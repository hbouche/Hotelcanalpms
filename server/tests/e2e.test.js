import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// Force test environment
process.env.PORT = '3299';
process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'hotel-canal-test.db';
process.env.NOTIFICATIONS_ENABLED = 'true';

// Mock nodemailer transporter globally before importing notifications
vi.mock('nodemailer', () => {
  return {
    default: {
      createTransport: vi.fn().mockReturnValue({
        verify: vi.fn().mockResolvedValue(true),
        sendMail: vi.fn().mockResolvedValue({ messageId: 'mock-email-id' })
      })
    },
    createTransport: vi.fn().mockReturnValue({
      verify: vi.fn().mockResolvedValue(true),
      sendMail: vi.fn().mockResolvedValue({ messageId: 'mock-email-id' })
    })
  };
});

// Intercept outgoing HTTP/HTTPS calls to mock the WhatsApp REST API webhooks
vi.mock('https', () => {
  return {
    request: vi.fn().mockImplementation((options, callback) => {
      const res = {
        statusCode: 200,
        on: (event, cb) => {
          if (event === 'data') cb('{"success": true}');
          if (event === 'end') cb();
        }
      };
      if (callback) callback(res);
      return {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn()
      };
    })
  };
});

vi.mock('http', () => {
  return {
    request: vi.fn().mockImplementation((options, callback) => {
      const res = {
        statusCode: 200,
        on: (event, cb) => {
          if (event === 'data') cb('{"success": true}');
          if (event === 'end') cb();
        }
      };
      if (callback) callback(res);
      return {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn()
      };
    })
  };
});

// Import server & DB helpers
const { app, server } = require('../server');
const { getDb, resetDb } = require('../db/database');
const { generateToken, hashPassword } = require('../auth');

const BASE_URL = 'http://localhost:3299/api/v1';

// Keep track of created user tokens
let adminToken = '';
let receptionistToken = '';
let cleaningToken = '';
let deactivatedToken = '';

beforeAll(async () => {
  // Ensure the database is clean before the test suite runs
  resetDb();
  
  const dbDir = fs.existsSync('/data') ? '/data' : path.resolve(__dirname, '../../data');
  const dbPath = path.join(dbDir, 'hotel-canal-test.db');
  
  if (fs.existsSync(dbPath)) {
    try {
      fs.unlinkSync(dbPath);
    } catch (e) {
      console.warn('Could not delete old test DB file, resetDb should handle it:', e.message);
    }
  }
  
  // Initialize and seed database
  const db = getDb();
  
  // Truncate tables for a completely clean test suite state
  db.pragma('foreign_keys = OFF');
  db.prepare('DELETE FROM reservas_hotel').run();
  db.prepare('DELETE FROM folio_hotel').run();
  db.prepare('DELETE FROM notificaciones_log').run();
  db.prepare('DELETE FROM usuarios').run();
  db.pragma('foreign_keys = ON');
  
  // Force enable notifications in configurations for this test run
  db.prepare('UPDATE configuracion_sistema SET notifications_enabled = 1, wa_enabled = 1 WHERE id = 1').run();
  
  const insertUser = db.prepare('INSERT INTO usuarios (email, password_hash, nombre, rol, activo) VALUES (?, ?, ?, ?, ?)');
  
  const adminId = insertUser.run('admin_test@example.invalid', hashPassword('pass123'), 'Admin User', 'admin', 1).lastInsertRowid;
  const recepId = insertUser.run('recep_test@example.invalid', hashPassword('pass123'), 'Recep User', 'receptionist', 1).lastInsertRowid;
  const cleanId = insertUser.run('clean_test@example.invalid', hashPassword('pass123'), 'Clean User', 'cleaning', 1).lastInsertRowid;
  const deactId = insertUser.run('deact_test@example.invalid', hashPassword('pass123'), 'Deactivated User', 'receptionist', 0).lastInsertRowid;
  
  adminToken = generateToken({ id: adminId, email: 'admin_test@example.invalid', rol: 'admin', nombre: 'Admin User' });
  receptionistToken = generateToken({ id: recepId, email: 'recep_test@example.invalid', rol: 'receptionist', nombre: 'Recep User' });
  cleaningToken = generateToken({ id: cleanId, email: 'clean_test@example.invalid', rol: 'cleaning', nombre: 'Clean User' });
  deactivatedToken = generateToken({ id: deactId, email: 'deact_test@example.invalid', rol: 'receptionist', nombre: 'Deactivated User' });
});

afterAll(async () => {
  // Gracefully close server and database connection to prevent hanging
  await new Promise((resolve) => server.close(resolve));
  resetDb();
});

describe('Hotel Panamá Canal PMS — Opaque-box E2E Test Suite', () => {
  // Helper function to hit endpoints
  async function apiRequest(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };
    if (options.token) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }
    const response = await fetch(url, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const status = response.status;
    let data = null;
    try {
      data = await response.json();
    } catch (e) {
      // no JSON or parsing failed
    }
    return { status, data };
  }

  // ── TIER 1: FEATURE COVERAGE ──

  describe('Tier 1: Feature Coverage & Basic Flows', () => {
    
    it('TC-1.1.1: Web Booking Initial State sets to Pendiente and logs received notification', async () => {
      const today = new Date();
      const checkIn = today.toISOString().split('T')[0];
      const checkOut = new Date(today.setDate(today.getDate() + 2)).toISOString().split('T')[0];
      
      const payload = {
        cliente: 'Juan',
        apellido: 'Pérez',
        email: 'juan.perez@example.com',
        whatsapp: '+50766667777',
        nacionalidad: 'Panameña',
        check_in: checkIn,
        check_out: checkOut,
        tipo_habitacion: 'Doble',
        plan_codigo: 'todo_incluido',
        adultos: 2,
        menores: 0
      };

      const { status, data } = await apiRequest('/public/reservar', {
        method: 'POST',
        body: payload
      });

      if (status !== 201) {
        fs.writeFileSync('C:\\Users\\Usuario\\.gemini\\antigravity\\scratch\\hotel-canal-pms\\.agents\\worker_sec_layout\\e2e_diag.txt', JSON.stringify({ status, data }, null, 2), 'utf-8');
      }

      expect(status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.reserva_id).toBeDefined();

      const reservationId = data.data.reserva_id;

      // Verify in DB state is Pendiente
      const db = getDb();
      const resRow = db.prepare('SELECT estado, habitacion_id FROM reservas_hotel WHERE id = ?').get(reservationId);
      expect(resRow).toBeDefined();
      expect(resRow.estado).toBe('Pendiente');

      // Verify received notification is logged in notificaciones_log
      const logRows = db.prepare('SELECT * FROM notificaciones_log WHERE reserva_id = ? AND tipo = ?').all(reservationId, 'recibida');
      expect(logRows.length).toBeGreaterThan(0);
      expect(logRows[0].canal).toBeDefined();
    });

    it('TC-1.1.2: Status Change Approve Pending sets to Confirmada and logs confirmacion notification', async () => {
      const db = getDb();
      // Insert a fresh pending booking
      const resId = db.prepare(`
        INSERT INTO reservas_hotel (cliente, email, check_in, check_out, noches, adultos, estado, tipo_habitacion, habitacion_id, plan_codigo, monto_total, saldo_pendiente)
        VALUES ('Maria', 'maria@example.com', '2026-06-10', '2026-06-12', 2, 2, 'Pendiente', 'Doble', 5, 'todo_incluido', 200, 200)
      `).run().lastInsertRowid;

      const { status, data } = await apiRequest(`/hotel/reservas/${resId}/status`, {
        method: 'PATCH',
        token: adminToken,
        body: { estado: 'Confirmada' }
      });

      expect(status).toBe(200);
      expect(data.success).toBe(true);

      const resRow = db.prepare('SELECT estado FROM reservas_hotel WHERE id = ?').get(resId);
      expect(resRow.estado).toBe('Confirmada');

      // Verify confirmation notification was logged
      const logRows = db.prepare('SELECT * FROM notificaciones_log WHERE reserva_id = ? AND tipo = ?').all(resId, 'confirmacion');
      expect(logRows.length).toBeGreaterThan(0);
    });

    it('TC-1.1.3: Check-In Confirmed sets room to Ocupada and logs bienvenida notification', async () => {
      const db = getDb();
      const resId = db.prepare(`
        INSERT INTO reservas_hotel (cliente, email, check_in, check_out, noches, adultos, estado, tipo_habitacion, habitacion_id, plan_codigo, monto_total, saldo_pendiente)
        VALUES ('Carlos', 'carlos@example.com', '2026-06-15', '2026-06-17', 2, 2, 'Confirmada', 'Doble', 5, 'todo_incluido', 200, 200)
      `).run().lastInsertRowid;

      const { status, data } = await apiRequest(`/hotel/reservas/${resId}/status`, {
        method: 'PATCH',
        token: adminToken,
        body: { estado: 'Hospedado' }
      });

      expect(status).toBe(200);
      expect(data.success).toBe(true);

      const resRow = db.prepare('SELECT estado, habitacion_id FROM reservas_hotel WHERE id = ?').get(resId);
      expect(resRow.estado).toBe('Hospedado');

      // Verify Room State sync is Ocupada
      const roomRow = db.prepare('SELECT estado_habitacion FROM habitaciones WHERE id = ?').get(resRow.habitacion_id);
      expect(roomRow.estado_habitacion).toBe('Ocupada');

      // Verify bienvenida notification logged
      const logRows = db.prepare('SELECT * FROM notificaciones_log WHERE reserva_id = ? AND tipo = ?').all(resId, 'bienvenida');
      expect(logRows.length).toBeGreaterThan(0);
    });

    it('TC-1.1.4: Check-Out sets room to Vacía/Sucia and logs checkout notification', async () => {
      const db = getDb();
      const resId = db.prepare(`
        INSERT INTO reservas_hotel (cliente, email, check_in, check_out, noches, adultos, estado, tipo_habitacion, habitacion_id, plan_codigo, monto_total, saldo_pendiente)
        VALUES ('Sofia', 'sofia@example.com', '2026-06-20', '2026-06-22', 2, 2, 'Hospedado', 'Doble', 6, 'todo_incluido', 200, 200)
      `).run().lastInsertRowid;

      const { status, data } = await apiRequest(`/hotel/reservas/${resId}/status`, {
        method: 'PATCH',
        token: adminToken,
        body: { estado: 'Check-Out' }
      });

      expect(status).toBe(200);
      expect(data.success).toBe(true);

      const resRow = db.prepare('SELECT estado, habitacion_id FROM reservas_hotel WHERE id = ?').get(resId);
      expect(resRow.estado).toBe('Check-Out');

      // Verify Room is Vacía and cleanup is Sucia
      const roomRow = db.prepare('SELECT estado_habitacion, estado_limpieza FROM habitaciones WHERE id = ?').get(resRow.habitacion_id);
      expect(roomRow.estado_habitacion).toBe('Vacía');
      expect(roomRow.estado_limpieza).toBe('Sucia');

      // Verify checkout notification logged
      const logRows = db.prepare('SELECT * FROM notificaciones_log WHERE reserva_id = ? AND tipo = ?').all(resId, 'checkout');
      expect(logRows.length).toBeGreaterThan(0);
    });

    it('TC-1.5.3: Add payment logs a pago notification and updates balances', async () => {
      const db = getDb();
      const resId = db.prepare(`
        INSERT INTO reservas_hotel (cliente, email, check_in, check_out, noches, adultos, estado, tipo_habitacion, habitacion_id, plan_codigo, monto_total, monto_pagado, saldo_pendiente)
        VALUES ('Luis', 'luis@example.com', '2026-06-25', '2026-06-27', 2, 2, 'Confirmada', 'Doble', 7, 'todo_incluido', 300, 50, 250)
      `).run().lastInsertRowid;

      const { status, data } = await apiRequest(`/hotel/reservas/${resId}/folio`, {
        method: 'POST',
        token: adminToken,
        body: {
          monto: 100,
          concepto: 'Abono reserva',
          tipo: 'credito',
          metodo_pago: 'yappy'
        }
      });

      expect(status).toBe(200);
      expect(data.success).toBe(true);

      const resRow = db.prepare('SELECT monto_pagado, saldo_pendiente FROM reservas_hotel WHERE id = ?').get(resId);
      expect(resRow.monto_pagado).toBe(150);
      expect(resRow.saldo_pendiente).toBe(150);

      // Verify notification logged
      const logRows = db.prepare('SELECT * FROM notificaciones_log WHERE reserva_id = ? AND tipo = ?').all(resId, 'pago');
      expect(logRows.length).toBeGreaterThan(0);
    });

    it('TC-1.4.3/1.4.4: RBAC blocks cleaning role from updating status with HTTP 403', async () => {
      const db = getDb();
      const resId = db.prepare(`
        INSERT INTO reservas_hotel (cliente, email, check_in, check_out, noches, adultos, estado, tipo_habitacion, habitacion_id, plan_codigo, monto_total, saldo_pendiente)
        VALUES ('Pedro', 'pedro@example.com', '2026-07-01', '2026-07-03', 2, 2, 'Pendiente', 'Doble', 7, 'todo_incluido', 200, 200)
      `).run().lastInsertRowid;

      const { status } = await apiRequest(`/hotel/reservas/${resId}/status`, {
        method: 'PATCH',
        token: cleaningToken,
        body: { estado: 'Confirmada' }
      });

      expect(status).toBe(403);

      const resRow = db.prepare('SELECT estado FROM reservas_hotel WHERE id = ?').get(resId);
      expect(resRow.estado).toBe('Pendiente'); // remains unchanged
    });

  });

  // ── TIER 2: BOUNDARY & CORNER CASES ──

  describe('Tier 2: Boundary & Corner Cases', () => {

    it('TC-2.1.2: Check-In Bypass from Pending is rejected by the state machine', async () => {
      const db = getDb();
      const resId = db.prepare(`
        INSERT INTO reservas_hotel (cliente, email, check_in, check_out, noches, adultos, estado, tipo_habitacion, habitacion_id, plan_codigo, monto_total, saldo_pendiente)
        VALUES ('Bypass', 'bypass@example.com', '2026-07-05', '2026-07-07', 2, 2, 'Pendiente', 'Doble', 8, 'todo_incluido', 200, 200)
      `).run().lastInsertRowid;

      // Using receptionist token to enforce state machine check
      const { status, data } = await apiRequest(`/hotel/reservas/${resId}/status`, {
        method: 'PATCH',
        token: receptionistToken,
        body: { estado: 'Hospedado' }
      });

      expect(status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('INVALID_TRANSITION');

      const resRow = db.prepare('SELECT estado FROM reservas_hotel WHERE id = ?').get(resId);
      expect(resRow.estado).toBe('Pendiente'); // unchanged
    });

    it('TC-2.1.4: Checkout of Confirmed Reservation is rejected by the state machine', async () => {
      const db = getDb();
      const resId = db.prepare(`
        INSERT INTO reservas_hotel (cliente, email, check_in, check_out, noches, adultos, estado, tipo_habitacion, habitacion_id, plan_codigo, monto_total, saldo_pendiente)
        VALUES ('NoHospedado', 'nohosp@example.com', '2026-07-10', '2026-07-12', 2, 2, 'Confirmada', 'Doble', 8, 'todo_incluido', 200, 200)
      `).run().lastInsertRowid;

      // Using receptionist token to enforce state machine check
      const { status, data } = await apiRequest(`/hotel/reservas/${resId}/status`, {
        method: 'PATCH',
        token: receptionistToken,
        body: { estado: 'Check-Out' }
      });

      expect(status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('INVALID_TRANSITION');

      const resRow = db.prepare('SELECT estado FROM reservas_hotel WHERE id = ?').get(resId);
      expect(resRow.estado).toBe('Confirmada'); // unchanged
    });

    it('TC-2.1.3: Retroactive Date Creation throws validation error', async () => {
      const payload = {
        cliente: 'Retro',
        apellido: 'Test',
        email: 'retro@example.com',
        whatsapp: '+50766667777',
        nacionalidad: 'Panameña',
        check_in: '2020-01-01', // definitely in the past
        check_out: '2020-01-03',
        tipo_habitacion: 'Doble',
        plan_codigo: 'todo_incluido',
        adultos: 2,
        menores: 0
      };

      const { status, data } = await apiRequest('/public/reservar', {
        method: 'POST',
        body: payload
      });

      expect(status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('TC-2.4.4: Deactivated Staff Member Block fails immediately with HTTP 403', async () => {
      const { status, data } = await apiRequest('/hotel/dashboard', {
        method: 'GET',
        token: deactivatedToken
      });

      expect(status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('USER_DEACTIVATED');
    });

  });

  // ── TIER 3: CROSS-FEATURE PAIRWISE COMBINATIONS ──

  describe('Tier 3: Cross-Feature Pairwise Integrations', () => {

    it('TC-3.1: Happy Path Complete Flow (Book -> Pendiente -> Confirmada -> Payment -> Hospedado -> Check-Out)', async () => {
      const db = getDb();
      const today = new Date();
      const checkIn = today.toISOString().split('T')[0];
      const checkOut = new Date(today.setDate(today.getDate() + 3)).toISOString().split('T')[0];

      // 1. Online booking
      const bookPayload = {
        cliente: 'Integración',
        apellido: 'Completa',
        email: 'integ@example.com',
        whatsapp: '+50766667777',
        nacionalidad: 'Panameña',
        check_in: checkIn,
        check_out: checkOut,
        tipo_habitacion: 'Doble',
        plan_codigo: 'todo_incluido',
        adultos: 2,
        menores: 0
      };

      const { status: st1, data: d1 } = await apiRequest('/public/reservar', {
        method: 'POST',
        body: bookPayload
      });

      expect(st1).toBe(201);
      const resId = d1.data.reserva_id;

      // Verify 'recibida' notification
      let logRows = db.prepare('SELECT * FROM notificaciones_log WHERE reserva_id = ? AND tipo = ?').all(resId, 'recibida');
      expect(logRows.length).toBeGreaterThan(0);

      // 2. Approve booking as admin
      const { status: st2 } = await apiRequest(`/hotel/reservas/${resId}/status`, {
        method: 'PATCH',
        token: adminToken,
        body: { estado: 'Confirmada' }
      });
      expect(st2).toBe(200);

      // Verify 'confirmacion' notification
      logRows = db.prepare('SELECT * FROM notificaciones_log WHERE reserva_id = ? AND tipo = ?').all(resId, 'confirmacion');
      expect(logRows.length).toBeGreaterThan(0);

      // 3. Register payment
      const { status: st3 } = await apiRequest(`/hotel/reservas/${resId}/folio`, {
        method: 'POST',
        token: adminToken,
        body: {
          monto: 150,
          concepto: 'Deposito 50%',
          tipo: 'credito',
          metodo_pago: 'yappy'
        }
      });
      expect(st3).toBe(200);

      // Verify 'pago' notification
      logRows = db.prepare('SELECT * FROM notificaciones_log WHERE reserva_id = ? AND tipo = ?').all(resId, 'pago');
      expect(logRows.length).toBeGreaterThan(0);

      // 4. Check-in guest
      const { status: st4 } = await apiRequest(`/hotel/reservas/${resId}/status`, {
        method: 'PATCH',
        token: adminToken,
        body: { estado: 'Hospedado' }
      });
      expect(st4).toBe(200);

      // Verify Room status sync
      const resRow = db.prepare('SELECT habitacion_id FROM reservas_hotel WHERE id = ?').get(resId);
      const roomRow = db.prepare('SELECT estado_habitacion FROM habitaciones WHERE id = ?').get(resRow.habitacion_id);
      expect(roomRow.estado_habitacion).toBe('Ocupada');

      // Verify 'bienvenida' notification
      logRows = db.prepare('SELECT * FROM notificaciones_log WHERE reserva_id = ? AND tipo = ?').all(resId, 'bienvenida');
      expect(logRows.length).toBeGreaterThan(0);

      // 5. Check-out guest
      const { status: st5 } = await apiRequest(`/hotel/reservas/${resId}/status`, {
        method: 'PATCH',
        token: adminToken,
        body: { estado: 'Check-Out' }
      });
      expect(st5).toBe(200);

      // Verify Room status vacant & dirty
      const roomRowPost = db.prepare('SELECT estado_habitacion, estado_limpieza FROM habitaciones WHERE id = ?').get(resRow.habitacion_id);
      expect(roomRowPost.estado_habitacion).toBe('Vacía');
      expect(roomRowPost.estado_limpieza).toBe('Sucia');

      // Verify 'checkout' notification
      logRows = db.prepare('SELECT * FROM notificaciones_log WHERE reserva_id = ? AND tipo = ?').all(resId, 'checkout');
      expect(logRows.length).toBeGreaterThan(0);
    });

  });

  // ── TIER 4: REAL-WORLD WORKLOADS / CONCURRENCY ──

  describe('Tier 4: Real-world Workloads & Concurrency', () => {

    it('TC-4.3: Concurrency allocations: parallel online bookings on same room and overlapping dates serialize cleanly with only one succeeding', async () => {
      const db = getDb();
      // Ensure only 1 room of type Familiar is available for the test dates
      db.prepare("UPDATE habitaciones SET activa = 0 WHERE tipo = 'Familiar'").run();
      const mainRoomId = db.prepare("SELECT id FROM habitaciones WHERE tipo = 'Familiar' LIMIT 1").get().id;
      db.prepare("UPDATE habitaciones SET activa = 1 WHERE id = ?").run(mainRoomId);

      // Future dates keep this concurrency test independent of the calendar.
      const nextYear = new Date().getUTCFullYear() + 1;
      const checkIn = `${nextYear}-08-01`;
      const checkOut = `${nextYear}-08-05`;

      const payloadA = {
        cliente: 'User A',
        apellido: 'Test',
        email: 'usera@example.com',
        whatsapp: '+50766667777',
        nacionalidad: 'Panameña',
        check_in: checkIn,
        check_out: checkOut,
        tipo_habitacion: 'Familiar',
        plan_codigo: 'todo_incluido',
        adultos: 2,
        menores: 0
      };

      const payloadB = {
        cliente: 'User B',
        apellido: 'Test',
        email: 'userb@example.com',
        whatsapp: '+50766667778',
        nacionalidad: 'Panameña',
        check_in: checkIn,
        check_out: checkOut,
        tipo_habitacion: 'Familiar',
        plan_codigo: 'todo_incluido',
        adultos: 2,
        menores: 0
      };

      // Fire both parallel online booking requests concurrently
      const results = await Promise.all([
        apiRequest('/public/reservar', { method: 'POST', body: payloadA }),
        apiRequest('/public/reservar', { method: 'POST', body: payloadB })
      ]);

      const successCount = results.filter(r => r.status === 201).length;
      const rejectCount = results.filter(r => r.status === 400).length;

      expect(successCount).toBe(1);
      expect(rejectCount).toBe(1);

      // Restore other Familiar rooms
      db.prepare("UPDATE habitaciones SET activa = 1 WHERE tipo = 'Familiar'").run();
    });

    it('TC-4.4: Admin can edit a folio transaction directly and totals recalculate', async () => {
      const db = getDb();
      const resId = db.prepare(`
        INSERT INTO reservas_hotel (cliente, email, check_in, check_out, noches, adultos, estado, tipo_habitacion, habitacion_id, plan_codigo, monto_total, monto_pagado, saldo_pendiente, precio_adulto_noche, subtotal, impuesto_pct, impuesto_monto)
        VALUES ('Luis Direct', 'luis.dir@example.com', '2026-06-25', '2026-06-27', 2, 2, 'Confirmada', 'Doble', 7, 'todo_incluido', 300, 100, 200, 75, 300, 0, 0)
      `).run().lastInsertRowid;

      const folioId = db.prepare(`
        INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, metodo_pago, registrado_por)
        VALUES (?, 'credito', 'Abono inicial', 100.00, 'efectivo', 'admin')
      `).run(resId).lastInsertRowid;

      // 1. Receptionist tries to edit directly -> should fail with 403
      const { status: recStatus } = await apiRequest(`/hotel/reservas/${resId}/folio/${folioId}`, {
        method: 'PUT',
        token: receptionistToken,
        body: { monto: 80.00, concepto: 'Abono inicial corregido' }
      });
      expect(recStatus).toBe(403);

      // 2. Admin edits directly -> should succeed with 200
      const { status: adminStatus, data: adminData } = await apiRequest(`/hotel/reservas/${resId}/folio/${folioId}`, {
        method: 'PUT',
        token: adminToken,
        body: { monto: 80.00, concepto: 'Abono inicial corregido' }
      });
      expect(adminStatus).toBe(200);
      expect(adminData.success).toBe(true);

      const resRow = db.prepare('SELECT monto_pagado, saldo_pendiente FROM reservas_hotel WHERE id = ?').get(resId);
      expect(resRow.monto_pagado).toBe(80.00);
      expect(resRow.saldo_pendiente).toBe(220.00);

      const folioRow = db.prepare('SELECT monto, concepto FROM folio_hotel WHERE id = ?').get(folioId);
      expect(folioRow.monto).toBe(80.00);
      expect(folioRow.concepto).toBe('Abono inicial corregido');
    });

    it('TC-4.5: Admin can delete a folio transaction directly and totals recalculate', async () => {
      const db = getDb();
      const resId = db.prepare(`
        INSERT INTO reservas_hotel (cliente, email, check_in, check_out, noches, adultos, estado, tipo_habitacion, habitacion_id, plan_codigo, monto_total, monto_pagado, saldo_pendiente, precio_adulto_noche, subtotal, impuesto_pct, impuesto_monto)
        VALUES ('Luis Delete', 'luis.del@example.com', '2026-06-25', '2026-06-27', 2, 2, 'Confirmada', 'Doble', 7, 'todo_incluido', 300, 100, 200, 75, 300, 0, 0)
      `).run().lastInsertRowid;

      const folioId = db.prepare(`
        INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, metodo_pago, registrado_por)
        VALUES (?, 'credito', 'Abono equivocado', 100.00, 'efectivo', 'admin')
      `).run(resId).lastInsertRowid;

      // 1. Receptionist tries to delete directly -> should fail with 403
      const { status: recStatus } = await apiRequest(`/hotel/reservas/${resId}/folio/${folioId}`, {
        method: 'DELETE',
        token: receptionistToken
      });
      expect(recStatus).toBe(403);

      // 2. Admin deletes directly -> should succeed with 200
      const { status: adminStatus, data: adminData } = await apiRequest(`/hotel/reservas/${resId}/folio/${folioId}`, {
        method: 'DELETE',
        token: adminToken
      });
      expect(adminStatus).toBe(200);
      expect(adminData.success).toBe(true);

      const resRow = db.prepare('SELECT monto_pagado, saldo_pendiente FROM reservas_hotel WHERE id = ?').get(resId);
      expect(resRow.monto_pagado).toBe(0);
      expect(resRow.saldo_pendiente).toBe(300.00);

      const folioCount = db.prepare('SELECT count(*) as count FROM folio_hotel WHERE id = ?').get(folioId).count;
      expect(folioCount).toBe(0);
    });

    it('TC-4.6: Admin can delete a reservation completely with audit log, others are blocked', async () => {
      const db = getDb();
      
      // 1. Setup reservation & linked folio
      const resId = db.prepare(`
        INSERT INTO reservas_hotel (cliente, email, check_in, check_out, noches, adultos, estado, tipo_habitacion, habitacion_id, plan_codigo, monto_total, monto_pagado, saldo_pendiente)
        VALUES ('Delete Me', 'delme@example.com', '2026-06-25', '2026-06-27', 2, 2, 'Confirmada', 'Doble', 7, 'todo_incluido', 300, 100, 200)
      `).run().lastInsertRowid;

      const folioId = db.prepare(`
        INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, metodo_pago, registrado_por)
        VALUES (?, 'credito', 'Abono inicial', 100.00, 'efectivo', 'admin')
      `).run(resId).lastInsertRowid;

      // 2. Receptionist attempts deletion -> 403 Forbidden
      const { status: recStatus } = await apiRequest(`/hotel/reservas/${resId}`, {
        method: 'DELETE',
        token: receptionistToken,
        body: { motivo: 'Error de prueba' }
      });
      expect(recStatus).toBe(403);

      // 3. Admin attempts deletion without motivo -> 400 Bad Request
      const { status: badStatus } = await apiRequest(`/hotel/reservas/${resId}`, {
        method: 'DELETE',
        token: adminToken,
        body: {}
      });
      expect(badStatus).toBe(400);

      // 4. Admin deletes successfully -> 200 OK
      const { status: okStatus, data: okData } = await apiRequest(`/hotel/reservas/${resId}`, {
        method: 'DELETE',
        token: adminToken,
        body: { motivo: 'Reserva duplicada en Kommo' }
      });
      expect(okStatus).toBe(200);
      expect(okData.success).toBe(true);

      // 5. Verify database records are cleared
      const resCount = db.prepare('SELECT count(*) as count FROM reservas_hotel WHERE id = ?').get(resId).count;
      expect(resCount).toBe(0);

      const fCount = db.prepare('SELECT count(*) as count FROM folio_hotel WHERE id = ?').get(folioId).count;
      expect(fCount).toBe(0);

      // 6. Verify audit log entry
      const auditLog = db.prepare('SELECT * FROM reservas_eliminadas_log WHERE reserva_id = ?').get(resId);
      expect(auditLog).toBeDefined();
      expect(auditLog.cliente).toBe('Delete Me');
      expect(auditLog.motivo).toBe('Reserva duplicada en Kommo');
      expect(auditLog.eliminado_por).toBeDefined();
    });

  });

});
