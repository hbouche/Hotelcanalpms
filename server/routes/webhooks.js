const express = require('express');
const router = express.Router();
router.use(require('../integration-policy').requireIntegrations);
const crypto = require('crypto');
const { getDb } = require('../db/database');
const { requireAuth, requireRole } = require('../auth');
const { WEBHOOK_EVENTS } = require('../utils/webhooks');

function ok(res, data, meta, status = 200) {
  const response = { success: true, data };
  if (meta) response.meta = meta;
  return res.status(status).json(response);
}

function err(res, code, message, status = 400) {
  return res.status(status).json({ success: false, error: { code, message } });
}

// Create webhook (admin only)
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { url, eventos } = req.body;
    if (!url || !eventos) return err(res, 'VALIDATION_ERROR', 'url y eventos requeridos');
    if (!Array.isArray(eventos)) return err(res, 'VALIDATION_ERROR', 'eventos debe ser un array');
    const invalid = eventos.filter(e => e !== '*' && !WEBHOOK_EVENTS.includes(e));
    if (invalid.length) return err(res, 'VALIDATION_ERROR', `Eventos inválidos: ${invalid.join(', ')}. Válidos: ${WEBHOOK_EVENTS.join(', ')}, *`);
    
    const secret = crypto.randomBytes(16).toString('hex');
    const db = getDb();
    const result = db.prepare('INSERT INTO webhooks (url, eventos, secret) VALUES (?, ?, ?)').run(url, JSON.stringify(eventos), secret);
    const hook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(result.lastInsertRowid);
    ok(res, { ...hook, eventos: JSON.parse(hook.eventos), signing_secret: secret, warning: '⚠️ Guarda el signing_secret. No se puede recuperar.' }, null, 201);
  } catch (e) { console.error(e); err(res, 'SERVER_ERROR', 'Error creando webhook', 500); }
});

// List webhooks (admin only)
router.get('/', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const hooks = db.prepare('SELECT id, url, eventos, activo, last_triggered, fail_count, created_at FROM webhooks ORDER BY created_at DESC').all();
    ok(res, hooks.map(h => ({ ...h, eventos: JSON.parse(h.eventos || '[]') })));
  } catch (e) { err(res, 'SERVER_ERROR', 'Error listando webhooks', 500); }
});

// Delete webhook (admin only)
router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM webhooks WHERE id = ?').run(req.params.id);
    ok(res, { message: 'Webhook eliminado' });
  } catch (e) { err(res, 'SERVER_ERROR', 'Error eliminando webhook', 500); }
});

// Test webhook (admin only)
router.post('/:id/test', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const hook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id);
    if (!hook) return err(res, 'NOT_FOUND', 'Webhook no encontrado', 404);
    
    const testPayload = { test: true, message: 'Test webhook from Hotel Panamá Canal PMS', timestamp: new Date().toISOString() };
    const body = JSON.stringify({ evento: 'test', timestamp: new Date().toISOString(), data: testPayload });
    const signature = hook.secret ? crypto.createHmac('sha256', hook.secret).update(body).digest('hex') : null;
    
    const url = new URL(hook.url);
    const options = {
      hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Event': 'test', ...(signature ? { 'X-Webhook-Signature': `sha256=${signature}` } : {}) }
    };
    const lib = url.protocol === 'https:' ? require('https') : require('http');
    const req2 = lib.request(options, (r) => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => ok(res, { status: r.statusCode, response: d.substring(0, 200) }));
    });
    req2.on('error', (e) => ok(res, { status: 'error', message: e.message }));
    req2.write(body);
    req2.end();
  } catch (e) { err(res, 'SERVER_ERROR', 'Error testing webhook', 500); }
});

module.exports = router;
