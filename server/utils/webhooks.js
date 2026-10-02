const crypto = require('crypto');
const { getDb } = require('../db/database');

const WEBHOOK_EVENTS = ['reserva.creada', 'reserva.estado', 'reserva.actualizada', 'pago.registrado', 'habitacion.limpieza', 'plan.actualizado'];

// Fire webhook helper
function fireWebhooks(evento, payload) {
  if (!require('../integration-policy').integrationsEnabled()) return;
  try {
    const db = getDb();
    const hooks = db.prepare("SELECT * FROM webhooks WHERE activo = 1").all();
    for (const hook of hooks) {
      const eventos = JSON.parse(hook.eventos || '[]');
      if (!eventos.includes(evento) && !eventos.includes('*')) continue;
      
      const body = JSON.stringify({ evento, timestamp: new Date().toISOString(), data: payload });
      const signature = hook.secret ? crypto.createHmac('sha256', hook.secret).update(body).digest('hex') : null;
      
      // Fire and forget
      const url = new URL(hook.url);
      const options = {
        hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Webhook-Event': evento, ...(signature ? { 'X-Webhook-Signature': `sha256=${signature}` } : {}) }
      };
      const lib = url.protocol === 'https:' ? require('https') : require('http');
      const req = lib.request(options, (r) => {
        db.prepare('UPDATE webhooks SET last_triggered = datetime("now"), fail_count = CASE WHEN ? < 300 THEN 0 ELSE fail_count + 1 END WHERE id = ?').run(r.statusCode, hook.id);
      });
      req.on('error', () => {
        db.prepare('UPDATE webhooks SET fail_count = fail_count + 1 WHERE id = ?').run(hook.id);
      });
      req.write(body);
      req.end();
    }
  } catch (e) { console.error('Webhook error:', e.message); }
}

module.exports = {
  fireWebhooks,
  WEBHOOK_EVENTS
};
