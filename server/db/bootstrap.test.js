import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');

// Exercise the real production bootstrap without loading fixture users, and keep
// all data/credentials confined to this disposable test process and directory.
process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-bootstrap-'));
process.env.EXTERNAL_INTEGRATIONS_ENABLED = 'false';
delete process.env.INITIAL_ADMIN_EMAIL;
delete process.env.INITIAL_ADMIN_PASSWORD;
const { getDb, resetDb } = require('./database');
const { DB_PATH } = require('../data-paths');
const authRouter = require('../routes/auth');
const password = 'isolated-bootstrap-test-password';
let server, baseUrl;

async function login(email, suppliedPassword = password) {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: suppliedPassword }),
  });
  return { status: response.status, data: await response.json() };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  delete process.env.INITIAL_ADMIN_EMAIL;
  delete process.env.INITIAL_ADMIN_PASSWORD;
});

afterEach(() => {
  resetDb();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

describe('First administrator production bootstrap', () => {
  it('keeps an installation without supplied credentials empty', () => {
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM usuarios').get().c).toBe(0);
  });

  it('creates a normalized initial administrator that can log in with either email spelling', async () => {
    process.env.INITIAL_ADMIN_EMAIL = '  First.Admin@Example.INVALID  ';
    process.env.INITIAL_ADMIN_PASSWORD = password;
    const user = getDb().prepare('SELECT * FROM usuarios').get();
    expect(user.email).toBe('first.admin@example.invalid');
    expect(user.rol).toBe('admin');
    expect(user.activo).toBe(1);
    for (const email of ['first.admin@example.invalid', '  First.Admin@Example.INVALID  ']) {
      const result = await login(email);
      expect(result.status).toBe(200);
      expect(result.data.data.user.email).toBe('first.admin@example.invalid');
      const me = await fetch(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${result.data.data.token}` } });
      expect(me.status).toBe(200);
      expect((await me.json()).data).toEqual({ id: user.id, nombre: 'Administrador', email: 'first.admin@example.invalid', rol: 'admin' });
    }
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM usuarios').get().c).toBe(1);
  });

  it('accepts exactly eight characters for the first administrator and authenticates it', async () => {
    const eightCharacters = 'testOnly'; // Fictional fixture, never used outside this temporary database.
    expect(eightCharacters).toHaveLength(8);
    process.env.INITIAL_ADMIN_EMAIL = 'eight@example.invalid';
    process.env.INITIAL_ADMIN_PASSWORD = eightCharacters;
    const user = getDb().prepare('SELECT * FROM usuarios').get();
    expect(user.email).toBe('eight@example.invalid');
    expect(user.rol).toBe('admin');
    expect((await login(user.email, eightCharacters)).status).toBe(200);
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM usuarios').get().c).toBe(1);
    // A later bootstrap value does not reset that account, even below the minimum.
    resetDb();
    process.env.INITIAL_ADMIN_PASSWORD = 'fixture';
    expect(getDb().prepare('SELECT * FROM usuarios').all()).toEqual([user]);
    expect((await login(user.email, eightCharacters)).status).toBe(200);
    expect((await login(user.email, 'fixture')).status).toBe(401);
  });

  it('rejects seven characters for bootstrap without creating an administrator', () => {
    process.env.INITIAL_ADMIN_EMAIL = 'seven@example.invalid';
    process.env.INITIAL_ADMIN_PASSWORD = 'fixture';
    expect(process.env.INITIAL_ADMIN_PASSWORD).toHaveLength(7);
    expect(() => getDb()).toThrow('INITIAL_ADMIN_PASSWORD must have at least 8 characters');
    const Database = require('better-sqlite3');
    const inspected = new Database(DB_PATH, { readonly: true });
    try { expect(inspected.prepare('SELECT COUNT(*) AS c FROM usuarios').get().c).toBe(0); }
    finally { inspected.close(); }
  });

  it.each(['invalid-email', 'double@@example.invalid', '   ', 'person@example'])('rejects an invalid supplied bootstrap email before creating any user (%s)', email => {
    process.env.INITIAL_ADMIN_EMAIL = email;
    process.env.INITIAL_ADMIN_PASSWORD = password;
    expect(() => getDb()).toThrow('INITIAL_ADMIN_EMAIL must be a valid email address');
    const Database = require('better-sqlite3');
    const inspected = new Database(DB_PATH, { readonly: true });
    try { expect(inspected.prepare('SELECT COUNT(*) AS c FROM usuarios').get().c).toBe(0); }
    finally { inspected.close(); }
  });

  it('does not replace, duplicate, or reset the existing administrator on later initialization', async () => {
    process.env.INITIAL_ADMIN_EMAIL = ' First.Admin@Example.INVALID ';
    process.env.INITIAL_ADMIN_PASSWORD = password;
    const original = getDb().prepare('SELECT * FROM usuarios').get();
    resetDb();
    process.env.INITIAL_ADMIN_EMAIL = 'different@example.invalid';
    process.env.INITIAL_ADMIN_PASSWORD = 'different-isolated-test-password';
    expect(getDb().prepare('SELECT * FROM usuarios').all()).toEqual([original]);
    expect((await login('first.admin@example.invalid')).status).toBe(200);
    expect((await login('first.admin@example.invalid', process.env.INITIAL_ADMIN_PASSWORD)).status).toBe(401);
    expect((await login('different@example.invalid', process.env.INITIAL_ADMIN_PASSWORD)).status).toBe(401);
    // Invalid stale bootstrap settings also must not lock out an existing user.
    resetDb();
    process.env.INITIAL_ADMIN_EMAIL = 'invalid-stale-setting';
    process.env.INITIAL_ADMIN_PASSWORD = 'short';
    expect(getDb().prepare('SELECT * FROM usuarios').all()).toEqual([original]);
    expect((await login('first.admin@example.invalid')).status).toBe(200);
  });
});
