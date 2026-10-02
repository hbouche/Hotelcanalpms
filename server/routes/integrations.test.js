import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'hotel-canal-integrations-test.db';

const { getDb, resetDb } = require('../db/database');
const integrationsRouter = require('./integrations');

function findRouteHandler(router, path, method) {
  const route = router.stack.find(
    (s) => s.route && s.route.path === path && s.route.methods[method]
  );
  if (!route) throw new Error(`Route not found for path: ${path} and method: ${method}`);
  return route.route.stack[route.route.stack.length - 1].handle;
}

describe('Kommo CRM Integrations Webhook Endpoints', () => {
  let db;
  let postHandler;
  let getHandler;

  beforeAll(() => {
    resetDb();

    const fs = require('fs');
    const path = require('path');
    const dbDir = fs.existsSync('/data') ? '/data' : path.resolve(__dirname, '../../data');
    const dbPath = path.join(dbDir, 'hotel-canal-integrations-test.db');
    if (fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath);
      } catch (e) {}
    }

    db = getDb();

    postHandler = findRouteHandler(integrationsRouter, '/kommo', 'post');
    getHandler = findRouteHandler(integrationsRouter, '/kommo', 'get');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return VALIDATION_ERROR (400) if lead_id is missing', async () => {
    const req = {
      query: {},
      body: {}
    };

    let resStatus = 200;
    let resData = null;
    const res = {
      status: (code) => { resStatus = code; return res; },
      json: (data) => { resData = data; return res; }
    };

    await postHandler(req, res);

    expect(resStatus).toBe(400);
    expect(resData.success).toBe(false);
    expect(resData.error.code).toBe('VALIDATION_ERROR');
    expect(resData.error.message).toContain('No lead_id found');
  });

  it('should calculate pricing and return JSON even if Kommo integration is disabled', async () => {
    // Make sure integration is disabled or not configured in database
    db.prepare("DELETE FROM config_hotel WHERE clave IN ('kommo_api_token', 'kommo_subdomain', 'kommo_enabled')").run();

    const req = {
      query: {},
      body: {
        lead_id: 12345,
        check_in: '2026-06-01',
        check_out: '2026-06-03',
        adultos: 2,
        tipo_habitacion: 'Doble',
        plan_codigo: 'demo_exp'
      }
    };

    let resStatus = 200;
    let resData = null;
    const res = {
      status: (code) => { resStatus = code; return res; },
      json: (data) => { resData = data; return res; }
    };

    await postHandler(req, res);

    expect(resStatus).toBe(200);
    expect(resData.success).toBe(true);
    expect(resData.data.lead_id).toBe(12345);
    expect(resData.data.noches).toBe(2);
    expect(resData.data.adultos).toBe(2);
    expect(resData.data.tipo_habitacion).toBe('Doble');
    expect(resData.data.monto_total).toBeGreaterThan(0);
    expect(resData.data.deposito_minimo).toBe(Math.round(resData.data.monto_total * 0.5 * 100) / 100);
    expect(resData.data.disponible).toBe(true);
  });

  it('should correctly parse lead_id from different webhook formats', async () => {
    const formats = [
      {
        req: { query: { lead_id: 101 }, body: {} },
        expected: 101
      },
      {
        req: { query: {}, body: { lead_id: 102 } },
        expected: 102
      },
      {
        req: { query: {}, body: { leads: { status: [{ id: 103 }] } } },
        expected: 103
      },
      {
        req: { query: {}, body: { leads: { update: [{ id: 104 }] } } },
        expected: 104
      },
      {
        req: { query: {}, body: { 'leads[status][0][id]': 105 } },
        expected: 105
      }
    ];

    for (const f of formats) {
      // Set basic reservation values to avoid VALIDATION_ERROR on dates
      f.req.query.check_in = '2026-06-01';
      f.req.query.check_out = '2026-06-02';
      f.req.query.tipo_habitacion = 'Doble';

      let resStatus = 200;
      let resData = null;
      const res = {
        status: (code) => { resStatus = code; return res; },
        json: (data) => { resData = data; return res; }
      };

      await postHandler(f.req, res);

      expect(resStatus).toBe(200);
      expect(resData.success).toBe(true);
      expect(resData.data.lead_id).toBe(f.expected);
    }
  });

  it('should call GET /kommo (fallback) and delegate to POST', async () => {
    const req = {
      query: {
        lead_id: 999,
        check_in: '2026-06-05',
        check_out: '2026-06-08',
        adultos: 1,
        tipo_habitacion: 'Estándar'
      },
      body: {}
    };

    let resStatus = 200;
    let resData = null;
    const res = {
      status: (code) => { resStatus = code; return res; },
      json: (data) => { resData = data; return res; }
    };

    // Mock router.handle as a direct call to postHandler
    const router = integrationsRouter;
    const originalHandle = router.handle;
    router.handle = async (rq, rs) => {
      await postHandler(rq, rs);
    };

    try {
      await getHandler(req, res);
      expect(resStatus).toBe(200);
      expect(resData.success).toBe(true);
      expect(resData.data.lead_id).toBe(999);
      expect(resData.data.noches).toBe(3);
      expect(resData.data.tipo_habitacion).toBe('Estándar');
    } finally {
      router.handle = originalHandle;
    }
  });

  it('should fetch lead, map fields, update lead, and write notes in Kommo if Token is configured', async () => {
    // Configure Kommo integration in the test database
    db.prepare("INSERT OR REPLACE INTO config_hotel (clave, valor, descripcion) VALUES ('kommo_api_token', 'my-dummy-jwt-token', 'Kommo API Token')").run();
    db.prepare("INSERT OR REPLACE INTO config_hotel (clave, valor, descripcion) VALUES ('kommo_subdomain', 'testsub', 'Kommo Subdomain')").run();
    db.prepare("INSERT OR REPLACE INTO config_hotel (clave, valor, descripcion) VALUES ('kommo_enabled', '1', 'Kommo Enabled')").run();

    // Mock fetch
    const mockLeadResponse = {
      id: 888,
      custom_fields_values: [
        { field_name: 'PMS_CHECK_IN', values: [{ value: '2026-07-10' }] },
        { field_name: 'pms_check_out ', values: [{ value: '2026-07-15' }] },
        { field_name: 'PMS_ADULTOS', values: [{ value: '3' }] },
        { field_name: 'pms_tipo_habitacion', values: [{ value: 'Familiar' }] }
      ]
    };

    const mockCustomFieldsResponse = {
      _embedded: {
        custom_fields: [
          { id: 1111, name: 'PMS_TOTAL_COTIZACION' },
          { id: 2222, name: 'PMS_DEPOSITO_MINIMO' }
        ]
      }
    };

    const fetchCalls = [];

    const mockFetch = vi.fn().mockImplementation((url, options) => {
      fetchCalls.push({ url, options });

      if (url.includes('/api/v4/leads/888?with=contacts')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockLeadResponse)
        });
      }

      if (url.includes('/api/v4/leads/custom_fields')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockCustomFieldsResponse)
        });
      }

      if (url.includes('/api/v4/leads/888') && options?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true })
        });
      }

      if (url.includes('/api/v4/leads/888/notes') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true })
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({})
      });
    });

    vi.stubGlobal('fetch', mockFetch);

    // Call webhook with only lead_id (dates and config should be retrieved automatically from Kommo lead mock!)
    const req = {
      query: { lead_id: 888 },
      body: {}
    };

    let resStatus = 200;
    let resData = null;
    const res = {
      status: (code) => { resStatus = code; return res; },
      json: (data) => { resData = data; return res; }
    };

    await postHandler(req, res);

    expect(resStatus).toBe(200);
    expect(resData.success).toBe(true);
    expect(resData.data.lead_id).toBe(888);
    expect(resData.data.check_in).toBe('2026-07-10');
    expect(resData.data.check_out).toBe('2026-07-15');
    expect(resData.data.noches).toBe(5);
    expect(resData.data.adultos).toBe(3);
    expect(resData.data.tipo_habitacion).toBe('Familiar');

    // Verify correct Kommo API calls were made
    expect(mockFetch).toHaveBeenCalled();

    // 1. Fetch Lead
    const getLeadCall = fetchCalls.find(c => c.url.includes('/leads/888?with=contacts'));
    expect(getLeadCall).toBeDefined();
    expect(getLeadCall.options.headers.Authorization).toBe('Bearer my-dummy-jwt-token');

    // 2. Fetch Custom Fields
    const getFieldsCall = fetchCalls.find(c => c.url.includes('/leads/custom_fields'));
    expect(getFieldsCall).toBeDefined();

    // 3. Patch Custom Fields (Total & Deposito)
    const patchLeadCall = fetchCalls.find(c => c.url.includes('/leads/888') && c.options.method === 'PATCH');
    expect(patchLeadCall).toBeDefined();
    const patchBody = JSON.parse(patchLeadCall.options.body);
    expect(patchBody.custom_fields_values).toEqual([
      { field_id: 1111, values: [{ value: String(resData.data.monto_total) }] },
      { field_id: 2222, values: [{ value: String(resData.data.deposito_minimo) }] }
    ]);

    // 4. Create Note (Ready-to-copy WhatsApp message)
    const postNoteCall = fetchCalls.find(c => c.url.includes('/leads/888/notes') && c.options.method === 'POST');
    expect(postNoteCall).toBeDefined();
    const noteBody = JSON.parse(postNoteCall.options.body);
    expect(noteBody[0].note_type).toBe('common');
    expect(noteBody[0].params.text).toContain('💰 Total:');
    expect(noteBody[0].params.text).toContain('MENSAJE LISTO PARA WHATSAPP');
  });

  it('should post a warning note to Kommo if validation fails but Token is configured', async () => {
    // Configure Kommo integration
    db.prepare("INSERT OR REPLACE INTO config_hotel (clave, valor, descripcion) VALUES ('kommo_api_token', 'my-dummy-jwt-token', 'Kommo API Token')").run();
    db.prepare("INSERT OR REPLACE INTO config_hotel (clave, valor, descripcion) VALUES ('kommo_subdomain', 'testsub', 'Kommo Subdomain')").run();
    db.prepare("INSERT OR REPLACE INTO config_hotel (clave, valor, descripcion) VALUES ('kommo_enabled', '1', 'Kommo Enabled')").run();

    const fetchCalls = [];
    const mockFetch = vi.fn().mockImplementation((url, options) => {
      fetchCalls.push({ url, options });

      if (url.includes('/api/v4/leads/777?with=contacts')) {
        // Return lead with empty fields (will cause validation error)
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 777, custom_fields_values: [] })
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({})
      });
    });

    vi.stubGlobal('fetch', mockFetch);

    // Call webhook with lead_id 777 and no other arguments
    const req = {
      query: { lead_id: 777 },
      body: {}
    };

    let resStatus = 200;
    let resData = null;
    const res = {
      status: (code) => { resStatus = code; return res; },
      json: (data) => { resData = data; return res; }
    };

    await postHandler(req, res);

    expect(resStatus).toBe(400);
    expect(resData.success).toBe(false);
    expect(resData.error.code).toBe('VALIDATION_ERROR');

    // Verify warning note was posted to Kommo
    const warningNoteCall = fetchCalls.find(c => c.url.includes('/leads/777/notes') && c.options.method === 'POST');
    expect(warningNoteCall).toBeDefined();
    const noteBody = JSON.parse(warningNoteCall.options.body);
    expect(noteBody[0].params.text).toContain('⚠️ Error de Cotización PMS');
    expect(noteBody[0].params.text).toContain('Datos de reserva incompletos');
  });
});
