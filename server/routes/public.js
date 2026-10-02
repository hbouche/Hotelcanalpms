const express = require('express');
const router = express.Router();
const { cardPaymentsEnabled, requireCardPayments } = require('../integration-policy');
router.use('/paypal', requireCardPayments);
const { getDb, findById, create } = require('../db/database');
const { calcNoches, calcReservationWithRates, getConfig } = require('../utils/calculations');
const { fireWebhooks } = require('../utils/webhooks');
const { upload, validateUploadSignature } = require('../utils/upload');
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

// Safe hotel display settings only; no private integration configuration.
router.get('/hotel-config', (req, res) => {
  const number = (key) => { const n = Number(getConfig(key)); return Number.isFinite(n) ? n : 0; };
  ok(res, { nombre_propiedad: getConfig('nombre_propiedad') || 'Hotel Panamá Canal',
    impuesto_turismo_pct: number('impuesto_turismo_pct'),
    deposito_sugerido_pct: number('deposito_sugerido_pct') });
});

// Public room type photos (for booking widget)
router.get('/tipo-fotos', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT clave, valor FROM config_hotel WHERE clave LIKE 'foto_tipo_%'").all();
    const fotos = {};
    for (const r of rows) { fotos[r.clave.replace('foto_tipo_', '')] = r.valor; }
    ok(res, fotos);
  } catch (e) { err(res, 'SERVER_ERROR', 'Error obteniendo fotos', 500); }
});

// Public availability — returns room TYPES (not IDs) with availability count
router.get('/disponibilidad', (req, res) => {
  try {
    const { check_in, check_out } = req.query;
    const categoria = req.query.categoria || 'Estadía';
    
    if (!check_in || !check_out) return err(res, 'VALIDATION_ERROR', 'check_in y check_out requeridos');
    
    if (categoria === 'Pasadía') {
      if (check_out < check_in) return err(res, 'VALIDATION_ERROR', 'check_out no puede ser anterior a check_in');
    } else {
      if (check_out <= check_in) return err(res, 'VALIDATION_ERROR', 'check_out debe ser posterior a check_in');
    }
    
    const db = getDb();
    // Get all active rooms filtering by category
    const rooms = db.prepare("SELECT id, tipo, categoria, capacidad_min, capacidad_max FROM habitaciones WHERE activa = 1 AND categoria = ?").all(categoria);
    
    // Get conflicting reservations depending on category
    let conflicts;
    if (categoria === 'Pasadía') {
      conflicts = db.prepare(`
        SELECT habitacion_id FROM reservas_hotel
        WHERE estado NOT IN ('Cancelada', 'No-Show', 'Check-Out')
          AND check_in <= ? AND check_out >= ?
      `).all(check_out, check_in).map(r => r.habitacion_id);
    } else {
      conflicts = db.prepare(`
        SELECT habitacion_id FROM reservas_hotel
        WHERE estado NOT IN ('Cancelada', 'No-Show', 'Check-Out')
          AND check_in < ? AND check_out > ?
      `).all(check_out, check_in).map(r => r.habitacion_id);
    }
    
    // Group by type
    const types = {};
    for (const room of rooms) {
      const available = !conflicts.includes(room.id);
      if (!types[room.tipo]) {
        types[room.tipo] = { tipo: room.tipo, categoria: room.categoria, capacidad_min: room.capacidad_min, capacidad_max: room.capacidad_max, total: 0, disponibles: 0 };
      }
      types[room.tipo].total++;
      if (available) types[room.tipo].disponibles++;
    }
    const result = Object.values(types).filter(t => t.disponibles > 0);
    ok(res, { check_in, check_out, tipos_disponibles: result });
  } catch (e) { console.error(e); err(res, 'SERVER_ERROR', 'Error verificando disponibilidad', 500); }
});

// Public plans — only visible_web=1
router.get('/planes', (req, res) => {
  try {
    const { tipo } = req.query; // optional room type filter
    const db = getDb();
    let plans = db.prepare("SELECT id, codigo, nombre, descripcion, categoria, precio_adulto_noche, precio_menor_noche, precio_mascota_noche, incluye, horario, extras_disponibles, tipos_aplicables, imagen FROM planes_tarifa WHERE activo = 1 AND visible_web = 1").all();
    // Filter by room type if provided
    if (tipo) {
      plans = plans.filter(p => {
        const tipos = safeJSON(p.tipos_aplicables);
        return tipos.length === 0 || tipos.includes(tipo);
      });
    }
    plans = plans.map(p => ({
      ...p,
      incluye: safeJSON(p.incluye),
      extras_disponibles: safeJSON(p.extras_disponibles),
      tipos_aplicables: safeJSON(p.tipos_aplicables)
    }));
    ok(res, plans);
  } catch (e) { err(res, 'SERVER_ERROR', 'Error listando planes', 500); }
});

// Public cotizar
router.get('/cotizar', (req, res) => {
  try {
    const { plan, adultos = 1, menores = 0, mascotas = 0, check_in, check_out } = req.query;
    if (!plan || !check_in || !check_out) return err(res, 'VALIDATION_ERROR', 'plan, check_in, check_out requeridos');
    const db = getDb();
    const planData = db.prepare('SELECT * FROM planes_tarifa WHERE codigo = ? AND activo = 1 AND visible_web = 1').get(plan);
    if (!planData) return err(res, 'NOT_FOUND', 'Plan no encontrado', 404);
    const noches = calcNoches(check_in, check_out);
    const totals = calcReservationWithRates(planData.id, check_in, check_out, +adultos, +menores, +mascotas);
    const depositoPct = Number(getConfig('deposito_sugerido_pct') ?? 0);
    ok(res, {
      plan: { codigo: planData.codigo, nombre: planData.nombre, descripcion: planData.descripcion },
      noches, adultos: +adultos, menores: +menores, mascotas: +mascotas,
      ...totals,
      deposito_pct: depositoPct,
      deposito_minimo: Math.round(totals.monto_total * (depositoPct / 100) * 100) / 100
    });
  } catch (e) { console.error(e); err(res, 'SERVER_ERROR', 'Error cotizando', 500); }
});

// PayPal config (public — only returns client_id and mode)
router.get('/paypal-config', (req, res) => {
  if (!cardPaymentsEnabled()) return ok(res, { paypal_enabled: false, paypal_client_id: null, paypal_mode: 'sandbox' });
  try {
    const clientId = getConfig('paypal_client_id') || process.env.PAYPAL_CLIENT_ID || '';
    const mode = getConfig('paypal_mode') || process.env.PAYPAL_MODE || 'sandbox';
    ok(res, { paypal_enabled: !!clientId, paypal_client_id: clientId || null, paypal_mode: mode });
  } catch (e) { err(res, 'SERVER_ERROR', 'Error config PayPal', 500); }
});

// PayPal create order (server-side)
router.post('/paypal/create-order', async (req, res) => {
  try {
    const { monto, descripcion } = req.body;
    if (!monto || monto <= 0) return err(res, 'VALIDATION_ERROR', 'monto requerido');
    const clientId = getConfig('paypal_client_id') || process.env.PAYPAL_CLIENT_ID;
    const secret = getConfig('paypal_secret') || process.env.PAYPAL_CLIENT_SECRET;
    const mode = getConfig('paypal_mode') || process.env.PAYPAL_MODE || 'sandbox';
    if (!clientId || !secret) return err(res, 'CONFIG_ERROR', 'PayPal no configurado');
    const baseUrl = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    
    // Get access token
    const authResp = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST', 
      headers: { 
        'Authorization': `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`, 
        'Content-Type': 'application/x-www-form-urlencoded' 
      },
      body: 'grant_type=client_credentials'
    });
    
    const authData = await authResp.json();
    if (!authResp.ok || !authData.access_token) {
      console.error('PayPal Auth Failure:', authData);
      const errMsg = authData.error_description || authData.error || 'Credenciales de PayPal inválidas o incorrectas.';
      return err(res, 'PAYPAL_ERROR', `Fallo de autenticación con PayPal: ${errMsg}`, 401);
    }
    
    // Create order
    const orderResp = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authData.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: 'USD', value: String(monto) }, description: descripcion || 'Reserva Hotel Panamá Canal' }]
      })
    });
    
    const order = await orderResp.json();
    if (!orderResp.ok) {
      console.error('PayPal Create Order Failure:', order);
      const errMsg = order.message || (order.details && order.details[0]?.description) || 'No se pudo generar la orden de cobro.';
      return err(res, 'PAYPAL_ERROR', `Error al crear orden en PayPal: ${errMsg}`, orderResp.status);
    }
    
    ok(res, { orderId: order.id, status: order.status });
  } catch (e) { 
    console.error('PayPal create-order error:', e); 
    err(res, 'SERVER_ERROR', 'Error interno al procesar orden de PayPal', 500); 
  }
});

// PayPal capture order
router.post('/paypal/capture-order', async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return err(res, 'VALIDATION_ERROR', 'orderId requerido');
    const clientId = getConfig('paypal_client_id') || process.env.PAYPAL_CLIENT_ID;
    const secret = getConfig('paypal_secret') || process.env.PAYPAL_CLIENT_SECRET;
    const mode = getConfig('paypal_mode') || process.env.PAYPAL_MODE || 'sandbox';
    if (!clientId || !secret) return err(res, 'CONFIG_ERROR', 'PayPal no configurado');
    const baseUrl = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    
    // Get access token
    const authResp = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST', 
      headers: { 
        'Authorization': `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`, 
        'Content-Type': 'application/x-www-form-urlencoded' 
      },
      body: 'grant_type=client_credentials'
    });
    
    const authData = await authResp.json();
    if (!authResp.ok || !authData.access_token) {
      console.error('PayPal Auth Failure on Capture:', authData);
      const errMsg = authData.error_description || authData.error || 'Credenciales de PayPal inválidas.';
      return err(res, 'PAYPAL_ERROR', `Fallo de autenticación con PayPal: ${errMsg}`, 401);
    }
    
    // Capture order
    const captureResp = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST', 
      headers: { 'Authorization': `Bearer ${authData.access_token}`, 'Content-Type': 'application/json' }
    });
    
    const capture = await captureResp.json();
    if (!captureResp.ok) {
      console.error('PayPal Capture Failure:', capture);
      const errMsg = capture.message || (capture.details && capture.details[0]?.description) || 'El pago no pudo ser capturado por PayPal.';
      return err(res, 'PAYPAL_ERROR', `Error al capturar pago en PayPal: ${errMsg}`, captureResp.status);
    }
    
    if (capture.status !== 'COMPLETED') {
      return err(res, 'PAYPAL_ERROR', `El pago no pudo completarse. Estado actual: ${capture.status}`, 400);
    }
    
    ok(res, { status: capture.status, orderId: capture.id, payer: capture.payer });
  } catch (e) { 
    console.error('PayPal capture error:', e); 
    err(res, 'SERVER_ERROR', 'Error interno al capturar pago de PayPal', 500); 
  }
});

// Public reservation creation (with PayPal or manual payment)
router.post('/reservar', (req, res) => {
  try {
    // Public requests cannot assert that money was received while card processing is disabled.
    if (!cardPaymentsEnabled()) Object.assign(req.body, { monto_pagado: 0, paypal_order_id: null, metodo_pago: 'al_cobro', referencia: '' });
    const { cliente, apellido, email, whatsapp, nacionalidad, check_in, check_out, tipo_habitacion, plan_codigo, adultos = 1, menores = 0, mascotas = 0, monto_pagado = 0, paypal_order_id, pago_tipo = 'deposito', metodo_pago, referencia } = req.body;
    // Validations
    const missing = [];
    if (!cliente) missing.push('cliente');
    if (!email) missing.push('email');
    if (!check_in) missing.push('check_in');
    if (!check_out) missing.push('check_out');
    if (!tipo_habitacion) missing.push('tipo_habitacion');
    if (!plan_codigo) missing.push('plan_codigo');
    if (missing.length) return err(res, 'VALIDATION_ERROR', `Campos requeridos: ${missing.join(', ')}`);

    const db = getDb();
    
    // Find rooms of the requested type to determine category
    const rooms = db.prepare("SELECT id, categoria FROM habitaciones WHERE tipo = ? AND activa = 1").all(tipo_habitacion);
    if (rooms.length === 0) return err(res, 'NOT_FOUND', 'Tipo de habitación no encontrado');
    const isPasadia = rooms[0].categoria === 'Pasadía';

    if (isPasadia) {
      if (check_out < check_in) return err(res, 'VALIDATION_ERROR', 'Check-out no puede ser anterior a check_in');
    } else {
      if (check_out <= check_in) return err(res, 'VALIDATION_ERROR', 'Check-out debe ser posterior a check_in');
    }

    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Panama' });
    if (check_in < todayStr) return err(res, 'VALIDATION_ERROR', 'No se puede reservar en fechas pasadas');

    const plan = db.prepare('SELECT * FROM planes_tarifa WHERE codigo = ? AND activo = 1 AND visible_web = 1').get(plan_codigo);
    if (!plan) return err(res, 'NOT_FOUND', 'Plan no disponible');

    // Validate plan room type applicability
    if (plan.tipos_aplicables) {
      try {
        const applicableTypes = JSON.parse(plan.tipos_aplicables);
        if (Array.isArray(applicableTypes) && applicableTypes.length > 0) {
          if (!applicableTypes.includes(tipo_habitacion)) {
            return err(res, 'VALIDATION_ERROR', `El plan ${plan.nombre} no se puede aplicar a habitaciones de tipo ${tipo_habitacion}. Tipos válidos: ${applicableTypes.join(', ')}`);
          }
        }
      } catch (e) {
        console.error('Error parsing plan.tipos_aplicables in public:', e);
      }
    }

    // Find conflicting reservations in DB depending on category
    const conflicts = isPasadia
      ? db.prepare(`
          SELECT habitacion_id FROM reservas_hotel
          WHERE estado NOT IN ('Cancelada', 'No-Show', 'Check-Out')
            AND check_in <= ? AND check_out >= ?
        `).all(check_out, check_in).map(r => r.habitacion_id)
      : db.prepare(`
          SELECT habitacion_id FROM reservas_hotel
          WHERE estado NOT IN ('Cancelada', 'No-Show', 'Check-Out')
            AND check_in < ? AND check_out > ?
        `).all(check_out, check_in).map(r => r.habitacion_id);

    const availableRoom = rooms.find(r => !conflicts.includes(r.id));
    if (!availableRoom) return err(res, 'NO_AVAILABILITY', 'No hay habitaciones disponibles para esas fechas');

    // Calculate totals
    const totals = calcReservationWithRates(plan.id, check_in, check_out, +adultos, +menores, +mascotas);
    const noches = calcNoches(check_in, check_out);
    const paidAmount = parseFloat(monto_pagado) || 0;

    const data = {
      cliente: sanitize(cliente), apellido: sanitize(apellido || ''), email: sanitize(email), whatsapp: sanitize(whatsapp || ''),
      telefono: '', nacionalidad: sanitize(nacionalidad || ''),
      habitacion_id: availableRoom.id, tipo_habitacion,
      check_in, check_out, noches, adultos: +adultos, menores: +menores, mascotas: +mascotas,
      plan_codigo, plan_nombre: plan.nombre,
      precio_adulto_noche: plan.precio_adulto_noche, precio_menor_noche: plan.precio_menor_noche, precio_mascota_noche: plan.precio_mascota_noche,
      subtotal: totals.subtotal, impuesto_pct: totals.impuesto_pct, impuesto_monto: totals.impuesto_monto,
      monto_total: totals.monto_total, deposito_sugerido: totals.deposito_sugerido,
      monto_pagado: paidAmount, saldo_pendiente: Math.round((totals.monto_total - paidAmount) * 100) / 100,
      estado: 'Pendiente', fuente: 'Website',
      metodo_pago: metodo_pago || (paypal_order_id ? 'paypal' : null),
      referencia: referencia || paypal_order_id || null,
      notas: metodo_pago ? `${metodo_pago.toUpperCase()} Ref: ${referencia || 'N/A'}` : (paypal_order_id ? `PayPal Order: ${paypal_order_id}` : ''),
      created_by: 'Web Booking'
    };

    const reserva = create('reservas_hotel', data);

    // Add folio entries
    if (totals.subtotal > 0) {
      db.prepare('INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, registrado_por) VALUES (?, ?, ?, ?, ?)').run(
        reserva.id, 'debito', `${plan.nombre} (${noches} noches)`, totals.subtotal, 'Web Booking');
    }
    if (totals.impuesto_monto > 0) {
      db.prepare('INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, registrado_por) VALUES (?, ?, ?, ?, ?)').run(
        reserva.id, 'debito', `Impuesto ${totals.impuesto_pct}%`, totals.impuesto_monto, 'Web Booking');
    }
    if (paidAmount > 0) {
      const finalMetodo = metodo_pago || 'paypal';
      const finalReferencia = referencia || paypal_order_id || '';
      db.prepare('INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, metodo_pago, referencia, registrado_por) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        reserva.id, 'credito', pago_tipo === 'total' ? 'Pago total (Website)' : 'Depósito (Website)',
        paidAmount, finalMetodo, finalReferencia, 'Web Booking');
    }

    // Fire webhook
    fireWebhooks('reserva.creada', { reserva_id: reserva.id, cliente, check_in, check_out, plan: plan.nombre, monto_total: totals.monto_total, monto_pagado: paidAmount, fuente: 'Website' });

    ok(res, { reserva_id: reserva.id, mensaje: 'Reserva recibida. Nuestro equipo la revisará y confirmaremos por email/WhatsApp.' }, null, 201);

    // Fire notifications for web booking (async)
    const fullReserva = findById('reservas_hotel', reserva.id);
    const hab = fullReserva.habitacion_id ? findById('habitaciones', fullReserva.habitacion_id) : null;
    
    notifications.notifyReservationConfirmed(fullReserva, hab).catch(e => console.log('Booking notif error:', e.message));
    notifications.notifyAdminNewBooking(fullReserva, hab).catch(e => console.log('Admin notif error:', e.message));
  } catch (e) { console.error('Public booking error:', e); err(res, 'SERVER_ERROR', 'Error creando reserva', 500); }
});

// Public upload of transaction receipt/comprobante
router.post('/reservas/:id/comprobante', upload.single('comprobante'), validateUploadSignature, (req, res) => {
  try {
    const providedEmail = ((req.query.email || req.body.email || '') + '').trim().toLowerCase();
    if (!providedEmail) {
      return err(res, 'UNAUTHORIZED', 'Email no proporcionado', 401);
    }

    const reserva = findById('reservas_hotel', req.params.id);
    if (!reserva) return err(res, 'NOT_FOUND', 'Reserva no encontrada', 404);
    
    const dbEmail = (reserva.email || '').trim().toLowerCase();
    if (dbEmail !== providedEmail) {
      return err(res, 'UNAUTHORIZED', 'Email no coincide con la reserva', 401);
    }

    if (!req.file) return err(res, 'VALIDATION_ERROR', 'Archivo requerido (JPEG, PNG, WebP, PDF, máx 10MB)');
    
    const db = getDb();
    const tipo = 'recibo';
    db.prepare(`INSERT INTO documentos_reserva (reserva_id, tipo, nombre_original, nombre_archivo, mime_type, tamaño, notas, subido_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      req.params.id, tipo, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size,
      req.body.notas || 'Comprobante subido por Huésped desde el Widget de Reservas.', 'Huésped Online'
    );
    const doc = db.prepare('SELECT * FROM documentos_reserva WHERE reserva_id = ? ORDER BY id DESC LIMIT 1').get(req.params.id);
    ok(res, doc, null, 201);
  } catch (e) {
    console.error('Error subiendo comprobante publico:', e);
    err(res, 'SERVER_ERROR', 'Error subiendo comprobante', 500);
  }
});

// Public multi-room reservation creation
router.post('/reservas/multi', upload.single('comprobante'), validateUploadSignature, (req, res) => {
  let body = req.body;
  
  // If request was sent as multipart/form-data with a JSON payload string in 'datos'
  if (req.body && req.body.datos && typeof req.body.datos === 'string') {
    try {
      body = JSON.parse(req.body.datos);
    } catch (e) {
      return err(res, 'VALIDATION_ERROR', 'Error parseando campo datos como JSON');
    }
  }

  if (!cardPaymentsEnabled()) Object.assign(body, { monto_pagado: 0, paypal_order_id: null, metodo_pago: 'al_cobro', referencia: '' });

  const {
    cliente,
    apellido,
    email,
    whatsapp,
    nacionalidad,
    metodo_pago,
    referencia,
    paypal_order_id,
    pago_tipo = 'deposito',
    monto_pagado = 0,
    check_in: top_check_in,
    check_out: top_check_out
  } = body;

  const rooms = body.rooms;

  // Validations
  const missing = [];
  if (!cliente) missing.push('cliente');
  if (!email) missing.push('email');
  if (!rooms || !Array.isArray(rooms) || rooms.length === 0) missing.push('rooms');
  if (missing.length) return err(res, 'VALIDATION_ERROR', `Campos requeridos: ${missing.join(', ')}`);

  const db = getDb();

  // Generate a unique group code: e.g. G-XXXX
  const grupo_codigo = `G-${Math.floor(100000 + Math.random() * 900000)}`;

  // We will run this inside a transaction!
  const transaction = db.transaction(() => {
    const createdReservations = [];
    let aggregatedSubtotal = 0;
    let aggregatedImpuesto = 0;
    let aggregatedTotal = 0;
    
    // Track blocked/selected room IDs inside the transaction to prevent booking the same room ID in multiple parts of the same request
    const bookedRoomIdsThisRequest = [];

    for (let index = 0; index < rooms.length; index++) {
      const roomReq = rooms[index];
      const check_in = roomReq.check_in || top_check_in;
      const check_out = roomReq.check_out || top_check_out;
      const tipo_habitacion = roomReq.tipo_habitacion;
      const plan_codigo = roomReq.plan_codigo;
      const adultos = roomReq.adultos !== undefined ? +roomReq.adultos : 1;
      const menores = roomReq.menores !== undefined ? +roomReq.menores : 0;
      const mascotas = roomReq.mascotas !== undefined ? +roomReq.mascotas : 0;

      if (!tipo_habitacion) {
        throw new Error(`tipo_habitacion es requerido para la habitación en el índice ${index}`);
      }
      
      const activeRooms = db.prepare("SELECT id, categoria FROM habitaciones WHERE tipo = ? AND activa = 1").all(tipo_habitacion);
      if (activeRooms.length === 0) {
        throw new Error(`Tipo de habitación ${tipo_habitacion} no encontrado para la habitación en el índice ${index}`);
      }
      
      const isPasadia = activeRooms[0].categoria === 'Pasadía';

      if (isPasadia) {
        if (check_out < check_in) {
          throw new Error(`check_out no puede ser anterior a check_in para la habitación en el índice ${index}`);
        }
      } else {
        if (check_out <= check_in) {
          throw new Error(`check_out debe ser posterior a check_in para la habitación en el índice ${index}`);
        }
      }
      
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Panama' });
      if (check_in < todayStr) {
        throw new Error(`No se puede reservar en fechas pasadas para la habitación en el índice ${index}`);
      }
      if (!plan_codigo) {
        throw new Error(`plan_codigo es requerido para la habitación en el índice ${index}`);
      }

      const plan = db.prepare('SELECT * FROM planes_tarifa WHERE codigo = ? AND activo = 1 AND visible_web = 1').get(plan_codigo);
      if (!plan) {
        throw new Error(`Plan ${plan_codigo} no disponible`);
      }

      // Validate plan room type applicability
      if (plan.tipos_aplicables) {
        try {
          const applicableTypes = JSON.parse(plan.tipos_aplicables);
          if (Array.isArray(applicableTypes) && applicableTypes.length > 0) {
            if (!applicableTypes.includes(tipo_habitacion)) {
              throw new Error(`El plan ${plan.nombre} no se puede aplicar a habitaciones de tipo ${tipo_habitacion}`);
            }
          }
        } catch (e) {
          console.error('Error parsing plan.tipos_aplicables in multi-room:', e);
        }
      }

      // Find conflicting reservations in DB depending on category
      const conflicts = isPasadia
        ? db.prepare(`
            SELECT habitacion_id FROM reservas_hotel
            WHERE estado NOT IN ('Cancelada', 'No-Show', 'Check-Out')
              AND check_in <= ? AND check_out >= ?
          `).all(check_out, check_in).map(r => r.habitacion_id)
        : db.prepare(`
            SELECT habitacion_id FROM reservas_hotel
            WHERE estado NOT IN ('Cancelada', 'No-Show', 'Check-Out')
              AND check_in < ? AND check_out > ?
          `).all(check_out, check_in).map(r => r.habitacion_id);

      // Also filter out any rooms already booked inside THIS multi-room transaction
      const availableRoom = activeRooms.find(r => !conflicts.includes(r.id) && !bookedRoomIdsThisRequest.includes(r.id));
      
      if (!availableRoom) {
        throw new Error(`No hay habitaciones disponibles de tipo ${tipo_habitacion} para las fechas ${check_in} a ${check_out}`);
      }

      bookedRoomIdsThisRequest.push(availableRoom.id);

      // Calculate totals
      const totals = calcReservationWithRates(plan.id, check_in, check_out, adultos, menores, mascotas);
      const noches = calcNoches(check_in, check_out);

      // Associate full paid amount to the first booking in group
      const paidAmount = index === 0 ? (parseFloat(monto_pagado) || 0) : 0;

      const data = {
        cliente: sanitize(cliente),
        apellido: sanitize(apellido || ''),
        email: sanitize(email),
        whatsapp: sanitize(whatsapp || ''),
        telefono: '',
        nacionalidad: sanitize(nacionalidad || ''),
        habitacion_id: availableRoom.id,
        tipo_habitacion,
        check_in,
        check_out,
        noches,
        adultos,
        menores,
        mascotas,
        plan_codigo,
        plan_nombre: plan.nombre,
        precio_adulto_noche: plan.precio_adulto_noche,
        precio_menor_noche: plan.precio_menor_noche,
        precio_mascota_noche: plan.precio_mascota_noche,
        subtotal: totals.subtotal,
        impuesto_pct: totals.impuesto_pct,
        impuesto_monto: totals.impuesto_monto,
        monto_total: totals.monto_total,
        deposito_sugerido: totals.deposito_sugerido,
        monto_pagado: paidAmount,
        saldo_pendiente: Math.round((totals.monto_total - paidAmount) * 100) / 100,
        estado: 'Pendiente',
        fuente: 'Website',
        metodo_pago: metodo_pago || (paypal_order_id ? 'paypal' : null),
        referencia: referencia || paypal_order_id || null,
        notas: metodo_pago ? `${metodo_pago.toUpperCase()} Ref: ${referencia || 'N/A'}` : (paypal_order_id ? `PayPal Order: ${paypal_order_id}` : ''),
        created_by: 'Web Booking',
        grupo_codigo,
        es_maestra: index === 0 ? 1 : 0
      };

      const reserva = create('reservas_hotel', data);

      // Add folio entries
      if (totals.subtotal > 0) {
        db.prepare('INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, registrado_por) VALUES (?, ?, ?, ?, ?)').run(
          reserva.id, 'debito', `${plan.nombre} (${noches} noches)`, totals.subtotal, 'Web Booking');
      }
      if (totals.impuesto_monto > 0) {
        db.prepare('INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, registrado_por) VALUES (?, ?, ?, ?, ?)').run(
          reserva.id, 'debito', `Impuesto ${totals.impuesto_pct}%`, totals.impuesto_monto, 'Web Booking');
      }
      if (paidAmount > 0) {
        const finalMetodo = metodo_pago || 'paypal';
        const finalReferencia = referencia || paypal_order_id || '';
        db.prepare('INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, metodo_pago, referencia, registrado_por) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
          reserva.id, 'credito', pago_tipo === 'total' ? 'Pago total (Website)' : 'Depósito (Website)',
          paidAmount, finalMetodo, finalReferencia, 'Web Booking');
      }

      aggregatedSubtotal += totals.subtotal;
      aggregatedImpuesto += totals.impuesto_monto;
      aggregatedTotal += totals.monto_total;

      createdReservations.push({
        id: reserva.id,
        check_in,
        check_out,
        tipo_habitacion,
        plan_nombre: plan.nombre,
        monto_total: totals.monto_total
      });
    }

    return {
      createdReservations,
      aggregatedSubtotal,
      aggregatedImpuesto,
      aggregatedTotal
    };
  });

  try {
    const result = transaction();

    // If there is an uploaded receipt file (comprobante), attach it to the FIRST reservation in the group!
    if (req.file) {
      try {
        const firstRes = result.createdReservations[0];
        const tipo = 'recibo';
        db.prepare(`INSERT INTO documentos_reserva (reserva_id, tipo, nombre_original, nombre_archivo, mime_type, tamaño, notas, subido_por)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          firstRes.id, tipo, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size,
          body.notas || 'Comprobante de reserva multi-habitación subido por Huésped desde el Widget.', 'Huésped Online'
        );
      } catch (uploadErr) {
        console.error('Error attaching comprobante to first reservation:', uploadErr.message);
      }
    }

    // Fire webhooks and notifications for each booking created
    for (const item of result.createdReservations) {
      fireWebhooks('reserva.creada', {
        reserva_id: item.id,
        cliente,
        check_in: item.check_in,
        check_out: item.check_out,
        plan: item.plan_nombre,
        monto_total: item.monto_total,
        monto_pagado: item.monto_total === result.createdReservations[0].monto_total ? (parseFloat(monto_pagado) || 0) : 0,
        fuente: 'Website',
        grupo_codigo
      });

      // Async notifications
      const fullReserva = findById('reservas_hotel', item.id);
      const hab = fullReserva.habitacion_id ? findById('habitaciones', fullReserva.habitacion_id) : null;
      notifications.notifyReservationConfirmed(fullReserva, hab).catch(e => console.log('Booking notif error:', e.message));
      notifications.notifyAdminNewBooking(fullReserva, hab).catch(e => console.log('Admin notif error:', e.message));
    }

    ok(res, {
      success: true,
      grupo_codigo,
      reservas: result.createdReservations,
      reserva_id: result.createdReservations[0].id,
      totales: {
        subtotal: result.aggregatedSubtotal,
        impuesto: result.aggregatedImpuesto,
        total: result.aggregatedTotal
      },
      mensaje: `¡Reserva grupal ${grupo_codigo} recibida con éxito! Nuestro equipo la revisará y confirmaremos por email/WhatsApp.`
    }, null, 201);

  } catch (error) {
    console.error('Multi-room booking transaction aborted:', error.message);
    return err(res, 'NO_AVAILABILITY', error.message);
  }
});

module.exports = router;
