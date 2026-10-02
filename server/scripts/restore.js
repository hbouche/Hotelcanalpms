#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { resolveDataPaths, acquireStorageLease, ensureDirectory } = require('../data-paths');
const { verifyBundle, syncFile, syncDirectory, checkSpace, isWithin } = require('./storage-tools');

function restoreBackup({ from, dataDir, offline = false }) {
  if (!offline || !from || !dataDir) throw new Error('Restore requires --from, explicit --data-dir, and --offline');
  const source = fs.realpathSync(path.resolve(from));
  const paths = resolveDataPaths({ NODE_ENV: 'production', DATA_DIR: dataDir });
  ensureDirectory(paths.DATA_DIR);
  if (isWithin(fs.realpathSync(paths.DATA_DIR), source) || isWithin(source, fs.realpathSync(paths.DATA_DIR))) {
    throw new Error('The backup and restore destination must be separate directories');
  }
  const release = acquireStorageLease(paths);
  let staging;
  let uploadsInstalled = false;
  let databaseInstalled = false;
  let markerCreated = false;
  try {
    if (fs.existsSync(paths.RESTORE_MARKER)) throw new Error('An interrupted restore requires operator inspection; no files were overwritten');
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      if (fs.existsSync(paths.DB_PATH + suffix)) throw new Error('Restore refuses existing database files. Use a new DATA_DIR and retain the old data.');
    }
    if (fs.existsSync(paths.UPLOADS_DIR) && (!fs.lstatSync(paths.UPLOADS_DIR).isDirectory() || fs.lstatSync(paths.UPLOADS_DIR).isSymbolicLink() || fs.readdirSync(paths.UPLOADS_DIR).length)) {
      throw new Error('Restore refuses an existing nonempty uploads directory');
    }
    const manifest = verifyBundle(source);
    checkSpace(paths.DATA_DIR, manifest.files.reduce((sum, entry) => sum + entry.size, 0));
    staging = fs.mkdtempSync(path.join(paths.DATA_DIR, '.restore-staging-'));
    ensureDirectory(path.join(staging, 'uploads'));
    for (const entry of manifest.files) {
      const target = path.join(staging, entry.path);
      ensureDirectory(path.dirname(target));
      fs.copyFileSync(path.join(source, entry.path), target, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(target, 0o600);
      syncFile(target);
      syncDirectory(path.dirname(target));
    }
    fs.copyFileSync(path.join(source, 'manifest.json'), path.join(staging, 'manifest.json'));
    verifyBundle(staging);
    fs.writeFileSync(paths.RESTORE_MARKER, 'Restore in progress. Do not start the PMS until the complete database and uploads have been verified.\n', { flag: 'wx', mode: 0o600 });
    markerCreated = true;
    syncFile(paths.RESTORE_MARKER);
    syncDirectory(paths.DATA_DIR);
    if (fs.existsSync(paths.UPLOADS_DIR)) fs.rmdirSync(paths.UPLOADS_DIR); // Verified empty above, with exclusive lease.
    fs.renameSync(path.join(staging, 'uploads'), paths.UPLOADS_DIR);
    uploadsInstalled = true;
    // A same-disk hard link publishes atomically and cannot overwrite an existing DB.
    fs.linkSync(path.join(staging, 'database.sqlite'), paths.DB_PATH);
    databaseInstalled = true;
    syncDirectory(paths.DATA_DIR);
    fs.unlinkSync(paths.RESTORE_MARKER);
    markerCreated = false;
    syncDirectory(paths.DATA_DIR);
    return { dataDir: paths.DATA_DIR, files: manifest.files.length, restoredAt: new Date().toISOString() };
  } catch (error) {
    // Roll back only files this invocation installed. Never remove pre-existing records.
    if (databaseInstalled) fs.unlinkSync(paths.DB_PATH);
    if (uploadsInstalled) fs.rmSync(paths.UPLOADS_DIR, { recursive: true, force: true });
    if (markerCreated) fs.unlinkSync(paths.RESTORE_MARKER);
    throw error;
  } finally {
    if (staging) fs.rmSync(staging, { recursive: true, force: true });
    release();
  }
}

if (require.main === module) {
  try {
    const { values } = parseArgs({ options: { from: { type: 'string' }, 'data-dir': { type: 'string' }, offline: { type: 'boolean' }, help: { type: 'boolean' } } });
    if (values.help) console.log('node server/scripts/restore.js --from /private/backup-directory --data-dir /var/data/recovered-hotel --offline\nPMS must be stopped or in storage maintenance. Existing data is never overwritten.');
    else console.log(JSON.stringify(restoreBackup({ from: values.from, dataDir: values['data-dir'], offline: values.offline })));
  } catch (error) { console.error('Restore failed:', error.message); process.exitCode = 1; }
}
module.exports = { restoreBackup };
