#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { resolveDataPaths, acquireStorageLease, ensureDirectory } = require('../data-paths');
const { privateOutput, listFiles, sha256, syncFile, syncDirectory, nativeBackup, verifyBundle, checkSpace } = require('./storage-tools');

async function createBackup({ dataDir, output, databaseOnly = false, offline = false }) {
  const paths = resolveDataPaths({ ...process.env, NODE_ENV: 'production', DATA_DIR: dataDir || process.env.DATA_DIR });
  if (!fs.existsSync(paths.DB_PATH)) throw new Error('Source hotel database is missing');
  if (fs.existsSync(paths.RESTORE_MARKER)) throw new Error('Resolve the interrupted restore before backing up');
  if (!databaseOnly && !offline) throw new Error('Full backups require --offline and the PMS stopped or in storage maintenance mode');
  const destination = privateOutput(output, paths.DATA_DIR);
  let release;
  let created = false;
  try {
    if (!databaseOnly) release = acquireStorageLease(paths);
    const uploads = databaseOnly ? [] : listFiles(paths.UPLOADS_DIR);
    const estimatedBytes = fs.statSync(paths.DB_PATH).size + (fs.existsSync(paths.DB_PATH + '-wal') ? fs.statSync(paths.DB_PATH + '-wal').size : 0) + uploads.reduce((sum, entry) => sum + entry.size, 0);
    checkSpace(path.dirname(destination), estimatedBytes);
    if (databaseOnly) {
      await nativeBackup(paths.DB_PATH, destination);
      return { output: destination, consistency: 'database-only', warning: 'Uploads are NOT included. This is not a full hotel recovery bundle.' };
    }
    fs.mkdirSync(destination, { mode: 0o700 });
    created = true;
    await nativeBackup(paths.DB_PATH, path.join(destination, 'database.sqlite'));
    ensureDirectory(path.join(destination, 'uploads'));
    for (const entry of uploads) {
      const target = path.join(destination, 'uploads', entry.path);
      ensureDirectory(path.dirname(target));
      fs.copyFileSync(path.join(paths.UPLOADS_DIR, entry.path), target, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(target, 0o600);
      syncFile(target);
      syncDirectory(path.dirname(target));
    }
    const files = listFiles(destination).map(entry => ({ ...entry, sha256: sha256(path.join(destination, entry.path)) }));
    const manifest = {
      format: 'hotel-panama-canal-backup-v1',
      consistency: 'offline-db-and-uploads',
      createdAt: new Date().toISOString(),
      files,
      notes: 'Contains private hotel records, password hashes and uploaded documents. Keep encrypted offsite. Runtime secrets and diagnostic log files are not included.',
    };
    const manifestPath = path.join(destination, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    syncFile(manifestPath);
    verifyBundle(destination);
    syncDirectory(destination);
    syncDirectory(path.dirname(destination));
    return { output: destination, consistency: manifest.consistency, files: files.length };
  } catch (error) {
    if (created) fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  } finally { if (release) release(); }
}

if (require.main === module) {
  (async () => {
    const { values } = parseArgs({ options: {
      output: { type: 'string' }, 'data-dir': { type: 'string' },
      'database-only': { type: 'boolean' }, offline: { type: 'boolean' }, help: { type: 'boolean' },
    } });
    if (values.help) {
      console.log('Full: node server/scripts/backup.js --output /private/backup-directory --offline [--data-dir /var/data/hotel-panama-canal]\nOnline DB only: add --database-only (uploads excluded). Destinations must be new and outside DATA_DIR and the repository.');
      return;
    }
    console.log(JSON.stringify(await createBackup({ output: values.output, dataDir: values['data-dir'], databaseOnly: values['database-only'], offline: values.offline })));
  })().catch(error => { console.error('Backup failed:', error.message); process.exitCode = 1; });
}
module.exports = { createBackup };
