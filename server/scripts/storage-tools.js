'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { ensureDirectory } = require('../data-paths');
const PROJECT_DIR = path.resolve(__dirname, '../..');

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function privateOutput(output, dataDir) {
  if (!output) throw new Error('An explicit --output outside the repository and DATA_DIR is required');
  const resolved = path.resolve(output);
  // First check lexical paths so a rejected destination creates no source directories.
  if (isWithin(PROJECT_DIR, resolved) || isWithin(path.resolve(dataDir), resolved)) {
    throw new Error('Backups must be outside the repository and live DATA_DIR. Download to private offsite storage.');
  }
  ensureDirectory(path.dirname(resolved));
  const real = path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved));
  if (isWithin(fs.realpathSync(PROJECT_DIR), real) || isWithin(fs.realpathSync(dataDir), real)) {
    throw new Error('Backup destination resolves inside the repository or live DATA_DIR');
  }
  for (let current = path.dirname(real); ; current = path.dirname(current)) {
    const gitMarker = path.join(current, '.git');
    if (fs.existsSync(gitMarker) && (fs.statSync(gitMarker).isFile() || fs.existsSync(path.join(gitMarker, 'HEAD')))) {
      throw new Error('Backups must never be written inside a Git repository');
    }
    if (path.dirname(current) === current) break;
  }
  if (fs.existsSync(real)) throw new Error('Backup destination already exists; never overwrite a backup');
  return real;
}

function listFiles(root, relative = '') {
  if (!fs.existsSync(root)) return [];
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Expected a real directory: ' + root);
  const files = [];
  for (const name of fs.readdirSync(root).sort()) {
    const full = path.join(root, name);
    const entry = fs.lstatSync(full);
    const portable = relative ? `${relative}/${name}` : name;
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not allowed in recovery bundles: ' + portable);
    if (entry.isDirectory()) files.push(...listFiles(full, portable));
    else if (entry.isFile()) files.push({ path: portable, size: entry.size });
    else throw new Error('Unsupported recovery file: ' + portable);
  }
  return files;
}

function sha256(filename) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filename, 'r');
  try {
    const buffer = Buffer.alloc(64 * 1024);
    let bytes;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes));
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}

function syncFile(filename) {
  const fd = fs.openSync(filename, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function syncDirectory(directory) {
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function inspectDatabase(filename, uploadsDir) {
  const db = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('SQLite integrity_check failed');
    if (db.pragma('foreign_key_check').length) throw new Error('SQLite foreign_key_check failed');
    // Prevent restoring an unrelated SQLite database as hotel data.
    for (const table of ['reservas_hotel', 'usuarios', 'config_hotel', 'documentos_reserva']) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
        throw new Error('Not a complete Hotel Panamá Canal database: missing ' + table);
      }
    }
    if (uploadsDir) {
      const docs = db.prepare('SELECT nombre_archivo FROM documentos_reserva').all();
      for (const doc of docs) {
        const name = doc.nombre_archivo;
        if (!name || path.basename(name) !== name || name.includes('\\')) throw new Error('Unsafe document filename in database');
        const full = path.join(uploadsDir, name);
        if (!fs.existsSync(full) || !fs.lstatSync(full).isFile() || fs.lstatSync(full).isSymbolicLink()) {
          throw new Error('Referenced guest document is missing from backup: ' + name);
        }
      }
    }
  } finally { db.close(); }
}

async function nativeBackup(source, destination) {
  if (!fs.existsSync(source)) throw new Error('Source database does not exist; refusing to initialize one');
  const fd = fs.openSync(destination, 'wx', 0o600);
  fs.closeSync(fd);
  let db;
  try {
    db = new Database(source, { readonly: true, fileMustExist: true, timeout: 5000 });
    await db.backup(destination); // SQLite online backup includes committed WAL data.
    db.close();
    db = null;
    const snapshot = new Database(destination, { fileMustExist: true });
    try { snapshot.pragma('journal_mode = DELETE'); } finally { snapshot.close(); }
    inspectDatabase(destination);
    syncFile(destination);
  } catch (error) {
    if (db?.open) db.close();
    fs.rmSync(destination, { force: true });
    throw error;
  }
}

function verifyBundle(root) {
  const entries = listFiles(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.format !== 'hotel-panama-canal-backup-v1' || manifest.consistency !== 'offline-db-and-uploads' || !Array.isArray(manifest.files)) {
    throw new Error('Unsupported or incomplete backup manifest');
  }
  const actual = new Map(entries.filter(entry => entry.path !== 'manifest.json').map(entry => [entry.path, entry]));
  const seen = new Set();
  for (const entry of manifest.files) {
    if (typeof entry.path !== 'string' || (!entry.path.startsWith('uploads/') && entry.path !== 'database.sqlite') ||
        entry.path.includes('\\') || path.posix.normalize(entry.path) !== entry.path ||
        entry.path.split('/').some(part => !part || part === '.' || part === '..') || seen.has(entry.path)) {
      throw new Error('Invalid or duplicate manifest path');
    }
    seen.add(entry.path);
    const onDisk = actual.get(entry.path);
    if (!onDisk || onDisk.size !== entry.size || !/^[a-f0-9]{64}$/.test(entry.sha256) || sha256(path.join(root, entry.path)) !== entry.sha256) {
      throw new Error('Backup checksum/size mismatch: ' + entry.path);
    }
  }
  if (!seen.has('database.sqlite') || actual.size !== seen.size) throw new Error('Backup contains missing or unlisted files');
  inspectDatabase(path.join(root, 'database.sqlite'), path.join(root, 'uploads'));
  return manifest;
}

function checkSpace(directory, bytes) {
  const stats = fs.statfsSync(directory);
  const available = stats.bavail * stats.bsize;
  if (available < bytes * 1.1 + 16 * 1024 * 1024) throw new Error('Insufficient free space for a verified recovery copy');
}

module.exports = { privateOutput, listFiles, sha256, syncFile, syncDirectory, inspectDatabase, nativeBackup, verifyBundle, checkSpace, isWithin };
