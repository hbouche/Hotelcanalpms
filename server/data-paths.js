'use strict';
const fs = require('node:fs');
const path = require('node:path');

// All mutable application state lives below this one explicitly selected root.
// Never infer an unrelated /data mount: a new installation must stay independent.
function resolveDataPaths(env = process.env) {
  const DATA_DIR = path.resolve(env.DATA_DIR || path.join(__dirname, '../data'));
  const DB_NAME = env.NODE_ENV === 'test' ? (env.TEST_DB_NAME || 'hotel-canal-test.db') : 'hotel-canal.db';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.db$/.test(DB_NAME)) {
    throw new Error('TEST_DB_NAME must be a plain .db filename, not a path');
  }
  return {
    DATA_DIR,
    DB_NAME,
    DB_PATH: path.join(DATA_DIR, DB_NAME),
    UPLOADS_DIR: path.join(DATA_DIR, 'uploads'),
    LOGS_DIR: path.join(DATA_DIR, 'logs'),
    STORAGE_LOCK_PATH: path.join(DATA_DIR, `.${DB_NAME}.storage-lock.sqlite`),
    RESTORE_MARKER: path.join(DATA_DIR, '.restore-incomplete'),
  };
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

// A separate SQLite exclusive transaction is an OS-released storage lease.
// It survives neither process exit nor a crash, unlike a stale PID/lock file.
// Every PMS database user and offline maintenance command must acquire it.
function acquireStorageLease(paths = resolveDataPaths()) {
  ensureDirectory(paths.DATA_DIR);
  const Database = require('better-sqlite3');
  let lease;
  try {
    lease = new Database(paths.STORAGE_LOCK_PATH, { timeout: 0 });
    fs.chmodSync(paths.STORAGE_LOCK_PATH, 0o600);
    lease.exec('BEGIN EXCLUSIVE');
  } catch (error) {
    if (lease?.open) lease.close();
    if (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED') {
      throw new Error('Storage is in use. Stop the PMS or start it in STORAGE_MAINTENANCE_MODE=true before full backup or restore.');
    }
    throw error;
  }
  let released = false;
  return () => {
    if (!released) {
      released = true;
      lease.close();
    }
  };
}

module.exports = { ...resolveDataPaths(), resolveDataPaths, ensureDirectory, acquireStorageLease };
