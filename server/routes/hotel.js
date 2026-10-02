const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { getDb, findById, create, update } = require('../db/database');
const { requireAuth, requireRole, requireOperations, requireHousekeeping } = require('../auth');
const { housekeepingRoom } = require('../housekeeping');
const { calcNoches, calcReservation, calcReservationWithRates, getConfig } = require('../utils/calculations');
const { fireWebhooks } = require('../utils/webhooks');
const { upload, validateUploadSignature, UPLOADS_DIR } = require('../utils/upload');
const notifications = require('../notifications');

// ── Helpers ──
function ok(res, data, meta, status = 200) {
  const response = { success: true, data };
  if (meta) response.meta = meta;
  return res.status(status).json(response);
}

function err(res, code, message, status = 400) {
  return res.status(status).json({ success: false, error: { code, message } });
}

function safeJSON(str) {
  if (!str) return [];
  try { return JSON.parse(str); } catch { return []; }
}

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '');
}

// ══════════════════════════════════════
// PLANES DE TARIFA
// ══════════════════════════════════════

router.get('/hotel/planes', requireAuth, requireOperations, (req, res) => {
  try {
    const db = getDb();
    const showAll = req.query.all === '1'; // include inactive
    const plans = db.prepare(`SELECT * FROM planes_tarifa ${showAll ? '' : 'WHERE activo = 1'} ORDER BY categoria, precio_adulto_noche ASC`).all();
    // Parse JSON fields
    const parsed = plans.map(p => ({
      ...p,
      incluye: safeJSON(p.incluye),
      extras_disponibles: safeJSON(p.extras_disponibles),
      tipos_aplicables: safeJSON(p.tipos_aplicables),
    }));
    ok(res, parsed);
  } catch (e) { console.error(e); err(res, 'SERVER_ERROR', 'Error listando planes', 500); }
});

router.get('/hotel/productos/:id', requireAuth, requireOperations, (req, res) => {
  try {
    const p = findById('planes_tarifa', req.params.id);
    if (!p) return err(res, 'NOT_FOUND', 'Producto no encontrado', 404);
    ok(res, { ...p, incluye: safeJSON(p.incluye), extras_disponibles: safeJSON(p.extras_disponibles), tipos_aplicables: safeJSON(p.tipos_aplicables) });
  } catch (e) { err(res, 'SERVER_ERROR', 'Error obteniendo producto', 500); }
});

router.post('/hotel/planes', requireAuth, requireOperations, requireRole('admin'), (req, res) => {
  try {
    const { codigo, nombre, precio_adulto_noche } = req.body;
    if (!codigo || !nombre || precio_adulto_noche === undefined) return err(res, 'VALIDATION_ERROR', 'codigo, nombre y precio_adulto_noche requeridos');
    const db = getDb();
    // Check unique codigo
    const existing = db.prepare('SELECT id FROM planes_tarifa WHERE codigo = ?').get(sanitize(codigo));
    if (existing) return err(res, 'DUPLICATE', 'Ya existe un producto con ese código');
    const plan = create('planes_tarifa', {
      codigo: sanitize(codigo), nombre: sanitize(nombre),
      descripcion: sanitize(req.body.descripcion || ''),
      categoria: req.body.categoria || 'Estadía',
      precio_adulto_noche, precio_menor_noche: req.body.precio_menor_noche || 0,
      precio_mascota_noche: req.body.precio_mascota_noche || 0,
      incluye: req.body.incluye ? JSON.stringify(req.body.incluye) : null,
      horario: req.body.horario || null,
      extras_disponibles: req.body.extras_disponibles ? JSON.stringify(req.body.extras_disponibles) : null,
      tipos_aplicables: req.body.tipos_aplicables ? JSON.stringify(req.body.tipos_aplicables) : null,
      imagen: req.body.imagen || null,
      lleva_impuesto: req.body.lleva_impuesto !== undefined ? parseInt(req.body.lleva_impuesto) : 1,
      impuesto_pct: req.body.impuesto_pct !== undefined ? parseFloat(req.body.impuesto_pct) : Number(getConfig('impuesto_turismo_pct') ?? 0),
    });
    ok(res, plan, null, 201);
  } catch (e) { console.error(e); err(res, 'SERVER_ERROR', 'Error creando producto', 500); }
});

router.put('/hotel/planes/:id', requireAuth, requireOperations, requireRole('admin'), (req, res) => {
  try {
    const existing = findById('planes_tarifa', req.params.id);
    if (!existing) return err(res, 'NOT_FOUND', 'Producto no encontrado', 404);
    const data = {};
    const allowed = ['nombre', 'descripcion', 'categoria', 'precio_adulto_noche', 'precio_menor_noche', 'precio_mascota_noche', 'horario', 'imagen', 'activo', 'visible_web', 'lleva_impuesto', 'impuesto_pct'];
    for (const f of allowed) { if (req.body[f] !== undefined) data[f] = req.body[f]; }
    // JSON array fields
    if (req.body.incluye !== undefined) data.incluye = JSON.stringify(req.body.incluye);
    if (req.body.extras_disponibles !== undefined) data.extras_disponibles = JSON.stringify(req.body.extras_disponibles);
    if (req.body.tipos_aplicables !== undefined) data.tipos_aplicables = JSON.stringify(req.body.tipos_aplicables);
    data.updated_at = new Date().toISOString();
    const updated = update('planes_tarifa', req.params.id, data);

    // Auto-sync entre_semana rate rule when base price changes
    if (req.body.precio_adulto_noche !== undefined || req.body.precio_menor_noche !== undefined || req.body.precio_mascota_noche !== undefined) {
      const db = getDb();
      const newAdulto = parseFloat(req.body.precio_adulto_noche ?? existing.precio_adulto_noche);
      const newMenor = parseFloat(req.body.precio_menor_noche ?? existing.precio_menor_noche);
      const newMascota = parseFloat(req.body.precio_mascota_noche ?? existing.precio_mascota_noche);
      const existingRule = db.prepare("SELECT id FROM reglas_tarifa WHERE plan_id = ? AND tipo_dia = 'entre_semana'").get(req.params.id);
      if (existingRule) {
        db.prepare("UPDATE reglas_tarifa SET precio_adulto = ?, precio_menor = ?, precio_mascota = ? WHERE id = ?")
          .run(newAdulto, newMenor, newMascota, existingRule.id);
      } else {
        db.prepare("INSERT INTO reglas_tarifa (plan_id, tipo_dia, precio_adulto, precio_menor, precio_mascota) VALUES (?, 'entre_semana', ?, ?, ?)")
          .run(req.params.id, newAdulto, newMenor, newMascota);
      }
    }

    ok(res, updated);
  } catch (e) { console.error(e); err(res, 'SERVER_ERROR', 'Error actualizando producto', 500); }
});

router.delete('/hotel/planes/:id', requireAuth, requireOperations, requireRole('admin'), (req, res) => {
  try {
    const existing = findById('planes_tarifa', req.params.id);
    if (!existing) return err(res, 'NOT_FOUND', 'Producto no encontrado', 404);
    update('planes_tarifa', req.params.id, { activo: 0, updated_at: new Date().toISOString() });
    ok(res, { message: 'Producto desactivado' });
  } catch (e) { err(res, 'SERVER_ERROR', 'Error eliminando producto', 500); }
});

// Upload product photo
router.post('/hotel/planes/:id/foto', requireAuth, requireOperations, requireRole('admin'), upload.single('foto'), (req, res) => {
  try {
    if (!req.file) return err(res, 'VALIDATION_ERROR', 'Archivo de imagen requerido');
    const existing = findById('planes_tarifa', req.params.id);
    if (!existing) return err(res, 'NOT_FOUND', 'Producto no encontrado', 404);
    const imageUrl = `/uploads/${req.file.filename}`;
    update('planes_tarifa', req.params.id, { imagen: imageUrl, updated_at: new Date().toISOString() });
    ok(res, { imagen: imageUrl, filename: req.file.filename });
  } catch (e) { console.error(e); err(res, 'SERVER_ERROR', 'Error subiendo foto', 500); }
});

// Cotizar — preview pricing with day-based rates
router.get('/hotel/cotizar', requireAuth, requireOperations, (req, res) => {
  try {
    const { plan, adultos = 1, menores = 0, mascotas = 0, check_in, check_out } = req.query;
    if (!plan || !check_in || !check_out) return err(res, 'VALIDATION_ERROR', 'plan, check_in, check_out requeridos');
    const db = getDb();
    const planData = db.prepare('SELECT * FROM planes_tarifa WHERE codigo = ? AND activo = 1').get(plan);
    if (!planData) return err(res, 'NOT_FOUND', 'Plan no encontrado', 404);
    const noches = calcNoches(check_in, check_out);
    const totals = calcReservationWithRates(planData.id, check_in, check_out, +adultos, +menores, +mascotas);
    ok(res, {
      plan: { ...planData, incluye: safeJSON(planData.incluye), extras_disponibles: safeJSON(planData.extras_disponibles) },
      noches, adultos: +adultos, menores: +menores, mascotas: +mascotas,
      ...totals
    });
  } catch (e) { console.error(e); err(res, 'SERVER_ERROR', 'Error cotizando', 500); }
});

// ══════════════════════════════════════
// REGLAS DE TARIFA
// ══════════════════════════════════════

router.get('/hotel/planes/:id/reglas', requireAuth, requireOperations, (req, res) => {
  try {
    const db = getDb();
    const reglas = db.prepare("SELECT * FROM reglas_tarifa WHERE plan_id = ? ORDER BY CASE tipo_dia WHEN 'entre_semana' THEN 1 WHEN 'fin_de_semana' THEN 2 WHEN 'festivo' THEN 3 END").all(req.params.id);
    ok(res, reglas);
  } catch (e) { console.error('Reglas error:', e); err(res, 'SERVER_ERROR', 'Error listando reglas', 500); }
});

router.put('/hotel/planes/:id/reglas', requireAuth, requireOperations, requireRole('admin'), (req, res) => {
  try {
    const planId = req.params.id;
    const existing = findById('planes_tarifa', planId);
    if (!existing) return err(res, 'NOT_FOUND', 'Plan no encontrado', 404);
    const db = getDb();
    const { reglas } = req.body; // [{tipo_dia, precio_adulto, precio_menor, precio_mascota}]
    if (!Array.isArray(reglas)) return err(res, 'VALIDATION_ERROR', 'reglas debe ser un array');
    const del = db.prepare('DELETE FROM reglas_tarifa WHERE plan_id = ?');
    const ins = db.prepare('INSERT INTO reglas_tarifa (plan_id, tipo_dia, precio_adulto, precio_menor, precio_mascota) VALUES (?, ?, ?, ?, ?)');
    const txn = db.transaction(() => {
      del.run(planId);
      for (const r of reglas) {
        if (r.tipo_dia && r.precio_adulto !== undefined) {
          ins.run(planId, r.tipo_dia, r.precio_adulto, r.precio_menor || 0, r.precio_mascota || 0);
        }
      }
    });
    txn();
    const updated = db.prepare('SELECT * FROM reglas_tarifa WHERE plan_id = ? ORDER BY tipo_dia').all(planId);
    ok(res, updated);
  } catch (e) { console.error(e); err(res, 'SERVER_ERROR', 'Error actualizando reglas', 500); }
});

// ══════════════════════════════════════
// DÍAS FESTIVOS
// ══════════════════════════════════════

router.get('/hotel/festivos', requireAuth, requireOperations, (req, res) => {
  try {
    const db = getDb();
    ok(res, db.prepare('SELECT * FROM dias_festivos ORDER BY fecha').all());
  } catch (e) { err(res, 'SERVER_ERROR', 'Error listando festivos', 500); }
});

router.post('/hotel/festivos', requireAuth, requireOperations, requireRole('admin'), (req, res) => {
  try {
    const { fecha, nombre } = req.body;
    if (!fecha || !nombre) return err(res, 'VALIDATION_ERROR', 'fecha y nombre requeridos');
    const db = getDb();
    const existing = db.prepare('SELECT id FROM dias_festivos WHERE fecha = ?').get(fecha);
    if (existing) return err(res, 'DUPLICATE', 'Ya existe un festivo para esa fecha');
    db.prepare('INSERT INTO dias_festivos (fecha, nombre) VALUES (?, ?)').run(fecha, sanitize(nombre));
    ok(res, { fecha, nombre }, null, 201);
  } catch (e) { err(res, 'SERVER_ERROR', 'Error creando festivo', 500); }
});

router.delete('/hotel/festivos/:id', requireAuth, requireOperations, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM dias_festivos WHERE id = ?').run(req.params.id);
    ok(res, { message: 'Festivo eliminado' });
  } catch (e) { err(res, 'SERVER_ERROR', 'Error eliminando festivo', 500); }
});

// ══════════════════════════════════════
// DISPONIBILIDAD
// ══════════════════════════════════════

router.get('/hotel/disponibilidad', requireAuth, requireOperations, (req, res) => {
  try {
    const { check_in, check_out } = req.query;
    if (!check_in || !check_out) return err(res, 'VALIDATION_ERROR', 'check_in y check_out requeridos');
    const db = getDb();
    // Find rooms with conflicting reservations
    const occupied = db.prepare(`
      SELECT DISTINCT habitacion_id FROM reservas_hotel
      WHERE estado NOT IN ('Cancelada', 'No-Show', 'Check-Out')
        AND check_in < ? AND check_out > ?
    `).all(check_out, check_in).map(r => r.habitacion_id);

    const allRooms = db.prepare('SELECT * FROM habitaciones WHERE activa = 1 ORDER BY id').all();
    const available = allRooms.map(room => ({
      ...room,
      disponible: !occupied.includes(room.id)
    }));
    ok(res, available);
  } catch (e) { err(res, 'SERVER_ERROR', 'Error verificando disponibilidad', 500); }
});

// Calendar grid data
router.get('/hotel/calendario', requireAuth, requireHousekeeping, (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) return err(res, 'VALIDATION_ERROR', 'desde y hasta requeridos');
    const db = getDb();
    const rooms = db.prepare('SELECT * FROM habitaciones WHERE activa = 1 ORDER BY categoria, tipo, id').all();
    const reservations = db.prepare(`
      SELECT r.*, h.nombre as habitacion_nombre, h.tipo as habitacion_tipo
      FROM reservas_hotel r
      LEFT JOIN habitaciones h ON r.habitacion_id = h.id
      WHERE r.estado NOT IN ('Cancelada', 'No-Show')
        AND r.check_in < ? AND r.check_out ${req.user?.rol === 'cleaning' ? '>=' : '>'} ?
      ORDER BY r.check_in
    `).all(hasta, desde);
    if (req.user?.rol === 'cleaning') {
      return ok(res, {
        housekeeping: true,
        habitaciones: rooms.map(housekeepingRoom),
        // Deliberate allowlist: no guest names, contact info, notes, documents,
        // group identifiers, headcounts or financial fields in this view.
        reservas: reservations.map(({ id, habitacion_id, check_in, check_out, estado, habitacion_nombre, habitacion_tipo }) => ({
          id, habitacion_id, check_in, check_out, estado, habitacion_nombre, habitacion_tipo,
        })),
      });
    }
    ok(res, { habitaciones: rooms, reservas: reservations });
  } catch (e) { err(res, 'SERVER_ERROR', 'Error cargando calendario', 500); }
});

// ══════════════════════════════════════
// RESERVAS DE HOTEL
// ══════════════════════════════════════

router.get('/hotel/reservas', requireAuth, requireOperations, (req, res) => {
  try {
    const { estado, tipo_habitacion, cliente, check_in_desde, check_in_hasta, grupo_codigo, page = 1, limit = 50 } = req.query;
    const db = getDb();
    
    // Manual pagination and filtering to match what server.js did
    const conditions = [];
    const params = [];
    if (estado) { conditions.push('estado = ?'); params.push(estado); }
    if (tipo_habitacion) { conditions.push('tipo_habitacion = ?'); params.push(tipo_habitacion); }
    if (cliente) { conditions.push('(cliente LIKE ? OR apellido LIKE ?)'); params.push(`%${cliente}%`, `%${cliente}%`); }
    if (check_in_desde) { conditions.push('check_in >= ?'); params.push(check_in_desde); }
    if (check_in_hasta) { conditions.push('check_in <= ?'); params.push(check_in_hasta); }
    if (grupo_codigo) { conditions.push('grupo_codigo = ?'); params.push(grupo_codigo); }
    
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (Number(page) - 1) * Number(limit);
    
    const total = db.prepare(`SELECT COUNT(*) as c FROM reservas_hotel ${where}`).get(...params).c;
    const reservations = db.prepare(`SELECT * FROM reservas_hotel ${where} ORDER BY check_in DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), offset);
    
    // Attach room name + categoria
    const withRooms = reservations.map(r => {
      if (r.habitacion_id) {
        const room = db.prepare('SELECT nombre, tipo, categoria FROM habitaciones WHERE id = ?').get(r.habitacion_id);
        if (room) {
          r.habitacion_nombre = room.nombre;
          r.categoria_habitacion = room.categoria;
          r.tipo_hab = room.tipo;
        }
      }
      return r;
    });
    
    ok(res, withRooms, { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) });
  } catch (e) { console.error(e); err(res, 'SERVER_ERROR', 'Error listando reservas', 500); }
});

router.get('/hotel/reservas/:id', requireAuth, requireOperations, (req, res) => {
  try {
    const reserva = findById('reservas_hotel', req.params.id);
    if (!reserva) return err(res, 'NOT_FOUND', 'Reserva no encontrada', 404);
    const db = getDb();
    // Attach room info
    if (reserva.habitacion_id) {
      const room = findById('habitaciones', reserva.habitacion_id);
      reserva.habitacion = room;
    }
    // Attach folio
    reserva.folio = db.prepare('SELECT * FROM folio_hotel WHERE reserva_id = ? ORDER BY id ASC').all(req.params.id);
    // Attach additional guests
    reserva.huespedes_adicionales = db.prepare('SELECT * FROM huespedes_reserva WHERE reserva_id = ?').all(req.params.id);
    // Attach documents
    reserva.documentos = db.prepare('SELECT * FROM documentos_reserva WHERE reserva_id = ? ORDER BY created_at DESC').all(req.params.id);
    ok(res, reserva);
  } catch (e) { err(res, 'SERVER_ERROR', 'Error obteniendo reserva', 500); }
});

router.post('/hotel/reservas/grupo', requireAuth, requireOperations, (req, res) => {
  try {
    const { reservas, facturacion_consolidada = 1 } = req.body;
    if (!Array.isArray(reservas) || reservas.length === 0) {
      return err(res, 'VALIDATION_ERROR', 'Se requiere un array de reservas no vacío');
    }

    // Verify adultos >= 1 for all rooms before entering transaction
    for (const [index, r] of reservas.entries()) {
      const adultosVal = parseInt(r.adultos);
      if (isNaN(adultosVal) || adultosVal < 1) {
        return err(res, 'VALIDATION_ERROR', `Cada habitación debe tener al menos 1 adulto. Conflicto en la habitación en el índice ${index}.`);
      }
    }

    const db = getDb();
    const factConsolidadaVal = (facturacion_consolidada === 0 || facturacion_consolidada === false) ? 0 : 1;

    // Generate unique group code
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}${mm}${dd}`;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let grupo_codigo = '';
    let isUnique = false;
    while (!isUnique) {
      let rand = '';
      for (let i = 0; i < 4; i++) {
        rand += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      grupo_codigo = `GRP-${dateStr}-${rand}`;
      const exists = db.prepare('SELECT id FROM reservas_hotel WHERE grupo_codigo = ?').get(grupo_codigo);
      if (!exists) isUnique = true;
    }

    // Single SQLite Transaction block
    let createdReservations = [];
    const txn = db.transaction(() => {
      // 1. First, check availability and capacity for ALL rooms in the group.
      for (const [index, r] of reservas.entries()) {
        const { check_in, check_out, habitacion_id, cliente } = r;
        if (!cliente || !check_in || !check_out || !habitacion_id) {
          throw new Error(`Campos requeridos faltantes para la habitación en índice ${index}`);
        }
        if (check_out <= check_in) {
          throw new Error(`Check-out debe ser posterior al check-in para ${cliente}`);
        }

        // Overlap Check in DB
        const conflict = db.prepare(`
          SELECT id, cliente, check_in, check_out FROM reservas_hotel
          WHERE habitacion_id = ? AND estado NOT IN ('Cancelada', 'No-Show', 'Check-Out')
            AND check_in < ? AND check_out > ?
        `).get(habitacion_id, check_out, check_in);

        if (conflict) {
          throw new Error(`Habitación ocupada del ${conflict.check_in} al ${conflict.check_out} por ${conflict.cliente}`);
        }

        // In-memory Overlap check within the payload
        for (const [otherIndex, otherR] of reservas.entries()) {
          if (index !== otherIndex && otherR.habitacion_id === habitacion_id) {
            if (check_in < otherR.check_out && check_out > otherR.check_in) {
              throw new Error(`Conflicto interno: La habitación ID ${habitacion_id} está duplicada en fechas coincidentes dentro del mismo grupo.`);
            }
          }
        }
      }

      // 2. Process and insert each reservation
      let masterId = null;
      let masterReserva = null;
      const childDataList = [];

      for (const [index, r] of reservas.entries()) {
        const {
          cliente, apellido = '', email = '', whatsapp = '', telefono = '', nacionalidad = '',
          habitacion_id, tipo_habitacion, check_in, check_out, hora_llegada = null,
          adultos = 1, menores = 0, mascotas = 0, plan_codigo = null, plan_nombre = '',
          precio_adulto_noche = 0, precio_menor_noche = 0, precio_mascota_noche = 0,
          fuente = 'Teléfono', notas = '', estado = 'Confirmada'
        } = r;

        const room = findById('habitaciones', habitacion_id);
        if (!room) throw new Error(`Habitación ID ${habitacion_id} no encontrada`);

        const noches = calcNoches(check_in, check_out);

        const data = {
          cliente: sanitize(cliente),
          apellido: sanitize(apellido),
          email: sanitize(email),
          whatsapp: sanitize(whatsapp),
          telefono: sanitize(telefono),
          nacionalidad: sanitize(nacionalidad),
          habitacion_id,
          tipo_habitacion: sanitize(tipo_habitacion || room.tipo),
          check_in,
          check_out,
          noches,
          hora_llegada,
          adultos: parseInt(adultos) || 1,
          menores: parseInt(menores) || 0,
          mascotas: parseInt(mascotas) || 0,
          plan_codigo,
          plan_nombre: sanitize(plan_nombre),
          precio_adulto_noche: parseFloat(precio_adulto_noche) || 0,
          precio_menor_noche: parseFloat(precio_menor_noche) || 0,
          precio_mascota_noche: parseFloat(precio_mascota_noche) || 0,
          estado,
          fuente: sanitize(fuente),
          notas: sanitize(notas),
          grupo_codigo,
          es_maestra: index === 0 ? 1 : 0,
          facturacion_consolidada: factConsolidadaVal,
          created_by: req.user.nombre || req.user.email
        };

        if (data.plan_codigo && (!data.precio_adulto_noche || data.precio_adulto_noche === 0)) {
          const plan = db.prepare('SELECT * FROM planes_tarifa WHERE codigo = ? AND activo = 1').get(data.plan_codigo);
          if (plan) {
            data.plan_nombre = plan.nombre;
            data.precio_adulto_noche = plan.precio_adulto_noche;
            data.precio_menor_noche = plan.precio_menor_noche;
            data.precio_mascota_noche = plan.precio_mascota_noche;
          }
        }

        let totals;
        if (data.plan_codigo) {
          const plan = db.prepare('SELECT * FROM planes_tarifa WHERE codigo = ? AND activo = 1').get(data.plan_codigo);
          if (plan) {
            totals = calcReservationWithRates(plan.id, check_in, check_out, data.adultos, data.menores, data.mascotas);
            data.plan_nombre = plan.nombre;
          } else {
            totals = calcReservation({ ...data, noches });
          }
        } else {
          totals = calcReservation({ ...data, noches });
        }

        data._realTotals = {
          subtotal: totals.subtotal,
          impuesto_pct: totals.impuesto_pct,
          impuesto_monto: totals.impuesto_monto,
          monto_total: totals.monto_total,
          deposito_sugerido: totals.deposito_sugerido
        };

        if (index === 0) {
          masterReserva = data;
        } else {
          childDataList.push(data);
        }
      }

      if (factConsolidadaVal === 1) {
        let aggregateSubtotal = masterReserva._realTotals.subtotal;
        let aggregateImpuestoMonto = masterReserva._realTotals.impuesto_monto;
        let aggregateMontoTotal = masterReserva._realTotals.monto_total;
        let aggregateDepositoSugerido = masterReserva._realTotals.deposito_sugerido;

        for (const child of childDataList) {
          aggregateSubtotal += child._realTotals.subtotal;
          aggregateImpuestoMonto += child._realTotals.impuesto_monto;
          aggregateMontoTotal += child._realTotals.monto_total;
          aggregateDepositoSugerido += child._realTotals.deposito_sugerido;
        }

        masterReserva.subtotal = Math.round(aggregateSubtotal * 100) / 100;
        masterReserva.impuesto_pct = masterReserva._realTotals.impuesto_pct;
        masterReserva.impuesto_monto = Math.round(aggregateImpuestoMonto * 100) / 100;
        masterReserva.monto_total = Math.round(aggregateMontoTotal * 100) / 100;
        masterReserva.deposito_sugerido = Math.round(aggregateDepositoSugerido * 100) / 100;
        masterReserva.monto_pagado = 0;
        masterReserva.saldo_pendiente = masterReserva.monto_total;

        const masterRealSub = masterReserva._realTotals.subtotal;
        const masterRealTax = masterReserva._realTotals.impuesto_monto;
        const masterRealTaxPct = masterReserva._realTotals.impuesto_pct;
        delete masterReserva._realTotals;

        const masterRes = create('reservas_hotel', masterReserva);
        masterId = masterRes.id;
        createdReservations.push(masterRes);

        if (masterRealSub > 0) {
          const room = findById('habitaciones', masterRes.habitacion_id);
          const roomName = room ? room.nombre : masterRes.habitacion_id;
          db.prepare('INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, registrado_por) VALUES (?, ?, ?, ?, ?)').run(
            masterId, 'debito', `Habitación: ${masterRes.plan_nombre || 'Tarifa base'} (${masterRes.noches} noches) - Habitación ${roomName} (Huésped: ${masterRes.cliente} ${masterRes.apellido})`, masterRealSub, req.user.nombre
          );
        }
        if (masterRealTax > 0) {
          const room = findById('habitaciones', masterRes.habitacion_id);
          const roomName = room ? room.nombre : masterRes.habitacion_id;
          db.prepare('INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, registrado_por) VALUES (?, ?, ?, ?, ?)').run(
            masterId, 'debito', `Impuesto Turismo ${masterRealTaxPct}% - Habitación ${roomName} (Huésped: ${masterRes.cliente} ${masterRes.apellido})`, masterRealTax, req.user.nombre
          );
        }

        for (const child of childDataList) {
          child.parent_reserva_id = masterId;
          child.subtotal = 0;
          child.impuesto_monto = 0;
          child.monto_total = 0;
          child.saldo_pendiente = 0;
          child.deposito_sugerido = 0;
          child.productos_adicionales = 0;
          child.monto_pagado = 0;

          const childRealSubtotal = child._realTotals.subtotal;
          const childRealTaxMonto = child._realTotals.impuesto_monto;
          const childRealTaxPct = child._realTotals.impuesto_pct;
          delete child._realTotals;

          const childRes = create('reservas_hotel', child);
          createdReservations.push(childRes);

          const childRoom = findById('habitaciones', childRes.habitacion_id);
          const childRoomName = childRoom ? childRoom.nombre : childRes.habitacion_id;
          const childGuestName = `${childRes.cliente} ${childRes.apellido || ''}`.trim();

          if (childRealSubtotal > 0) {
            db.prepare('INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, registrado_por) VALUES (?, ?, ?, ?, ?)').run(
              masterId,
              'debito',
              `Habitación: ${childRes.plan_nombre || 'Tarifa base'} (${childRes.noches} noches) - Habitación ${childRoomName} (Huésped: ${childGuestName})`,
              childRealSubtotal,
              req.user.nombre
            );
          }
          if (childRealTaxMonto > 0) {
            db.prepare('INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, registrado_por) VALUES (?, ?, ?, ?, ?)').run(
              masterId,
              'debito',
              `Impuesto Turismo ${childRealTaxPct}% - Habitación ${childRoomName} (Huésped: ${childGuestName})`,
              childRealTaxMonto,
              req.user.nombre
            );
          }
        }
      } else {
        masterReserva.subtotal = masterReserva._realTotals.subtotal;
        masterReserva.impuesto_pct = masterReserva._realTotals.impuesto_pct;
        masterReserva.impuesto_monto = masterReserva._realTotals.impuesto_monto;
        masterReserva.monto_total = masterReserva._realTotals.monto_total;
        masterReserva.deposito_sugerido = masterReserva._realTotals.deposito_sugerido;
        masterReserva.monto_pagado = 0;
        masterReserva.saldo_pendiente = masterReserva.monto_total;

        delete masterReserva._realTotals;

        const masterRes = create('reservas_hotel', masterReserva);
        masterId = masterRes.id;
        createdReservations.push(masterRes);

        if (masterRes.subtotal > 0) {
          db.prepare('INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, registrado_por) VALUES (?, ?, ?, ?, ?)').run(
            masterId, 'debito', `Habitación: ${masterRes.plan_nombre || 'Tarifa base'} (${masterRes.noches} noches)`, masterRes.subtotal, req.user.nombre
          );
        }
        if (masterRes.impuesto_monto > 0) {
          db.prepare('INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, registrado_por) VALUES (?, ?, ?, ?, ?)').run(
            masterId, 'debito', `Impuesto Turismo ${masterRes.impuesto_pct}%`, masterRes.impuesto_monto, req.user.nombre
          );
        }

        for (const child of childDataList) {
          child.parent_reserva_id = masterId;
          child.subtotal = child._realTotals.subtotal;
          child.impuesto_pct = child._realTotals.impuesto_pct;
          child.impuesto_monto = child._realTotals.impuesto_monto;
          child.monto_total = child._realTotals.monto_total;
          child.deposito_sugerido = child._realTotals.deposito_sugerido;
          child.monto_pagado = 0;
          child.saldo_pendiente = child.monto_total;

          delete child._realTotals;

          const childRes = create('reservas_hotel', child);
          createdReservations.push(childRes);

          if (childRes.subtotal > 0) {
            db.prepare('INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, registrado_por) VALUES (?, ?, ?, ?, ?)').run(
              childRes.id, 'debito', `Habitación: ${childRes.plan_nombre || 'Tarifa base'} (${childRes.noches} noches)`, childRes.subtotal, req.user.nombre
            );
          }
          if (childRes.impuesto_monto > 0) {
            db.prepare('INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, registrado_por) VALUES (?, ?, ?, ?, ?)').run(
              childRes.id, 'debito', `Impuesto Turismo ${childRes.impuesto_pct}%`, childRes.impuesto_monto, req.user.nombre
            );
          }
        }
      }
    });

    txn();
    ok(res, { grupo_codigo, reservas: createdReservations }, null, 201);

    // Fire notifications for the master reservation of the group (async, non-blocking)
    if (createdReservations.length > 0) {
      const master = createdReservations[0];
      const hab = master.habitacion_id ? findById('habitaciones', master.habitacion_id) : null;
      notifications.notifyReservationConfirmed(master, hab).catch(e => console.log('Group master Notif error:', e.message));
      notifications.notifyAdminNewBooking(master, hab).catch(e => console.log('Group master Admin notif error:', e.message));
    }
  } catch (e) {
    console.error('Error creating group booking:', e);
    err(res, 'SERVER_ERROR', e.message || 'Error creando reserva grupal', 500);
  }
});

router.post('/hotel/reservas', requireAuth, requireOperations, (req, res) => {
  try {
    const { cliente, check_in, check_out, habitacion_id } = req.body;
    const missing = [];
    if (!cliente) missing.push('cliente');
    if (!check_in) missing.push('check_in');
    if (!check_out) missing.push('check_out');
    if (!habitacion_id) missing.push('habitacion_id');
    if (missing.length > 0) return err(res, 'VALIDATION_ERROR', `Campos requeridos: ${missing.join(', ')}`);

    // Date validation
    if (check_out <= check_in) return err(res, 'VALIDATION_ERROR', 'Check-out debe ser posterior al check-in');
    const todayStr = new Date().toISOString().split('T')[0];
    if (check_in < todayStr) return err(res, 'VALIDATION_ERROR', 'No se puede reservar en el pasado');

    const db = getDb();

    // ── Validate room availability ──
    if (habitacion_id) {
      const room = findById('habitaciones', habitacion_id);
      if (!room) return err(res, 'NOT_FOUND', 'Habitación no encontrada', 404);

      const conflict = db.prepare(`
        SELECT id, cliente, check_in, check_out FROM reservas_hotel
        WHERE habitacion_id = ? AND estado NOT IN ('Cancelada', 'No-Show', 'Check-Out')
          AND check_in < ? AND check_out > ?
      `).get(habitacion_id, check_out, check_in);

      if (conflict) {
        return err(res, 'ROOM_OCCUPIED', `Habitación ocupada del ${conflict.check_in} al ${conflict.check_out} por ${conflict.cliente}`);
      }

      // ── Validate guest capacity ──
      const totalGuests = (parseInt(req.body.adultos) || 1) + (parseInt(req.body.menores) || 0);
      const minCap = room.capacidad_min || 1;
      const maxCap = room.capacidad_max || room.capacidad || 4;
      if (totalGuests < minCap || totalGuests > maxCap) {
        return err(res, 'CAPACITY_ERROR', `${room.nombre} (${room.tipo}) admite de ${minCap} a ${maxCap} personas${room.descripcion_camas ? ` (${room.descripcion_camas})` : ''}. Seleccionaste ${totalGuests} huéspedes.`);
      }

      // ── Validate plan room type applicability ──
      if (req.body.plan_codigo) {
        const plan = db.prepare('SELECT * FROM planes_tarifa WHERE codigo = ? AND activo = 1').get(req.body.plan_codigo);
        if (plan && plan.tipos_aplicables) {
          try {
            const applicableTypes = JSON.parse(plan.tipos_aplicables);
            if (Array.isArray(applicableTypes) && applicableTypes.length > 0) {
              if (!applicableTypes.includes(room.tipo)) {
                return err(res, 'VALIDATION_ERROR', `El plan ${plan.nombre} no se puede aplicar a habitaciones de tipo ${room.tipo}. Tipos válidos: ${applicableTypes.join(', ')}`);
              }
            }
          } catch (e) {
            console.error('Error parsing plan.tipos_aplicables:', e);
          }
        }
      }
    }

    // ── Duplicate detection ──
    const duplicate = db.prepare(`
      SELECT id FROM reservas_hotel
      WHERE LOWER(cliente) = LOWER(?) AND check_in = ? AND check_out = ?
        AND estado NOT IN ('Cancelada', 'No-Show')
    `).get(cliente, check_in, check_out);

    if (duplicate) {
      return err(res, 'DUPLICATE', `Ya existe una reserva para ${cliente} en esas fechas (ID: ${duplicate.id})`);
    }

    // ── Build reservation data ──
    const noches = calcNoches(check_in, check_out);
    const data = {
      cliente: sanitize(cliente),
      apellido: sanitize(req.body.apellido || ''),
      email: sanitize(req.body.email || ''),
      whatsapp: sanitize(req.body.whatsapp || ''),
      telefono: sanitize(req.body.telefono || ''),
      nacionalidad: sanitize(req.body.nacionalidad || ''),
      habitacion_id: habitacion_id || null,
      tipo_habitacion: sanitize(req.body.tipo_habitacion || ''),
      check_in, check_out, noches,
      hora_llegada: req.body.hora_llegada || null,
      adultos: parseInt(req.body.adultos) || 1,
      menores: parseInt(req.body.menores) || 0,
      mascotas: parseInt(req.body.mascotas) || 0,
      plan_codigo: req.body.plan_codigo || null,
      plan_nombre: sanitize(req.body.plan_nombre || ''),
      precio_adulto_noche: parseFloat(req.body.precio_adulto_noche) || 0,
      precio_menor_noche: parseFloat(req.body.precio_menor_noche) || 0,
      precio_mascota_noche: parseFloat(req.body.precio_mascota_noche) || 0,
      estado: req.body.estado || 'Confirmada',
      fuente: sanitize(req.body.fuente || 'Teléfono'),
      notas: sanitize(req.body.notas || ''),
      created_by: req.user.nombre || req.user.email
    };

    // Auto-fill from plan if plan_codigo provided
    if (data.plan_codigo && (!data.precio_adulto_noche || data.precio_adulto_noche === 0)) {
      const plan = db.prepare('SELECT * FROM planes_tarifa WHERE codigo = ? AND activo = 1').get(data.plan_codigo);
      if (plan) {
        data.plan_nombre = plan.nombre;
        data.precio_adulto_noche = plan.precio_adulto_noche;
        data.precio_menor_noche = plan.precio_menor_noche;
        data.precio_mascota_noche = plan.precio_mascota_noche;
      }
    }

    // Auto-fill tipo_habitacion from room
    if (habitacion_id && !data.tipo_habitacion) {
      const room = findById('habitaciones', habitacion_id);
      if (room) data.tipo_habitacion = room.tipo;
    }

    // Calculate totals using day-aware pricing
    let totals;
    if (data.plan_codigo) {
      const plan = db.prepare('SELECT * FROM planes_tarifa WHERE codigo = ? AND activo = 1').get(data.plan_codigo);
      if (plan) {
        totals = calcReservationWithRates(plan.id, check_in, check_out, data.adultos, data.menores, data.mascotas);
        data.plan_nombre = plan.nombre;
      } else {
        totals = calcReservation({ ...data, noches });
      }
    } else {
      totals = calcReservation({ ...data, noches });
    }
    // Apply calculated totals
    data.subtotal = totals.subtotal;
    data.impuesto_pct = totals.impuesto_pct;
    data.impuesto_monto = totals.impuesto_monto;
    data.monto_total = totals.monto_total;
    data.deposito_sugerido = totals.deposito_sugerido;
    data.monto_pagado = 0;
    data.saldo_pendiente = totals.monto_total;

    const reserva = create('reservas_hotel', data);

    // Create initial folio entries
    if (data.subtotal > 0) {
      db.prepare('INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, registrado_por) VALUES (?, ?, ?, ?, ?)').run(
        reserva.id, 'debito', `Habitación: ${data.plan_nombre || 'Tarifa base'} (${noches} noches)`, data.subtotal, req.user.nombre
      );
    }
    if (data.impuesto_monto > 0) {
      db.prepare('INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, registrado_por) VALUES (?, ?, ?, ?, ?)').run(
        reserva.id, 'debito', `Impuesto Turismo ${data.impuesto_pct}%`, data.impuesto_monto, req.user.nombre
      );
    }

    ok(res, reserva, null, 201);

    // Fire notifications (async, non-blocking)
    const hab = reserva.habitacion_id ? findById('habitaciones', reserva.habitacion_id) : null;
    notifications.notifyReservationConfirmed(reserva, hab).catch(e => console.log('Notif error:', e.message));
    notifications.notifyAdminNewBooking(reserva, hab).catch(e => console.log('Admin notif error:', e.message));
  } catch (e) { console.error('Error creating reserva:', e); err(res, 'SERVER_ERROR', 'Error creando reserva', 500); }
});

router.put('/hotel/reservas/:id', requireAuth, requireOperations, (req, res) => {
  try {
    const existing = findById('reservas_hotel', req.params.id);
    if (!existing) return err(res, 'NOT_FOUND', 'Reserva no encontrada', 404);

    const data = {};
    const allowed = ['cliente', 'apellido', 'email', 'whatsapp', 'telefono', 'nacionalidad',
      'habitacion_id', 'tipo_habitacion', 'check_in', 'check_out', 'hora_llegada',
      'adultos', 'menores', 'mascotas', 'plan_codigo', 'plan_nombre',
      'precio_adulto_noche', 'precio_menor_noche', 'precio_mascota_noche',
      'productos_adicionales', 'estado', 'fuente', 'notas'];

    for (const f of allowed) {
      if (req.body[f] !== undefined) data[f] = typeof req.body[f] === 'string' ? sanitize(req.body[f]) : req.body[f];
    }

    // Recalculate if pricing changed
    const merged = { ...existing, ...data };
    if (data.adultos !== undefined || data.menores !== undefined || data.mascotas !== undefined ||
        data.precio_adulto_noche !== undefined || data.check_in !== undefined || data.check_out !== undefined ||
        data.productos_adicionales !== undefined) {
      merged.noches = calcNoches(merged.check_in, merged.check_out);
      data.noches = merged.noches;
      const totals = calcReservation(merged);
      Object.assign(data, totals);
    }

    // Sanitize empty string room assignments to null
    if (data.habitacion_id === '') {
      data.habitacion_id = null;
    }

    // Validate room availability if changing room or dates
    if (data.hasOwnProperty('habitacion_id') || data.check_in || data.check_out) {
      const db = getDb();
      const roomId = data.hasOwnProperty('habitacion_id') ? data.habitacion_id : existing.habitacion_id;
      const ci = data.check_in || existing.check_in;
      const co = data.check_out || existing.check_out;
      if (roomId) {
        const conflict = db.prepare(`
          SELECT id, cliente FROM reservas_hotel
          WHERE habitacion_id = ? AND id != ? AND estado NOT IN ('Cancelada', 'No-Show', 'Check-Out')
            AND check_in < ? AND check_out > ?
        `).get(roomId, req.params.id, co, ci);
        if (conflict) return err(res, 'ROOM_OCCUPIED', `Habitación ocupada por ${conflict.cliente}`);
      }
    }

    const updated = update('reservas_hotel', req.params.id, data);
    ok(res, updated);
  } catch (e) { console.error(e); err(res, 'SERVER_ERROR', 'Error actualizando reserva', 500); }
});

router.post('/hotel/reservas/:id/solicitar-cambio', requireAuth, requireOperations, (req, res) => {
  try {
    const { tipo_modificacion, transaccion_original_id, justificacion, snapshot_datos } = req.body;
    if (!tipo_modificacion || !justificacion || !snapshot_datos) {
      return err(res, 'VALIDATION_ERROR', 'tipo_modificacion, justificacion y snapshot_datos son requeridos');
    }
    if (!['editar_pago', 'editar_reserva'].includes(tipo_modificacion)) {
      return err(res, 'VALIDATION_ERROR', 'tipo_modificacion debe ser editar_pago o editar_reserva');
    }

    const db = getDb();
    // 1. Fetch current reservation
    const reservation = db.prepare('SELECT * FROM reservas_hotel WHERE id = ?').get(req.params.id);
    if (!reservation) return err(res, 'NOT_FOUND', 'Reserva no encontrada', 404);

    if (reservation.estado === 'Cambio Pendiente de Aprobación') {
      return err(res, 'ALREADY_PENDING', 'Ya existe una solicitud de cambio pendiente para esta reserva', 400);
    }

    let datosAnterioresObj = {};
    if (tipo_modificacion === 'editar_reserva') {
      datosAnterioresObj = { ...reservation };
    } else {
      if (!transaccion_original_id) {
        return err(res, 'VALIDATION_ERROR', 'transaccion_original_id es requerido para editar_pago');
      }
      const payment = db.prepare('SELECT * FROM folio_hotel WHERE id = ? AND reserva_id = ?').get(transaccion_original_id, req.params.id);
      if (!payment) return err(res, 'NOT_FOUND', 'Transacción de pago original no encontrada', 404);
      datosAnterioresObj = { ...payment, reserva_estado_anterior: reservation.estado };
    }

    // 2. Set the reservation's estado to 'Cambio Pendiente de Aprobación'
    db.prepare("UPDATE reservas_hotel SET estado = 'Cambio Pendiente de Aprobación' WHERE id = ?").run(req.params.id);

    // 3. Create the solicitudes_modificacion record in DB
    const requestData = {
      reserva_id: parseInt(req.params.id),
      tipo_modificacion,
      transaccion_original_id: transaccion_original_id ? parseInt(transaccion_original_id) : null,
      estado: 'Pendiente',
      usuario_solicitante: req.user.nombre || req.user.email || 'staff',
      justificacion: sanitize(justificacion),
      snapshot_datos: typeof snapshot_datos === 'string' ? snapshot_datos : JSON.stringify(snapshot_datos),
      datos_anteriores: JSON.stringify(datosAnterioresObj)
    };

    const newRequest = create('solicitudes_modificacion', requestData);
    ok(res, newRequest, null, 201);
  } catch (e) {
    console.error('Error en solicitar-cambio:', e);
    err(res, 'SERVER_ERROR', 'Error al procesar la solicitud de cambio', 500);
  }
});

// Status change (Check-in / Check-out)
router.patch('/hotel/reservas/:id/status', requireAuth, requireOperations, requireRole('admin', 'receptionist'), (req, res) => {
  try {
    const { estado } = req.body;
    const valid = ['Pendiente', 'Confirmada', 'Hospedado', 'Check-Out', 'Cancelada', 'No-Show'];
    if (!valid.includes(estado)) return err(res, 'VALIDATION_ERROR', `Estados válidos: ${valid.join(', ')}`);

    const existing = findById('reservas_hotel', req.params.id);
    if (!existing) return err(res, 'NOT_FOUND', 'Reserva no encontrada', 404);

    // ── Enforce State Machine Transitions ──
    const ALLOWED_TRANSITIONS = {
      'Pendiente': ['Confirmada', 'Cancelada'],
      'Confirmada': ['Pendiente', 'Hospedado', 'Cancelada', 'No-Show'],
      'Hospedado': ['Check-Out', 'Confirmada', 'Cancelada'],
      'Check-Out': [], // Terminal state
      'Cancelada': [], // Terminal state
      'No-Show': []    // Terminal state
    };

    const fromStatus = existing.estado;
    const toStatus = estado;

    if (fromStatus !== toStatus) {
      // Admins are allowed to bypass the state machine rules to make operational corrections
      if (req.user.rol !== 'admin') {
        const allowed = ALLOWED_TRANSITIONS[fromStatus];
        if (!allowed || !allowed.includes(toStatus)) {
          return err(res, 'INVALID_TRANSITION', `No se permite cambiar el estado de la reserva de '${fromStatus}' a '${toStatus}'`);
        }
      }
    }

    const updated = update('reservas_hotel', req.params.id, { estado });

    // ── Auto-update Room Occupancy/Cleaning Status ──
    if (existing.habitacion_id) {
      if (estado === 'Hospedado') {
        update('habitaciones', existing.habitacion_id, { estado_habitacion: 'Ocupada' });
      } else if (estado === 'Check-Out') {
        update('habitaciones', existing.habitacion_id, { estado_habitacion: 'Vacía', estado_limpieza: 'Sucia' });
      } else if (['Pendiente', 'Confirmada', 'Cancelada', 'No-Show'].includes(estado)) {
        // Correcting room status if reverted from Checked-In or Cancelled
        update('habitaciones', existing.habitacion_id, { estado_habitacion: 'Vacía' });
      }
    }

    ok(res, updated);

    // Fire notification (async, non-blocking)
    const hab = existing.habitacion_id ? findById('habitaciones', existing.habitacion_id) : null;
    notifications.notifyStatusChange(updated, existing.estado, estado, hab).catch(e => console.log('Notif error:', e.message));
  } catch (e) { err(res, 'SERVER_ERROR', 'Error cambiando estado', 500); }
});

// Delete a reservation completely with audit log (Admin only)
router.delete('/hotel/reservas/:id', requireAuth, requireOperations, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const reserva = findById('reservas_hotel', req.params.id);
    if (!reserva) return err(res, 'NOT_FOUND', 'Reserva no encontrada', 404);

    const { motivo } = req.body;
    if (!motivo) return err(res, 'VALIDATION_ERROR', 'Se requiere especificar un motivo de eliminación');

    const txn = db.transaction(() => {
      // 1. Log deletion in audit table
      db.prepare(`
        INSERT INTO reservas_eliminadas_log (reserva_id, cliente, check_in, check_out, monto_total, motivo, eliminado_por)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        reserva.id,
        `${reserva.cliente} ${reserva.apellido || ''}`.trim(),
        reserva.check_in,
        reserva.check_out,
        reserva.monto_total,
        sanitize(motivo),
        req.user.nombre || req.user.email || 'admin'
      );

      // 2. Clean up associated tables
      db.prepare('DELETE FROM folio_hotel WHERE reserva_id = ?').run(req.params.id);
      db.prepare('DELETE FROM documentos_reserva WHERE reserva_id = ?').run(req.params.id);
      db.prepare('DELETE FROM solicitudes_modificacion WHERE reserva_id = ?').run(req.params.id);
      db.prepare('DELETE FROM notificaciones_log WHERE reserva_id = ?').run(req.params.id);
      db.prepare('DELETE FROM reversiones_log WHERE reserva_id = ?').run(req.params.id);
      db.prepare('UPDATE reservas_hotel SET parent_reserva_id = NULL WHERE parent_reserva_id = ?').run(req.params.id);

      // 3. Delete the reservation
      db.prepare('DELETE FROM reservas_hotel WHERE id = ?').run(req.params.id);
    });

    txn();
    ok(res, { success: true, message: 'Reserva eliminada permanentemente del sistema.' });
  } catch (e) {
    console.error(e);
    err(res, 'SERVER_ERROR', 'Error al eliminar la reserva', 500);
  }
});

// ══════════════════════════════════════
// FOLIO / PAGOS
// ══════════════════════════════════════

router.get('/hotel/reservas/:id/folio', requireAuth, requireOperations, (req, res) => {
  try {
    const db = getDb();
    const entries = db.prepare('SELECT * FROM folio_hotel WHERE reserva_id = ? ORDER BY created_at').all(req.params.id);
    ok(res, entries);
  } catch (e) { err(res, 'SERVER_ERROR', 'Error obteniendo folio', 500); }
});

// Register payment (crédito) or extra charge (débito)
router.post('/hotel/reservas/:id/folio', requireAuth, requireOperations, (req, res) => {
  try {
    const reserva = findById('reservas_hotel', req.params.id);
    if (!reserva) return err(res, 'NOT_FOUND', 'Reserva no encontrada', 404);

    const { monto, concepto, tipo = 'credito', metodo_pago, referencia } = req.body;
    if (!monto || !concepto) return err(res, 'VALIDATION_ERROR', 'monto y concepto requeridos');

    const db = getDb();

    // Redirect if child and consolidated billing is enabled
    let targetReservaId = req.params.id;
    let targetReserva = reserva;
    let conceptStr = concepto;

    if (reserva.parent_reserva_id && reserva.facturacion_consolidada === 1) {
      const master = findById('reservas_hotel', reserva.parent_reserva_id);
      if (master) {
        let roomName = '';
        if (reserva.habitacion_id) {
          const room = findById('habitaciones', reserva.habitacion_id);
          if (room) roomName = room.nombre;
        }
        const guestName = `${reserva.cliente} ${reserva.apellido || ''}`.trim();
        conceptStr = `${concepto} (Ref: Hab ${roomName || reserva.habitacion_id} - ${guestName})`;
        targetReservaId = master.id;
        targetReserva = master;
      }
    }

    db.prepare('INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, metodo_pago, referencia, registrado_por) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      targetReservaId, tipo, sanitize(conceptStr), parseFloat(monto), sanitize(metodo_pago || ''), sanitize(referencia || ''), req.user.nombre
    );

    // Recalculate balance for targetReserva
    if (tipo === 'credito') {
      const newPagado = Math.round((parseFloat(targetReserva.monto_pagado) + parseFloat(monto)) * 100) / 100;
      const newSaldo = Math.round((parseFloat(targetReserva.monto_total) - newPagado) * 100) / 100;
      update('reservas_hotel', targetReservaId, { monto_pagado: newPagado, saldo_pendiente: newSaldo });
    } else if (tipo === 'debito') {
      // Extra charge — recalculate total preserving existing subtotal
      const newExtras = Math.round((parseFloat(targetReserva.productos_adicionales) + parseFloat(monto)) * 100) / 100;
      const subtotal = parseFloat(targetReserva.subtotal) || 0;
      const impuestoPct = parseFloat(targetReserva.impuesto_pct) || 10;
      const impuestoMonto = Math.round((subtotal + newExtras) * (impuestoPct / 100) * 100) / 100;
      const montoTotal = Math.round((subtotal + newExtras + impuestoMonto) * 100) / 100;
      const pagado = parseFloat(targetReserva.monto_pagado) || 0;
      const saldoPendiente = Math.round((montoTotal - pagado) * 100) / 100;
      
      update('reservas_hotel', targetReservaId, { 
        productos_adicionales: newExtras,
        impuesto_monto: impuestoMonto,
        monto_total: montoTotal,
        saldo_pendiente: saldoPendiente
      });
    }

    const updated = findById('reservas_hotel', targetReservaId);
    ok(res, updated, null, 200);

    // Fire payment notification (async)
    if (tipo === 'credito') {
      const hab = updated.habitacion_id ? findById('habitaciones', updated.habitacion_id) : null;
      notifications.notifyPaymentReceived(updated, { monto: parseFloat(monto), concepto: conceptStr, metodo_pago }, hab).catch(e => console.log('Notif error:', e.message));
    }
  } catch (e) { console.error(e); err(res, 'SERVER_ERROR', 'Error registrando movimiento', 500); }
});

// Edit a movement in the folio directly (Admin only)
router.put('/hotel/reservas/:id/folio/:folioId', requireAuth, requireOperations, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const reserva = findById('reservas_hotel', req.params.id);
    if (!reserva) return err(res, 'NOT_FOUND', 'Reserva no encontrada', 404);

    const original = db.prepare('SELECT * FROM folio_hotel WHERE id = ? AND reserva_id = ?').get(req.params.folioId, req.params.id);
    if (!original) return err(res, 'NOT_FOUND', 'Movimiento de folio no encontrado', 404);

    const { monto, concepto, metodo_pago, referencia, tipo, fecha } = req.body;

    const txn = db.transaction(() => {
      // 1. Update folio entry fields
      const allowedFields = { monto, concepto, metodo_pago, referencia, tipo, fecha };
      const updates = [];
      const params = [];
      for (const [key, value] of Object.entries(allowedFields)) {
        if (value !== undefined) {
          updates.push(`${key} = ?`);
          if (key === 'monto') {
            params.push(parseFloat(value));
          } else {
            params.push(key === 'concepto' || key === 'metodo_pago' || key === 'referencia' || key === 'tipo' || key === 'fecha' ? sanitize(String(value)) : value);
          }
        }
      }
      if (updates.length > 0) {
        db.prepare(`UPDATE folio_hotel SET ${updates.join(', ')} WHERE id = ?`).run(...params, req.params.folioId);
      }

      // 2. Recalculate reservation totals
      const totalPaid = db.prepare("SELECT SUM(monto) as total FROM folio_hotel WHERE reserva_id = ? AND tipo = 'credito'").get(req.params.id).total || 0;
      const newMontoPagado = Math.round(totalPaid * 100) / 100;

      const debits = db.prepare("SELECT * FROM folio_hotel WHERE reserva_id = ? AND tipo = 'debito'").all(req.params.id);
      let newProductosAdicionales = 0;
      for (const d of debits) {
        if (!d.concepto.startsWith('Habitación:') && !d.concepto.startsWith('Impuesto Turismo')) {
          newProductosAdicionales += d.monto;
        }
      }
      newProductosAdicionales = Math.round(newProductosAdicionales * 100) / 100;

      const merged = { ...reserva, monto_pagado: newMontoPagado, productos_adicionales: newProductosAdicionales };
      const totals = calcReservation(merged);
      Object.assign(merged, totals);

      db.prepare(`
        UPDATE reservas_hotel SET 
          productos_adicionales = ?, subtotal = ?, impuesto_pct = ?, impuesto_monto = ?,
          monto_total = ?, deposito_sugerido = ?, monto_pagado = ?, saldo_pendiente = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        merged.productos_adicionales, merged.subtotal, merged.impuesto_pct, merged.impuesto_monto,
        merged.monto_total, merged.deposito_sugerido, merged.monto_pagado, merged.saldo_pendiente,
        req.params.id
      );
    });

    txn();

    const updatedReserva = findById('reservas_hotel', req.params.id);
    ok(res, updatedReserva, null, 200);
  } catch (e) {
    console.error(e);
    err(res, 'SERVER_ERROR', 'Error al editar el movimiento de folio', 500);
  }
});

// Delete a movement in the folio directly (Admin only)
router.delete('/hotel/reservas/:id/folio/:folioId', requireAuth, requireOperations, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const reserva = findById('reservas_hotel', req.params.id);
    if (!reserva) return err(res, 'NOT_FOUND', 'Reserva no encontrada', 404);

    const original = db.prepare('SELECT * FROM folio_hotel WHERE id = ? AND reserva_id = ?').get(req.params.folioId, req.params.id);
    if (!original) return err(res, 'NOT_FOUND', 'Movimiento de folio no encontrado', 404);

    const txn = db.transaction(() => {
      // 1. Delete folio entry
      db.prepare('DELETE FROM folio_hotel WHERE id = ?').run(req.params.folioId);

      // 2. Recalculate reservation totals
      const totalPaid = db.prepare("SELECT SUM(monto) as total FROM folio_hotel WHERE reserva_id = ? AND tipo = 'credito'").get(req.params.id).total || 0;
      const newMontoPagado = Math.round(totalPaid * 100) / 100;

      const debits = db.prepare("SELECT * FROM folio_hotel WHERE reserva_id = ? AND tipo = 'debito'").all(req.params.id);
      let newProductosAdicionales = 0;
      for (const d of debits) {
        if (!d.concepto.startsWith('Habitación:') && !d.concepto.startsWith('Impuesto Turismo')) {
          newProductosAdicionales += d.monto;
        }
      }
      newProductosAdicionales = Math.round(newProductosAdicionales * 100) / 100;

      const merged = { ...reserva, monto_pagado: newMontoPagado, productos_adicionales: newProductosAdicionales };
      const totals = calcReservation(merged);
      Object.assign(merged, totals);

      db.prepare(`
        UPDATE reservas_hotel SET 
          productos_adicionales = ?, subtotal = ?, impuesto_pct = ?, impuesto_monto = ?,
          monto_total = ?, deposito_sugerido = ?, monto_pagado = ?, saldo_pendiente = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        merged.productos_adicionales, merged.subtotal, merged.impuesto_pct, merged.impuesto_monto,
        merged.monto_total, merged.deposito_sugerido, merged.monto_pagado, merged.saldo_pendiente,
        req.params.id
      );
    });

    txn();

    const updatedReserva = findById('reservas_hotel', req.params.id);
    ok(res, updatedReserva, null, 200);
  } catch (e) {
    console.error(e);
    err(res, 'SERVER_ERROR', 'Error al eliminar el movimiento de folio', 500);
  }
});

// Reversar un movimiento de folio (crédito o débito)
router.post('/hotel/reservas/:id/folio/:folioId/reversar', requireAuth, requireOperations, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const reserva = findById('reservas_hotel', req.params.id);
    if (!reserva) return err(res, 'NOT_FOUND', 'Reserva no encontrada', 404);

    const original = db.prepare('SELECT * FROM folio_hotel WHERE id = ? AND reserva_id = ?').get(req.params.folioId, req.params.id);
    if (!original) return err(res, 'NOT_FOUND', 'Movimiento de folio no encontrado', 404);

    // Verificar si ya fue reversado (buscando concepto que contenga "[ID {original.id}]")
    const searchPattern = `%[ID ${original.id}]%`;
    const reversed = db.prepare('SELECT id FROM folio_hotel WHERE reserva_id = ? AND concepto LIKE ?').get(req.params.id, searchPattern);
    if (reversed) {
      return err(res, 'VALIDATION_ERROR', 'Este movimiento ya ha sido reversado', 400);
    }

    let concept = '';

    const txn = db.transaction(() => {
      const motivo = (req.body && (req.body.motivo || req.body.reason)) || 'No especificado';
      db.prepare(`
        INSERT INTO reversiones_log (reserva_id, folio_id, monto, concepto_original, motivo, reversado_por)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(reserva.id, original.id, original.monto, original.concepto, sanitize(motivo), req.user.nombre || req.user.email);

      if (original.tipo === 'credito') {
        // Reversión de pago -> Genera un débito
        concept = `Reversión de pago [ID ${original.id}]: ${original.concepto}`;
        db.prepare('INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, registrado_por) VALUES (?, ?, ?, ?, ?)').run(
          req.params.id, 'debito', concept, original.monto, req.user.nombre
        );

        // Ajustar monto_pagado y saldo_pendiente
        const newPagado = Math.round((parseFloat(reserva.monto_pagado) - parseFloat(original.monto)) * 100) / 100;
        const newSaldo = Math.round((parseFloat(reserva.monto_total) - newPagado) * 100) / 100;
        update('reservas_hotel', req.params.id, { monto_pagado: newPagado, saldo_pendiente: newSaldo });
      } else if (original.tipo === 'debito') {
        // Reversión de cargo -> Genera un crédito
        concept = `Reversión de cargo [ID ${original.id}]: ${original.concepto}`;
        db.prepare('INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, registrado_por) VALUES (?, ?, ?, ?, ?)').run(
          req.params.id, 'credito', concept, original.monto, req.user.nombre
        );

        // Ajustar productos_adicionales y recalcular total
        const newExtras = Math.max(0, Math.round((parseFloat(reserva.productos_adicionales) - parseFloat(original.monto)) * 100) / 100);
        const recalc = calcReservation({ ...reserva, productos_adicionales: newExtras });
        update('reservas_hotel', req.params.id, { productos_adicionales: newExtras, ...recalc });
      }
    });

    txn();

    const updatedReserva = findById('reservas_hotel', req.params.id);
    ok(res, updatedReserva, null, 200);
  } catch (e) {
    console.error(e);
    err(res, 'SERVER_ERROR', 'Error al reversar movimiento', 500);
  }
});

// Saldos pendientes
router.get('/hotel/saldos', requireAuth, requireOperations, (req, res) => {
  try {
    const db = getDb();
    const pending = db.prepare(`
      SELECT r.*, h.nombre as habitacion_nombre
      FROM reservas_hotel r
      LEFT JOIN habitaciones h ON r.habitacion_id = h.id
      WHERE r.saldo_pendiente > 0 AND r.estado NOT IN ('Cancelada', 'No-Show')
      ORDER BY r.check_in ASC
    `).all();
    ok(res, pending);
  } catch (e) { err(res, 'SERVER_ERROR', 'Error obteniendo saldos', 500); }
});

// Cuentas por Cobrar de Terceros y Cuponeras (Oferta Simple, PaHoy, Al Cobro)
router.get('/hotel/saldos/terceros', requireAuth, requireOperations, (req, res) => {
  try {
    const db = getDb();
    const entries = db.prepare(`
      SELECT f.*, r.cliente, r.apellido, r.check_in, r.check_out, r.estado as reserva_estado,
             h.nombre as habitacion_nombre
      FROM folio_hotel f
      JOIN reservas_hotel r ON f.reserva_id = r.id
      LEFT JOIN habitaciones h ON r.habitacion_id = h.id
      WHERE f.tipo = 'credito'
        AND f.metodo_pago IN ('al_cobro', 'cuponera_oferta_simple', 'cuponera_pahoy')
        AND f.reconciliado = 0
      ORDER BY f.created_at ASC
    `).all();
    ok(res, entries);
  } catch (e) {
    console.error(e);
    err(res, 'SERVER_ERROR', 'Error obteniendo saldos de terceros', 500);
  }
});

// Reconciliación en lote de CxC Terceros y Cuponeras
router.post('/hotel/saldos/reconciliar', requireAuth, requireOperations, requireRole('admin'), (req, res) => {
  try {
    const { ids, comision_porcentaje } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return err(res, 'VALIDATION_ERROR', 'Se requiere una lista de ids de folio para reconciliar');
    }
    const comisionVal = comision_porcentaje !== undefined ? (parseFloat(comision_porcentaje) || 0) : 0;
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE folio_hotel
      SET reconciliado = 1, fecha_reconciliacion = ?, comision_porcentaje = ?
      WHERE id = ? AND tipo = 'credito' AND metodo_pago IN ('al_cobro', 'cuponera_oferta_simple', 'cuponera_pahoy')
    `);
    const today = new Date().toISOString().split('T')[0];
    const txn = db.transaction(() => {
      for (const id of ids) {
        stmt.run(today, comisionVal, id);
      }
    });
    txn();
    ok(res, { message: `${ids.length} movimientos reconciliados con éxito` });
  } catch (e) {
    console.error(e);
    err(res, 'SERVER_ERROR', 'Error reconciliando saldos de terceros', 500);
  }
});

// ══════════════════════════════════════
// GUEST MANAGEMENT / HUESPEDES
// ══════════════════════════════════════

// List guests
router.get('/hotel/huespedes', requireAuth, requireOperations, (req, res) => {
  try {
    const { q, page = 1, limit = 50, habitual } = req.query;
    const db = getDb();
    const conditions = [];
    const values = [];
    if (q) { conditions.push("(nombre LIKE ? OR apellido LIKE ? OR email LIKE ?)"); values.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (habitual === '1') { conditions.push("huesped_habitual = 1"); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = ((+page) - 1) * (+limit);
    const total = db.prepare(`SELECT COUNT(*) as c FROM huespedes ${where}`).get(...values).c;
    const data = db.prepare(`SELECT * FROM huespedes ${where} ORDER BY total_ingresos DESC LIMIT ? OFFSET ?`).all(...values, +limit, offset);
    ok(res, data, { total, page: +page, limit: +limit, pages: Math.ceil(total / +limit) });
  } catch (e) { err(res, 'SERVER_ERROR', 'Error listando huéspedes', 500); }
});

// Search guests (autocomplete)
router.get('/hotel/huespedes/buscar', requireAuth, requireOperations, (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return ok(res, []);
    const db = getDb();
    const results = db.prepare("SELECT id, nombre, apellido, email, telefono, pais, total_reservas, total_ingresos FROM huespedes WHERE nombre LIKE ? OR apellido LIKE ? OR email LIKE ? ORDER BY total_ingresos DESC LIMIT 10").all(`%${q}%`, `%${q}%`, `%${q}%`);
    ok(res, results);
  } catch (e) { err(res, 'SERVER_ERROR', 'Error buscando huéspedes', 500); }
});

// Guest aggregate stats
router.get('/hotel/huespedes/stats', requireAuth, requireOperations, (req, res) => {
  try {
    const db = getDb();
    const totals = db.prepare(`
      SELECT 
        COUNT(*) as total_huespedes,
        SUM(total_reservas) as total_reservas_historico,
        SUM(noches_estadia) as total_noches_historico,
        SUM(total_ingresos) as total_ingresos_historico,
        SUM(CASE WHEN huesped_habitual = 1 THEN 1 ELSE 0 END) as total_habituales,
        MIN(ultima_estadia) as primera_estadia,
        MAX(ultima_estadia) as ultima_estadia
      FROM huespedes
    `).get();

    const topPaises = db.prepare(`
      SELECT pais, COUNT(*) as count, SUM(total_ingresos) as ingresos
      FROM huespedes WHERE pais != '' AND pais IS NOT NULL
      GROUP BY pais ORDER BY count DESC LIMIT 10
    `).all();

    const topHuespedes = db.prepare(`
      SELECT nombre, apellido, email, pais, total_reservas, noches_estadia, total_ingresos, ultima_estadia
      FROM huespedes ORDER BY total_ingresos DESC LIMIT 10
    `).all();

    const revenueByYear = db.prepare(`
      SELECT 
        SUBSTR(ultima_estadia, 1, 4) as year,
        COUNT(*) as huespedes,
        SUM(total_ingresos) as ingresos,
        SUM(noches_estadia) as noches
      FROM huespedes 
      WHERE ultima_estadia IS NOT NULL AND ultima_estadia != ''
      GROUP BY SUBSTR(ultima_estadia, 1, 4) ORDER BY year
    `).all();

    ok(res, {
      ...totals,
      topPaises,
      topHuespedes,
      revenueByYear,
    });
  } catch (e) { err(res, 'SERVER_ERROR', 'Error obteniendo stats huéspedes', 500); }
});

// ══════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════

router.get('/hotel/dashboard', requireAuth, requireHousekeeping, (req, res) => {
  try {
    const db = getDb();
    const hoy = new Date().toISOString().split('T')[0];
    const { periodo = 'mes' } = req.query; // dia, semana, mes, total

    // Period date range
    let periodoDesde;
    const d = new Date();
    if (periodo === 'dia') periodoDesde = hoy;
    else if (periodo === 'semana') { d.setDate(d.getDate() - 7); periodoDesde = d.toISOString().split('T')[0]; }
    else if (periodo === 'total') periodoDesde = '2000-01-01';
    else { periodoDesde = hoy.substring(0, 7) + '-01'; } // mes
    const periodoHasta = hoy;

    const totalRooms = db.prepare('SELECT COUNT(*) as c FROM habitaciones WHERE activa = 1').get().c;
    const occupied = db.prepare(`
      SELECT COUNT(DISTINCT habitacion_id) as c FROM reservas_hotel
      WHERE estado = 'Hospedado' AND check_in <= ? AND check_out > ?
    `).get(hoy, hoy).c;

    const llegadasHoy = db.prepare(`SELECT COUNT(*) as c FROM reservas_hotel WHERE check_in = ? AND estado NOT IN ('Cancelada', 'No-Show')`).get(hoy).c;
    const salidasHoy = db.prepare(`SELECT COUNT(*) as c FROM reservas_hotel WHERE check_out = ? AND estado NOT IN ('Cancelada', 'No-Show')`).get(hoy).c;
    const hospedados = db.prepare(`SELECT COUNT(*) as c FROM reservas_hotel WHERE estado = 'Hospedado'`).get().c;

    if (req.user?.rol === 'cleaning') {
      const cleaningStats = (category) => db.prepare(`
        SELECT estado_limpieza, COUNT(*) as c FROM habitaciones
        WHERE activa = 1 ${category ? 'AND categoria = ?' : ''} GROUP BY estado_limpieza
      `).all(...(category ? [category] : []));
      return ok(res, {
        housekeeping: true,
        ocupacion: { total: totalRooms, ocupadas: occupied, porcentaje: totalRooms > 0 ? Math.round(occupied / totalRooms * 100) : 0 },
        hoy: { llegadas: llegadasHoy, salidas: salidasHoy, hospedados },
        limpieza: cleaningStats(),
        limpieza_estadia: cleaningStats('Estadía'),
        limpieza_pasadia: cleaningStats('Pasadía'),
      });
    }

    const saldoTotal = db.prepare(`
      SELECT COALESCE(SUM(saldo_pendiente), 0) as total FROM reservas_hotel
      WHERE saldo_pendiente > 0 AND estado NOT IN ('Cancelada', 'No-Show')
    `).get().total;

    const ingresosPeriodo = db.prepare(`
      SELECT COALESCE(SUM(monto_total), 0) as total FROM reservas_hotel
      WHERE check_in >= ? AND check_in <= ? AND estado NOT IN ('Cancelada', 'No-Show')
    `).get(periodoDesde, periodoHasta).total;

    const reservasPeriodo = db.prepare(`
      SELECT COUNT(*) as c FROM reservas_hotel WHERE check_in >= ? AND check_in <= ? AND estado NOT IN ('Cancelada', 'No-Show')
    `).get(periodoDesde, periodoHasta).c;

    // Split reservas by category
    const reservasEstadia = db.prepare(`
      SELECT COUNT(*) as c FROM reservas_hotel r
      JOIN habitaciones h ON r.habitacion_id = h.id
      WHERE r.check_in >= ? AND r.check_in <= ? AND r.estado NOT IN ('Cancelada', 'No-Show') AND h.categoria = 'Estadía'
    `).get(periodoDesde, periodoHasta).c;
    const reservasPasadia = db.prepare(`
      SELECT COUNT(*) as c FROM reservas_hotel r
      JOIN habitaciones h ON r.habitacion_id = h.id
      WHERE r.check_in >= ? AND r.check_in <= ? AND r.estado NOT IN ('Cancelada', 'No-Show') AND h.categoria = 'Pasadía'
    `).get(periodoDesde, periodoHasta).c;

    const recientes = db.prepare(`
      SELECT r.*, h.nombre as habitacion_nombre FROM reservas_hotel r
      LEFT JOIN habitaciones h ON r.habitacion_id = h.id
      ORDER BY r.created_at DESC LIMIT 10
    `).all();

    const limpiezaStats = db.prepare(`
      SELECT estado_limpieza, COUNT(*) as c FROM habitaciones WHERE activa = 1 GROUP BY estado_limpieza
    `).all();

    // Status distribution (pie chart data)
    const statusDist = db.prepare(`
      SELECT estado, COUNT(*) as c FROM reservas_hotel
      WHERE check_in >= ? AND check_in <= ? GROUP BY estado ORDER BY c DESC
    `).all(periodoDesde, periodoHasta);

    // Ingresos por plan
    const ingresosPorPlan = db.prepare(`
      SELECT plan_nombre, COUNT(*) as reservas, COALESCE(SUM(monto_total), 0) as total
      FROM reservas_hotel
      WHERE check_in >= ? AND check_in <= ? AND estado NOT IN ('Cancelada', 'No-Show') AND plan_nombre IS NOT NULL AND plan_nombre != ''
      GROUP BY plan_nombre ORDER BY total DESC
    `).all(periodoDesde, periodoHasta);

    // Ocupación por tipo de habitación
    const ocupacionPorTipo = db.prepare(`
      SELECT h.tipo, h.categoria, COUNT(DISTINCT r.id) as reservas
      FROM reservas_hotel r
      JOIN habitaciones h ON r.habitacion_id = h.id
      WHERE r.check_in >= ? AND r.check_in <= ? AND r.estado NOT IN ('Cancelada', 'No-Show')
      GROUP BY h.tipo ORDER BY reservas DESC
    `).all(periodoDesde, periodoHasta);

    // Limpieza by category
    const limpiezaEstadia = db.prepare(`SELECT estado_limpieza, COUNT(*) as c FROM habitaciones WHERE activa = 1 AND categoria = 'Estadía' GROUP BY estado_limpieza`).all();
    const limpiezaPasadia = db.prepare(`SELECT estado_limpieza, COUNT(*) as c FROM habitaciones WHERE activa = 1 AND categoria = 'Pasadía' GROUP BY estado_limpieza`).all();

    const totalEstadia = db.prepare("SELECT COUNT(*) as c FROM habitaciones WHERE activa = 1 AND categoria = 'Estadía'").get().c;
    const totalPasadia = db.prepare("SELECT COUNT(*) as c FROM habitaciones WHERE activa = 1 AND categoria = 'Pasadía'").get().c;

    const daysInPeriod = Math.max(1, Math.ceil((new Date(periodoHasta).getTime() - new Date(periodoDesde).getTime()) / 86400000) + 1);

    // Total room-nights occupied in the period (Estadía)
    const nochesEstadia = db.prepare(`
      SELECT COALESCE(SUM(r.noches), 0) as n FROM reservas_hotel r
      JOIN habitaciones h ON r.habitacion_id = h.id
      WHERE h.categoria = 'Estadía' AND r.estado NOT IN ('Cancelada', 'No-Show')
        AND r.check_in <= ? AND r.check_out >= ?
    `).get(periodoHasta, periodoDesde).n;
    const slotsEstadia = totalEstadia * daysInPeriod;
    const pctEstadia = slotsEstadia > 0 ? Math.min(100, Math.round((nochesEstadia / slotsEstadia) * 100)) : 0;

    // Total room-nights occupied in the period (Pasadía)
    const nochesPasadia = db.prepare(`
      SELECT COALESCE(SUM(r.noches), 0) as n FROM reservas_hotel r
      JOIN habitaciones h ON r.habitacion_id = h.id
      WHERE h.categoria = 'Pasadía' AND r.estado NOT IN ('Cancelada', 'No-Show')
        AND r.check_in <= ? AND r.check_out >= ?
    `).get(periodoHasta, periodoDesde).n;
    const slotsPasadia = totalPasadia * daysInPeriod;
    const pctPasadia = slotsPasadia > 0 ? Math.min(100, Math.round((nochesPasadia / slotsPasadia) * 100)) : 0;

    // Occupancy timeline
    const timelineEstadia = [];
    const timelinePasadia = [];
    const timelineDays = periodo === 'dia' ? 1 : periodo === 'semana' ? 7 : periodo === 'total' ? 30 : 14;
    const tlStart = periodo === 'total' ? 29 : Math.min(timelineDays - 1, 29);

    for (let i = tlStart; i >= 0; i--) {
      const dd = new Date(); dd.setDate(dd.getDate() - i);
      const ds = dd.toISOString().split('T')[0];
      const occE = db.prepare(`
        SELECT COUNT(DISTINCT r.habitacion_id) as c FROM reservas_hotel r
        JOIN habitaciones h ON r.habitacion_id = h.id
        WHERE h.categoria = 'Estadía' AND r.estado NOT IN ('Cancelada', 'No-Show') AND r.check_in <= ? AND r.check_out > ?
      `).get(ds, ds).c;
      const occP = db.prepare(`
        SELECT COUNT(DISTINCT r.habitacion_id) as c FROM reservas_hotel r
        JOIN habitaciones h ON r.habitacion_id = h.id
        WHERE h.categoria = 'Pasadía' AND r.estado NOT IN ('Cancelada', 'No-Show') AND r.check_in <= ? AND r.check_out > ?
      `).get(ds, ds).c;
      timelineEstadia.push({ fecha: ds, ocupadas: occE, pct: totalEstadia > 0 ? Math.round((occE / totalEstadia) * 100) : 0 });
      timelinePasadia.push({ fecha: ds, ocupadas: occP, pct: totalPasadia > 0 ? Math.round((occP / totalPasadia) * 100) : 0 });
    }

    // Historical stats filtered by period
    const histStats = db.prepare(`
      SELECT 
        COUNT(*) as total_reservas,
        SUM(noches) as total_noches,
        ROUND(SUM(monto_total), 2) as total_ingresos,
        COUNT(DISTINCT cliente || apellido) as total_clientes
      FROM reservas_hotel
      WHERE created_by = 'Cloudbeds Import' AND check_in >= ? AND check_in <= ?
        AND estado NOT IN ('Cancelada', 'No-Show')
    `).get(periodoDesde, periodoHasta);

    const histByType = db.prepare(`
      SELECT tipo_habitacion, COUNT(*) as reservas, ROUND(SUM(monto_total)) as ingresos
      FROM reservas_hotel
      WHERE created_by = 'Cloudbeds Import' AND check_in >= ? AND check_in <= ?
        AND estado NOT IN ('Cancelada', 'No-Show')
      GROUP BY tipo_habitacion ORDER BY ingresos DESC
    `).all(periodoDesde, periodoHasta);

    ok(res, {
      ocupacion: {
        total: totalEstadia + totalPasadia, ocupadas: nochesEstadia + nochesPasadia, porcentaje: (slotsEstadia + slotsPasadia) > 0 ? Math.round(((nochesEstadia + nochesPasadia) / (slotsEstadia + slotsPasadia)) * 100) : 0,
        estadia: { total: totalEstadia, ocupadas: nochesEstadia, pct: pctEstadia, dias: daysInPeriod },
        pasadia: { total: totalPasadia, ocupadas: nochesPasadia, pct: pctPasadia, dias: daysInPeriod },
      },
      hoy: { llegadas: llegadasHoy, salidas: salidasHoy, hospedados },
      financiero: { ingresos_periodo: Math.round(ingresosPeriodo * 100) / 100, saldo_pendiente_total: Math.round(saldoTotal * 100) / 100, reservas_periodo: reservasPeriodo, reservas_estadia: reservasEstadia, reservas_pasadia: reservasPasadia },
      limpieza: limpiezaStats,
      limpieza_estadia: limpiezaEstadia,
      limpieza_pasadia: limpiezaPasadia,
      recientes,
      status_distribucion: statusDist,
      timeline_estadia: timelineEstadia,
      timeline_pasadia: timelinePasadia,
      ingresos_por_plan: ingresosPorPlan,
      ocupacion_por_tipo: ocupacionPorTipo,
      historico: histStats,
      historico_por_tipo: histByType,
      periodo
    });
  } catch (e) { console.error(e); err(res, 'SERVER_ERROR', 'Error cargando dashboard', 500); }
});

// ══════════════════════════════════════
// DOCUMENTOS / ARCHIVOS
// ══════════════════════════════════════

// Upload document
router.post('/hotel/reservas/:id/documentos', requireAuth, requireOperations, upload.single('archivo'), validateUploadSignature, (req, res) => {
  try {
    if (!req.file) return err(res, 'VALIDATION_ERROR', 'Archivo requerido (JPEG, PNG, WebP, PDF, máx 10MB)');
    const reserva = findById('reservas_hotel', req.params.id);
    if (!reserva) return err(res, 'NOT_FOUND', 'Reserva no encontrada', 404);
    const db = getDb();
    const tipo = req.body.tipo || 'otro'; // cedula, pasaporte, recibo, otro
    db.prepare(`INSERT INTO documentos_reserva (reserva_id, tipo, nombre_original, nombre_archivo, mime_type, tamaño, notas, subido_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      req.params.id, tipo, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size,
      req.body.notas || '', req.user.nombre
    );
    const doc = db.prepare('SELECT * FROM documentos_reserva WHERE reserva_id = ? ORDER BY id DESC LIMIT 1').get(req.params.id);
    ok(res, doc, null, 201);
  } catch (e) { console.error(e); err(res, 'SERVER_ERROR', 'Error subiendo documento', 500); }
});

// List documents
router.get('/hotel/reservas/:id/documentos', requireAuth, requireOperations, (req, res) => {
  try {
    const db = getDb();
    const docs = db.prepare('SELECT * FROM documentos_reserva WHERE reserva_id = ? ORDER BY created_at DESC').all(req.params.id);
    ok(res, docs);
  } catch (e) { err(res, 'SERVER_ERROR', 'Error listando documentos', 500); }
});

// Guest documents require the standard active-user authentication check.
router.get('/hotel/documentos/:docId/archivo', requireAuth, requireOperations, (req, res) => {
  try {
    const db = getDb();
    const doc = db.prepare('SELECT * FROM documentos_reserva WHERE id = ?').get(req.params.docId);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });
    const filePath = path.join(UPLOADS_DIR, path.basename(doc.nombre_archivo));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.download(filePath, path.basename(doc.nombre_original));
  } catch (e) { res.status(500).json({ error: 'Error sirviendo archivo' }); }
});

// Delete document
router.delete('/hotel/documentos/:docId', requireAuth, requireOperations, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const doc = db.prepare('SELECT * FROM documentos_reserva WHERE id = ?').get(req.params.docId);
    if (!doc) return err(res, 'NOT_FOUND', 'Documento no encontrado', 404);
    // Delete file
    const filePath = path.join(UPLOADS_DIR, doc.nombre_archivo);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.prepare('DELETE FROM documentos_reserva WHERE id = ?').run(req.params.docId);
    ok(res, { deleted: true });
  } catch (e) { err(res, 'SERVER_ERROR', 'Error eliminando documento', 500); }
});

// ══════════════════════════════════════
// CONFIG
// ══════════════════════════════════════

router.get('/hotel/config', requireAuth, requireOperations, (req, res) => {
  try {
    const db = getDb();
    const config = db.prepare('SELECT * FROM config_hotel').all();
    const obj = {};
    for (const c of config) obj[c.clave] = c.valor;
    ok(res, obj);
  } catch (e) { err(res, 'SERVER_ERROR', 'Error obteniendo config', 500); }
});

// ══════════════════════════════════════
// FINANCIAL REPORTS
// ══════════════════════════════════════

router.get('/reportes/financiero', requireAuth, requireOperations, (req, res) => {
  try {
    const db = getDb();
    const { desde, hasta } = req.query;
    const d = desde || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const h = hasta || new Date().toISOString().split('T')[0];

    // 1. Reservations summary for period
    const reservas = db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN estado NOT IN ('Cancelada','No-Show') THEN 1 ELSE 0 END) as activas,
        SUM(CASE WHEN estado = 'Cancelada' THEN 1 ELSE 0 END) as canceladas,
        SUM(CASE WHEN estado = 'Por Aprobar' THEN 1 ELSE 0 END) as por_aprobar,
        SUM(CASE WHEN estado IN ('Confirmada','Check-In','Hospedado','Check-Out') THEN monto_total ELSE 0 END) as revenue_total,
        SUM(CASE WHEN estado IN ('Confirmada','Check-In','Hospedado','Check-Out') THEN monto_pagado ELSE 0 END) as cobrado,
        SUM(CASE WHEN estado IN ('Confirmada','Check-In','Hospedado','Check-Out') THEN saldo_pendiente ELSE 0 END) as pendiente,
        AVG(CASE WHEN estado IN ('Confirmada','Check-In','Hospedado','Check-Out') THEN noches ELSE NULL END) as promedio_noches,
        AVG(CASE WHEN estado IN ('Confirmada','Check-In','Hospedado','Check-Out') THEN monto_total ELSE NULL END) as ticket_promedio
      FROM reservas_hotel WHERE check_in >= ? AND check_in <= ?
    `).get(d, h);

    // 2. Revenue by plan
    const byPlan = db.prepare(`
      SELECT plan_nombre as plan, COUNT(*) as reservas, SUM(monto_total) as revenue, SUM(monto_pagado) as cobrado
      FROM reservas_hotel
      WHERE estado NOT IN ('Cancelada','No-Show') AND check_in >= ? AND check_in <= ?
      GROUP BY plan_nombre ORDER BY revenue DESC
    `).all(d, h);

    // 3. Revenue by source (fuente)
    const byFuente = db.prepare(`
      SELECT fuente, COUNT(*) as reservas, SUM(monto_total) as revenue
      FROM reservas_hotel
      WHERE estado NOT IN ('Cancelada','No-Show') AND check_in >= ? AND check_in <= ?
      GROUP BY fuente ORDER BY revenue DESC
    `).all(d, h);

    // 4. Revenue by room type
    const byTipo = db.prepare(`
      SELECT tipo_habitacion as tipo, COUNT(*) as reservas, SUM(monto_total) as revenue
      FROM reservas_hotel
      WHERE estado NOT IN ('Cancelada','No-Show') AND check_in >= ? AND check_in <= ?
      GROUP BY tipo_habitacion ORDER BY revenue DESC
    `).all(d, h);

    // 5. Payments by method (from folio)
    const byMetodo = db.prepare(`
      SELECT COALESCE(f.metodo_pago, 'otro') as metodo, COUNT(*) as pagos, SUM(f.monto) as total
      FROM folio_hotel f
      JOIN reservas_hotel r ON f.reserva_id = r.id
      WHERE f.tipo = 'credito' AND f.fecha >= ? AND f.fecha <= ?
      GROUP BY f.metodo_pago ORDER BY total DESC
    `).all(d, h);

    // 6. Daily revenue
    const daily = db.prepare(`
      SELECT check_in as fecha, COUNT(*) as reservas, SUM(monto_total) as revenue
      FROM reservas_hotel
      WHERE estado NOT IN ('Cancelada','No-Show') AND check_in >= ? AND check_in <= ?
      GROUP BY check_in ORDER BY fecha
    `).all(d, h);

    // 7. Occupancy rate
    const totalRooms = db.prepare("SELECT COUNT(*) as c FROM habitaciones WHERE activa = 1 AND categoria = 'Estadía'").get().c;
    const daysInRange = Math.max(1, Math.ceil((new Date(h).getTime() - new Date(d).getTime()) / 86400000) + 1);
    const totalSlots = totalRooms * daysInRange;
    const occupiedNights = db.prepare(`
      SELECT COALESCE(SUM(noches), 0) as n FROM reservas_hotel
      WHERE estado NOT IN ('Cancelada','No-Show','Por Aprobar') AND check_in <= ? AND check_out >= ?
    `).get(h, d).n;
    const occupancy = totalSlots > 0 ? Math.round((occupiedNights / totalSlots) * 100) : 0;

    // 8. Recent payments
    const recentPayments = db.prepare(`
      SELECT f.id, f.concepto, f.monto, f.metodo_pago, f.fecha, f.registrado_por,
             r.cliente, r.apellido, r.id as reserva_id
      FROM folio_hotel f JOIN reservas_hotel r ON f.reserva_id = r.id
      WHERE f.tipo = 'credito' AND f.fecha >= ? AND f.fecha <= ?
      ORDER BY f.created_at DESC LIMIT 20
    `).all(d, h);

    // 9. Top pending balances
    const pendientes = db.prepare(`
      SELECT id, cliente, apellido, plan_nombre, monto_total, monto_pagado, saldo_pendiente, check_in, check_out
      FROM reservas_hotel
      WHERE saldo_pendiente > 0 AND estado NOT IN ('Cancelada','No-Show','Check-Out')
      ORDER BY saldo_pendiente DESC LIMIT 10
    `).all();

    ok(res, {
      periodo: { desde: d, hasta: h },
      resumen: { ...reservas, occupancy, total_rooms: totalRooms },
      por_plan: byPlan,
      por_fuente: byFuente,
      por_tipo_habitacion: byTipo,
      por_metodo_pago: byMetodo,
      diario: daily,
      pagos_recientes: recentPayments,
      saldos_pendientes: pendientes
    });
  } catch (e) { console.error('Report error:', e); err(res, 'SERVER_ERROR', 'Error generando reporte', 500); }
});

// ── NOTIFICACIONES DE RESERVAS Y REENVÍO ──

// Listar notificaciones de una reserva
router.get('/hotel/reservas/:id/notificaciones', requireAuth, requireOperations, (req, res) => {
  try {
    const db = getDb();
    const reserva = findById('reservas_hotel', req.params.id);
    if (!reserva) {
      return err(res, 'NOT_FOUND', 'Reserva no encontrada', 404);
    }
    const notifs = db.prepare('SELECT * FROM notificaciones_log WHERE reserva_id = ? ORDER BY created_at DESC').all(req.params.id);
    ok(res, notifs);
  } catch (e) {
    console.error(e);
    err(res, 'SERVER_ERROR', 'Error al listar notificaciones de la reserva', 500);
  }
});

// Reenviar notificación por ID
router.post('/hotel/notificaciones/:logId/reenviar', requireAuth, requireOperations, async (req, res) => {
  try {
    const db = getDb();
    const log = db.prepare('SELECT * FROM notificaciones_log WHERE id = ?').get(req.params.logId);
    if (!log) {
      return err(res, 'NOT_FOUND', 'Log de notificación no encontrado', 404);
    }

    if (!log.contenido || log.contenido.trim() === '') {
      return err(res, 'VALIDATION_ERROR', 'No se puede reenviar esta notificación porque su contenido está vacío (registro histórico previo a la actualización).', 400);
    }

    let result;
    if (log.canal === 'email') {
      let subject = 'Reenvío de Notificación — Hotel Panamá Canal';
      const reserva = findById('reservas_hotel', log.reserva_id);
      
      if (reserva) {
        if (log.tipo === 'confirmacion') {
          subject = `✅ Reserva Confirmada #${reserva.id} — Hotel Panamá Canal`;
        } else if (log.tipo.startsWith('estado')) {
          const statusLabels = {
            'Confirmada': 'Confirmada',
            'Hospedado': 'Check-In',
            'Check-Out': 'Check-Out',
            'Cancelada': 'Cancelada',
            'No-Show': 'No-Show'
          };
          const label = statusLabels[reserva.estado] || reserva.estado;
          const emojis = { 'Confirmada': '✅', 'Hospedado': '🏨', 'Check-Out': '👋', 'Cancelada': '❌', 'No-Show': '⚠️' };
          const emoji = emojis[reserva.estado] || '📋';
          subject = `${emoji} ${label} — Reserva #${reserva.id} — Hotel Panamá Canal`;
        } else if (log.tipo.startsWith('pago')) {
          subject = `💳 Pago Recibido — Reserva #${reserva.id}`;
        } else if (log.tipo.startsWith('recordatorio')) {
          subject = `📅 Recordatorio — Tu estadía es pronto — Hotel Panamá Canal`;
        }
      }
      
      result = await notifications.sendEmail(log.destinatario, subject, log.contenido);
      // Guardar el intento de reenvío
      notifications.logNotification(db, log.reserva_id, log.tipo + '_reenvio', 'email', log.destinatario, result, log.contenido);
    } else if (log.canal === 'whatsapp') {
      result = await notifications.sendWhatsApp(log.destinatario, log.contenido);
      notifications.logNotification(db, log.reserva_id, log.tipo + '_reenvio', 'whatsapp', log.destinatario, result, log.contenido);
    } else {
      return err(res, 'VALIDATION_ERROR', 'Canal desconocido', 400);
    }

    if (result && result.sent) {
      ok(res, { success: true, message: 'Notificación reenviada con éxito', result });
    } else {
      err(res, 'SERVER_ERROR', result?.reason || 'Error al reenviar la notificación', 500);
    }
  } catch (e) {
    console.error(e);
    err(res, 'SERVER_ERROR', 'Error al reenviar la notificación', 500);
  }
});

module.exports = router;
