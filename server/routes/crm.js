const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { requireAuth } = require('../auth');

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function err(res, message, status = 400) {
  return res.status(status).json({ success: false, error: message });
}

// ── GET /api/v1/crm/servicios ──
router.get('/servicios', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const { include_inactive } = req.query || {};
    let query = 'SELECT * FROM servicios_adicionales';
    if (include_inactive !== 'true') {
      query += ' WHERE activo = 1';
    }
    query += ' ORDER BY nombre ASC';
    const services = db.prepare(query).all();
    return ok(res, services);
  } catch (e) {
    console.error('CRM Services error:', e);
    return err(res, 'Error al obtener servicios', 500);
  }
});

// ── POST /api/v1/crm/servicios ──
router.post('/servicios', requireAuth, (req, res) => {
  try {
    const { nombre, descripcion, precio_base, tipo_precio, activo } = req.body;
    if (!nombre || precio_base === undefined) return err(res, 'Nombre y precio base requeridos');
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO servicios_adicionales (nombre, descripcion, precio_base, tipo_precio, activo)
      VALUES (?, ?, ?, ?, ?)
    `).run(nombre, descripcion || '', precio_base, tipo_precio || 'global', activo !== undefined ? (activo ? 1 : 0) : 1);
    
    const newService = db.prepare('SELECT * FROM servicios_adicionales WHERE id = ?').get(result.lastInsertRowid);
    return ok(res, newService, 201);
  } catch (e) {
    console.error('CRM Service create error:', e);
    if (e.message.includes('UNIQUE constraint failed')) {
      return err(res, 'Ya existe un servicio con ese nombre');
    }
    return err(res, 'Error al crear servicio', 500);
  }
});

// ── PUT /api/v1/crm/servicios/:id ──
router.put('/servicios/:id', requireAuth, (req, res) => {
  try {
    const { nombre, descripcion, precio_base, tipo_precio, activo } = req.body;
    if (!nombre || precio_base === undefined) return err(res, 'Nombre y precio base requeridos');
    const db = getDb();
    const result = db.prepare(`
      UPDATE servicios_adicionales
      SET nombre = ?, descripcion = ?, precio_base = ?, tipo_precio = ?, activo = ?
      WHERE id = ?
    `).run(nombre, descripcion || '', precio_base, tipo_precio || 'global', activo ? 1 : 0, req.params.id);
    
    if (result.changes === 0) return err(res, 'Servicio no encontrado', 404);
    const updated = db.prepare('SELECT * FROM servicios_adicionales WHERE id = ?').get(req.params.id);
    return ok(res, updated);
  } catch (e) {
    console.error('CRM Service update error:', e);
    return err(res, 'Error al actualizar servicio', 500);
  }
});

// ── DELETE /api/v1/crm/servicios/:id ──
router.delete('/servicios/:id', requireAuth, (req, res) => {
  try {
    const db = getDb();
    // Soft delete / deactivate service so historical quotes don't break
    const result = db.prepare(`
      UPDATE servicios_adicionales
      SET activo = 0
      WHERE id = ?
    `).run(req.params.id);
    
    if (result.changes === 0) return err(res, 'Servicio no encontrado', 404);
    return ok(res, { message: 'Servicio desactivado con éxito' });
  } catch (e) {
    console.error('CRM Service delete error:', e);
    return err(res, 'Error al desactivar servicio', 500);
  }
});


// ── GET /api/v1/crm/leads ──
router.get('/leads', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const leads = db.prepare(`
      SELECT l.*, 
             COUNT(c.id) as total_cotizaciones,
             MAX(c.created_at) as ultima_cotizacion_fecha,
             COALESCE((SELECT check_in FROM cotizaciones_custom WHERE lead_id = l.id ORDER BY id DESC LIMIT 1), '') as fecha_evento,
             COALESCE((SELECT monto_total FROM cotizaciones_custom WHERE lead_id = l.id ORDER BY id DESC LIMIT 1), 0) as valor_total
      FROM leads_clientes l
      LEFT JOIN cotizaciones_custom c ON c.lead_id = l.id
      GROUP BY l.id
      ORDER BY l.updated_at DESC
    `).all();
    return ok(res, leads);
  } catch (e) {
    console.error('CRM Leads list error:', e);
    return err(res, 'Error al listar prospectos', 500);
  }
});

// ── GET /api/v1/crm/leads/:id ──
router.get('/leads/:id', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const lead = db.prepare('SELECT * FROM leads_clientes WHERE id = ?').get(req.params.id);
    if (!lead) return err(res, 'Prospecto no encontrado', 404);
    
    const quotes = db.prepare('SELECT * FROM cotizaciones_custom WHERE lead_id = ? ORDER BY created_at DESC').all(req.params.id);
    
    // Parse JSON fields in quotes
    const quotesParsed = quotes.map(q => {
      try {
        q.habitaciones_seleccionadas = JSON.parse(q.habitaciones_seleccionadas || '[]');
        q.items_adicionales = JSON.parse(q.items_adicionales || '[]');
      } catch (ex) {
        q.habitaciones_seleccionadas = [];
        q.items_adicionales = [];
      }
      return q;
    });

    return ok(res, { lead, cotizaciones: quotesParsed });
  } catch (e) {
    console.error('CRM Lead details error:', e);
    return err(res, 'Error al obtener detalles del prospecto', 500);
  }
});

// ── POST /api/v1/crm/leads ──
router.post('/leads', requireAuth, (req, res) => {
  try {
    const { nombre, apellido, email, telefono, notas, estado, fecha_seguimiento, oferta_mejora } = req.body;
    if (!nombre) return err(res, 'El nombre es obligatorio');
    
    const db = getDb();
    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO leads_clientes (nombre, apellido, email, telefono, notas, estado, fecha_seguimiento, oferta_mejora, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nombre,
      apellido || '',
      email || '',
      telefono || '',
      notas || '',
      estado || 'Borrador',
      fecha_seguimiento || '',
      oferta_mejora ? 1 : 0,
      now,
      now
    );
    
    const newLead = db.prepare('SELECT * FROM leads_clientes WHERE id = ?').get(result.lastInsertRowid);
    return ok(res, newLead, 201);
  } catch (e) {
    console.error('CRM Lead create error:', e);
    return err(res, 'Error al crear prospecto', 500);
  }
});

// ── PUT /api/v1/crm/leads/:id ──
router.put('/leads/:id', requireAuth, (req, res) => {
  try {
    const { nombre, apellido, email, telefono, notas, estado, atendido, fecha_seguimiento, oferta_mejora } = req.body;
    if (!nombre) return err(res, 'El nombre es obligatorio');
    
    const db = getDb();
    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE leads_clientes
      SET nombre = ?, apellido = ?, email = ?, telefono = ?, notas = ?, estado = ?, atendido = ?, fecha_seguimiento = ?, oferta_mejora = ?, updated_at = ?
      WHERE id = ?
    `).run(
      nombre,
      apellido || '',
      email || '',
      telefono || '',
      notas || '',
      estado || 'Borrador',
      atendido !== undefined ? (atendido ? 1 : 0) : 0,
      fecha_seguimiento || '',
      oferta_mejora ? 1 : 0,
      now,
      req.params.id
    );

    if (result.changes === 0) return err(res, 'Prospecto no encontrado', 404);
    const updatedLead = db.prepare('SELECT * FROM leads_clientes WHERE id = ?').get(req.params.id);
    return ok(res, updatedLead);
  } catch (e) {
    console.error('CRM Lead update error:', e);
    return err(res, 'Error al actualizar prospecto', 500);
  }
});

// ── DELETE /api/v1/crm/leads/:id ──
router.delete('/leads/:id', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM leads_clientes WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return err(res, 'Prospecto no encontrado', 404);
    return ok(res, { message: 'Prospecto eliminado con éxito' });
  } catch (e) {
    console.error('CRM Lead delete error:', e);
    return err(res, 'Error al eliminar prospecto', 500);
  }
});

// ── PATCH /api/v1/crm/leads/:id/status ──
router.patch('/leads/:id/status', requireAuth, (req, res) => {
  try {
    const { estado } = req.body;
    const validStatuses = ['Borrador', 'Enviada', 'En Negociación', 'Aceptada', 'Rechazada'];
    if (!estado || !validStatuses.includes(estado)) {
      return err(res, 'Estado inválido');
    }
    
    const db = getDb();
    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE leads_clientes 
      SET estado = ?, updated_at = ?
      WHERE id = ?
    `).run(estado, now, req.params.id);
    
    if (result.changes === 0) return err(res, 'Prospecto no encontrado', 404);
    
    const updatedLead = db.prepare('SELECT * FROM leads_clientes WHERE id = ?').get(req.params.id);
    return ok(res, updatedLead);
  } catch (e) {
    console.error('CRM Lead status update error:', e);
    return err(res, 'Error al actualizar estado del prospecto', 500);
  }
});

// ── POST /api/v1/crm/leads/:id/cotizaciones ──
router.post('/leads/:id/cotizaciones', requireAuth, (req, res) => {
  try {
    const leadId = req.params.id;
    const db = getDb();
    
    const leadExists = db.prepare('SELECT 1 FROM leads_clientes WHERE id = ?').get(leadId);
    if (!leadExists) return err(res, 'Prospecto no encontrado', 404);
    
    const {
      check_in,
      check_out,
      noches,
      adultos,
      menores,
      mascotas,
      plan_codigo,
      habitaciones_seleccionadas,
      items_adicionales,
      subtotal,
      descuento,
      descuento_tipo,
      impuesto_pct,
      impuesto_monto,
      monto_total,
      deposito_sugerido,
      notas
    } = req.body;

    const now = new Date().toISOString();
    
    const result = db.prepare(`
      INSERT INTO cotizaciones_custom (
        lead_id, check_in, check_out, noches, adultos, menores, mascotas, plan_codigo,
        habitaciones_seleccionadas, items_adicionales, subtotal, descuento, descuento_tipo,
        impuesto_pct, impuesto_monto, monto_total, deposito_sugerido, notas, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      leadId,
      check_in || '',
      check_out || '',
      noches || 1,
      adultos || 1,
      menores || 0,
      mascotas || 0,
      plan_codigo || '',
      JSON.stringify(habitaciones_seleccionadas || []),
      JSON.stringify(items_adicionales || []),
      subtotal || 0,
      descuento || 0,
      descuento_tipo || 'fijo',
      impuesto_pct || 10,
      impuesto_monto || 0,
      monto_total || 0,
      deposito_sugerido || 0,
      notas || '',
      now
    );

    // Update the updated_at timestamp on the lead
    db.prepare('UPDATE leads_clientes SET updated_at = ? WHERE id = ?').run(now, leadId);

    const newQuote = db.prepare('SELECT * FROM cotizaciones_custom WHERE id = ?').get(result.lastInsertRowid);
    newQuote.habitaciones_seleccionadas = JSON.parse(newQuote.habitaciones_seleccionadas || '[]');
    newQuote.items_adicionales = JSON.parse(newQuote.items_adicionales || '[]');
    
    return ok(res, newQuote, 201);
  } catch (e) {
    console.error('CRM Quote create error:', e);
    return err(res, 'Error al crear cotización', 500);
  }
});

module.exports = router;
