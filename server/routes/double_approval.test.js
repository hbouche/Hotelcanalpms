import { describe, it, expect, beforeAll } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'hotel-canal-approval-test.db';

const { getDb, resetDb } = require('../db/database');
const hotelRouter = require('./hotel');
const adminRouter = require('./admin');
const { requireRole } = require('../auth');

// Helper to find the route handler directly from the router stack
function findRouteHandler(router, path, method) {
  const route = router.stack.find(
    (s) => s.route && s.route.path === path && s.route.methods[method]
  );
  if (!route) throw new Error(`Route not found for path: ${path} and method: ${method}`);
  return route.route.stack[route.route.stack.length - 1].handle;
}

describe('Double Approval (4-eyes) Workflow Endpoints', () => {
  let db;
  let solicitarCambioHandler;
  let getSolicitudesHandler;
  let procesarSolicitudHandler;

  beforeAll(() => {
    resetDb();

    const fs = require('fs');
    const path = require('path');
    const dbDir = fs.existsSync('/data') ? '/data' : path.resolve(__dirname, '../../data');
    const dbPath = path.join(dbDir, 'hotel-canal-approval-test.db');
    if (fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath);
      } catch (e) {}
    }

    db = getDb();

    // Find handlers from routers
    solicitarCambioHandler = findRouteHandler(hotelRouter, '/hotel/reservas/:id/solicitar-cambio', 'post');
    getSolicitudesHandler = findRouteHandler(adminRouter, '/solicitudes-modificacion', 'get');
    procesarSolicitudHandler = findRouteHandler(adminRouter, '/solicitudes-modificacion/:id/procesar', 'post');
  });

  describe('R1 & R2: Solicitar Cambio (Receptionist / All roles)', () => {
    it('should successfully submit a change request and lock reservation state', () => {
      // Seed a reservation
      db.prepare(`
        INSERT INTO reservas_hotel (id, cliente, check_in, check_out, adultos, precio_adulto_noche, subtotal, monto_total, saldo_pendiente, estado, impuesto_pct)
        VALUES (10, 'John', '2026-06-10', '2026-06-15', 2, 50.0, 500.0, 550.0, 550.0, 'Confirmada', 10)
      `).run();

      const req = {
        user: { nombre: 'receptionist_user', rol: 'receptionist' },
        params: { id: '10' },
        body: {
          tipo_modificacion: 'editar_reserva',
          justificacion: 'Guest wants to stay one less night',
          snapshot_datos: {
            check_out: '2026-06-14'
          }
        }
      };

      let resStatus = 200;
      let resData = null;
      const res = {
        status: (code) => { resStatus = code; return res; },
        json: (data) => { resData = data; return res; }
      };

      solicitarCambioHandler(req, res);

      expect(resStatus).toBe(201);
      expect(resData.success).toBe(true);
      expect(resData.data.reserva_id).toBe(10);
      expect(resData.data.estado).toBe('Pendiente');
      expect(resData.data.usuario_solicitante).toBe('receptionist_user');

      // Verify reservation is locked to 'Cambio Pendiente de Aprobación'
      const updatedReserva = db.prepare('SELECT estado FROM reservas_hotel WHERE id = 10').get();
      expect(updatedReserva.estado).toBe('Cambio Pendiente de Aprobación');
    });

    it('should prevent requesting a change if reservation is already pending approval', () => {
      const req = {
        user: { nombre: 'receptionist_user', rol: 'receptionist' },
        params: { id: '10' },
        body: {
          tipo_modificacion: 'editar_reserva',
          justificacion: 'Another change request',
          snapshot_datos: { adultos: 3 }
        }
      };

      let resStatus = 200;
      let resData = null;
      const res = {
        status: (code) => { resStatus = code; return res; },
        json: (data) => { resData = data; return res; }
      };

      solicitarCambioHandler(req, res);

      expect(resStatus).toBe(400);
      expect(resData.success).toBe(false);
      expect(resData.error.code).toBe('ALREADY_PENDING');
    });
  });

  describe('R1: RBAC Security constraints', () => {
    it('should reject receptionist from executing admin approval actions via requireRole middleware', () => {
      const adminMiddleware = requireRole('admin');
      const req = {
        user: { nombre: 'receptionist_user', rol: 'receptionist' }
      };

      let resStatus = 200;
      let resData = null;
      const res = {
        status: (code) => { resStatus = code; return res; },
        json: (data) => { resData = data; return res; }
      };

      const next = () => { throw new Error('Should not call next()'); };

      adminMiddleware(req, res, next);

      expect(resStatus).toBe(403);
      expect(resData.success).toBe(false);
      expect(resData.error.code).toBe('FORBIDDEN');
    });
  });

  describe('R3: Admin Approval / Rejection Panel', () => {
    it('should allow admin to list pending modification requests with joined guest context', () => {
      const req = {
        user: { nombre: 'admin_user', rol: 'admin' },
        query: { estado: 'Pendiente' }
      };

      let resStatus = 200;
      let resData = null;
      const res = {
        status: (code) => { resStatus = code; return res; },
        json: (data) => { resData = data; return res; }
      };

      getSolicitudesHandler(req, res);

      expect(resStatus).toBe(200);
      expect(resData.success).toBe(true);
      expect(resData.data.length).toBe(1);
      expect(resData.data[0].cliente).toBe('John');
      expect(resData.data[0].justificacion).toBe('Guest wants to stay one less night');
    });

    it('should successfully approve a request, recalculate totals, update DB and release lock', () => {
      // Find the pending request id
      const pendingRequest = db.prepare("SELECT id FROM solicitudes_modificacion WHERE estado = 'Pendiente'").get();
      expect(pendingRequest).toBeDefined();

      const req = {
        user: { nombre: 'admin_user', rol: 'admin' },
        params: { id: pendingRequest.id.toString() },
        body: {
          accion: 'aprobar',
          comentarios_admin: 'Approve this change'
        }
      };

      let resStatus = 200;
      let resData = null;
      const res = {
        status: (code) => { resStatus = code; return res; },
        json: (data) => { resData = data; return res; }
      };

      procesarSolicitudHandler(req, res);

      expect(resStatus).toBe(200);
      expect(resData.success).toBe(true);

      // Verify the request state is 'Aprobado'
      const updatedRequest = db.prepare('SELECT estado, procesado_por, comentarios_admin FROM solicitudes_modificacion WHERE id = ?').get(pendingRequest.id);
      expect(updatedRequest.estado).toBe('Aprobado');
      expect(updatedRequest.procesado_por).toBe('admin_user');
      expect(updatedRequest.comentarios_admin).toBe('Approve this change');

      // Verify that the changes were applied, reservation totals recalculated, and original reservation status restored
      const updatedReserva = db.prepare('SELECT * FROM reservas_hotel WHERE id = 10').get();
      expect(updatedReserva.check_out).toBe('2026-06-14');
      expect(updatedReserva.noches).toBe(4);
      expect(updatedReserva.subtotal).toBe(400.0);
      expect(updatedReserva.monto_total).toBe(440.0);
      expect(updatedReserva.saldo_pendiente).toBe(440.0);
      expect(updatedReserva.estado).toBe('Confirmada'); // Restored from locked state
    });

    it('should successfully restore reservation state and leave booking unchanged when request is rejected', () => {
      // Seed a payment in folio_hotel
      db.prepare(`
        INSERT INTO folio_hotel (id, reserva_id, tipo, concepto, monto, registrado_por)
        VALUES (500, 10, 'credito', 'Abono inicial', 100.0, 'receptionist_user')
      `).run();

      // Update reservation paid total
      db.prepare('UPDATE reservas_hotel SET monto_pagado = 100.0, saldo_pendiente = 340.0 WHERE id = 10').run();

      // Submit a change request for the payment (editar_pago)
      const reqSolicitud = {
        user: { nombre: 'receptionist_user', rol: 'receptionist' },
        params: { id: '10' },
        body: {
          tipo_modificacion: 'editar_pago',
          transaccion_original_id: '500',
          justificacion: 'Typo in amount, should be 200',
          snapshot_datos: { monto: 200.0 }
        }
      };

      let statusSolicitud = 200;
      let dataSolicitud = null;
      const resSolicitud = {
        status: (code) => { statusSolicitud = code; return resSolicitud; },
        json: (data) => { dataSolicitud = data; return resSolicitud; }
      };

      solicitarCambioHandler(reqSolicitud, resSolicitud);
      expect(statusSolicitud).toBe(201);

      // Verify reservation is locked to 'Cambio Pendiente de Aprobación'
      let resLock = db.prepare('SELECT estado FROM reservas_hotel WHERE id = 10').get();
      expect(resLock.estado).toBe('Cambio Pendiente de Aprobación');

      // Admin rejects the request
      const reqRechazo = {
        user: { nombre: 'admin_user', rol: 'admin' },
        params: { id: dataSolicitud.data.id.toString() },
        body: {
          accion: 'rechazar',
          comentarios_admin: 'Refused: please check ticket receipt'
        }
      };

      let statusRechazo = 200;
      let dataRechazo = null;
      const resRechazo = {
        status: (code) => { statusRechazo = code; return resRechazo; },
        json: (data) => { dataRechazo = data; return resRechazo; }
      };

      procesarSolicitudHandler(reqRechazo, resRechazo);

      expect(statusRechazo).toBe(200);
      expect(dataRechazo.success).toBe(true);

      // Verify request state is 'Rechazado'
      const rejectedReq = db.prepare('SELECT * FROM solicitudes_modificacion WHERE id = ?').get(dataSolicitud.data.id);
      expect(rejectedReq.estado).toBe('Rechazado');
      expect(rejectedReq.comentarios_admin).toBe('Refused: please check ticket receipt');

      // Verify booking remains in original 'Confirmada' state and numbers are untouched
      const originalRes = db.prepare('SELECT * FROM reservas_hotel WHERE id = 10').get();
      expect(originalRes.estado).toBe('Confirmada');
      expect(originalRes.monto_pagado).toBe(100.0);

      const originalPayment = db.prepare('SELECT * FROM folio_hotel WHERE id = 500').get();
      expect(originalPayment.monto).toBe(100.0);
    });
  });
});
