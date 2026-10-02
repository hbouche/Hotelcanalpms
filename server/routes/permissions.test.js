import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

// A separate, disposable database and uploads directory. No real users or data.
process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'housekeeping-permissions.db';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-permissions-'));
process.env.EXTERNAL_INTEGRATIONS_ENABLED = 'false';
process.env.CARD_PAYMENTS_ENABLED = 'false';
process.env.NOTIFICATIONS_ENABLED = 'false';

const { getDb, resetDb } = require('../db/database');
const { generateToken, hashApiKey } = require('../auth');
const { UPLOADS_DIR } = require('../data-paths');
const authRouter = require('./auth');
const hotelRouter = require('./hotel');
const roomsRouter = require('./habitaciones');
const crmRouter = require('./crm');
const adminRouter = require('./admin');

let db, server, baseUrl, roomId, reservationId, documentId;
const tokens = {};
const users = {};
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const roomFields = ['id', 'nombre', 'tipo', 'categoria', 'capacidad', 'capacidad_min', 'capacidad_max', 'descripcion_camas', 'piso', 'estado_limpieza', 'estado_habitacion', 'no_molestar', 'activa'];

async function request(endpoint, role = 'cleaning', method = 'GET', body, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (role) headers.Authorization = `Bearer ${tokens[role]}`;
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method, headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}

beforeAll(async () => {
  db = getDb();
  db.prepare('UPDATE configuracion_sistema SET notifications_enabled = 0, wa_enabled = 0 WHERE id = 1').run();
  const insertUser = db.prepare('INSERT INTO usuarios (email, password_hash, nombre, rol) VALUES (?, ?, ?, ?)');
  for (const role of ['admin', 'receptionist', 'cleaning']) {
    const user = { email: `${role}@permissions.example.invalid`, nombre: `Fictional ${role}`, rol: role };
    user.id = Number(insertUser.run(user.email, 'unused-test-hash', user.nombre, role).lastInsertRowid);
    users[role] = user;
    tokens[role] = generateToken(user);
  }
  roomId = Number(db.prepare(`INSERT INTO habitaciones (nombre, tipo, comentarios, asignado_a, no_molestar, estado_habitacion)
    VALUES ('PERM-TEST', 'Doble', 'Guest-only private note', 'Guest-only private assignment', 1, 'Ocupada')`).run().lastInsertRowid);
  reservationId = Number(db.prepare(`INSERT INTO reservas_hotel
    (cliente, apellido, email, telefono, whatsapp, nacionalidad, habitacion_id, check_in, check_out, noches, adultos, menores,
     estado, notas, monto_total, monto_pagado, saldo_pendiente, grupo_codigo, created_by)
    VALUES ('Private Guest', 'Private Surname', 'private@example.invalid', '+100000000', '+100000001', 'Private country', ?, ?, ?, 1, 2, 1,
      'Hospedado', 'Private reservation note', 1234.56, 234.56, 1000, 'PRIVATE-GROUP', 'Private creator')`).run(roomId, today, tomorrow).lastInsertRowid);
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_DIR, 'private-test-document.pdf'), '%PDF-1.4\nPrivate guest document');
  documentId = Number(db.prepare(`INSERT INTO documentos_reserva (reserva_id, tipo, nombre_original, nombre_archivo, mime_type)
    VALUES (?, 'pasaporte', 'private-passport.pdf', 'private-test-document.pdf', 'application/pdf')`).run(reservationId).lastInsertRowid);
  db.prepare(`INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto) VALUES (?, 'credito', 'Private payment note', 234.56)`).run(reservationId);
  db.prepare(`INSERT INTO leads_clientes (nombre, email) VALUES ('Private lead', 'lead@example.invalid')`).run();

  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/habitaciones', roomsRouter);
  app.use('/api/v1/crm', crmRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1', hotelRouter);
  app.use('/uploads', require('../public-uploads'), express.static(UPLOADS_DIR));
  server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  resetDb();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

describe('Housekeeping permissions through the actual HTTP middleware', () => {
  it('requires authentication even for the allowed housekeeping views', async () => {
    for (const endpoint of ['/api/v1/habitaciones', '/api/v1/hotel/dashboard', `/api/v1/hotel/calendario?desde=${today}&hasta=${tomorrow}`]) {
      expect((await request(endpoint, null)).status, endpoint).toBe(401);
    }
  });

  it('forbids every private route except the explicit housekeeping views/updates, before handlers or uploads run', async () => {
    const reservationCount = db.prepare('SELECT COUNT(*) AS c FROM reservas_hotel').get().c;
    const filesBefore = fs.readdirSync(UPLOADS_DIR).sort();
    for (const [prefix, router] of [['/api/v1', hotelRouter], ['/api/v1/crm', crmRouter], ['/api/v1/habitaciones', roomsRouter], ['/api/v1/admin', adminRouter]]) {
      for (const layer of router.stack.filter(layer => layer.route)) {
        const route = layer.route;
        for (const method of Object.keys(route.methods)) {
          if (router === hotelRouter && method === 'get' && ['/hotel/calendario', '/hotel/dashboard'].includes(route.path)) continue;
          if (router === roomsRouter && (method === 'get' && ['/', '/tipos', '/tipo-fotos'].includes(route.path)
            || method === 'patch' && ['/:id/limpieza', '/masiva'].includes(route.path))) continue;
          const endpoint = prefix + route.path.replace(/:[A-Za-z_]+/g, String(reservationId));
          const response = await request(endpoint, 'cleaning', method.toUpperCase(), method === 'get' ? undefined : {});
          const disabledIntegration = router === adminRouter && ['/configuracion/test-smtp', '/configuracion/test-resend'].includes(route.path);
          expect(response.status, `${method.toUpperCase()} ${endpoint}`).toBe(disabledIntegration ? 503 : 403);
          expect(response.data.error.code, endpoint).toBe(disabledIntegration ? 'INTEGRATIONS_DISABLED' : 'FORBIDDEN');
        }
      }
    }
    expect(db.prepare('SELECT COUNT(*) AS c FROM reservas_hotel').get().c).toBe(reservationCount);
    expect(fs.readdirSync(UPLOADS_DIR).sort()).toEqual(filesBefore);
  });

  it('shows anonymous occupancy, dates, do-not-disturb and cleanliness without guest/financial/free-text fields', async () => {
    const calendar = await request(`/api/v1/hotel/calendario?desde=${today}&hasta=${tomorrow}`);
    expect(calendar.status).toBe(200);
    expect(calendar.data.data.housekeeping).toBe(true);
    const reservation = calendar.data.data.reservas.find(row => row.id === reservationId);
    expect(reservation).toEqual({ id: reservationId, habitacion_id: roomId, check_in: today, check_out: tomorrow, estado: 'Hospedado', habitacion_nombre: 'PERM-TEST', habitacion_tipo: 'Doble' });
    const room = calendar.data.data.habitaciones.find(row => row.id === roomId);
    expect(Object.keys(room).sort()).toEqual([...roomFields].sort());
    expect(room.no_molestar).toBe(1);
    expect(room.estado_habitacion).toBe('Ocupada');
    expect(JSON.stringify(calendar.data)).not.toContain('Private');
    expect(JSON.stringify(calendar.data)).not.toContain('1234.56');

    const rooms = await request('/api/v1/habitaciones');
    expect(rooms.status).toBe(200);
    expect(rooms.data.data.find(row => row.id === roomId)).toEqual(room);
    expect((await request('/api/v1/habitaciones/tipos')).status).toBe(200);
    expect((await request('/api/v1/habitaciones/tipo-fotos')).status).toBe(200);
  });

  it('includes departures and same-day stays on the first visible calendar day for cleaning', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const insert = db.prepare(`INSERT INTO reservas_hotel (cliente, habitacion_id, check_in, check_out, estado)
      VALUES ('Fictional boundary guest', ?, ?, ?, 'Confirmada')`);
    const departingId = Number(insert.run(roomId, yesterday, today).lastInsertRowid);
    const sameDayId = Number(insert.run(roomId, today, today).lastInsertRowid);
    const result = await request(`/api/v1/hotel/calendario?desde=${today}&hasta=${tomorrow}`);
    expect(result.status).toBe(200);
    expect(result.data.data.reservas.map(row => row.id)).toEqual(expect.arrayContaining([departingId, sameDayId]));
    expect(JSON.stringify(result.data)).not.toContain('Fictional boundary guest');
  });

  it('provides a dedicated housekeeping dashboard with no guest histories or finances', async () => {
    const result = await request('/api/v1/hotel/dashboard?periodo=total');
    expect(result.status).toBe(200);
    expect(Object.keys(result.data.data).sort()).toEqual(['housekeeping', 'ocupacion', 'hoy', 'limpieza', 'limpieza_estadia', 'limpieza_pasadia'].sort());
    expect(result.data.data.housekeeping).toBe(true);
    expect(result.data.data.ocupacion.ocupadas).toBeGreaterThanOrEqual(1);
    expect(result.data.data.hoy.hospedados).toBeGreaterThanOrEqual(1);
    expect(result.data.data.limpieza).toContainEqual(expect.objectContaining({ estado_limpieza: 'Sucia' }));
    expect(JSON.stringify(result.data)).not.toContain('Private');
  });

  it('retains individual/bulk cleaning updates but cannot overwrite room operations or expose notes in the response', async () => {
    const cleaned = await request(`/api/v1/habitaciones/${roomId}/limpieza`, 'cleaning', 'PATCH', {
      estado_limpieza: 'Limpia', estado_habitacion: 'Vacía', comentarios: 'tampered', no_molestar: 0,
    });
    expect(cleaned.status).toBe(200);
    expect(cleaned.data.data.estado_limpieza).toBe('Limpia');
    expect(Object.keys(cleaned.data.data).sort()).toEqual([...roomFields].sort());
    expect(cleaned.data.data.estado_habitacion).toBe('Ocupada');
    expect(cleaned.data.data.no_molestar).toBe(1);
    expect(db.prepare('SELECT comentarios FROM habitaciones WHERE id = ?').get(roomId).comentarios).toBe('Guest-only private note');
    const bulk = await request('/api/v1/habitaciones/masiva', 'cleaning', 'PATCH', { ids: [roomId], estado_limpieza: 'Inspeccionada' });
    expect(bulk.status).toBe(200);
    expect(db.prepare('SELECT estado_limpieza FROM habitaciones WHERE id = ?').get(roomId).estado_limpieza).toBe('Inspeccionada');
    expect((await request(`/api/v1/habitaciones/${roomId}/limpieza`, 'cleaning', 'PATCH', { estado_limpieza: 'invalid' })).status).toBe(400);
    for (const [endpoint, method, body] of [
      [`/api/v1/habitaciones/${roomId}`, 'PATCH', { estado_habitacion: 'Vacía' }],
      [`/api/v1/habitaciones/${roomId}`, 'PUT', { nombre: 'tampered' }],
      [`/api/v1/habitaciones/${roomId}`, 'DELETE', {}],
      ['/api/v1/habitaciones', 'POST', { nombre: 'tampered', tipo: 'Doble' }],
      ['/api/v1/habitaciones/todas', 'GET'],
      ['/api/v1/habitaciones/tipo/Doble/foto', 'POST', {}],
      ['/api/v1/admin/usuarios', 'GET'],
    ]) expect((await request(endpoint, 'cleaning', method, body)).status, `${method} ${endpoint}`).toBe(403);
  });

  it('denies direct authenticated and public guest-document downloads to cleaning', async () => {
    expect((await request(`/api/v1/hotel/documentos/${documentId}/archivo`)).status).toBe(403);
    expect((await request('/uploads/private-test-document.pdf')).status).toBe(404);
    expect((await request(`/api/v1/hotel/documentos/${documentId}/archivo`, null)).status).toBe(401);
  });
});

describe('Operational roles and immediate role changes', () => {
  it.each(['admin', 'receptionist'])('preserves guest, document, payment, dashboard and CRM reads for %s', async role => {
    const detail = await request(`/api/v1/hotel/reservas/${reservationId}`, role);
    expect(detail.status).toBe(200);
    expect(detail.data.data.email).toBe('private@example.invalid');
    expect(detail.data.data.monto_total).toBe(1234.56);
    expect(detail.data.data.documentos[0].id).toBe(documentId);
    expect((await request(`/api/v1/hotel/documentos/${documentId}/archivo`, role)).data).toContain('Private guest document');
    for (const endpoint of ['/api/v1/hotel/dashboard', '/api/v1/hotel/saldos', '/api/v1/hotel/huespedes', '/api/v1/crm/leads', '/api/v1/reportes/financiero']) {
      expect((await request(endpoint, role)).status, endpoint).toBe(200);
    }
    const dashboard = await request('/api/v1/hotel/dashboard', role);
    expect(dashboard.data.data.financiero).toBeDefined();
    expect(dashboard.data.data.housekeeping).toBeUndefined();
  });

  it('preserves reception reservation, manual payment and document upload workflows while keeping admin-only configuration restricted', async () => {
    const start = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 32 * 86400000).toISOString().slice(0, 10);
    const created = await request('/api/v1/hotel/reservas', 'receptionist', 'POST', {
      cliente: 'Fictional reception workflow', habitacion_id: roomId, check_in: start, check_out: end, adultos: 2, precio_adulto_noche: 50,
    });
    expect(created.status).toBe(201);
    const id = created.data.data.id;
    const paid = await request(`/api/v1/hotel/reservas/${id}/folio`, 'receptionist', 'POST', { monto: 20, concepto: 'Fictional cash deposit', tipo: 'credito', metodo_pago: 'efectivo' });
    expect(paid.status).toBe(200);
    expect(paid.data.data.monto_pagado).toBe(20);
    const document = new FormData();
    document.set('tipo', 'recibo');
    document.set('archivo', new Blob(['%PDF-1.4\nFictional receipt'], { type: 'application/pdf' }), 'fictional-receipt.pdf');
    expect((await request(`/api/v1/hotel/reservas/${id}/documentos`, 'receptionist', 'POST', document)).status).toBe(201);
    expect((await request(`/api/v1/hotel/reservas/${id}/status`, 'receptionist', 'PATCH', { estado: 'Hospedado' })).status).toBe(200);
    expect((await request('/api/v1/crm/leads', 'receptionist', 'POST', { nombre: 'Fictional new lead' })).status).toBe(201);
    expect((await request('/api/v1/admin/usuarios', 'receptionist')).status).toBe(403);
    expect((await request('/api/v1/habitaciones', 'receptionist', 'POST', { nombre: 'Reception cannot configure', tipo: 'Doble' })).status).toBe(403);
    expect((await request('/api/v1/habitaciones', 'admin', 'POST', { nombre: 'Admin can configure', tipo: 'Doble' })).status).toBe(201);
  });

  it('applies a downgrade and deactivation to an already issued admin token on its next request', async () => {
    const user = { email: 'downgrade@permissions.example.invalid', nombre: 'Fictional old admin', rol: 'admin' };
    user.id = Number(db.prepare('INSERT INTO usuarios (email, password_hash, nombre, rol) VALUES (?, ?, ?, ?)').run(user.email, 'unused-test-hash', user.nombre, user.rol).lastInsertRowid);
    tokens.downgraded = generateToken(user);
    expect((await request('/api/v1/admin/usuarios', 'downgraded')).status).toBe(200);
    expect((await request(`/api/v1/admin/usuarios/${user.id}`, 'admin', 'PUT', { rol: 'cleaning', nombre: 'Fictional current cleaner', email: 'current@permissions.example.invalid' })).status).toBe(200);
    const me = await request('/api/v1/auth/me', 'downgraded');
    expect(me.data.data).toEqual({ id: user.id, email: 'current@permissions.example.invalid', nombre: 'Fictional current cleaner', rol: 'cleaning' });
    expect((await request('/api/v1/admin/usuarios', 'downgraded')).status).toBe(403);
    expect((await request(`/api/v1/hotel/reservas/${reservationId}`, 'downgraded')).status).toBe(403);
    expect((await request('/api/v1/hotel/dashboard', 'downgraded')).data.data.housekeeping).toBe(true);
    expect((await request(`/api/v1/admin/usuarios/${user.id}`, 'admin', 'PUT', { activo: 0 })).status).toBe(200);
    expect((await request('/api/v1/hotel/dashboard', 'downgraded')).data.error.code).toBe('USER_DEACTIVATED');
    db.prepare('DELETE FROM usuarios WHERE id = ?').run(user.id);
    expect((await request('/api/v1/hotel/dashboard', 'downgraded')).status).toBe(401);
  });

  it('does not trust a signed but stale or elevated role claim over the stored user role', async () => {
    tokens.elevated = generateToken({ ...users.cleaning, rol: 'admin' });
    expect((await request('/api/v1/admin/usuarios', 'elevated')).status).toBe(403);
    expect((await request('/api/v1/auth/me', 'elevated')).data.data.rol).toBe('cleaning');
  });

  it('keeps API-key read/write scopes effective without granting read keys mutation rights', async () => {
    for (const scope of ['read', 'write']) {
      const key = `fictional-permissions-key-${scope}`;
      db.prepare('INSERT INTO api_keys (key_hash, key_preview, nombre, permisos) VALUES (?, ?, ?, ?)').run(hashApiKey(key), `test-${scope}`, 'Fictional scope test', scope);
      const headers = { 'X-API-Key': key };
      expect((await request('/api/v1/hotel/reservas', null, 'GET', undefined, headers)).status).toBe(200);
      expect((await request(`/api/v1/habitaciones/${roomId}/limpieza`, null, 'PATCH', { estado_limpieza: 'Limpia' }, headers)).status).toBe(scope === 'read' ? 403 : 200);
      expect((await request('/api/v1/crm/leads', null, 'POST', { nombre: `Fictional ${scope} lead` }, headers)).status).toBe(scope === 'read' ? 403 : 201);
      expect((await request('/api/v1/admin/usuarios', null, 'GET', undefined, headers)).status).toBe(403);
    }
  });
});
