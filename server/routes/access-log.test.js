import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const express = require('express');
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-access-'));
process.env.TEST_DB_NAME = 'access.db';
process.env.EXTERNAL_INTEGRATIONS_ENABLED = 'false';
process.env.NOTIFICATIONS_ENABLED = 'false';
const { getDb, resetDb } = require('../db/database');
const { hashPassword, generateToken, hashApiKey } = require('../auth');
const { DB_PATH } = require('../data-paths');
let db, server, base, userId;
const tokens = {};
const password = 'fictional-test-only-password';
async function request(route, role, body) {
  const headers = {};
  if (role) headers.Authorization = `Bearer ${tokens[role]}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + route, { headers, method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
beforeAll(async () => {
  db = getDb();
  for (const rol of ['admin', 'receptionist', 'cleaning']) {
    const u = { email: `${rol}@access.example.invalid`, nombre: `Fictional ${rol}`, rol };
    u.id = Number(db.prepare('INSERT INTO usuarios (email, nombre, rol, password_hash) VALUES (?, ?, ?, ?)').run(u.email, u.nombre, rol, hashPassword(password)).lastInsertRowid);
    tokens[rol] = generateToken(u);
    if (rol === 'admin') userId = u.id;
  }
  const app = express();
  app.use(express.json());
  app.use('/auth', require('./auth'));
  app.use('/admin', require('./admin'));
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  resetDb();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});
describe('Persistent authentication history', () => {
  it('starts empty with no reconstructed last access', async () => {
    expect(db.prepare('SELECT count(*) n FROM accesos_log').get().n).toBe(0);
    const users = await request('/admin/usuarios', 'admin');
    expect(users.body.data.every(u => u.ultimo_acceso === null)).toBe(true);
  });
  it('records success and all ordinary failures without submitted secrets or unknown identifiers', async () => {
    const success = await request('/auth/login', null, { email: ' ADMIN@access.example.invalid ', password });
    expect(success.status).toBe(200);
    const first = db.prepare('SELECT * FROM accesos_log ORDER BY id DESC LIMIT 1').get();
    expect(first.usuario_id).toBe(userId);
    expect(first.resultado).toBe('exitoso');
    for (const body of [
      { email: 'admin@access.example.invalid', password: 'wrong-secret' },
      { email: 'unknown-secret@example.invalid', password: 'wrong-secret' },
      {}, { email: {}, password: [] }
    ]) expect([400, 401]).toContain((await request('/auth/login', null, body)).status);
    db.prepare('UPDATE usuarios SET activo = 0 WHERE id = ?').run(userId);
    expect((await request('/auth/login', null, { email: 'admin@access.example.invalid', password })).status).toBe(403);
    db.prepare('UPDATE usuarios SET activo = 1 WHERE id = ?').run(userId);
    const rows = db.prepare('SELECT * FROM accesos_log ORDER BY id').all();
    expect(rows.map(r => r.resultado)).toEqual(['exitoso', 'fallido', 'fallido', 'fallido', 'fallido', 'fallido']);
    expect(rows.map(r => r.usuario_id)).toEqual([userId, userId, null, null, null, userId]);
    expect(Object.keys(rows[0]).sort()).toEqual(['fecha', 'id', 'resultado', 'usuario_id']);
    const history = await request('/admin/accesos', 'admin');
    const serialized = JSON.stringify(history.body);
    for (const secret of [password, 'wrong-secret', 'unknown-secret', success.body.data.token, 'password_hash', 'ip']) expect(serialized).not.toContain(secret);
    const users = await request('/admin/usuarios', 'admin');
    expect(users.body.data.find(u => u.id === userId).ultimo_acceso).toBe(first.fecha);
    expect((await request('/auth/me', 'admin')).body.data).not.toHaveProperty('ultimo_acceso');
  });
  it('denies reception, housekeeping, anonymous and immediately downgraded administrators', async () => {
    for (const role of ['cleaning', 'receptionist', null]) {
      for (const route of ['/admin/accesos', '/admin/usuarios']) expect((await request(route, role)).status).toBe(role ? 403 : 401);
    }
    db.prepare("UPDATE usuarios SET rol = 'receptionist' WHERE id = ?").run(userId);
    expect((await request('/admin/accesos', 'admin')).status).toBe(403);
    db.prepare("UPDATE usuarios SET rol = 'admin' WHERE id = ?").run(userId);
  });
  it('denies read/write API keys and never returns a token if logging fails', async () => {
    for (const permission of ['read', 'write']) {
      const key = `fictional-key-${permission}`;
      db.prepare('INSERT INTO api_keys (key_hash, key_preview, nombre, permisos) VALUES (?, ?, ?, ?)').run(hashApiKey(key), permission, 'Fictional', permission);
      const res = await fetch(base + '/admin/accesos', { headers: { 'x-api-key': key } });
      expect(res.status).toBe(403);
    }
    const original = db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare').mockImplementation(sql => {
      if (sql.startsWith('INSERT INTO accesos_log')) throw new Error('fictional-secret-in-error');
      return original(sql);
    });
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await request('/auth/login', null, { email: 'admin@access.example.invalid', password });
      expect(res.status).toBe(500);
      expect(res.body).not.toHaveProperty('data');
      expect(JSON.stringify(logs.mock.calls)).not.toContain('fictional-secret');
    } finally { spy.mockRestore(); logs.mockRestore(); }
  });
  it('paginates without duplicates and rejects malformed cursors', async () => {
    const insert = db.prepare("INSERT INTO accesos_log (resultado) VALUES ('fallido')");
    for (let i = 0; i < 55; i++) insert.run();
    const first = (await request('/admin/accesos', 'admin')).body;
    expect(first.data).toHaveLength(50);
    const second = (await request(`/admin/accesos?before=${first.meta.next}`, 'admin')).body;
    expect(second.data).toHaveLength(11);
    expect(second.meta.next).toBe(null);
    expect(new Set([...first.data, ...second.data].map(r => r.id)).size).toBe(61);
    expect((await request('/admin/accesos?before=bad', 'admin')).status).toBe(400);
  });
  it('survives a separate process and backs up an existing database before additive migration', () => {
    const usersBefore = db.prepare('SELECT * FROM usuarios ORDER BY id').all();
    const reservationsBefore = db.prepare('SELECT * FROM reservas_hotel ORDER BY id').all();
    resetDb();
    const modulePath = path.resolve(__dirname, '../db/database');
    const run = code => {
      const result = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: process.env });
      expect(result.status, result.stderr).toBe(0);
    };
    run(`const {getDb,resetDb}=require(${JSON.stringify(modulePath)}); const db=getDb(); if(db.prepare('SELECT count(*) n FROM accesos_log').get().n!==61) process.exit(2); if(!db.prepare(\"SELECT fecha FROM accesos_log WHERE usuario_id=${userId} AND resultado='exitoso' ORDER BY id DESC LIMIT 1\").get()) process.exit(3); resetDb();`);
    // Simulate the previous deployed schema using fictional existing accounts.
    const old = new Database(DB_PATH);
    old.exec('DROP TABLE accesos_log'); old.close();
    run(`const assert=require('node:assert/strict'); const Database=require('better-sqlite3'); const original=Database.prototype.prepare; Database.prototype.prepare=function(sql){if(sql==='VACUUM INTO ?') throw new Error('Fictional backup failure'); return original.call(this,sql);}; const {getDb}=require(${JSON.stringify(modulePath)}); assert.throws(getDb,/Fictional backup failure/); const db=new Database(${JSON.stringify(DB_PATH)}); assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='accesos_log'").get(),undefined); db.close();`);
    run(`const {getDb,resetDb}=require(${JSON.stringify(modulePath)}); const db=getDb(); if(db.prepare('SELECT count(*) n FROM accesos_log').get().n!==0) process.exit(2); resetDb();`);
    const backups = fs.readdirSync(process.env.DATA_DIR).filter(n => n.includes('.before-access-log-'));
    expect(backups).toHaveLength(1);
    const backup = new Database(path.join(process.env.DATA_DIR, backups[0]), { readonly: true });
    expect(backup.prepare('SELECT * FROM usuarios ORDER BY id').all()).toEqual(usersBefore);
    expect(backup.prepare('SELECT * FROM reservas_hotel ORDER BY id').all()).toEqual(reservationsBefore);
    expect(backup.prepare("SELECT name FROM sqlite_master WHERE name='accesos_log'").get()).toBeUndefined();
    backup.close();
    db = getDb();
    expect(db.prepare('SELECT * FROM usuarios ORDER BY id').all()).toEqual(usersBefore);
    expect(db.prepare('SELECT * FROM reservas_hotel ORDER BY id').all()).toEqual(reservationsBefore);
    expect(fs.readdirSync(process.env.DATA_DIR).filter(n => n.includes('.before-access-log-'))).toHaveLength(1);
  });
});
