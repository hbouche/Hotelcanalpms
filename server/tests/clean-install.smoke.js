// Isolated smoke checks for the normal (non-test-fixture) starting state.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.NODE_ENV = 'development';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-canal-clean-'));
process.env.EXTERNAL_INTEGRATIONS_ENABLED = 'false';
delete process.env.INITIAL_ADMIN_EMAIL;
delete process.env.INITIAL_ADMIN_PASSWORD;
const { getDb, resetDb } = require('../db/database');
const db = getDb();
for (const table of ['habitaciones', 'planes_tarifa', 'reglas_tarifa', 'dias_festivos',
  'reservas_hotel', 'huespedes', 'huespedes_reserva', 'folio_hotel', 'usuarios',
  'leads_clientes', 'cotizaciones_custom', 'servicios_adicionales', 'documentos_reserva', 'api_keys', 'webhooks']) {
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, `${table} must be empty`);
}
const config = db.prepare('SELECT * FROM configuracion_sistema WHERE id = 1').get();
assert.equal(config.notifications_enabled, 0);
assert.equal(config.wa_enabled, 0);
for (const key of ['smtp_host', 'smtp_user', 'smtp_pass', 'smtp_from', 'wa_api_url', 'wa_api_token',
  'hotel_telefono', 'hotel_direccion', 'hotel_politica_cancelacion', 'hotel_politica_reembolso']) {
  assert.equal(config[key] || '', '', `${key} must be unset`);
}
assert.equal(db.prepare("SELECT valor FROM config_hotel WHERE clave='nombre_propiedad'").get().valor, 'Hotel Panamá Canal');
const express = require('express');
const app = express();
app.use(express.json());
app.use('/public', require('../routes/public'));
app.use('/integrations', require('../routes/integrations'));
app.use('/admin', require('../routes/admin'));
app.use('/webhooks', require('../routes/webhooks'));
app.use('/api/v1', require('../routes/hotel'));
app.use('/uploads', require('../public-uploads'), express.static(require('../utils/upload').UPLOADS_DIR));
(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const p = await (await fetch(base + '/public/paypal-config')).json();
    assert.equal(p.data.paypal_enabled, false);
    assert.equal(p.data.paypal_client_id, null);
    const h = await (await fetch(base + '/public/hotel-config')).json();
    assert.equal(h.data.impuesto_turismo_pct, 0);
    assert.equal(h.data.deposito_sugerido_pct, 0);
    for (const route of ['/public/paypal/create-order', '/public/paypal/capture-order',
      '/integrations/kommo', '/admin/configuracion/test-smtp', '/admin/configuracion/test-resend', '/webhooks/1/test']) {
      const response = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(response.status, 503, `${route} must be blocked`);
      assert.equal((await response.json()).error.code, 'INTEGRATIONS_DISABLED');
    }
    const uploads = require('../utils/upload').UPLOADS_DIR;
    fs.writeFileSync(path.join(uploads, 'guest-private.txt'), 'fictional private test document');
    const doc = db.prepare("INSERT INTO documentos_reserva (tipo, nombre_original, nombre_archivo) VALUES ('otro', 'guest-private.txt', 'guest-private.txt')").run();
    assert.equal((await fetch(base + '/uploads/guest-private.txt')).status, 404);
    assert.equal((await fetch(base + `/api/v1/hotel/documentos/${doc.lastInsertRowid}/archivo`)).status, 401);
    const { generateToken, hashPassword } = require('../auth');
    const user = db.prepare("INSERT INTO usuarios (email, password_hash, nombre, rol) VALUES ('smoke@example.invalid', ?, 'Fictional test user', 'admin')").run(hashPassword('isolated-test-fixture'));
    const token = generateToken({ id: user.lastInsertRowid, email: 'smoke@example.invalid', nombre: 'Fictional test user', rol: 'admin' });
    const documentPath = `/api/v1/hotel/documentos/${doc.lastInsertRowid}/archivo`;
    assert.equal((await fetch(base + documentPath + '?token=' + token)).status, 401);
    const auth = { headers: { Authorization: `Bearer ${token}` } };
    assert.equal((await fetch(base + documentPath, auth)).status, 200);
    db.prepare('UPDATE usuarios SET activo = 0 WHERE id = ?').run(user.lastInsertRowid);
    assert.equal((await fetch(base + documentPath, auth)).status, 403);
    fs.writeFileSync(path.join(uploads, 'public-room.jpg'), 'fictional public image');
    db.prepare("INSERT INTO config_hotel (clave, valor) VALUES ('foto_tipo_Prueba', '/uploads/public-room.jpg')").run();
    assert.equal((await fetch(base + '/uploads/public-room.jpg')).status, 200);
    // A public booking can be requested without online payment, but cannot claim money received.
    db.prepare("INSERT INTO habitaciones (nombre, tipo, categoria, capacidad_min, capacidad_max) VALUES ('TEST-1', 'Prueba', 'Estadía', 1, 2)").run();
    db.prepare("INSERT INTO planes_tarifa (codigo, nombre, precio_adulto_noche, visible_web) VALUES ('smoke', 'Prueba aislada', 20, 1)").run();
    const year = new Date().getUTCFullYear() + 1;
    const booking = await fetch(base + '/public/reservas/multi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      cliente: 'Fictional booking', email: 'fictional@example.invalid', monto_pagado: 999, metodo_pago: 'paypal', paypal_order_id: 'untrusted-client-claim',
      rooms: [{ tipo_habitacion: 'Prueba', plan_codigo: 'smoke', adultos: 1, check_in: `${year}-07-01`, check_out: `${year}-07-02` }]
    }) });
    assert.equal(booking.status, 201);
    assert.equal(db.prepare("SELECT monto_pagado FROM reservas_hotel WHERE cliente = 'Fictional booking'").get().monto_pagado, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM folio_hotel WHERE tipo = 'credito'").get().n, 0);
    process.env.EXTERNAL_INTEGRATIONS_ENABLED = 'true';
    assert.equal((await (await fetch(base + '/public/paypal-config')).json()).data.paypal_enabled, false);
    process.env.EXTERNAL_INTEGRATIONS_ENABLED = 'false';
    const notifications = require('../notifications');
    assert.equal((await notifications.sendEmail('nobody@example.invalid', 'test', 'test')).sent, false);
    console.log('Clean-install smoke passed: 15 operational tables empty, no inherited contacts or login, external integrations disabled; private documents require an active authenticated user.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    resetDb();
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
