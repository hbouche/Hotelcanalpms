const express = require('express');
const router = express.Router();
const { getDb, findById, create, update } = require('../db/database');
const { requireAuth, requireRole } = require('../auth');
const { upload, validateUploadSignature } = require('../utils/upload');

function ok(res, data, meta, status = 200) {
  const response = { success: true, data };
  if (meta) response.meta = meta;
  return res.status(status).json(response);
}

function err(res, code, message, status = 400) {
  return res.status(status).json({ success: false, error: { code, message } });
}

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '');
}

// Get active rooms
router.get('/', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const rooms = db.prepare('SELECT * FROM habitaciones WHERE activa = 1 ORDER BY tipo, id').all();
    ok(res, rooms);
  } catch (e) { err(res, 'SERVER_ERROR', 'Error listando habitaciones', 500); }
});

// All rooms (including inactive) — for admin
router.get('/todas', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const rooms = db.prepare('SELECT * FROM habitaciones ORDER BY tipo, id').all();
    ok(res, rooms);
  } catch (e) { err(res, 'SERVER_ERROR', 'Error listando habitaciones', 500); }
});

// Distinct room types — for dropdowns
router.get('/tipos', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const tipos = db.prepare('SELECT DISTINCT tipo FROM habitaciones WHERE activa = 1 ORDER BY tipo').all().map(r => r.tipo);
    ok(res, tipos);
  } catch (e) { err(res, 'SERVER_ERROR', 'Error listando tipos', 500); }
});

// Create room
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { nombre, tipo } = req.body;
    if (!nombre || !tipo) return err(res, 'VALIDATION_ERROR', 'nombre y tipo requeridos');
    const db = getDb();
    // Check duplicate name
    const dup = db.prepare('SELECT id FROM habitaciones WHERE nombre = ?').get(nombre);
    if (dup) return err(res, 'DUPLICATE', `Ya existe una habitación con nombre "${nombre}"`);
    const data = {
      nombre: sanitize(nombre),
      tipo: sanitize(tipo),
      capacidad: parseInt(req.body.capacidad_max) || parseInt(req.body.capacidad) || 2,
      capacidad_min: parseInt(req.body.capacidad_min) || 1,
      capacidad_max: parseInt(req.body.capacidad_max) || 4,
      descripcion_camas: sanitize(req.body.descripcion_camas || ''),
      piso: sanitize(req.body.piso || ''),
    };
    const room = create('habitaciones', data);
    ok(res, room, null, 201);
  } catch (e) { console.error(e); err(res, 'SERVER_ERROR', 'Error creando habitación', 500); }
});

// Update room (full edit)
router.put('/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const existing = findById('habitaciones', req.params.id);
    if (!existing) return err(res, 'NOT_FOUND', 'Habitación no encontrada', 404);
    const data = {};
    const allowed = ['nombre', 'tipo', 'capacidad', 'capacidad_min', 'capacidad_max', 'descripcion_camas', 'piso', 'activa'];
    for (const f of allowed) {
      if (req.body[f] !== undefined) data[f] = typeof req.body[f] === 'string' ? sanitize(req.body[f]) : req.body[f];
    }
    // Keep capacidad in sync with capacidad_max
    if (data.capacidad_max) data.capacidad = data.capacidad_max;
    const updated = update('habitaciones', req.params.id, data);
    ok(res, updated);
  } catch (e) { err(res, 'SERVER_ERROR', 'Error actualizando habitación', 500); }
});

// Delete room (soft-delete)
router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const existing = findById('habitaciones', req.params.id);
    if (!existing) return err(res, 'NOT_FOUND', 'Habitación no encontrada', 404);
    // Check if room has active reservations
    const db = getDb();
    const active = db.prepare(`SELECT COUNT(*) as c FROM reservas_hotel WHERE habitacion_id = ? AND estado NOT IN ('Cancelada', 'No-Show', 'Check-Out')`).get(req.params.id);
    if (active.c > 0) return err(res, 'HAS_RESERVATIONS', `No se puede eliminar: tiene ${active.c} reservas activas`);
    update('habitaciones', req.params.id, { activa: 0 });
    ok(res, { deleted: true });
  } catch (e) { err(res, 'SERVER_ERROR', 'Error eliminando habitación', 500); }
});

// Update limpieza
router.patch('/:id/limpieza', requireAuth, (req, res) => {
  try {
    const { estado_limpieza } = req.body;
    const valid = ['Sucia', 'Limpia', 'Inspeccionada'];
    if (!valid.includes(estado_limpieza)) return err(res, 'VALIDATION_ERROR', `Estados válidos: ${valid.join(', ')}`);
    const updated = update('habitaciones', req.params.id, { estado_limpieza });
    ok(res, updated);
  } catch (e) { err(res, 'SERVER_ERROR', 'Error actualizando limpieza', 500); }
});

// Bulk update limpieza
router.patch('/masiva', requireAuth, (req, res) => {
  try {
    const { ids, estado_limpieza } = req.body;
    const valid = ['Sucia', 'Limpia', 'Inspeccionada'];
    if (!Array.isArray(ids) || ids.length === 0) return err(res, 'VALIDATION_ERROR', 'ids requeridos');
    if (!valid.includes(estado_limpieza)) return err(res, 'VALIDATION_ERROR', `Estados válidos: ${valid.join(', ')}`);
    const db = getDb();
    const stmt = db.prepare('UPDATE habitaciones SET estado_limpieza = ? WHERE id = ?');
    const txn = db.transaction(() => { for (const id of ids) stmt.run(estado_limpieza, id); });
    txn();
    ok(res, { updated: ids.length, estado_limpieza });
  } catch (e) { err(res, 'SERVER_ERROR', 'Error en actualización masiva', 500); }
});

// Room patch (other fields)
router.patch('/:id', requireAuth, (req, res) => {
  try {
    const data = {};
    const allowed = ['estado_limpieza', 'estado_habitacion', 'asignado_a', 'no_molestar', 'comentarios'];
    for (const f of allowed) { if (req.body[f] !== undefined) data[f] = req.body[f]; }
    const updated = update('habitaciones', req.params.id, data);
    ok(res, updated);
  } catch (e) { err(res, 'SERVER_ERROR', 'Error actualizando habitación', 500); }
});

// Upload photo for room type
router.post('/tipo/:tipo/foto', requireAuth, requireRole('admin'), upload.single('foto'), validateUploadSignature, (req, res) => {
  try {
    if (!req.file) return err(res, 'VALIDATION_ERROR', 'Archivo de imagen requerido');
    const tipo = req.params.tipo;
    const imageUrl = `/uploads/${req.file.filename}`;
    const db = getDb();
    const key = `foto_tipo_${tipo}`;
    const existing = db.prepare("SELECT clave FROM config_hotel WHERE clave = ?").get(key);
    if (existing) { db.prepare("UPDATE config_hotel SET valor = ? WHERE clave = ?").run(imageUrl, key); }
    else { db.prepare("INSERT INTO config_hotel (clave, valor, descripcion) VALUES (?, ?, ?)").run(key, imageUrl, `Foto tipo ${tipo}`); }
    ok(res, { tipo, imagen: imageUrl });
  } catch (e) { console.error(e); err(res, 'SERVER_ERROR', 'Error subiendo foto', 500); }
});

// Get all room type photos
router.get('/tipo-fotos', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT clave, valor FROM config_hotel WHERE clave LIKE 'foto_tipo_%'").all();
    const fotos = {};
    for (const r of rows) { fotos[r.clave.replace('foto_tipo_', '')] = r.valor; }
    ok(res, fotos);
  } catch (e) { err(res, 'SERVER_ERROR', 'Error obteniendo fotos', 500); }
});

module.exports = router;
