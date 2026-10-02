import { describe, it, expect, beforeAll } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'hotel-canal-reversals-test.db';

const { getDb, resetDb } = require('../db/database');
const { calcReservationWithRates, calcReservation } = require('./calculations');
const hotelRouter = require('../routes/hotel');

// Helper to find the route handler directly from the router stack
function findRouteHandler(path, method) {
  const route = hotelRouter.stack.find(
    (s) => s.route && s.route.path === path && s.route.methods[method]
  );
  if (!route) throw new Error(`Route not found for path: ${path} and method: ${method}`);
  return route.route.stack[route.route.stack.length - 1].handle;
}

describe('CxC, Reversals and Dynamic Taxes - Integration tests', () => {
  let db;

  beforeAll(() => {
    resetDb();
    db = getDb();
    
    // Seed test data with foreign keys temporarily disabled for clean slate
    db.pragma('foreign_keys = OFF');
    db.prepare('DELETE FROM folio_hotel').run();
    db.prepare('DELETE FROM reservas_hotel').run();
    db.prepare('DELETE FROM planes_tarifa').run();
    db.prepare('DELETE FROM reglas_tarifa').run();
    db.prepare('DELETE FROM habitaciones').run();
    db.prepare('DELETE FROM huespedes_reserva').run();
    db.prepare('DELETE FROM documentos_reserva').run();
    db.prepare('DELETE FROM notificaciones_log').run();
    db.pragma('foreign_keys = ON');
    
    // Seed a room
    db.prepare(`
      INSERT INTO habitaciones (id, nombre, tipo, categoria, estado_habitacion, estado_limpieza)
      VALUES (1, 'Hab 101', 'Doble', 'Estadía', 'Vacía', 'Limpia')
    `).run();
  });

  describe('Taxes Calculations', () => {
    it('should compute tax = 0% when plan does not have tax enabled', () => {
      // Seed a plan with lleva_impuesto = 0
      db.prepare(`
        INSERT INTO planes_tarifa (id, codigo, nombre, precio_adulto_noche, lleva_impuesto, impuesto_pct, activo)
        VALUES (1, 'EXENTO', 'Plan Exento', 100.0, 0, 10, 1)
      `).run();

      const reservationData = {
        check_in: '2026-06-01',
        check_out: '2026-06-03', // 2 nights
        adultos: 1,
        ninos: 0,
        mascotas: 0,
        plan_id: 1,
        plan_codigo: 'EXENTO',
        habitacion_id: 1,
        productos_adicionales: 0
      };

      const result = calcReservationWithRates(
        reservationData.plan_id,
        reservationData.check_in,
        reservationData.check_out,
        reservationData.adultos,
        reservationData.ninos,
        reservationData.mascotas
      );
      expect(result.impuesto_monto).toBe(0);
      expect(result.monto_total).toBe(200); // 100 * 2 nights
    });

    it('should compute tax with custom pct when plan has custom tax enabled', () => {
      // Seed a plan with lleva_impuesto = 1 and impuesto_pct = 7
      db.prepare(`
        INSERT INTO planes_tarifa (id, codigo, nombre, precio_adulto_noche, lleva_impuesto, impuesto_pct, activo)
        VALUES (2, 'CON_IMP_7', 'Plan Impuesto 7%', 100.0, 1, 7, 1)
      `).run();

      const reservationData = {
        check_in: '2026-06-01',
        check_out: '2026-06-03', // 2 nights
        adultos: 1,
        ninos: 0,
        mascotas: 0,
        plan_id: 2,
        plan_codigo: 'CON_IMP_7',
        habitacion_id: 1,
        productos_adicionales: 0
      };

      const result = calcReservationWithRates(
        reservationData.plan_id,
        reservationData.check_in,
        reservationData.check_out,
        reservationData.adultos,
        reservationData.ninos,
        reservationData.mascotas
      );
      expect(result.impuesto_monto).toBe(14); // 7% of 200
      expect(result.monto_total).toBe(214);
    });
  });

  describe('CxC Third Party and Cuponeras Reconciliation', () => {
    const listThirdPartyHandler = findRouteHandler('/hotel/saldos/terceros', 'get');
    const reconcileHandler = findRouteHandler('/hotel/saldos/reconciliar', 'post');

    it('should register cuponera payment and list it as unreconciled', () => {
      // Seed a reservation
      db.prepare(`
        INSERT INTO reservas_hotel (id, cliente, apellido, check_in, check_out, adultos, menores, mascotas, plan_codigo, habitacion_id, monto_total, monto_pagado, saldo_pendiente, estado)
        VALUES (10, 'John', 'Doe', '2026-06-01', '2026-06-03', 1, 0, 0, 'EXENTO', 1, 200, 0, 200, 'Confirmada')
      `).run();

      // Register payment with cuponera_oferta_simple
      db.prepare(`
        INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, metodo_pago, referencia, registrado_por, reconciliado)
        VALUES (10, 'credito', 'Pago Oferta Simple', 200, 'cuponera_oferta_simple', 'REF-OS-1', 'Test Admin', 0)
      `).run();

      // List unreconciled third party folios
      const req = { user: { rol: 'admin' }, query: {} };
      let resData;
      const res = {
        status: () => res,
        json: (data) => { resData = data; }
      };

      listThirdPartyHandler(req, res);
      expect(resData.success).toBe(true);
      const entry = resData.data.find(e => e.reserva_id === 10);
      expect(entry).toBeDefined();
      expect(entry.metodo_pago).toBe('cuponera_oferta_simple');
      expect(entry.reconciliado).toBe(0);
    });

    it('should reconcile folios in bulk via admin route', () => {
      // Find the entry we inserted
      const entry = db.prepare("SELECT id FROM folio_hotel WHERE reserva_id = 10 AND metodo_pago = 'cuponera_oferta_simple'").get();
      expect(entry).toBeDefined();

      const req = {
        user: { rol: 'admin' },
        body: { ids: [entry.id] }
      };
      let resData;
      const res = {
        status: () => res,
        json: (data) => { resData = data; }
      };

      reconcileHandler(req, res);
      expect(resData.success).toBe(true);

      // Verify DB state
      const updated = db.prepare("SELECT reconciliado, fecha_reconciliacion FROM folio_hotel WHERE id = ?").get(entry.id);
      expect(updated.reconciliado).toBe(1);
      expect(updated.fecha_reconciliacion).toBe(new Date().toISOString().split('T')[0]);
    });

    it('should reconcile folios in bulk via admin route and apply comision_porcentaje', () => {
      // Seed a reservation
      db.prepare(`
        INSERT INTO reservas_hotel (id, cliente, apellido, check_in, check_out, adultos, menores, mascotas, plan_codigo, habitacion_id, monto_total, monto_pagado, saldo_pendiente, estado)
        VALUES (11, 'Jane', 'Doe', '2026-06-01', '2026-06-03', 1, 0, 0, 'EXENTO', 1, 200, 0, 200, 'Confirmada')
      `).run();

      // Register payment with cuponera_pahoy
      db.prepare(`
        INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, metodo_pago, referencia, registrado_por, reconciliado)
        VALUES (11, 'credito', 'Pago PaHoy', 200, 'cuponera_pahoy', 'REF-PH-1', 'Test Admin', 0)
      `).run();

      const entry = db.prepare("SELECT id FROM folio_hotel WHERE reserva_id = 11 AND metodo_pago = 'cuponera_pahoy'").get();
      expect(entry).toBeDefined();

      const req = {
        user: { rol: 'admin' },
        body: { ids: [entry.id], comision_porcentaje: 12.5 }
      };
      let resData;
      const res = {
        status: () => res,
        json: (data) => { resData = data; }
      };

      reconcileHandler(req, res);
      expect(resData.success).toBe(true);

      // Verify DB state
      const updated = db.prepare("SELECT reconciliado, fecha_reconciliacion, comision_porcentaje FROM folio_hotel WHERE id = ?").get(entry.id);
      expect(updated.reconciliado).toBe(1);
      expect(updated.fecha_reconciliacion).toBe(new Date().toISOString().split('T')[0]);
      expect(updated.comision_porcentaje).toBe(12.5);
    });

    it('should default comision_porcentaje to 0 when not provided', () => {
      // Seed a reservation
      db.prepare(`
        INSERT INTO reservas_hotel (id, cliente, apellido, check_in, check_out, adultos, menores, mascotas, plan_codigo, habitacion_id, monto_total, monto_pagado, saldo_pendiente, estado)
        VALUES (12, 'Bob', 'Smith', '2026-06-01', '2026-06-03', 1, 0, 0, 'EXENTO', 1, 200, 0, 200, 'Confirmada')
      `).run();

      // Register payment with al_cobro
      db.prepare(`
        INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, metodo_pago, referencia, registrado_por, reconciliado)
        VALUES (12, 'credito', 'Pago Al Cobro', 200, 'al_cobro', 'REF-AC-1', 'Test Admin', 0)
      `).run();

      const entry = db.prepare("SELECT id FROM folio_hotel WHERE reserva_id = 12 AND metodo_pago = 'al_cobro'").get();
      expect(entry).toBeDefined();

      const req = {
        user: { rol: 'admin' },
        body: { ids: [entry.id] }
      };
      let resData;
      const res = {
        status: () => res,
        json: (data) => { resData = data; }
      };

      reconcileHandler(req, res);
      expect(resData.success).toBe(true);

      // Verify DB state
      const updated = db.prepare("SELECT reconciliado, fecha_reconciliacion, comision_porcentaje FROM folio_hotel WHERE id = ?").get(entry.id);
      expect(updated.reconciliado).toBe(1);
      expect(updated.comision_porcentaje).toBe(0);
    });
  });

  describe('Audit-Safe Reversals', () => {
    const reversarHandler = findRouteHandler('/hotel/reservas/:id/folio/:folioId/reversar', 'post');

    it('should reverse a payment (credito) by adding a debit contrapartida and adjusting reservation balances', () => {
      // Seed a reservation with $100 paid and $100 pending
      db.prepare(`
        INSERT INTO reservas_hotel (id, cliente, apellido, check_in, check_out, adultos, menores, mascotas, plan_codigo, habitacion_id, monto_total, monto_pagado, saldo_pendiente, estado)
        VALUES (20, 'Jane', 'Doe', '2026-06-01', '2026-06-03', 1, 0, 0, 'EXENTO', 1, 200, 100, 100, 'Confirmada')
      `).run();

      // Seed folio payment
      db.prepare(`
        INSERT INTO folio_hotel (id, reserva_id, tipo, concepto, monto, metodo_pago, registrado_por)
        VALUES (200, 20, 'credito', 'Abono 50%', 100.0, 'efectivo', 'Test Staff')
      `).run();

      const req = {
        user: { rol: 'admin', nombre: 'Admin User' },
        params: { id: '20', folioId: '200' }
      };
      let resData;
      let resStatus = 200;
      const res = {
        status: (code) => { resStatus = code; return res; },
        json: (data) => { resData = data; return res; }
      };

      reversarHandler(req, res);
      expect(resStatus).toBe(200);
      expect(resData.success).toBe(true);

      // Check reservation balance adjusted: monto_pagado = 0, saldo_pendiente = 200
      const updatedRes = db.prepare('SELECT monto_pagado, saldo_pendiente FROM reservas_hotel WHERE id = 20').get();
      expect(updatedRes.monto_pagado).toBe(0);
      expect(updatedRes.saldo_pendiente).toBe(200);

      // Check contrapartida added in folio_hotel
      const contrapartida = db.prepare("SELECT * FROM folio_hotel WHERE reserva_id = 20 AND tipo = 'debito'").get();
      expect(contrapartida).toBeDefined();
      expect(contrapartida.concepto).toBe('Reversión de pago [ID 200]: Abono 50%');
      expect(contrapartida.monto).toBe(100.0);
    });

    it('should reject a duplicate reversal attempt on the same folio entry', () => {
      const req = {
        user: { rol: 'admin', nombre: 'Admin User' },
        params: { id: '20', folioId: '200' }
      };
      let resData;
      let resStatus = 200;
      const res = {
        status: (code) => { resStatus = code; return res; },
        json: (data) => { resData = data; return res; }
      };

      reversarHandler(req, res);
      expect(resStatus).toBe(400);
      expect(resData.success).toBe(false);
      expect(resData.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
