'use strict';
// Fictional, isolated disk fixtures only. Nothing is written into the repository.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-persistence-'));
process.env.NODE_ENV = 'development';
process.env.DATA_DIR = path.join(root, 'live');
process.env.EXTERNAL_INTEGRATIONS_ENABLED = 'false';
delete process.env.INITIAL_ADMIN_EMAIL;
delete process.env.INITIAL_ADMIN_PASSWORD;
const { getDb, resetDb } = require('../db/database');
const paths = require('../data-paths');
const { createBackup } = require('../scripts/backup');
const { restoreBackup } = require('../scripts/restore');
const { verifyBundle } = require('../scripts/storage-tools');
const dbModule = path.resolve(__dirname, '../db/database');
function run(code, env = {}) {
  const result = spawnSync(process.execPath, ['-e', code], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 15000 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || String(result.error));
  return result;
}

(async () => {
  try {
    let db = getDb();
    assert.equal(db.prepare('SELECT count(*) n FROM reservas_hotel').get().n, 0);
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.pragma('synchronous', { simple: true }), 2);
    db.prepare("INSERT INTO habitaciones (nombre,tipo) VALUES ('Fictional room','Estándar')").run();
    db.prepare("INSERT INTO reservas_hotel (cliente,check_in,check_out,habitacion_id) VALUES ('Fictional Guest','2030-01-01','2030-01-02',1)").run();
    db.prepare("INSERT INTO documentos_reserva (reserva_id,tipo,nombre_archivo) VALUES (1,'otro','fictional.pdf')").run();
    fs.mkdirSync(paths.UPLOADS_DIR, { recursive: true });
    const contents = '%PDF-1.4 fictional recovery test only';
    fs.writeFileSync(path.join(paths.UPLOADS_DIR, 'fictional.pdf'), contents);
    require('../notifications').logNotification(db, 1, 'fictional-test', 'email', 'nobody@example.invalid', { sent: false });
    assert.ok(fs.existsSync(path.join(paths.LOGS_DIR, 'notifications.log')), 'notifications must respect DATA_DIR');
    assert.equal(require('../utils/upload').UPLOADS_DIR, paths.UPLOADS_DIR);

    // WAL data is captured by the native online API while the PMS holds its lease.
    db.prepare("INSERT INTO config_hotel (clave,valor) VALUES ('persistence_probe','committed-in-wal')").run();
    const online = path.join(root, 'online.sqlite');
    await createBackup({ output: online, databaseOnly: true });
    const onlineDb = new Database(online, { readonly: true });
    assert.equal(onlineDb.prepare("SELECT valor FROM config_hotel WHERE clave='persistence_probe'").get().valor, 'committed-in-wal');
    onlineDb.close();
    await assert.rejects(createBackup({ output: path.join(root, 'full-while-running'), offline: true }), /Storage is in use/);
    await assert.rejects(createBackup({ output: path.join(paths.DATA_DIR, 'unsafe'), databaseOnly: true }), /outside the repository/);
    await assert.rejects(createBackup({ output: online, databaseOnly: true }), /already exists/);
    await assert.rejects(createBackup({ output: path.join(root, 'no-ack') }), /require --offline/);

    resetDb();
    run(`const assert=require('node:assert/strict'); const {getDb,resetDb}=require(${JSON.stringify(dbModule)}); const db=getDb(); assert.equal(db.prepare('SELECT cliente FROM reservas_hotel WHERE id=1').get().cliente,'Fictional Guest'); assert.equal(db.prepare('SELECT count(*) n FROM habitaciones').get().n,1); resetDb();`);
    db = getDb();
    assert.equal(db.prepare('SELECT count(*) n FROM documentos_reserva').get().n, 1, 'documents survive reopening');
    resetDb();

    const full = path.join(root, 'full');
    await createBackup({ output: full, offline: true });
    assert.equal(verifyBundle(full).files.length, 2);
    assert.ok(!fs.existsSync(path.join(full, '.env')));
    assert.throws(() => restoreBackup({ from: full, dataDir: paths.DATA_DIR, offline: true }), /refuses existing database/);
    assert.throws(() => restoreBackup({ from: full, dataDir: path.join(root, 'no-offline') }), /requires/);
    const restored = path.join(root, 'restored');
    restoreBackup({ from: full, dataDir: restored, offline: true });
    assert.equal(fs.readFileSync(path.join(restored, 'uploads/fictional.pdf'), 'utf8'), contents);
    run(`const assert=require('node:assert/strict'); const {getDb,resetDb}=require(${JSON.stringify(dbModule)}); const db=getDb(); assert.equal(db.prepare('SELECT cliente FROM reservas_hotel WHERE id=1').get().cliente,'Fictional Guest'); assert.equal(db.prepare('SELECT count(*) n FROM documentos_reserva').get().n,1); resetDb();`, { DATA_DIR: restored });
    assert.throws(() => restoreBackup({ from: full, dataDir: restored, offline: true }), /refuses existing database/);

    // A maintenance lease blocks both restore and normal PMS startup.
    const blocked = paths.resolveDataPaths({ DATA_DIR: path.join(root, 'blocked') });
    const release = paths.acquireStorageLease(blocked);
    try {
      assert.throws(() => restoreBackup({ from: full, dataDir: blocked.DATA_DIR, offline: true }), /Storage is in use/);
      const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(dbModule)}).getDb()`], { env: { ...process.env, DATA_DIR: blocked.DATA_DIR }, encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Storage is in use/);
    } finally { release(); }

    fs.appendFileSync(path.join(full, 'uploads/fictional.pdf'), 'tamper');
    assert.throws(() => restoreBackup({ from: full, dataDir: path.join(root, 'tampered'), offline: true }), /checksum\/size mismatch/);
    fs.writeFileSync(path.join(full, 'uploads/fictional.pdf'), contents);
    fs.symlinkSync(online, path.join(full, 'unexpected-link'));
    assert.throws(() => verifyBundle(full), /Symlinks/);
    fs.unlinkSync(path.join(full, 'unexpected-link'));
    fs.writeFileSync(path.join(restored, '.restore-incomplete'), 'interrupted test');
    const interrupted = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(dbModule)}).getDb()`], { env: { ...process.env, DATA_DIR: restored }, encoding: 'utf8' });
    assert.notEqual(interrupted.status, 0);
    assert.match(interrupted.stderr, /interrupted restore/);

    // OS releases the lease after an ungraceful process death: restart is possible.
    const crashDir = path.join(root, 'crash');
    const child = spawn(process.execPath, ['-e', `require(${JSON.stringify(dbModule)}).getDb(); process.send('ready'); setInterval(()=>{},1000);`], { env: { ...process.env, DATA_DIR: crashDir }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error('Crash fixture exited before ready')); }); });
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGKILL');
    await exited;
    run(`const d=require(${JSON.stringify(dbModule)}); d.getDb(); d.resetDb();`, { DATA_DIR: crashDir });

    // Maintenance serves no hotel routes, touches no main DB and runs no scheduler.
    run(`const assert=require('node:assert/strict'); const fs=require('node:fs'); const {server}=require(${JSON.stringify(path.resolve(__dirname, '../server'))}); server.on('listening',async()=>{try{const base='http://127.0.0.1:'+server.address().port; const health=await(await fetch(base+'/health')).json();assert.equal(health.status,'maintenance');assert.equal((await fetch(base+'/api/v1/hotel/reservas',{method:'POST'})).status,503);assert.ok(!fs.existsSync(require(${JSON.stringify(path.resolve(__dirname, '../data-paths'))}).DB_PATH));server.close(()=>process.exit(0));}catch(e){console.error(e);process.exit(1);}});`, { DATA_DIR: path.join(root, 'maintenance'), STORAGE_MAINTENANCE_MODE: 'true', PORT: '0' });
    console.log('Persistence smoke passed: reopen/restart, committed WAL native backup, full DB+uploads restore, checksums, no-overwrite/offline guards, crash-released lease, isolated logs, and maintenance mode.');
  } finally {
    resetDb();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
