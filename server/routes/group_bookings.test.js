import { describe, it, expect, beforeAll } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'hotel-canal-group-test.db';

const { getDb, resetDb } = require('../db/database');
const hotelRouter = require('./hotel');

// Helper to find the route handler directly from the router stack
function findRouteHandler(router, path, method) {
  const route = router.stack.find(
    (s) => s.route && s.route.path === path && s.route.methods[method]
  );
  if (!route) throw new Error(`Route not found for path: ${path} and method: ${method}`);
  return route.route.stack[route.route.stack.length - 1].handle;
}

describe('Group Bookings and Folio Billing Consolidation', () => {
  let db;
  let getReservasHandler;
  let postGrupoHandler;
  let postFolioHandler;

  beforeAll(() => {
    resetDb();

    const fs = require('fs');
    const path = require('path');
    const dbDir = fs.existsSync('/data') ? '/data' : path.resolve(__dirname, '../../data');
    const dbPath = path.join(dbDir, 'hotel-canal-group-test.db');
    if (fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath);
      } catch (e) {}
    }

    db = getDb();

    // Find route handlers
    getReservasHandler = findRouteHandler(hotelRouter, '/hotel/reservas', 'get');
    postGrupoHandler = findRouteHandler(hotelRouter, '/hotel/reservas/grupo', 'post');
    postFolioHandler = findRouteHandler(hotelRouter, '/hotel/reservas/:id/folio', 'post');

    // Seed clean test room data
    db.pragma('foreign_keys = OFF');
    db.prepare('DELETE FROM folio_hotel').run();
    db.prepare('DELETE FROM reservas_hotel').run();
    db.prepare('DELETE FROM planes_tarifa').run();
    db.prepare('DELETE FROM reglas_tarifa').run();
    db.prepare('DELETE FROM habitaciones').run();
    db.pragma('foreign_keys = ON');

    db.prepare(`
      INSERT INTO habitaciones (id, nombre, tipo, categoria, estado_habitacion, estado_limpieza)
      VALUES 
        (101, 'FAM(1)', 'Familiar', 'Estadía', 'Vacía', 'Limpia'),
        (102, 'DOB(1)', 'Doble', 'Estadía', 'Vacía', 'Limpia'),
        (103, 'EST(1)', 'Estándar', 'Estadía', 'Vacía', 'Limpia')
    `).run();

    db.prepare(`
      INSERT INTO planes_tarifa (id, codigo, nombre, precio_adulto_noche, precio_menor_noche, precio_mascota_noche, lleva_impuesto, impuesto_pct, activo)
      VALUES (1, 'oferta_simple', 'Oferta Simple', 100.0, 50.0, 0, 1, 10, 1)
    `).run();

    db.prepare(`
      INSERT INTO reglas_tarifa (plan_id, tipo_dia, precio_adulto, precio_menor, precio_mascota, activo)
      VALUES 
        (1, 'entre_semana', 100.0, 50.0, 0, 1),
        (1, 'fin_de_semana', 125.0, 60.0, 0, 1),
        (1, 'festivo', 150.0, 75.0, 0, 1)
    `).run();
  });

  describe('POST /hotel/reservas/grupo', () => {
    it('should create group bookings with consolidated billing successfully', () => {
      const req = {
        user: { nombre: 'Admin User', email: 'admin@example.invalid' },
        body: {
          facturacion_consolidada: 1,
          reservas: [
            {
              cliente: 'Lead',
              apellido: 'Group',
              email: 'lead@group.com',
              habitacion_id: 101,
              check_in: '2026-07-01',
              check_out: '2026-07-03',
              adultos: 2,
              menores: 0,
              plan_codigo: 'oferta_simple',
              precio_adulto_noche: 100
            },
            {
              cliente: 'Child One',
              apellido: 'Guest',
              email: 'child1@group.com',
              habitacion_id: 102,
              check_in: '2026-07-01',
              check_out: '2026-07-03',
              adultos: 1,
              menores: 0,
              plan_codigo: 'oferta_simple',
              precio_adulto_noche: 100
            }
          ]
        }
      };

      let resStatus = 200;
      let resData = null;
      const res = {
        status: (code) => { resStatus = code; return res; },
        json: (data) => { resData = data; return res; }
      };

      postGrupoHandler(req, res);

      expect(resStatus).toBe(201);
      expect(resData.success).toBe(true);
      expect(resData.data.grupo_codigo).toMatch(/^GRP-\d{8}-/);

      const groupCode = resData.data.grupo_codigo;

      // Verify reservations in DB
      const master = db.prepare("SELECT * FROM reservas_hotel WHERE grupo_codigo = ? AND es_maestra = 1").get(groupCode);
      const child = db.prepare("SELECT * FROM reservas_hotel WHERE grupo_codigo = ? AND es_maestra = 0").get(groupCode);

      expect(master).toBeDefined();
      expect(child).toBeDefined();
      expect(child.parent_reserva_id).toBe(master.id);

      // Pricing check for consolidated billing (Estadía per person rate):
      // Master room cost: 2 adults * 100 * 2 nights = 400. Tax = 40. Total = 440
      // Child room cost: 1 adult * 100 * 2 nights = 200. Tax = 20. Total = 220
      // Aggregate: subtotal = 600, impuesto_monto = 60, monto_total = 660
      expect(master.subtotal).toBe(600);
      expect(master.impuesto_monto).toBe(60);
      expect(master.monto_total).toBe(660);
      expect(master.saldo_pendiente).toBe(660);

      // Child must be stored with $0
      expect(child.subtotal).toBe(0);
      expect(child.impuesto_monto).toBe(0);
      expect(child.monto_total).toBe(0);
      expect(child.saldo_pendiente).toBe(0);

      // Folio entries on Master
      const folioEntries = db.prepare("SELECT * FROM folio_hotel WHERE reserva_id = ?").all(master.id);
      expect(folioEntries.length).toBe(4);
      expect(folioEntries.some(f => f.monto === 400 && f.concepto.includes('Lead Group'))).toBe(true);
      expect(folioEntries.some(f => f.monto === 40 && f.concepto.includes('Lead Group'))).toBe(true);
      expect(folioEntries.some(f => f.monto === 200 && f.concepto.includes('Child One Guest'))).toBe(true);
      expect(folioEntries.some(f => f.monto === 20 && f.concepto.includes('Child One Guest'))).toBe(true);
    });

    it('should reject group bookings if any room has 0 adults', () => {
      const req = {
        user: { nombre: 'Admin User', email: 'admin@example.invalid' },
        body: {
          facturacion_consolidada: 1,
          reservas: [
            {
              cliente: 'Lead',
              apellido: 'Group',
              email: 'lead@group.com',
              habitacion_id: 101,
              check_in: '2026-07-01',
              check_out: '2026-07-03',
              adultos: 2,
              menores: 0,
              plan_codigo: 'oferta_simple',
              precio_adulto_noche: 100
            },
            {
              cliente: 'Child One',
              apellido: 'Guest',
              email: 'child1@group.com',
              habitacion_id: 102,
              check_in: '2026-07-01',
              check_out: '2026-07-03',
              adultos: 0,
              menores: 2,
              plan_codigo: 'oferta_simple',
              precio_adulto_noche: 100
            }
          ]
        }
      };

      let resStatus = 200;
      let resData = null;
      const res = {
        status: (code) => { resStatus = code; return res; },
        json: (data) => { resData = data; return res; }
      };

      postGrupoHandler(req, res);

      expect(resStatus).toBe(400);
      expect(resData.success).toBe(false);
      expect(resData.error.code).toBe('VALIDATION_ERROR');
      expect(resData.error.message).toContain('debe tener al menos 1 adulto');
    });

    it('should create group bookings with separate billing successfully', () => {
      const req = {
        user: { nombre: 'Admin User', email: 'admin@example.invalid' },
        body: {
          facturacion_consolidada: 0,
          reservas: [
            {
              cliente: 'Lead Sep',
              apellido: 'Group',
              email: 'sep_lead@group.com',
              habitacion_id: 101,
              check_in: '2026-08-01',
              check_out: '2026-08-03',
              adultos: 2,
              menores: 0,
              plan_codigo: 'oferta_simple',
              precio_adulto_noche: 100
            },
            {
              cliente: 'Child Sep',
              apellido: 'Guest',
              email: 'sep_child@group.com',
              habitacion_id: 102,
              check_in: '2026-08-01',
              check_out: '2026-08-03',
              adultos: 1,
              menores: 0,
              plan_codigo: 'oferta_simple',
              precio_adulto_noche: 100
            }
          ]
        }
      };

      let resStatus = 200;
      let resData = null;
      const res = {
        status: (code) => { resStatus = code; return res; },
        json: (data) => { resData = data; return res; }
      };

      postGrupoHandler(req, res);

      expect(resStatus).toBe(201);
      expect(resData.success).toBe(true);
      const groupCode = resData.data.grupo_codigo;

      const master = db.prepare("SELECT * FROM reservas_hotel WHERE grupo_codigo = ? AND es_maestra = 1").get(groupCode);
      const child = db.prepare("SELECT * FROM reservas_hotel WHERE grupo_codigo = ? AND es_maestra = 0").get(groupCode);

      // Separate accounts check (Estadía per person rate)
      expect(master.subtotal).toBe(450);
      expect(master.impuesto_monto).toBe(45);
      expect(master.monto_total).toBe(495);

      expect(child.subtotal).toBe(225);
      expect(child.impuesto_monto).toBe(22.5);
      expect(child.monto_total).toBe(247.5);

      // Folio entries should be separate
      const masterFolio = db.prepare("SELECT * FROM folio_hotel WHERE reserva_id = ?").all(master.id);
      const childFolio = db.prepare("SELECT * FROM folio_hotel WHERE reserva_id = ?").all(child.id);

      expect(masterFolio.length).toBe(2);
      expect(childFolio.length).toBe(2);
    });

    it('should reject bookings if any room overlaps with an existing reservation', () => {
      const req = {
        user: { nombre: 'Admin User', email: 'admin@example.invalid' },
        body: {
          facturacion_consolidada: 1,
          reservas: [
            {
              cliente: 'Overlap Lead',
              apellido: 'Group',
              email: 'overlap@group.com',
              habitacion_id: 101, // conflict
              check_in: '2026-07-02',
              check_out: '2026-07-04',
              adultos: 2,
              plan_codigo: 'oferta_simple'
            },
            {
              cliente: 'Clean Child',
              apellido: 'Guest',
              email: 'cleanchild@group.com',
              habitacion_id: 103, // clean
              check_in: '2026-07-02',
              check_out: '2026-07-04',
              adultos: 1,
              plan_codigo: 'oferta_simple'
            }
          ]
        }
      };

      let resStatus = 200;
      let resData = null;
      const res = {
        status: (code) => { resStatus = code; return res; },
        json: (data) => { resData = data; return res; }
      };

      postGrupoHandler(req, res);

      expect(resStatus).toBe(500);
      expect(resData.success).toBe(false);

      // Verify that Clean Child was NOT created due to rollback
      const rolledBack = db.prepare("SELECT id FROM reservas_hotel WHERE cliente = 'Clean Child'").get();
      expect(rolledBack).toBeUndefined();
    });
  });

  describe('Folio Redirection & Consolidated Accounting', () => {
    it('should redirect child folio additions to Master when consolidated billing is enabled', () => {
      const child = db.prepare("SELECT * FROM reservas_hotel WHERE cliente = 'Child One'").get();
      const master = db.prepare("SELECT * FROM reservas_hotel WHERE id = ?").get(child.parent_reserva_id);

      expect(child.facturacion_consolidada).toBe(1);

      const req = {
        user: { nombre: 'Receptionist' },
        params: { id: child.id.toString() },
        body: {
          monto: 50.0,
          concepto: 'Servicio al cuarto',
          tipo: 'debito'
        }
      };

      let resStatus = 200;
      let resData = null;
      const res = {
        status: (code) => { resStatus = code; return res; },
        json: (data) => { resData = data; return res; }
      };

      postFolioHandler(req, res);

      expect(resStatus).toBe(200);
      expect(resData.success).toBe(true);

      // The returned reservation must be the Master (since redirect happened)
      expect(resData.data.id).toBe(master.id);

      // Master totals should increase by 50 + 5 (tax) = 55
      // Old Master total: 660. New Master total: 715
      expect(resData.data.productos_adicionales).toBe(50);
      expect(resData.data.monto_total).toBe(715);
      expect(resData.data.saldo_pendiente).toBe(715);

      // Verify folio entry is recorded on Master's folio
      const redirectedFolio = db.prepare("SELECT * FROM folio_hotel WHERE reserva_id = ? AND tipo = 'debito' AND concepto LIKE '%Servicio al cuarto%'").get(master.id);
      expect(redirectedFolio).toBeDefined();
      expect(redirectedFolio.monto).toBe(50.0);
      expect(redirectedFolio.concepto).toContain('Child One Guest');
    });

    it('should support payments redirections directly to Master folio', () => {
      const child = db.prepare("SELECT * FROM reservas_hotel WHERE cliente = 'Child One'").get();
      const master = db.prepare("SELECT * FROM reservas_hotel WHERE id = ?").get(child.parent_reserva_id);

      const req = {
        user: { nombre: 'Receptionist' },
        params: { id: child.id.toString() },
        body: {
          monto: 200.0,
          concepto: 'Pago de estadía',
          tipo: 'credito',
          metodo_pago: 'efectivo'
        }
      };

      let resStatus = 200;
      let resData = null;
      const res = {
        status: (code) => { resStatus = code; return res; },
        json: (data) => { resData = data; return res; }
      };

      postFolioHandler(req, res);

      expect(resStatus).toBe(200);
      expect(resData.success).toBe(true);
      expect(resData.data.id).toBe(master.id);

      // Master paid amount must be 200, outstanding balance should decrease by 200
      // Previous total: 715. paid: 200. pending: 515
      expect(resData.data.monto_pagado).toBe(200);
      expect(resData.data.saldo_pendiente).toBe(515);

      // Verify payment recorded on Master's folio
      const paymentFolio = db.prepare("SELECT * FROM folio_hotel WHERE reserva_id = ? AND tipo = 'credito' AND concepto LIKE '%Pago de estadía%'").get(master.id);
      expect(paymentFolio).toBeDefined();
      expect(paymentFolio.monto).toBe(200.0);
      expect(paymentFolio.concepto).toContain('Child One Guest');
    });
  });

  describe('GET /hotel/reservas with grupo_codigo filter', () => {
    it('should filter reservations by group code', () => {
      const child = db.prepare("SELECT * FROM reservas_hotel WHERE cliente = 'Child One'").get();
      const groupCode = child.grupo_codigo;

      const req = {
        user: { rol: 'admin' },
        query: { grupo_codigo: groupCode }
      };

      let resStatus = 200;
      let resData = null;
      const res = {
        status: (code) => { resStatus = code; return res; },
        json: (data) => { resData = data; return res; }
      };

      getReservasHandler(req, res);

      expect(resStatus).toBe(200);
      expect(resData.success).toBe(true);
      expect(resData.data.length).toBe(2);
      expect(resData.data.every(r => r.grupo_codigo === groupCode)).toBe(true);
    });
  });
});
