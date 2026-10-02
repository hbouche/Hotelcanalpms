const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { requireAuth, requireRole, generateApiKey, hashApiKey } = require('../auth');

function ok(res, data, meta, status = 200) {
  const response = { success: true, data };
  if (meta) response.meta = meta;
  return res.status(status).json(response);
}

function err(res, code, message, status = 400) {
  return res.status(status).json({ success: false, error: { code, message } });
}

// Create API key (admin only)
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { nombre, permisos = 'read', rate_limit = 100 } = req.body;
    if (!nombre) return err(res, 'VALIDATION_ERROR', 'nombre requerido');
    if (!['read', 'write', 'admin'].includes(permisos)) return err(res, 'VALIDATION_ERROR', 'permisos debe ser: read, write, admin');
    
    const rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);
    const keyPreview = '...' + rawKey.slice(-8);
    
    const db = getDb();
    db.prepare('INSERT INTO api_keys (key_hash, key_preview, nombre, permisos, rate_limit) VALUES (?, ?, ?, ?, ?)')
      .run(keyHash, keyPreview, nombre, permisos, rate_limit);
    
    const created = db.prepare('SELECT id, key_preview, nombre, permisos, rate_limit, activo, created_at FROM api_keys WHERE key_hash = ?').get(keyHash);
    
    ok(res, {
      ...created,
      api_key: rawKey,  // Only returned once at creation!
      warning: '⚠️ Guarda esta API key. No se puede recuperar después.'
    }, null, 201);
  } catch (e) { console.error(e); err(res, 'SERVER_ERROR', 'Error creando API key', 500); }
});

// List API keys (admin)
router.get('/', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const keys = db.prepare('SELECT id, key_preview, nombre, permisos, rate_limit, activo, last_used, request_count, created_at FROM api_keys ORDER BY created_at DESC').all();
    ok(res, keys);
  } catch (e) { err(res, 'SERVER_ERROR', 'Error listando API keys', 500); }
});

// Revoke API key (admin)
router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    db.prepare('UPDATE api_keys SET activo = 0 WHERE id = ?').run(req.params.id);
    ok(res, { message: 'API key revocada' });
  } catch (e) { err(res, 'SERVER_ERROR', 'Error revocando API key', 500); }
});

module.exports = router;
