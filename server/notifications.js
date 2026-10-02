const { integrationsEnabled } = require('./integration-policy');
/**
 * 📧📱 NOTIFICATION MODULE — Hotel Panamá Canal PMS
 * 
 * Handles email (Nodemailer/SMTP) and WhatsApp (API) notifications.
 * Configure via environment variables:
 * 
 * EMAIL:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *   
 * WHATSAPP (WhatsApp Business API / Twilio):
 *   WA_API_URL, WA_API_TOKEN, WA_FROM_NUMBER
 *   
 * GENERAL:
 *   HOTEL_NAME (default: Hotel Panamá Canal)
 *   HOTEL_URL  (default: https://example.invalid)
 *   NOTIFICATIONS_ENABLED (default: false — set to 'true' to activate)
 */

const nodemailer = require('nodemailer');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { getDb } = require('./db/database');

// ── Configuration ──
const HOTEL_NAME = process.env.HOTEL_NAME || 'Hotel Panamá Canal';
const HOTEL_URL = process.env.HOTEL_URL || '';
const HOTEL_PHONE = process.env.HOTEL_PHONE || '';
const HOTEL_EMAIL_DISPLAY = process.env.HOTEL_EMAIL_DISPLAY || '';

function getSystemConfig(dbInstance) {
  const d = dbInstance || getDb();
  try {
    return d.prepare('SELECT * FROM configuracion_sistema WHERE id = 1').get() || {};
  } catch (err) {
    console.error('⚠️ Failed to get system config from DB:', err.message);
    return {};
  }
}

// ── SMTP Transporter (dynamic dynamic init) ──
let transporter = null;

function getTransporter() {
  if (!integrationsEnabled()) return null;
  const config = getSystemConfig();
  const host = config.smtp_host;
  const port = parseInt(config.smtp_port || '587');
  const user = config.smtp_user;
  const pass = config.smtp_pass;
  
  if (!host || !user || !pass) {
    console.log('📧 Email not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS)');
    return null;
  }
  
  // If credentials changed or transporter doesn't exist, create a new one
  if (!transporter || 
      transporter.options.host !== host || 
      transporter.options.port !== port || 
      transporter.options.auth.user !== user || 
      transporter.options.auth.pass !== pass) {
    
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    
    transporter.verify().then(() => {
      console.log('📧 SMTP connected successfully (dynamic)');
    }).catch(err => {
      console.log('📧 SMTP connection failed:', err.message);
      transporter = null;
    });
  }
  
  return transporter;
}

// ── WhatsApp Helper ──
function sendWhatsApp(phone, message) {
  if (!integrationsEnabled()) return Promise.resolve({ sent: false, reason: 'disabled' });
  return new Promise((resolve, reject) => {
    const config = getSystemConfig();
    const apiUrl = config.wa_api_url;
    const token = config.wa_api_token;
    const fromNumber = config.wa_from_number;
    const waEnabled = config.wa_enabled === 1;
    
    if (!waEnabled) {
      return resolve({ sent: false, reason: 'disabled' });
    }
    
    if (!apiUrl || !token) {
      console.log('📱 WhatsApp not configured (set WA_API_URL, WA_API_TOKEN)');
      return resolve({ sent: false, reason: 'not_configured' });
    }
    
    // Normalize phone
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    if (!cleanPhone || cleanPhone.length < 8) {
      return resolve({ sent: false, reason: 'invalid_phone' });
    }
    
    const payload = JSON.stringify({
      messaging_product: 'whatsapp',
      to: cleanPhone,
      type: 'text',
      text: { body: message }
    });
    
    const url = new URL(apiUrl);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(payload),
      }
    };
    
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ sent: res.statusCode < 300, statusCode: res.statusCode, response: data });
      });
    });
    req.on('error', (e) => resolve({ sent: false, reason: e.message }));
    req.write(payload);
    req.end();
  });
}

// ── Email Templates ──

function baseTemplate(content, preheader = '', config = null) {
  const cfg = config || getSystemConfig();
  const hotelName = HOTEL_NAME;
  const hotelPhone = cfg.hotel_telefono || HOTEL_PHONE;
  const hotelEmail = cfg.smtp_from || HOTEL_EMAIL_DISPLAY;
  const hotelUrl = HOTEL_URL;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; background: #f4f1eb; margin: 0; padding: 0; }
  .container { max-width: 600px; margin: 0 auto; }
  .header { background: linear-gradient(135deg, #d4a853 0%, #c4943f 100%); padding: 32px 24px; text-align: center; }
  .header h1 { color: white; margin: 0; font-size: 28px; letter-spacing: 1px; }
  .header p { color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px; }
  .body { background: white; padding: 32px 24px; }
  .body h2 { color: #2d3748; margin: 0 0 16px; font-size: 22px; }
  .detail-table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  .detail-table td { padding: 10px 12px; border-bottom: 1px solid #f0ece4; font-size: 14px; }
  .detail-table td:first-child { color: #718096; width: 140px; }
  .detail-table td:last-child { color: #2d3748; font-weight: 500; }
  .highlight { background: #faf8f4; border-radius: 12px; padding: 20px; margin: 20px 0; border-left: 4px solid #d4a853; }
  .highlight .amount { font-size: 28px; font-weight: 700; color: #2d3748; }
  .highlight .label { font-size: 13px; color: #718096; margin-top: 4px; }
  .btn { display: inline-block; background: #d4a853; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 16px 0; }
  .btn:hover { background: #c4943f; }
  .footer { text-align: center; padding: 24px; color: #a0aec0; font-size: 12px; }
  .footer a { color: #d4a853; }
  .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
  .badge-green { background: #e6f9ed; color: #22863a; }
  .badge-blue { background: #e3f2fd; color: #1565c0; }
  .badge-amber { background: #fff8e1; color: #e65100; }
</style></head><body>
<div style="display:none;font-size:1px;color:#f4f1eb;line-height:1px;max-height:0;overflow:hidden;">${preheader}</div>
<div class="container">
  <div class="header">
    <h1>🏨 ${hotelName}</h1>
    <p>Playa, Naturaleza y Aventura</p>
  </div>
  <div class="body">${content}</div>
  <div class="footer">
    <p>${hotelName} • ${cfg.hotel_direccion || 'Por configurar'}</p>
    <p>📞 ${hotelPhone} • 📧 ${hotelEmail}</p>
    <p><a href="${hotelUrl}">${hotelUrl}</a></p>
  </div>
</div></body></html>`;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('es-PA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return dateStr; }
}

function formatMoney(amount) {
  return '$' + (amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Notification Functions ──

// Helper: robust regex-based template variable substitution
function renderTemplate(templateBody, context) {
  if (!templateBody) return '';
  return templateBody.replace(/\{\{([a-zA-Z0-9_\-]+)\}\}/g, (match, p1) => {
    return context.hasOwnProperty(p1) ? (context[p1] !== null && context[p1] !== undefined ? context[p1] : '') : match;
  });
}

// Helper: load template from database or fall back to defaults, then render
function renderNotification(codigo, context, fallbackSubject, fallbackBody, canal) {
  const db = getDb();
  let template = null;
  try {
    template = db.prepare('SELECT asunto, contenido FROM notificaciones_plantillas WHERE codigo = ? AND canal = ?').get(codigo, canal);
  } catch (err) {
    console.error(`⚠️ Failed to load template ${codigo}/${canal} from DB, using fallback:`, err.message);
  }

  const subjectTemplate = template?.asunto || fallbackSubject;
  const bodyTemplate = template?.contenido || fallbackBody;

  const subject = subjectTemplate ? renderTemplate(subjectTemplate, context) : null;
  const body = renderTemplate(bodyTemplate, context);

  return { subject, body };
}

// Helper: build a unified rich variable context for template rendering
function buildTemplateContext(reserva, habitacion, extra = {}) {
  const guestName = `${reserva.cliente} ${reserva.apellido || ''}`.trim();
  const roomName = habitacion?.nombre || reserva.tipo_habitacion || '-';
  const config = getSystemConfig();
  
  return {
    id: reserva.id,
    cliente: reserva.cliente || '',
    apellido: reserva.apellido || '',
    cliente_nombre_completo: guestName,
    email: reserva.email || '',
    telefono: reserva.telefono || '',
    whatsapp: reserva.whatsapp || '',
    check_in: reserva.check_in || '',
    check_out: reserva.check_out || '',
    check_in_formateado: formatDate(reserva.check_in),
    check_out_formateado: formatDate(reserva.check_out),
    noches: reserva.noches || 0,
    hora_llegada: reserva.hora_llegada || '',
    adultos: reserva.adultos || 0,
    menores: reserva.menores || 0,
    mascotas: reserva.mascotas || 0,
    habitacion: roomName,
    plan: reserva.plan_nombre || 'Estándar',
    plan_codigo: reserva.plan_codigo || '',
    subtotal: formatMoney(reserva.subtotal),
    impuesto_monto: formatMoney(reserva.impuesto_monto),
    monto_total: formatMoney(reserva.monto_total),
    monto_pagado: formatMoney(reserva.monto_pagado),
    saldo_pendiente: formatMoney(reserva.saldo_pendiente),
    fuente: reserva.fuente || 'Teléfono',
    notas: reserva.notas || '-',
    // Hotel info
    hotel_nombre: config.nombre_propiedad || HOTEL_NAME,
    hotel_url: HOTEL_URL,
    hotel_telefono: config.hotel_telefono || HOTEL_PHONE,
    hotel_correo: config.smtp_from || HOTEL_EMAIL_DISPLAY,
    hotel_politica_cancelacion: config.hotel_politica_cancelacion || '',
    hotel_politica_reembolso: config.hotel_politica_reembolso || '',
    hotel_direccion: config.hotel_direccion || 'Por configurar',
    ...extra
  };
}

/**
 * 1. RESERVATION CONFIRMED — sent when a new reservation is created or confirmed
 */
async function notifyReservationConfirmed(reserva, habitacion) {
  const config = getSystemConfig();
  const emailEnabled = config.notifications_enabled === 1;
  const waEnabled = config.wa_enabled === 1;
  if (!emailEnabled && !waEnabled) return { email: false, whatsapp: false };
  const results = { email: false, whatsapp: false };
  
  const context = buildTemplateContext(reserva, habitacion);
  const db = getDb();
  const isPending = reserva.estado === 'Pendiente';
  const tipo = isPending ? 'recibida' : 'confirmacion';
  const codigo = isPending ? 'recibida' : 'confirmacion';

  // EMAIL
  if (reserva.email && emailEnabled) {
    let fallbackSubject, fallbackBody;
    if (isPending) {
      fallbackSubject = `⏳ Solicitud de Reserva Recibida #${reserva.id} — ${context.hotel_nombre}`;
      fallbackBody = `<h2>⏳ Solicitud de Reserva Recibida</h2>
<p style="color:#4a5568;">Hola <strong>` + context.cliente_nombre_completo + `</strong>, hemos recibido con éxito su solicitud de reserva.</p>
<p style="color:#b45309;font-weight:bold;margin-top:16px;">⚠️ Nota Importante sobre su Reserva:</p>
<p style="color:#4a5568;line-height:1.6;font-size:14px;background-color:#fffbeb;border:1px solid #fef3c7;padding:12px;border-radius:8px;">
  Para garantizar la seguridad de su estadía, toda reserva en Hotel Panamá Canal requiere de una <strong>revisión y aprobación manual</strong> por nuestro equipo. 
  El procesamiento del pago seguro o la carga de su comprobante de transferencia inicia el trámite de su solicitud, pero <strong>no garantiza la reserva definitiva hasta recibir el correo electrónico oficial de aprobación de Hotel Panamá Canal.</strong>
</p>
<p style="color:#4a5568;margin-top:12px;">Nos comunicaremos con usted a la brevedad por WhatsApp o correo electrónico para validar sus datos y confirmar la reserva de manera oficial.</p>

<table class="detail-table" style="margin-top:16px;">
  <tr><td>📋 Solicitud</td><td>#` + reserva.id + `</td></tr>
  <tr><td>📊 Estado</td><td><span class="badge badge-amber" style="background-color:#fff3cd;color:#856404;padding:4px 8px;border-radius:4px;font-weight:bold;font-size:11px;">⏳ En Revisión</span></td></tr>
  <tr><td>📅 Check-in</td><td><strong>` + context.check_in_formateado + `</strong></td></tr>
  <tr><td>📅 Check-out</td><td><strong>` + context.check_out_formateado + `</strong></td></tr>
  <tr><td>🌙 Noches</td><td>` + reserva.noches + `</td></tr>
  <tr><td>🏠 Habitación</td><td>` + context.habitacion + `</td></tr>
  <tr><td>🍽️ Plan</td><td>` + context.plan + `</td></tr>
  <tr><td>👥 Huéspedes</td><td>` + reserva.adultos + ` adultos` + (reserva.menores ? ', ' + reserva.menores + ' menores' : '') + `</td></tr>
</table>

<div class="highlight" style="margin-top:16px;">
  <div class="amount">` + context.monto_total + `</div>
  <div class="label">Total Cotizado</div>
  ` + (reserva.monto_pagado > 0 ? `<div style="margin-top:8px;font-size:13px;color:#22863a;">Abonado: ` + context.monto_pagado + ` | Saldo Pendiente: ` + context.saldo_pendiente + `</div>` : '') + `
</div>

<p style="color:#a0aec0;font-size:12px;margin-top:20px;">Si tienes alguna duda o deseas corregir algún dato, contáctanos por WhatsApp al ` + context.hotel_telefono + `.</p>`;
    } else {
      fallbackSubject = `✅ Reserva Confirmada #${reserva.id} — ${context.hotel_nombre}`;
      fallbackBody = `<h2>✅ ¡Reserva Confirmada!</h2>
<p style="color:#4a5568;">Hola <strong>` + context.cliente_nombre_completo + `</strong>, tu reserva ha sido confirmada. ¡Te esperamos!</p>

<table class="detail-table">
  <tr><td>📋 Reserva</td><td>#` + reserva.id + `</td></tr>
  <tr><td>📅 Check-in</td><td><strong>` + context.check_in_formateado + `</strong></td></tr>
  <tr><td>📅 Check-out</td><td><strong>` + context.check_out_formateado + `</strong></td></tr>
  <tr><td>🌙 Noches</td><td>` + reserva.noches + `</td></tr>
  <tr><td>🏠 Habitación</td><td>` + context.habitacion + `</td></tr>
  <tr><td>🍽️ Plan</td><td>` + context.plan + `</td></tr>
  <tr><td>👥 Huéspedes</td><td>` + reserva.adultos + ` adultos` + (reserva.menores ? ', ' + reserva.menores + ' menores' : '') + `</td></tr>
</table>

<div class="highlight">
  <div class="amount">` + context.monto_total + `</div>
  <div class="label">Total de tu estadía</div>
  ` + (reserva.monto_pagado > 0 ? `<div style="margin-top:8px;font-size:13px;color:#22863a;">✓ Pagado: ` + context.monto_pagado + ` | Saldo: ` + context.saldo_pendiente + `</div>` : '') + `
</div>

<p style="color:#718096;font-size:14px;">
  <strong>Check-in:</strong> A partir de las 2:00 PM<br>
  <strong>Check-out:</strong> Antes de las 12:00 PM<br>
  <strong>Dirección:</strong> ` + context.hotel_direccion + `
</p>

<p style="text-align:center;">
  <a href="` + HOTEL_URL + `" class="btn">Ver Detalles</a>
</p>

<p style="color:#a0aec0;font-size:12px;">Si necesitas hacer cambios, contáctanos por WhatsApp al ` + context.hotel_telefono + ` o responde a este correo.</p>`;
    }
      
    const rendered = renderNotification(codigo, context, fallbackSubject, fallbackBody, 'email');
    const previewText = isPending 
      ? `Tu solicitud de reserva #${reserva.id} en ${context.hotel_nombre} está en proceso de revisión`
      : `Tu reserva #${reserva.id} en ${context.hotel_nombre} está confirmada`;
    const finalHtml = baseTemplate(rendered.body, previewText, config);
    
    results.email = await sendEmail(reserva.email, rendered.subject, finalHtml);
    logNotification(db, reserva.id, tipo, 'email', reserva.email, results.email, finalHtml);
  }
  
  // WHATSAPP
  if ((reserva.whatsapp || reserva.telefono) && waEnabled) {
    let fallbackMsg;
    if (isPending) {
      fallbackMsg = `⏳ *Solicitud de Reserva Recibida* — ` + context.hotel_nombre + `\n\n` +
        `Hola ` + context.cliente_nombre_completo + ` 👋\n\n` +
        `Hemos recibido tu solicitud de reserva #` + reserva.id + ` para el período de ` + reserva.check_in + ` a ` + reserva.check_out + `.\n\n` +
        `⚠️ *Nota importante:* Tu reserva se encuentra *pendiente de aprobación manual*. Nos comunicaremos contigo a la brevedad por este medio para validar tus datos y confirmar la reserva de manera oficial. El procesamiento de pago seguro o la carga de tu comprobante inicia el trámite de revisión, pero la confirmación definitiva requiere nuestra aprobación oficial.\n\n` +
        `💰 Total cotizado: ` + context.monto_total + `\n\n` +
        `¡Gracias por tu paciencia! 🌊🌴`;
    } else {
      fallbackMsg = `✅ *Reserva Confirmada* — ` + context.hotel_nombre + `\n\n` +
        `Hola ` + context.cliente_nombre_completo + ` 👋\n\n` +
        `Tu reserva ha sido confirmada:\n` +
        `📋 #` + reserva.id + `\n` +
        `📅 ` + reserva.check_in + ` → ` + reserva.check_out + ` (` + reserva.noches + ` noches)\n` +
        `🏠 ` + context.habitacion + `\n` +
        `💰 Total: ` + context.monto_total + `\n\n` +
        `Check-in: 2:00 PM\nCheck-out: 12:00 PM\n\n` +
        `¡Te esperamos! 🌊🌴`;
    }
      
    const rendered = renderNotification(codigo, context, null, fallbackMsg, 'whatsapp');
    results.whatsapp = await sendWhatsApp(reserva.whatsapp || reserva.telefono, rendered.body);
    logNotification(db, reserva.id, tipo, 'whatsapp', reserva.whatsapp || reserva.telefono, results.whatsapp, rendered.body);
  }
  
  return results;
}

async function notifyStatusChange(reserva, oldStatus, newStatus, habitacion) {
  const config = getSystemConfig();
  const emailEnabled = config.notifications_enabled === 1;
  const waEnabled = config.wa_enabled === 1;
  if (!emailEnabled && !waEnabled) return { email: false, whatsapp: false };
  const results = { email: false, whatsapp: false };
  
  const context = buildTemplateContext(reserva, habitacion);
  const db = getDb();
  
  const isRejectedRequest = newStatus === 'Cancelada' && oldStatus === 'Pendiente';
  
  const statusConfig = {
    'Confirmada': { emoji: '✅', badge: 'badge-green', label: 'Confirmada', msg: 'Tu reserva ha sido confirmada.' },
    'Hospedado': { emoji: '🏨', badge: 'badge-green', label: 'Check-In', msg: '¡Bienvenido! Tu check-in ha sido registrado.' },
    'Check-Out': { emoji: '👋', badge: 'badge-blue', label: 'Check-Out', msg: 'Esperamos que hayas disfrutado tu estadía.' },
    'Cancelada': { 
      emoji: '❌', 
      badge: 'badge-amber', 
      label: isRejectedRequest ? 'Solicitud No Aprobada' : 'Cancelada', 
      msg: isRejectedRequest 
        ? 'agradecemos tu interés en hospedarte con nosotros. Lamentablemente, tu solicitud de reserva no pudo ser aprobada en esta ocasión debido a limitaciones de disponibilidad o políticas de capacidad.' 
        : 'Tu reserva ha sido cancelada.' 
    },
    'No-Show': { emoji: '⚠️', badge: 'badge-amber', label: 'No-Show', msg: 'Tu reserva fue marcada como No-Show.' },
  };
  
  const configObj = statusConfig[newStatus] || { emoji: '📋', badge: 'badge-blue', label: newStatus, msg: `Tu reserva cambió a ${newStatus}.` };
  
  let codigo = 'estado';
  if (newStatus === 'Confirmada') codigo = 'confirmacion';
  else if (newStatus === 'Hospedado') codigo = 'bienvenida';
  else if (newStatus === 'Check-Out') codigo = 'checkout';
  else if (isRejectedRequest) codigo = 'rechazo';

  // EMAIL
  if (reserva.email && emailEnabled) {
    let fallbackExtraContent = '';
    if (newStatus === 'Check-Out') {
      fallbackExtraContent = `
        <div class="highlight">
          <div class="amount">` + context.monto_total + `</div>
          <div class="label">Total de tu estadía</div>
          <div style="margin-top:8px;font-size:13px;color:` + (reserva.saldo_pendiente > 0 ? '#e53e3e' : '#22863a') + `;>
            Pagado: ` + context.monto_pagado + ` 
            ` + (reserva.saldo_pendiente > 0 ? `| <strong>Saldo pendiente: ` + context.saldo_pendiente + `</strong>` : '| ✓ Cuenta saldada') + `
          </div>
        </div>
        <p style="color:#4a5568;font-size:14px;">🙏 ¡Gracias por hospedarte con nosotros! Esperamos verle pronto.</p>
        <p style="color:#718096;font-size:13px;">¿Disfrutaste tu estadía? Déjanos una reseña en Google o TripAdvisor. ⭐⭐⭐⭐⭐</p>`;
    } else if (newStatus === 'Hospedado') {
      fallbackExtraContent = `
        <p style="color:#4a5568;font-size:14px;">🎉 ¡Bienvenido a ` + context.hotel_nombre + `! Tu habitación <strong>` + context.habitacion + `</strong> está lista.</p>
        <p style="color:#718096;font-size:13px;">
          📶 WiFi: Hotel Panamá Canal Guest<br>
          🍽️ Restaurante: 7am - 10pm<br>
          🏖️ ¡Disfruta la playa!
        </p>`;
    } else if (isRejectedRequest) {
      fallbackExtraContent = `
        <div style="background-color:#fff5f5;border:1px solid #fed7d7;padding:12px;border-radius:8px;margin-top:16px;color:#c53030;font-size:13px;line-height:1.5;">
          <strong>Nota de Devolución:</strong> Lamentamos los inconvenientes. Si realizó algún pago seguro en línea o transferencia bancaria, nuestro equipo se pondrá en contacto con usted por WhatsApp de manera prioritaria para coordinar el reembolso inmediato y total de su dinero.
        </div>
        <p style="color:#718096;font-size:12px;margin-top:16px;">Si desea consultar disponibilidad para otras fechas, no dude en escribirnos directamente por WhatsApp al ` + context.hotel_telefono + `.</p>`;
    }
    
    const fallbackSubject = configObj.emoji + ` ` + configObj.label + ` — Reserva #` + reserva.id + ` — ` + context.hotel_nombre;
    const fallbackBody = `
      <h2>` + configObj.emoji + ` Reserva ` + configObj.label + `</h2>
      <p style="color:#4a5568;">Hola <strong>` + context.cliente_nombre_completo + `</strong>, ` + configObj.msg + `</p>
      
      <table class="detail-table">
        <tr><td>📋 Reserva</td><td>#` + reserva.id + `</td></tr>
        <tr><td>📊 Estado</td><td><span class="badge ` + configObj.badge + ` font-semibold" style="padding:4px 8px;border-radius:4px;font-size:11px;">` + configObj.emoji + ` ` + configObj.label + `</span></td></tr>
        <tr><td>📅 Check-in</td><td>` + context.check_in_formateado + `</td></tr>
        <tr><td>📅 Check-out</td><td>` + context.check_out_formateado + `</td></tr>
        <tr><td>🏠 Habitación</td><td>` + context.habitacion + `</td></tr>
      </table>
      ` + fallbackExtraContent;
      
    const rendered = renderNotification(codigo, context, fallbackSubject, fallbackBody, 'email');
    const finalHtml = baseTemplate(rendered.body, configObj.emoji + ` Reserva ` + configObj.label + ` #` + reserva.id + ` — ` + context.hotel_nombre, config);
    
    results.email = await sendEmail(reserva.email, rendered.subject, finalHtml);
    logNotification(db, reserva.id, codigo, 'email', reserva.email, results.email, finalHtml);
  }
  
  // WHATSAPP
  if ((reserva.whatsapp || reserva.telefono) && waEnabled) {
    let fallbackMsg = configObj.emoji + ` *` + configObj.label + `* — ` + context.hotel_nombre + `\n\nHola ` + context.cliente_nombre_completo + `, ` + configObj.msg + `\n\n📋 Reserva #` + reserva.id + `\n📅 ` + reserva.check_in + ` → ` + reserva.check_out + `\n🏠 ` + context.habitacion;
    if (newStatus === 'Check-Out' && reserva.saldo_pendiente > 0) {
      fallbackMsg += `\n\n💰 Saldo pendiente: ` + context.saldo_pendiente + `\nPor favor contáctanos para saldar tu cuenta.`;
    }
    if (newStatus === 'Check-Out') {
      fallbackMsg += '\n\n🙏 ¡Gracias por tu visita! Esperamos verte pronto. 🌊';
    }
    if (newStatus === 'Hospedado') {
      fallbackMsg += '\n\n🎉 ¡Bienvenido! Disfruta tu estadía. 🌴';
    }
    
    const rendered = renderNotification(codigo, context, null, fallbackMsg, 'whatsapp');
    results.whatsapp = await sendWhatsApp(reserva.whatsapp || reserva.telefono, rendered.body);
    logNotification(db, reserva.id, codigo, 'whatsapp', reserva.whatsapp || reserva.telefono, results.whatsapp, rendered.body);
  }
  
  return results;
}

async function notifyPaymentReceived(reserva, payment, habitacion) {
  const config = getSystemConfig();
  const emailEnabled = config.notifications_enabled === 1;
  const waEnabled = config.wa_enabled === 1;
  if (!emailEnabled && !waEnabled) return { email: false, whatsapp: false };
  const results = { email: false, whatsapp: false };
  
  const paymentExtras = {
    pago_monto: formatMoney(payment.monto),
    pago_concepto: payment.concepto || 'Pago',
    pago_metodo: payment.metodo_pago || 'N/D',
    pago_referencia: payment.referencia || '-',
    pago_fecha: payment.fecha || new Date().toISOString().split('T')[0]
  };
  
  const context = buildTemplateContext(reserva, habitacion, paymentExtras);
  const db = getDb();
  
  // EMAIL
  if (reserva.email && emailEnabled) {
    const fallbackSubject = `💳 Pago Recibido ` + context.pago_monto + ` — Reserva #` + reserva.id;
    const fallbackBody = `
      <h2>💳 Pago Registrado</h2>
      <p style="color:#4a5568;">Hola <strong>` + context.cliente_nombre_completo + `</strong>, hemos recibido tu pago. ¡Gracias!</p>
      
      <div class="highlight">
        <div class="amount" style="color:#22863a;">+ ` + context.pago_monto + `</div>
        <div class="label">` + context.pago_concepto + ` — ` + context.pago_metodo + `</div>
      </div>
      
      <table class="detail-table">
        <tr><td>📋 Reserva</td><td>#` + reserva.id + `</td></tr>
        <tr><td>🏠 Habitación</td><td>` + context.habitacion + `</td></tr>
        <tr><td>💰 Total estadía</td><td>` + context.monto_total + `</td></tr>
        <tr><td>✅ Total pagado</td><td style="color:#22863a;">` + context.monto_pagado + `</td></tr>
        <tr><td>📊 Saldo</td><td style="color:` + (reserva.saldo_pendiente > 0 ? '#e53e3e' : '#22863a') + `;">
          ` + (reserva.saldo_pendiente > 0 ? context.saldo_pendiente : '✓ Saldado') + `
        </td></tr>
      </table>`;
      
    const rendered = renderNotification('pago', context, fallbackSubject, fallbackBody, 'email');
    const finalHtml = baseTemplate(rendered.body, `Pago de ` + context.pago_monto + ` recibido — Reserva #` + reserva.id, config);
    
    results.email = await sendEmail(reserva.email, rendered.subject, finalHtml);
    logNotification(db, reserva.id, 'pago', 'email', reserva.email, results.email, finalHtml);
  }
  
  // WHATSAPP
  if ((reserva.whatsapp || reserva.telefono) && waEnabled) {
    const fallbackMsg = `💳 *Pago Registrado* — ` + context.hotel_nombre + `\n\n` +
      `Hola ` + context.cliente_nombre_completo + `, recibimos tu pago:\n\n` +
      `✅ Monto: ` + context.pago_monto + `\n` +
      `📋 Reserva: #` + reserva.id + `\n` +
      `💰 Total: ` + context.monto_total + `\n` +
      `✅ Pagado: ` + context.monto_pagado + `\n` +
      (reserva.saldo_pendiente > 0 ? `⚠️ Saldo: ` + context.saldo_pendiente : '🎉 ¡Cuenta saldada!') +
      `\n\n¡Gracias! 🙏`;
      
    const rendered = renderNotification('pago', context, null, fallbackMsg, 'whatsapp');
    results.whatsapp = await sendWhatsApp(reserva.whatsapp || reserva.telefono, rendered.body);
    logNotification(db, reserva.id, 'pago', 'whatsapp', reserva.whatsapp || reserva.telefono, results.whatsapp, rendered.body);
  }
  
  return results;
}

/**
 * 4. ADMIN NOTIFICATION — notify hotel staff of new booking
 */
async function notifyAdminNewBooking(reserva, habitacion) {
  const config = getSystemConfig();
  const emailEnabled = config.notifications_enabled === 1;
  if (!emailEnabled) return { email: false };
  
  const adminEmail = config.admin_email || process.env.ADMIN_EMAIL;
  if (!adminEmail) return { email: false };
  
  const context = buildTemplateContext(reserva, habitacion);
  const db = getDb();
  
  const fallbackSubject = `🔔 Nueva Reserva — ` + context.cliente_nombre_completo + ` — ` + context.check_in_formateado;
  const fallbackBody = `
    <h2>🔔 Nueva Reserva Recibida</h2>
    <p style="color:#4a5568;">Se ha registrado una nueva reserva en el sistema.</p>
    
    <table class="detail-table">
      <tr><td>👤 Huésped</td><td><strong>` + context.cliente_nombre_completo + `</strong></td></tr>
      <tr><td>📧 Email</td><td>` + (reserva.email || 'N/D') + `</td></tr>
      <tr><td>📱 WhatsApp</td><td>` + (reserva.whatsapp || reserva.telefono || 'N/D') + `</td></tr>
      <tr><td>📅 Check-in</td><td><strong>` + context.check_in_formateado + `</strong></td></tr>
      <tr><td>📅 Check-out</td><td><strong>` + context.check_out_formateado + `</strong></td></tr>
      <tr><td>🌙 Noches</td><td>` + reserva.noches + `</td></tr>
      <tr><td>🏠 Habitación</td><td>` + context.habitacion + `</td></tr>
      <tr><td>🍽️ Plan</td><td>` + (reserva.plan_nombre || 'N/D') + `</td></tr>
      <tr><td>💰 Total</td><td><strong>` + context.monto_total + `</strong></td></tr>
      <tr><td>📝 Fuente</td><td>` + (reserva.fuente || 'Directa') + `</td></tr>
      <tr><td>📝 Notas</td><td>` + (reserva.notas || '-') + `</td></tr>
    </table>
    
    <p style="text-align:center;">
      <a href="` + HOTEL_URL + `" class="btn">Ir al PMS</a>
    </p>`;
    
  const rendered = renderNotification('admin_notif', context, fallbackSubject, fallbackBody, 'email');
  const finalHtml = baseTemplate(rendered.body, `Nueva reserva de ` + context.cliente_nombre_completo + ` — ` + reserva.check_in, config);
  
  const emailResult = await sendEmail(adminEmail, rendered.subject, finalHtml);
  logNotification(db, reserva.id, 'admin_notif', 'email', adminEmail, emailResult, finalHtml);
  return { email: emailResult };
}

/**
 * 5. REMINDER — pre-arrival reminder (X days before check-in)
 */
async function notifyReminder(reserva, habitacion, daysUntil) {
  const config = getSystemConfig();
  const emailEnabled = config.notifications_enabled === 1;
  const waEnabled = config.wa_enabled === 1;
  if (!emailEnabled && !waEnabled) return { email: false, whatsapp: false };
  const results = { email: false, whatsapp: false };
  
  const dayLabel = daysUntil === 1 ? 'mañana' : `en ` + daysUntil + ` días`;
  const reminderExtras = {
    dias_restantes: daysUntil,
    etiqueta_dias: dayLabel
  };
  
  const context = buildTemplateContext(reserva, habitacion, reminderExtras);
  const db = getDb();
  
  // EMAIL
  if (reserva.email && emailEnabled) {
    const fallbackSubject = `📅 Recordatorio — Tu estadía es ` + dayLabel + ` — ` + context.hotel_nombre;
    const fallbackBody = `
      <h2>📅 Tu estadía es ` + dayLabel + `</h2>
      <p style="color:#4a5568;">Hola <strong>` + context.cliente_nombre_completo + `</strong>, te recordamos que tu reserva en ` + context.hotel_nombre + ` es ` + dayLabel + `.</p>
      
      <table class="detail-table">
        <tr><td>📅 Check-in</td><td><strong>` + context.check_in_formateado + `</strong> (2:00 PM)</td></tr>
        <tr><td>📅 Check-out</td><td>` + context.check_out_formateado + ` (12:00 PM)</td></tr>
        <tr><td>🏠 Habitación</td><td>` + context.habitacion + `</td></tr>
        <tr><td>🍽️ Plan</td><td>` + context.plan + `</td></tr>
      </table>
      
      ` + (reserva.saldo_pendiente > 0 ? `
        <div class="highlight">
          <div class="label">Saldo pendiente</div>
          <div class="amount" style="color:#e53e3e;">` + context.saldo_pendiente + `</div>
        </div>
      ` : '') + `
      
      <p style="color:#718096;font-size:14px;">
        <strong>📍 Dirección:</strong> ` + context.hotel_direccion + `<br>
        <strong>🅿️ Estacionamiento:</strong> Disponible en el hotel<br>
        <strong>📶 WiFi:</strong> Disponible en todo el recinto
      </p>
      
      <p style="color:#4a5568;">¡Te esperamos! 🌊🌴</p>`;
      
    const rendered = renderNotification('recordatorio', context, fallbackSubject, fallbackBody, 'email');
    const finalHtml = baseTemplate(rendered.body, `Recordatorio: tu estadía en ` + context.hotel_nombre + ` es ` + dayLabel, config);
    
    results.email = await sendEmail(reserva.email, rendered.subject, finalHtml);
    logNotification(db, reserva.id, 'recordatorio', 'email', reserva.email, results.email, finalHtml);
  }
  
  // WHATSAPP
  if ((reserva.whatsapp || reserva.telefono) && waEnabled) {
    const fallbackMsg = `📅 *Recordatorio* — ` + context.hotel_nombre + `\n\n` +
      `Hola ` + context.cliente_nombre_completo + ` 👋\n\n` +
      `Te recordamos que tu estadía es *` + dayLabel + `*:\n\n` +
      `📅 Check-in: ` + reserva.check_in + ` (2:00 PM)\n` +
      `🏠 ` + context.habitacion + `\n` +
      (reserva.saldo_pendiente > 0 ? `💰 Saldo pendiente: ` + context.saldo_pendiente + `\n` : '') +
      `\n📍 ` + context.hotel_direccion + `\n\n¡Te esperamos! 🌊🌴`;
      
    const rendered = renderNotification('recordatorio', context, null, fallbackMsg, 'whatsapp');
    results.whatsapp = await sendWhatsApp(reserva.whatsapp || reserva.telefono, rendered.body);
    logNotification(db, reserva.id, 'recordatorio', 'whatsapp', reserva.whatsapp || reserva.telefono, results.whatsapp, rendered.body);
  }
  
  return results;
}

// ── Core send email function ──
async function sendEmail(to, subject, html) {
  if (!integrationsEnabled()) return { sent: false, reason: 'disabled' };
  try {
    const config = getSystemConfig();
    if (config.notifications_enabled !== 1) {
      return { sent: false, reason: 'disabled' };
    }

    const emailProvider = config.email_provider || 'smtp';
    const adminEmail = config.admin_email || process.env.ADMIN_EMAIL;
    const from = (emailProvider === 'resend' ? config.resend_from_email : null) || config.smtp_from || process.env.SMTP_FROM || `${HOTEL_NAME} <${config.smtp_user || process.env.SMTP_USER || ''}>`;
    const bcc = (adminEmail && to !== adminEmail) ? adminEmail : null;

    if (emailProvider === 'resend') {
      const apiKey = config.resend_api_key;
      if (!apiKey) {
        return { sent: false, reason: 'Resend API key not configured' };
      }
      
      const res = await new Promise((resolve) => {
        const payload = JSON.stringify({
          from: from,
          to: [to],
          subject: subject,
          html: html,
          ...(bcc ? { bcc: [bcc] } : {})
        });

        const options = {
          hostname: 'api.resend.com',
          path: '/emails',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Content-Length': Buffer.byteLength(payload)
          }
        };

        const req = https.request(options, (resReq) => {
          let data = '';
          resReq.on('data', chunk => data += chunk);
          resReq.on('end', () => {
            if (resReq.statusCode >= 200 && resReq.statusCode < 300) {
              try {
                const parsed = JSON.parse(data);
                resolve({ sent: true, messageId: parsed.id });
              } catch {
                resolve({ sent: true, messageId: 'resend-success' });
              }
            } else {
              resolve({ sent: false, reason: `Resend API error (${resReq.statusCode}): ${data}` });
            }
          });
        });

        req.on('error', (e) => {
          resolve({ sent: false, reason: e.message });
        });

        req.write(payload);
        req.end();
      });

      if (res.sent) {
        console.log(`📧 Email sent to ${to} via Resend: ${res.messageId}`);
      } else {
        console.error(`📧 Resend error to ${to}:`, res.reason);
      }
      return res;
    } else {
      const t = getTransporter();
      if (!t) return { sent: false, reason: 'not_configured' };
      
      const mailOptions = { from, to, subject, html };
      if (bcc) {
        mailOptions.bcc = bcc;
      }
      
      const info = await t.sendMail(mailOptions);
      console.log(`📧 Email sent to ${to} via SMTP: ${info.messageId}`);
      return { sent: true, messageId: info.messageId };
    }
  } catch (err) {
    console.error(`📧 Email error to ${to}:`, err.message);
    return { sent: false, reason: err.message };
  }
}

// ── Permanent File Logger ──
function logNotificationToFile(reservaId, tipo, canal, destinatario, resultado) {
  try {
    const { LOGS_DIR: logDir, ensureDirectory } = require('./data-paths');
      
    if (!fs.existsSync(logDir)) {
      ensureDirectory(logDir);
    }
    
    const logFilePath = path.join(logDir, 'notifications.log');
    const logEntry = {
      timestamp: new Date().toISOString(),
      reserva_id: reservaId,
      tipo,
      canal,
      destinatario,
      resultado
    };
    
    // Keep at most two 5 MiB files; the relational notification audit remains in SQLite.
    if (fs.existsSync(logFilePath) && fs.statSync(logFilePath).size >= 5 * 1024 * 1024) {
      fs.renameSync(logFilePath, logFilePath + '.1');
    }
    fs.appendFileSync(logFilePath, JSON.stringify(logEntry) + '\n', { encoding: 'utf-8', mode: 0o600 });
  } catch (err) {
    console.error('⚠️ File logging failed for notifications.log:', err.message);
  }
}

// ── Notification Log (Database & File) ──
function logNotification(db, reservaId, tipo, canal, destinatario, resultado, contenido = null) {
  // 1. Guardar en SQLite
  try {
    db.prepare(`INSERT INTO notificaciones_log (reserva_id, tipo, canal, destinatario, resultado, contenido, created_at) 
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`).run(reservaId, tipo, canal, destinatario, JSON.stringify(resultado), contenido);
  } catch (err) {
    console.error('⚠️ DB log failed for notifications:', err.message);
  }
  
  // 2. Guardar en archivo permanente notifications.log
  logNotificationToFile(reservaId, tipo, canal, destinatario, resultado);
}

module.exports = {
  notifyReservationConfirmed,
  notifyStatusChange,
  notifyPaymentReceived,
  notifyAdminNewBooking,
  notifyReminder,
  sendEmail,
  sendWhatsApp,
  logNotification,
  baseTemplate,
  get ENABLED() {
    try {
      const config = getSystemConfig();
      return config.notifications_enabled === 1 || config.wa_enabled === 1;
    } catch {
      return false;
    }
  }
};
