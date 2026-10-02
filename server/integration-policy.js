function integrationsEnabled() {
  return process.env.EXTERNAL_INTEGRATIONS_ENABLED === 'true';
}
function requireIntegrations(req, res, next) {
  if (!integrationsEnabled()) return res.status(503).json({ success: false, error: {
    code: 'INTEGRATIONS_DISABLED', message: 'Integraciones externas desactivadas en esta copia'
  } });
  next();
}
function cardPaymentsEnabled() {
  return integrationsEnabled() && process.env.CARD_PAYMENTS_ENABLED === 'true';
}
function requireCardPayments(req, res, next) {
  if (!cardPaymentsEnabled()) return res.status(503).json({ success: false, error: {
    code: 'INTEGRATIONS_DISABLED', message: 'Cobros con tarjeta y PayPal desactivados'
  } });
  next();
}
module.exports = { integrationsEnabled, requireIntegrations, cardPaymentsEnabled, requireCardPayments };
