import { describe, it, expect, beforeAll, afterAll } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'hotel-canal-security-test.db';

const fs = require('fs');
const path = require('path');
const { getDb, resetDb } = require('../db/database');
const { requireAuth } = require('../auth');

const publicRouter = require('./public');
const integrationsRouter = require('./integrations');
const adminRouter = require('./admin');
const hotelRouter = require('./hotel');

function findRouteHandler(router, path, method) {
  const route = router.stack.find(
    (s) => s.route && s.route.path === path && s.route.methods[method]
  );
  if (!route) throw new Error(`Route not found for path: ${path} and method: ${method}`);
  return route.route.stack[route.route.stack.length - 1].handle;
}

describe('Public Endpoint & Webhook Secret Security Audit', () => {
  let db;
  let comprobanteHandler;
  let kommoPostHandler;
  let kommoGetHandler;
  let tempFilePath;

  beforeAll(() => {
    resetDb();

    const dbDir = fs.existsSync('/data') ? '/data' : path.resolve(__dirname, '../../data');
    const dbPath = path.join(dbDir, 'hotel-canal-security-test.db');
    if (fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath);
      } catch (e) {}
    }

    db = getDb();

    // Create temp file for comprobante upload signature validation
    tempFilePath = path.join(__dirname, 'temp-comprobante.pdf');
    fs.writeFileSync(tempFilePath, Buffer.from('%PDF-1.4 - dummy pdf file content for checking magic bytes'));

    comprobanteHandler = findRouteHandler(publicRouter, '/reservas/:id/comprobante', 'post');
    kommoPostHandler = findRouteHandler(integrationsRouter, '/kommo', 'post');
    kommoGetHandler = findRouteHandler(integrationsRouter, '/kommo', 'get');
  });

  afterAll(() => {
    if (fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (e) {}
    }
  });

  describe('1. Public Endpoint Security: /reservas/:id/comprobante', () => {
    it('should reject with 401 if no email is provided', async () => {
      // Mock db reservation
      db.prepare("INSERT INTO reservas_hotel (id, cliente, email, check_in, check_out, estado) VALUES (1001, 'John Doe', 'john@example.com', '2026-06-01', '2026-06-03', 'Pendiente')").run();

      const req = {
        params: { id: 1001 },
        query: {},
        body: {},
        file: {
          path: tempFilePath,
          filename: 'temp-comprobante.pdf',
          originalname: 'temp-comprobante.pdf',
          mimetype: 'application/pdf',
          size: 100
        }
      };

      let resStatus = 200;
      let resData = null;
      const res = {
        status: (code) => { resStatus = code; return res; },
        json: (data) => { resData = data; return res; }
      };

      await comprobanteHandler(req, res);

      expect(resStatus).toBe(401);
      expect(resData.success).toBe(false);
      expect(resData.error.code).toBe('UNAUTHORIZED');
      expect(resData.error.message).toContain('Email no proporcionado');
    });

    it('should reject with 401 if provided email does not match reservation email', async () => {
      const req = {
        params: { id: 1001 },
        query: { email: 'wrong@example.com' },
        body: {},
        file: {
          path: tempFilePath,
          filename: 'temp-comprobante.pdf',
          originalname: 'temp-comprobante.pdf',
          mimetype: 'application/pdf',
          size: 100
        }
      };

      let resStatus = 200;
      let resData = null;
      const res = {
        status: (code) => { resStatus = code; return res; },
        json: (data) => { resData = data; return res; }
      };

      await comprobanteHandler(req, res);

      expect(resStatus).toBe(401);
      expect(resData.success).toBe(false);
      expect(resData.error.message).toContain('Email no coincide');
    });

    it('should upload successfully if email matches case-insensitively and is trimmed', async () => {
      const req = {
        params: { id: 1001 },
        query: { email: '  JOHN@example.com  ' },
        body: { notas: 'Test public receipt upload' },
        file: {
          path: tempFilePath,
          filename: 'temp-comprobante.pdf',
          originalname: 'temp-comprobante.pdf',
          mimetype: 'application/pdf',
          size: 100
        }
      };

      let resStatus = 200;
      let resData = null;
      const res = {
        status: (code) => { resStatus = code; return res; },
        json: (data) => { resData = data; return res; }
      };

      await comprobanteHandler(req, res);

      expect(resStatus).toBe(201);
      expect(resData.success).toBe(true);
      expect(resData.data.reserva_id).toBe(1001);
      expect(resData.data.nombre_original).toBe('temp-comprobante.pdf');
    });
  });

  describe('2. Webhook Secret Validation: /kommo', () => {
    beforeAll(() => {
      // Clean config_hotel table before webhook tests
      db.prepare("DELETE FROM config_hotel WHERE clave = 'kommo_webhook_secret'").run();
      delete process.env.KOMMO_WEBHOOK_SECRET;
    });

    it('should pass without secret validation if no secret is configured', async () => {
      const req = {
        query: { lead_id: 12345, check_in: '2026-06-01', check_out: '2026-06-02', tipo_habitacion: 'Doble' },
        body: {}
      };

      let resStatus = 200;
      let resData = null;
      const res = {
        status: (code) => { resStatus = code; return res; },
        json: (data) => { resData = data; return res; }
      };

      await kommoPostHandler(req, res);

      expect(resStatus).toBe(200);
      expect(resData.success).toBe(true);
    });

    it('should reject with 401 if secret is configured in DB but not provided by client', async () => {
      db.prepare("INSERT OR REPLACE INTO config_hotel (clave, valor) VALUES ('kommo_webhook_secret', 'my-super-secret')").run();

      const req = {
        query: { lead_id: 12345, check_in: '2026-06-01', check_out: '2026-06-02', tipo_habitacion: 'Doble' },
        body: {}
      };

      let resStatus = 200;
      let resData = null;
      const res = {
        status: (code) => { resStatus = code; return res; },
        json: (data) => { resData = data; return res; }
      };

      await kommoPostHandler(req, res);

      expect(resStatus).toBe(401);
      expect(resData.success).toBe(false);
      expect(resData.error.message).toContain('Invalid or missing webhook secret');
    });

    it('should reject with 401 if secret is configured in DB but client provides invalid one', async () => {
      const req = {
        query: { lead_id: 12345, check_in: '2026-06-01', check_out: '2026-06-02', tipo_habitacion: 'Doble', secret: 'wrong-secret' },
        body: {}
      };

      let resStatus = 200;
      let resData = null;
      const res = {
        status: (code) => { resStatus = code; return res; },
        json: (data) => { resData = data; return res; }
      };

      await kommoPostHandler(req, res);

      expect(resStatus).toBe(401);
      expect(resData.success).toBe(false);
    });

    it('should accept if secret matches query parameter secret', async () => {
      const req = {
        query: { lead_id: 12345, check_in: '2026-06-01', check_out: '2026-06-02', tipo_habitacion: 'Doble', secret: 'my-super-secret' },
        body: {}
      };

      let resStatus = 200;
      let resData = null;
      const res = {
        status: (code) => { resStatus = code; return res; },
        json: (data) => { resData = data; return res; }
      };

      await kommoPostHandler(req, res);

      expect(resStatus).toBe(200);
      expect(resData.success).toBe(true);
    });

    it('should accept if secret matches header x-kommo-secret', async () => {
      const req = {
        query: { lead_id: 12345, check_in: '2026-06-01', check_out: '2026-06-02', tipo_habitacion: 'Doble' },
        headers: { 'x-kommo-secret': 'my-super-secret' },
        body: {}
      };

      let resStatus = 200;
      let resData = null;
      const res = {
        status: (code) => { resStatus = code; return res; },
        json: (data) => { resData = data; return res; }
      };

      await kommoPostHandler(req, res);

      expect(resStatus).toBe(200);
      expect(resData.success).toBe(true);
    });
  });

  describe('3. Private Route Authentication Audit', () => {
    it('should protect all routes in adminRouter with requireAuth middleware', () => {
      adminRouter.stack.forEach((layer) => {
        if (layer.route) {
          const hasAuth = layer.route.stack.some(
            (mw) => mw.handle === requireAuth || mw.name === 'requireAuth'
          );
          expect(hasAuth).toBe(true);
        }
      });
    });

    it('should protect all routes in hotelRouter with requireAuth middleware', () => {
      hotelRouter.stack.forEach((layer) => {
        if (layer.route) {
          // This route uses inline authentication (JWT or query token) for direct browser downloads
          if (layer.route.path === '/hotel/documentos/:docId/archivo') {
            return;
          }
          const hasAuth = layer.route.stack.some(
            (mw) => mw.handle === requireAuth || mw.name === 'requireAuth'
          );
          expect(hasAuth).toBe(true);
        }
      });
    });
  });

  describe('Diagnostics', () => {
    it('should print notifications config', () => {
      const { ENABLED } = require('../notifications');
      const { getDb } = require('../db/database');
      const db = getDb();
      console.log('DIAGNOSTICS - process.env.NOTIFICATIONS_ENABLED:', process.env.NOTIFICATIONS_ENABLED);
      console.log('DIAGNOSTICS - process.env.NODE_ENV:', process.env.NODE_ENV);
      console.log('DIAGNOSTICS - process.env.TEST_DB_NAME:', process.env.TEST_DB_NAME);
      console.log('DIAGNOSTICS - notifications.ENABLED:', ENABLED);
      try {
        const config = db.prepare('SELECT * FROM configuracion_sistema WHERE id = 1').get();
        console.log('DIAGNOSTICS - DB SYSTEM CONFIG:', config);
        const count = db.prepare('SELECT COUNT(*) as c FROM notificaciones_log').get();
        console.log('DIAGNOSTICS - notificaciones_log count:', count);
      } catch (e) {
        console.log('DIAGNOSTICS - Failed to query DB:', e.message);
      }
    });

    it('should check plan applicable types', () => {
      const { getDb } = require('../db/database');
      const db = getDb();
      try {
        const plan = db.prepare('SELECT * FROM planes_tarifa WHERE codigo = "todo_incluido"').get();
        console.log('DIAGNOSTICS - PLAN tipos_aplicables raw:', JSON.stringify(plan.tipos_aplicables));
        const applicableTypes = JSON.parse(plan.tipos_aplicables);
        console.log('DIAGNOSTICS - parsed:', JSON.stringify(applicableTypes));
        console.log('DIAGNOSTICS - includes Doble:', applicableTypes.includes('Doble'));
      } catch (e) {
        console.log('DIAGNOSTICS - Plan test failed:', e.message);
      }
    });
  });
});
