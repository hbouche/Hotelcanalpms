const express = require('express');
const router = express.Router();
const { requireIntegrations } = require('../integration-policy');
router.use(['/configuracion/test-smtp', '/configuracion/test-resend'], requireIntegrations);
const path = require('path');
const { getDb } = require('../db/database');
const { requireAuth, requireRole } = require('../auth');
const { parseFile, detectColumns, runImport } = require('../import-cloudbeds');
const { importUpload, validateImportSignature } = require('../utils/upload');
const { calcNoches, calcReservation, calcReservationWithRates } = require('../utils/calculations');
const { baseTemplate } = require('../notifications');

// ── Helpers ──
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

// Guest column mapping (Cloudbeds Spanish export)
const GUEST_COLUMNS = {
  nombre: ['nombre', 'first name', 'first_name', 'name', 'guest name'],
  apellido: ['apellido', 'last name', 'last_name', 'surname', 'family name'],
  email: ['correo electrónico', 'correo electronico', 'correo', 'email', 'e-mail', 'guest email'],
  telefono: ['teléfono', 'telefono', 'phone', 'telephone', 'mobile', 'cell'],
  direccion: ['dirección', 'direccion', 'address', 'street'],
  ciudad: ['ciudad', 'city'],
  pais: ['país', 'pais', 'country', 'nationality'],
  provincia: ['provincia', 'state', 'region'],
  codigo_postal: ['código postal', 'codigo postal', 'zip', 'postal code', 'zip code'],
  total_reservas: ['total de las reservas', 'total reservas', 'reservations', 'total reservations', 'bookings'],
  noches_estadia: ['noches de estadía', 'noches de estadia', 'noches', 'nights', 'total nights', 'stay nights'],
  total_ingresos: ['total de ingresos', 'ingresos', 'revenue', 'total revenue', 'income'],
  ultima_estadia: ['última estadía', 'ultima estadia', 'last stay', 'last visit', 'last checkout'],
  huesped_habitual: ['huésped habitual', 'huesped habitual', 'returning guest', 'repeat guest', 'habitual'],
  estado_huesped: ['estado del huésped', 'estado del huesped', 'guest status', 'status'],
};

function detectGuestColumns(fileHeaders) {
  const mapping = {};
  const used = new Set();
  const normalized = fileHeaders.map(h => h.toLowerCase().trim());

  for (const [field, variations] of Object.entries(GUEST_COLUMNS)) {
    for (const variant of variations) {
      const idx = normalized.findIndex((h, i) => !used.has(i) && (h === variant || h.includes(variant)));
      if (idx !== -1) {
        mapping[field] = fileHeaders[idx];
        used.add(idx);
        break;
      }
    }
  }
  const unmapped = fileHeaders.filter((_, i) => !used.has(i));
  return { mapping, unmapped };
}

// Preview import (dry run — no data saved)
router.post('/import/preview', requireAuth, requireRole('admin'), importUpload.single('archivo'), validateImportSignature, (req, res) => {
  try {
    if (!req.file) return err(res, 'VALIDATION_ERROR', 'Archivo CSV o XLSX requerido');
    const { headers, rows, errors: parseErrors } = parseFile(req.file.buffer, req.file.originalname);
    if (rows.length === 0) return err(res, 'EMPTY_FILE', 'El archivo no contiene datos');
    const { mapping, unmapped } = detectColumns(headers);

    // Check minimum required columns
    if (!mapping.first_name) return err(res, 'MISSING_COLUMN', 'No se encontró columna de nombre del huésped');
    if (!mapping.check_in) return err(res, 'MISSING_COLUMN', 'No se encontró columna de check-in');
    if (!mapping.check_out) return err(res, 'MISSING_COLUMN', 'No se encontró columna de check-out');

    const db = getDb();
    const results = runImport(db, rows, mapping, { dryRun: true, skipDuplicates: true });

    ok(res, {
      filename: req.file.originalname,
      total_rows: rows.length,
      headers,
      mapping,
      unmapped,
      preview: results.details.slice(0, 20),
      summary: {
        will_import: results.imported,
        duplicates: results.duplicates,
        errors: results.errors,
      },
      parse_errors: parseErrors?.slice(0, 5) || [],
    });
  } catch (e) {
    console.error('Import preview error:', e);
    err(res, 'SERVER_ERROR', `Error procesando archivo: ${e.message}`, 500);
  }
});

// Execute import (saves data)
router.post('/import/execute', requireAuth, requireRole('admin'), importUpload.single('archivo'), validateImportSignature, (req, res) => {
  try {
    if (!req.file) return err(res, 'VALIDATION_ERROR', 'Archivo CSV o XLSX requerido');
    const { headers, rows, errors: parseErrors } = parseFile(req.file.buffer, req.file.originalname);
    if (rows.length === 0) return err(res, 'EMPTY_FILE', 'El archivo no contiene datos');
    const { mapping, unmapped } = detectColumns(headers);

    if (!mapping.first_name) return err(res, 'MISSING_COLUMN', 'No se encontró columna de nombre del huésped');
    if (!mapping.check_in) return err(res, 'MISSING_COLUMN', 'No se encontró columna de check-in');
    if (!mapping.check_out) return err(res, 'MISSING_COLUMN', 'No se encontró columna de check-out');

    const db = getDb();
    const results = runImport(db, rows, mapping, { dryRun: false, skipDuplicates: true });

    ok(res, {
      filename: req.file.originalname,
      summary: {
        total: results.total,
        imported: results.imported,
        duplicates: results.duplicates,
        errors: results.errors,
      },
      mapping,
      details: results.details,
    });
  } catch (e) {
    console.error('Import execute error:', e);
    err(res, 'SERVER_ERROR', `Error importando: ${e.message}`, 500);
  }
});

// Import history — count imported reservations + guests
router.get('/import/stats', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const imported = db.prepare("SELECT COUNT(*) as c FROM reservas_hotel WHERE created_by = 'Cloudbeds Import'").get().c;
    const lastImport = db.prepare("SELECT created_at FROM reservas_hotel WHERE created_by = 'Cloudbeds Import' ORDER BY id DESC LIMIT 1").get();
    // Guest stats
    let guestsImported = 0, lastGuestImport = null;
    try {
      guestsImported = db.prepare("SELECT COUNT(*) as c FROM huespedes WHERE fuente_import = 'Cloudbeds'").get().c;
      const lg = db.prepare("SELECT created_at FROM huespedes WHERE fuente_import = 'Cloudbeds' ORDER BY id DESC LIMIT 1").get();
      lastGuestImport = lg?.created_at || null;
    } catch(e) { /* table may not exist yet */ }
    ok(res, {
      total_imported: imported,
      last_import: lastImport?.created_at || null,
      guests_imported: guestsImported,
      last_guest_import: lastGuestImport,
    });
  } catch (e) { err(res, 'SERVER_ERROR', 'Error obteniendo stats', 500); }
});

// Preview guests import
router.post('/import/guests/preview', requireAuth, requireRole('admin'), importUpload.single('archivo'), validateImportSignature, (req, res) => {
  try {
    if (!req.file) return err(res, 'VALIDATION_ERROR', 'Archivo requerido');
    const { headers, rows } = parseFile(req.file.buffer, req.file.originalname);
    if (rows.length === 0) return err(res, 'EMPTY_FILE', 'El archivo no contiene datos');

    const { mapping, unmapped } = detectGuestColumns(headers);
    if (!mapping.nombre) return err(res, 'MISSING_COLUMN', 'No se encontró columna de nombre');

    const db = getDb();
    let duplicates = 0, willImport = 0, errors = 0;
    const preview = [];

    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const row = rows[i];
      const nombre = row[mapping.nombre]?.toString().trim();
      const apellido = mapping.apellido ? row[mapping.apellido]?.toString().trim() : '';
      const email = mapping.email ? row[mapping.email]?.toString().trim() : '';

      if (!nombre) { errors++; preview.push({ row: i+1, status: 'error', errors: ['Sin nombre'] }); continue; }

      // Check duplicate
      let isDup = false;
      try {
        if (email) {
          isDup = !!db.prepare("SELECT id FROM huespedes WHERE email = ?").get(email);
        }
        if (!isDup) {
          isDup = !!db.prepare("SELECT id FROM huespedes WHERE LOWER(nombre) = LOWER(?) AND LOWER(apellido) = LOWER(?)").get(nombre, apellido || '');
        }
      } catch(e) { /* table may not exist */ }

      if (isDup) {
        duplicates++;
        preview.push({ row: i+1, status: 'duplicate', guest: `${nombre} ${apellido}`, email });
      } else {
        willImport++;
        const totalRes = mapping.total_reservas ? parseInt(row[mapping.total_reservas]) || 0 : 0;
        const totalRev = mapping.total_ingresos ? parseFloat(row[mapping.total_ingresos]) || 0 : 0;
        const noches = mapping.noches_estadia ? parseInt(row[mapping.noches_estadia]) || 0 : 0;
        const pais = mapping.pais ? row[mapping.pais]?.toString().trim() : '';
        preview.push({
          row: i+1, status: 'preview', guest: `${nombre} ${apellido}`,
          email, pais, total_reservas: totalRes, total_ingresos: totalRev, noches,
        });
      }
    }

    // Count totals for full file
    let fullDups = 0, fullImport = 0, fullErrors = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const nombre = row[mapping.nombre]?.toString().trim();
      if (!nombre) { fullErrors++; continue; }
      const apellido = mapping.apellido ? row[mapping.apellido]?.toString().trim() : '';
      const email = mapping.email ? row[mapping.email]?.toString().trim() : '';
      let isDup = false;
      try {
        if (email) isDup = !!db.prepare("SELECT id FROM huespedes WHERE email = ?").get(email);
        if (!isDup) isDup = !!db.prepare("SELECT id FROM huespedes WHERE LOWER(nombre) = LOWER(?) AND LOWER(apellido) = LOWER(?)").get(nombre, apellido || '');
      } catch(e) { }
      if (isDup) fullDups++; else fullImport++;
    }

    ok(res, {
      type: 'guests',
      filename: req.file.originalname,
      total_rows: rows.length,
      headers,
      mapping,
      unmapped,
      preview,
      summary: {
        will_import: fullImport,
        duplicates: fullDups,
        errors: fullErrors,
      },
    });
  } catch (e) {
    console.error('Guest preview error:', e);
    err(res, 'SERVER_ERROR', `Error procesando archivo: ${e.message}`, 500);
  }
});

// Execute guests import
router.post('/import/guests/execute', requireAuth, requireRole('admin'), importUpload.single('archivo'), validateImportSignature, (req, res) => {
  try {
    if (!req.file) return err(res, 'VALIDATION_ERROR', 'Archivo requerido');
    const { headers, rows } = parseFile(req.file.buffer, req.file.originalname);
    if (rows.length === 0) return err(res, 'EMPTY_FILE', 'El archivo no contiene datos');

    const { mapping } = detectGuestColumns(headers);
    if (!mapping.nombre) return err(res, 'MISSING_COLUMN', 'No se encontró columna de nombre');

    const db = getDb();
    let imported = 0, duplicates = 0, errors = 0;
    const details = [];

    const parseGuestDate = (val) => {
      if (!val) return null;
      const str = String(val).trim();
      // DD/MM/YYYY format (Cloudbeds Spanish)
      const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
      // ISO
      if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.substring(0, 10);
      // Date object
      if (val instanceof Date) return val.toISOString().split('T')[0];
      return str;
    };

    const txn = db.transaction(() => {
      const insertStmt = db.prepare(`INSERT INTO huespedes 
        (nombre, apellido, email, telefono, direccion, ciudad, pais, provincia, codigo_postal,
         total_reservas, noches_estadia, total_ingresos, ultima_estadia, huesped_habitual, estado_huesped, fuente_import)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const nombre = row[mapping.nombre]?.toString().trim();
          if (!nombre) { errors++; details.push({ row: i+1, status: 'error', errors: ['Sin nombre'] }); continue; }

          const apellido = mapping.apellido ? row[mapping.apellido]?.toString().trim() || '' : '';
          const email = mapping.email ? row[mapping.email]?.toString().trim() || '' : '';
          const telefono = mapping.telefono ? row[mapping.telefono]?.toString().trim() || '' : '';
          const direccion = mapping.direccion ? row[mapping.direccion]?.toString().trim() || '' : '';
          const ciudad = mapping.ciudad ? row[mapping.ciudad]?.toString().trim() || '' : '';
          const pais = mapping.pais ? row[mapping.pais]?.toString().trim() || '' : '';
          const provincia = mapping.provincia ? row[mapping.provincia]?.toString().trim() || '' : '';
          const codigoPostal = mapping.codigo_postal ? row[mapping.codigo_postal]?.toString().trim() || '' : '';
          const totalReservas = mapping.total_reservas ? parseInt(row[mapping.total_reservas]) || 0 : 0;
          const nochesEstadia = mapping.noches_estadia ? parseInt(row[mapping.noches_estadia]) || 0 : 0;
          const totalIngresos = mapping.total_ingresos ? parseFloat(row[mapping.total_ingresos]) || 0 : 0;
          const ultimaEstadia = mapping.ultima_estadia ? parseGuestDate(row[mapping.ultima_estadia]) : null;
          const habitual = mapping.huesped_habitual ? (row[mapping.huesped_habitual]?.toString().toLowerCase() === 'sí' || row[mapping.huesped_habitual]?.toString().toLowerCase() === 'si' || row[mapping.huesped_habitual]?.toString().toLowerCase() === 'yes' ? 1 : 0) : 0;
          const estadoHuesped = mapping.estado_huesped ? row[mapping.estado_huesped]?.toString().trim() || '' : '';

          // Duplicate check
          let isDup = false;
          if (email) isDup = !!db.prepare("SELECT id FROM huespedes WHERE email = ?").get(email);
          if (!isDup) isDup = !!db.prepare("SELECT id FROM huespedes WHERE LOWER(nombre) = LOWER(?) AND LOWER(apellido) = LOWER(?)").get(nombre, apellido);

          if (isDup) {
            duplicates++;
            details.push({ row: i+1, status: 'duplicate', guest: `${nombre} ${apellido}` });
            continue;
          }

          insertStmt.run(nombre, apellido, email, telefono, direccion, ciudad, pais, provincia, codigoPostal,
            totalReservas, nochesEstadia, totalIngresos, ultimaEstadia, habitual, estadoHuesped, 'Cloudbeds');

          imported++;
          if (details.length < 100) {
            details.push({ row: i+1, status: 'imported', guest: `${nombre} ${apellido}`, email, pais, total_reservas: totalReservas, total_ingresos: totalIngresos });
          }
        } catch (e) {
          errors++;
          details.push({ row: i+1, status: 'error', errors: [e.message] });
        }
      }
    });
    txn();

    // ── Auto-generate historical reservations from imported guests ──
    let migratedRes = 0, migratedRev = 0;
    if (imported > 0) {
      try {
        const existingImports = db.prepare("SELECT COUNT(*) as c FROM reservas_hotel WHERE created_by = 'Cloudbeds Import'").get().c;
        if (existingImports === 0) {
          const rooms = db.prepare("SELECT id, nombre, tipo FROM habitaciones WHERE categoria = 'Estadía' AND activa = 1").all();
          if (rooms.length > 0) {
            const allGuests = db.prepare("SELECT * FROM huespedes WHERE total_reservas > 0 AND total_ingresos > 0 ORDER BY ultima_estadia DESC").all();
            const addD = (ds, days) => { const dt = new Date(ds + 'T12:00:00Z'); dt.setUTCDate(dt.getUTCDate() + days); return dt.toISOString().split('T')[0]; };
            const iR = db.prepare("INSERT INTO reservas_hotel (cliente, apellido, email, telefono, nacionalidad, habitacion_id, tipo_habitacion, check_in, check_out, noches, adultos, menores, mascotas, plan_nombre, subtotal, impuesto_pct, impuesto_monto, monto_total, monto_pagado, saldo_pendiente, estado, fuente, notas, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,0,?,?,10,?,?,?,0,'Check-Out','Cloudbeds',?,'Cloudbeds Import',?)");
            const iF = db.prepare("INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, metodo_pago, registrado_por, fecha, created_at) VALUES (?,'credito','Pago histórico Cloudbeds',?,'Histórico','Cloudbeds Import',?,?)");
            let ri = 0;
            const txn2 = db.transaction(() => {
              for (const g of allGuests) {
                const nr = Math.max(1, g.total_reservas || 1);
                const tn = Math.max(nr, g.noches_estadia || nr);
                const tr = g.total_ingresos || 0;
                const an = Math.max(1, Math.round(tn / nr));
                const ar = Math.round((tr / nr) * 100) / 100;
                let anchor = g.ultima_estadia;
                if (!anchor || anchor.length < 8) anchor = '2024-06-01';
                for (let i = 0; i < nr; i++) {
                  const off = i * (an + 30 + Math.floor(Math.random() * 30));
                  const co = addD(anchor, -off);
                  const ci = addD(co, -an);
                  const room = rooms[ri % rooms.length]; ri++;
                  let rev = i === nr - 1 && nr > 1 ? Math.round((tr - ar * (nr - 1)) * 100) / 100 : ar;
                  if (rev < 0) rev = ar;
                  const sub = Math.round(rev / 1.10 * 100) / 100;
                  const tax = Math.round((rev - sub) * 100) / 100;
                  const r2 = iR.run(g.nombre, g.apellido||'', g.email||'', g.telefono||'', g.pais||'', room.id, room.tipo, ci, co, an, Math.min(2, Math.max(1, Math.ceil(rev/150))), 'Estadía Todo Incluido', sub, tax, rev, rev, `Historial Cloudbeds #${i+1}/${nr}`, ci+'T08:00:00');
                  iF.run(r2.lastInsertRowid, rev, ci, ci+'T08:00:00');
                  migratedRes++; migratedRev += rev;
                }
              }
            });
            txn2();
            console.log(`✅ Auto-generated ${migratedRes} historical reservations ($${migratedRev.toLocaleString()})`);
          }
        }
      } catch (me) { console.error('Migration after import:', me.message); }
    }

    ok(res, {
      type: 'guests',
      filename: req.file.originalname,
      summary: { total: rows.length, imported, duplicates, errors, reservas_generadas: migratedRes },
      details: details.slice(0, 50),
    });
  } catch (e) {
    console.error('Guest import error:', e);
    err(res, 'SERVER_ERROR', `Error importando huéspedes: ${e.message}`, 500);
  }
});

const { hashPassword } = require('../auth');

// ══════════════════════════════════════
// USER MANAGEMENT CRUD
// ══════════════════════════════════════

router.get('/usuarios', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { page = 1, limit = 50, search } = req.query;
    const db = getDb();
    const conditions = [];
    const params = [];
    if (search) {
      conditions.push('(nombre LIKE ? OR email LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (Number(page) - 1) * Number(limit);
    
    const total = db.prepare(`SELECT COUNT(*) as c FROM usuarios ${where}`).get(...params).c;
    const users = db.prepare(`SELECT id, email, nombre, rol, activo, created_at FROM usuarios ${where} ORDER BY nombre ASC LIMIT ? OFFSET ?`).all(...params, Number(limit), offset);
    
    ok(res, users, { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) });
  } catch (e) {
    console.error(e);
    err(res, 'SERVER_ERROR', 'Error listando usuarios', 500);
  }
});

router.post('/usuarios', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { email, nombre, rol, password } = req.body;
    if (!email || !nombre || !rol || !password) {
      return err(res, 'VALIDATION_ERROR', 'email, nombre, rol y password son requeridos');
    }
    const validRoles = ['admin', 'receptionist', 'cleaning'];
    if (!validRoles.includes(rol)) {
      return err(res, 'VALIDATION_ERROR', 'rol no es válido (admin, receptionist, cleaning)');
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return err(res, 'VALIDATION_ERROR', 'Formato de email inválido');
    }
    
    const db = getDb();
    const existing = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email.toLowerCase().trim());
    if (existing) {
      return err(res, 'DUPLICATE', 'El usuario con ese email ya existe');
    }
    
    const password_hash = hashPassword(password);
    const stmt = db.prepare('INSERT INTO usuarios (email, nombre, rol, password_hash, activo) VALUES (?, ?, ?, ?, 1)');
    const result = stmt.run(email.toLowerCase().trim(), sanitize(nombre), rol, password_hash);
    
    ok(res, { id: result.lastInsertRowid, email: email.toLowerCase().trim(), nombre: sanitize(nombre), rol, activo: 1 }, null, 201);
  } catch (e) {
    console.error(e);
    err(res, 'SERVER_ERROR', 'Error al crear usuario', 500);
  }
});

router.put('/usuarios/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
    if (!existing) {
      return err(res, 'NOT_FOUND', 'Usuario no encontrado', 404);
    }
    
    const { email, nombre, rol, password, activo } = req.body;
    const updates = [];
    const params = [];
    
    if (email !== undefined) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return err(res, 'VALIDATION_ERROR', 'Formato de email inválido');
      }
      const dup = db.prepare('SELECT id FROM usuarios WHERE email = ? AND id != ?').get(email.toLowerCase().trim(), req.params.id);
      if (dup) {
        return err(res, 'DUPLICATE', 'El usuario con ese email ya existe');
      }
      updates.push('email = ?');
      params.push(email.toLowerCase().trim());
    }
    
    if (nombre !== undefined) {
      updates.push('nombre = ?');
      params.push(sanitize(nombre));
    }
    
    if (rol !== undefined) {
      const validRoles = ['admin', 'receptionist', 'cleaning'];
      if (!validRoles.includes(rol)) {
        return err(res, 'VALIDATION_ERROR', 'rol no es válido (admin, receptionist, cleaning)');
      }
      updates.push('rol = ?');
      params.push(rol);
    }
    
    if (password !== undefined) {
      updates.push('password_hash = ?');
      params.push(hashPassword(password));
    }
    
    if (activo !== undefined) {
      updates.push('activo = ?');
      params.push(activo ? 1 : 0);
    }
    
    if (updates.length === 0) {
      return err(res, 'VALIDATION_ERROR', 'Nada que actualizar');
    }
    
    const query = `UPDATE usuarios SET ${updates.join(', ')} WHERE id = ?`;
    params.push(req.params.id);
    
    db.prepare(query).run(...params);
    const updated = db.prepare('SELECT id, email, nombre, rol, activo, created_at FROM usuarios WHERE id = ?').get(req.params.id);
    ok(res, updated);
  } catch (e) {
    console.error(e);
    err(res, 'SERVER_ERROR', 'Error al actualizar usuario', 500);
  }
});

router.delete('/usuarios/:id', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM usuarios WHERE id = ?').get(req.params.id);
    if (!existing) {
      return err(res, 'NOT_FOUND', 'Usuario no encontrado', 404);
    }
    db.prepare('UPDATE usuarios SET activo = 0 WHERE id = ?').run(req.params.id);
    ok(res, { message: 'Usuario desactivado con éxito' });
  } catch (e) {
    console.error(e);
    err(res, 'SERVER_ERROR', 'Error al desactivar usuario', 500);
  }
});

// ══════════════════════════════════════
// SYSTEM CONFIG CRUD
// ══════════════════════════════════════

router.get('/configuracion/sistema', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const config = db.prepare('SELECT * FROM configuracion_sistema WHERE id = 1').get();
    if (!config) {
      return err(res, 'NOT_FOUND', 'Configuración de sistema no encontrada', 404);
    }
    
    // Mask sensitive fields
    if (config.smtp_pass) config.smtp_pass = '******';
    if (config.wa_api_token) config.wa_api_token = '******';
    if (config.resend_api_key) config.resend_api_key = '******';
    
    ok(res, config);
  } catch (e) {
    console.error(e);
    err(res, 'SERVER_ERROR', 'Error al obtener configuración', 500);
  }
});

router.put('/configuracion/sistema', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const config = db.prepare('SELECT * FROM configuracion_sistema WHERE id = 1').get();
    if (!config) {
      return err(res, 'NOT_FOUND', 'Configuración de sistema no encontrada', 404);
    }
    
    const allowed = [
      'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from',
      'admin_email', 'notifications_enabled', 'wa_api_url', 'wa_api_token',
      'wa_from_number', 'wa_enabled',
      'hotel_telefono', 'hotel_politica_cancelacion', 'hotel_politica_reembolso',
      'hotel_direccion', 'email_provider', 'resend_api_key', 'resend_from_email'
    ];
    const updates = [];
    const params = [];
    
    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        let val = req.body[field];
        
        // Skip updating sensitive fields if they contain the masked placeholder
        if (['smtp_pass', 'wa_api_token', 'resend_api_key'].includes(field) && val === '******') {
          continue;
        }
        
        // Validations
        if (field === 'smtp_port' && val !== null) {
          const port = parseInt(val);
          if (isNaN(port) || port < 1 || port > 65535) {
            return err(res, 'VALIDATION_ERROR', 'Puerto SMTP inválido');
          }
        }
        if ((field === 'admin_email' || field === 'smtp_from') && val !== null) {
          const emailStr = String(val);
          if (field === 'admin_email') {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(emailStr)) {
              return err(res, 'VALIDATION_ERROR', 'Formato de admin_email inválido');
            }
          }
        }
        if ((field === 'notifications_enabled' || field === 'wa_enabled') && val !== null) {
          val = val ? 1 : 0;
        }
        
        updates.push(`${field} = ?`);
        params.push(val);
      }
    }
    
    if (updates.length === 0) {
      return err(res, 'VALIDATION_ERROR', 'Nada que actualizar');
    }
    
    const query = `UPDATE configuracion_sistema SET ${updates.join(', ')} WHERE id = 1`;
    db.prepare(query).run(...params);
    
    const updated = db.prepare('SELECT * FROM configuracion_sistema WHERE id = 1').get();
    if (updated) {
      if (updated.smtp_pass) updated.smtp_pass = '******';
      if (updated.wa_api_token) updated.wa_api_token = '******';
      if (updated.resend_api_key) updated.resend_api_key = '******';
    }
    ok(res, updated);
  } catch (e) {
    console.error(e);
    err(res, 'SERVER_ERROR', 'Error al actualizar configuración', 500);
  }
});

// GET Hotel general and payment configuration (admin)
router.get('/configuracion/hotel', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT clave, valor, descripcion FROM config_hotel').all();
    const config = {};
    for (const r of rows) {
      if ((r.clave === 'paypal_secret' || r.clave === 'kommo_api_token') && r.valor) {
        config[r.clave] = '******';
      } else {
        config[r.clave] = r.valor;
      }
    }
    ok(res, config);
  } catch (e) {
    console.error('Error fetching hotel config:', e);
    err(res, 'SERVER_ERROR', 'Error al obtener configuración de hotel', 500);
  }
});

// PUT Hotel general and payment configuration (admin)
router.put('/configuracion/hotel', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const allowed = [
      'nombre_propiedad',
      'impuesto_turismo_pct',
      'deposito_sugerido_pct',
      'moneda',
      'paypal_client_id',
      'paypal_secret',
      'paypal_mode',
      'kommo_api_token',
      'kommo_subdomain',
      'kommo_enabled'
    ];
    
    // Validations
    if (req.body.impuesto_turismo_pct !== undefined) {
      const pct = parseFloat(req.body.impuesto_turismo_pct);
      if (isNaN(pct) || pct < 0 || pct > 100) {
        return err(res, 'VALIDATION_ERROR', 'El porcentaje de impuesto de turismo debe estar entre 0% y 100%');
      }
    }
    
    if (req.body.deposito_sugerido_pct !== undefined) {
      const pct = parseFloat(req.body.deposito_sugerido_pct);
      if (isNaN(pct) || pct < 0 || pct > 100) {
        return err(res, 'VALIDATION_ERROR', 'El porcentaje de depósito sugerido debe estar entre 0% y 100%');
      }
    }
    
    if (req.body.paypal_mode !== undefined && !['sandbox', 'live'].includes(req.body.paypal_mode)) {
      return err(res, 'VALIDATION_ERROR', 'Modo de PayPal inválido (debe ser sandbox o live)');
    }

    db.transaction(() => {
      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          const val = req.body[key] === null ? '' : String(req.body[key]).trim();
          // Skip updating paypal_secret or kommo_api_token if it is the masked placeholder
          if ((key === 'paypal_secret' || key === 'kommo_api_token') && val === '******') {
            continue;
          }
          db.prepare(`
            INSERT INTO config_hotel (clave, valor)
            VALUES (?, ?)
            ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor
          `).run(key, val);
        }
      }
    })();
    
    // Return updated config
    const rows = db.prepare('SELECT clave, valor FROM config_hotel').all();
    const config = {};
    for (const r of rows) {
      if ((r.clave === 'paypal_secret' || r.clave === 'kommo_api_token') && r.valor) {
        config[r.clave] = '******';
      } else {
        config[r.clave] = r.valor;
      }
    }
    ok(res, config);
  } catch (e) {
    console.error('Error updating hotel config:', e);
    err(res, 'SERVER_ERROR', 'Error al actualizar la configuración de hotel', 500);
  }
});

// Route for SMTP Test Diagnostics
router.post('/configuracion/test-smtp', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, destinatario } = req.body;
    
    if (!smtp_host || !smtp_port || !smtp_user || !smtp_pass || !smtp_from || !destinatario) {
      return err(res, 'VALIDATION_ERROR', 'Todos los campos SMTP y el destinatario son requeridos para la prueba.');
    }
    
    const port = parseInt(smtp_port);
    if (isNaN(port) || port < 1 || port > 65535) {
      return err(res, 'VALIDATION_ERROR', 'Puerto SMTP inválido');
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(destinatario)) {
      return err(res, 'VALIDATION_ERROR', 'Formato de correo destinatario inválido');
    }
    
    console.log(`🧪 Iniciando diagnóstico SMTP para ${destinatario} a través de ${smtp_host}:${port}`);
    
    const nodemailer = require('nodemailer');
    const testTransporter = nodemailer.createTransport({
      host: smtp_host,
      port: port,
      secure: port === 465,
      auth: {
        user: smtp_user,
        pass: smtp_pass
      },
      connectionTimeout: 10000, // 10s timeout
      greetingTimeout: 10000,
      socketTimeout: 10000
    });
    
    // 1. Verify connection
    try {
      await testTransporter.verify();
      console.log('🧪 SMTP Connection verified successfully');
    } catch (verifyError) {
      console.error('❌ SMTP verification failed:', verifyError);
      return res.status(400).json({
        success: false,
        error: {
          code: 'SMTP_CONNECTION_FAILED',
          message: `No se pudo conectar al servidor SMTP: ${verifyError.message}`,
          details: verifyError.stack || verifyError
        }
      });
    }
    
    // 2. Send test premium HTML email
    const mailBody = `
      <h2 style="color:#22863a;">🧪 ¡Conexión SMTP Exitosa!</h2>
      <p style="color:#4a5568;">El PMS de Hotel Panamá Canal ha verificado exitosamente la configuración de tu servidor de correo saliente (SMTP).</p>
      
      <div class="highlight" style="border-left-color: #22863a; background-color: #f6fdf9; border-left-width: 4px; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0; font-size: 14px; color: #2e7d32;"><strong>Detalles de la conexión:</strong></p>
        <ul style="margin: 8px 0 0 0; padding-left: 20px; font-size: 13px; color: #2d3748; line-height: 1.6;">
          <li><strong>Servidor (Host):</strong> <code>${smtp_host}</code></li>
          <li><strong>Puerto (Port):</strong> <code>${port}</code></li>
          <li><strong>Usuario (User):</strong> <code>${smtp_user}</code></li>
          <li><strong>Remitente (From):</strong> <code>${smtp_from}</code></li>
          <li><strong>Fecha/Hora de Prueba:</strong> <code>${new Date().toLocaleString('es-PA')}</code></li>
        </ul>
      </div>
      
      <p style="color:#718096;font-size:13px;">Si has recibido este mensaje, significa que los correos automáticos de confirmación, recordatorios y recibos de pago comenzarán a enviarse con normalidad desde este buzón.</p>
    `;
    
    // Dummy system configuration to generate base HTML structure
    const dummyConfig = {
      hotel_telefono: req.body.hotel_telefono || '',
      smtp_from: smtp_from,
      hotel_direccion: req.body.hotel_direccion || 'Por configurar'
    };
    
    const finalHtml = baseTemplate(mailBody, '🧪 Prueba de SMTP Exitosa — Hotel Panamá Canal PMS', dummyConfig);
    
    try {
      const info = await testTransporter.sendMail({
        from: smtp_from,
        to: destinatario,
        subject: `🧪 Prueba de SMTP Exitosa — Hotel Panamá Canal PMS`,
        html: finalHtml
      });
      
      console.log(`🧪 Test email sent successfully: ${info.messageId}`);
      return ok(res, {
        message: 'Correo de diagnóstico SMTP enviado con éxito.',
        messageId: info.messageId,
        response: info.response
      });
    } catch (sendError) {
      console.error('❌ SMTP email send failed:', sendError);
      return res.status(400).json({
        success: false,
        error: {
          code: 'SMTP_TEST_FAILED',
          message: `El servidor SMTP aceptó la conexión pero falló al enviar el mensaje: ${sendError.message}`,
          details: sendError.stack || sendError
        }
      });
    }
    
  } catch (e) {
    console.error('SMTP test route server error:', e);
    err(res, 'SERVER_ERROR', `Error del servidor durante la prueba SMTP: ${e.message}`, 500);
  }
});

// Route for Resend Test Diagnostics
router.post('/configuracion/test-resend', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { resend_api_key, resend_from_email, smtp_from, destinatario } = req.body;
    const fromEmail = resend_from_email || smtp_from;
    
    if (!resend_api_key || !fromEmail || !destinatario) {
      return err(res, 'VALIDATION_ERROR', 'La API Key de Resend, el remitente y el destinatario son requeridos.');
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(destinatario)) {
      return err(res, 'VALIDATION_ERROR', 'Formato de correo destinatario inválido');
    }
    
    console.log(`🧪 Iniciando diagnóstico Resend para ${destinatario}`);
    
    const mailBody = `
      <h2 style="color:#22863a;">🧪 ¡Conexión Resend Exitosa!</h2>
      <p style="color:#4a5568;">El PMS de Hotel Panamá Canal ha verificado exitosamente la configuración de tu proveedor de correo Resend.</p>
      
      <div class="highlight" style="border-left-color: #22863a; background-color: #f6fdf9; border-left-width: 4px; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0; font-size: 14px; color: #2e7d32;"><strong>Detalles de la conexión:</strong></p>
        <ul style="margin: 8px 0 0 0; padding-left: 20px; font-size: 13px; color: #2d3748; line-height: 1.6;">
          <li><strong>Proveedor:</strong> <code>Resend API</code></li>
          <li><strong>Remitente (From):</strong> <code>${fromEmail}</code></li>
          <li><strong>Fecha/Hora de Prueba:</strong> <code>${new Date().toLocaleString('es-PA')}</code></li>
        </ul>
      </div>
      
      <p style="color:#718096;font-size:13px;">Si has recibido este mensaje, significa que los correos automáticos de confirmación, recordatorios y recibos de pago comenzarán a enviarse con normalidad desde Resend.</p>
    `;
    
    const dummyConfig = {
      hotel_telefono: req.body.hotel_telefono || '',
      smtp_from: fromEmail,
      hotel_direccion: req.body.hotel_direccion || 'Por configurar'
    };
    
    const finalHtml = baseTemplate(mailBody, '🧪 Prueba de Resend Exitosa — Hotel Panamá Canal PMS', dummyConfig);
    
    const https = require('https');
    const payload = JSON.stringify({
      from: fromEmail,
      to: [destinatario],
      subject: `🧪 Prueba de Resend Exitosa — Hotel Panamá Canal PMS`,
      html: finalHtml
    });
    const options = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resend_api_key}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const resResult = await new Promise((resolve) => {
      const reqRes = https.request(options, (resReq) => {
        let data = '';
        resReq.on('data', chunk => data += chunk);
        resReq.on('end', () => {
          if (resReq.statusCode >= 200 && resReq.statusCode < 300) {
            try {
              const parsed = JSON.parse(data);
              resolve({ success: true, messageId: parsed.id });
            } catch {
              resolve({ success: true, messageId: 'resend-success' });
            }
          } else {
            resolve({ success: false, error: `Resend API error (${resReq.statusCode}): ${data}` });
          }
        });
      });

      reqRes.on('error', (e) => {
        resolve({ success: false, error: e.message });
      });

      reqRes.write(payload);
      reqRes.end();
    });

    if (resResult.success) {
      return ok(res, {
        message: 'Correo de diagnóstico Resend enviado con éxito.',
        messageId: resResult.messageId
      });
    } else {
      return res.status(400).json({
        success: false,
        error: {
          code: 'RESEND_TEST_FAILED',
          message: `La API de Resend devolvió un error: ${resResult.error}`
        }
      });
    }
  } catch (e) {
    console.error('Resend test route server error:', e);
    err(res, 'SERVER_ERROR', `Error del servidor durante la prueba Resend: ${e.message}`, 500);
  }
});

// ══════════════════════════════════════
// LOGS QUERY ENDPOINTS
// ══════════════════════════════════════

router.get('/configuracion/logs', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { page = 1, limit = 50, search } = req.query;
    const db = getDb();
    const conditions = [];
    const params = [];
    if (search) {
      conditions.push('(tipo LIKE ? OR canal LIKE ? OR destinatario LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (Number(page) - 1) * Number(limit);
    
    const total = db.prepare(`SELECT COUNT(*) as c FROM notificaciones_log ${where}`).get(...params).c;
    const logs = db.prepare(`SELECT * FROM notificaciones_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), offset);
    
    ok(res, logs, { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) });
  } catch (e) {
    console.error(e);
    err(res, 'SERVER_ERROR', 'Error al listar logs de notificaciones', 500);
  }
});

router.get('/configuracion/reversiones', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const db = getDb();
    const offset = (Number(page) - 1) * Number(limit);
    
    const total = db.prepare(`SELECT COUNT(*) as c FROM reversiones_log`).get().c;
    const logs = db.prepare(`SELECT * FROM reversiones_log ORDER BY fecha DESC LIMIT ? OFFSET ?`).all(Number(limit), offset);
    
    ok(res, logs, { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) });
  } catch (e) {
    console.error(e);
    err(res, 'SERVER_ERROR', 'Error al listar logs de reversiones', 500);
  }
});

router.get('/solicitudes-modificacion', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { estado } = req.query;
    const db = getDb();
    let query = `
      SELECT s.*, r.cliente, r.apellido, r.plan_nombre 
      FROM solicitudes_modificacion s 
      JOIN reservas_hotel r ON s.reserva_id = r.id
    `;
    const params = [];
    if (estado) {
      query += ' WHERE s.estado = ?';
      params.push(estado);
    }
    query += ' ORDER BY s.id DESC';
    const list = db.prepare(query).all(...params);
    ok(res, list);
  } catch (e) {
    console.error('Error listando solicitudes:', e);
    err(res, 'SERVER_ERROR', 'Error al listar solicitudes de modificación', 500);
  }
});

router.post('/solicitudes-modificacion/:id/procesar', requireAuth, requireRole('admin'), (req, res) => {
  const db = getDb();
  
  // Pre-transaction validation: Check if request is valid and pending
  const request = db.prepare('SELECT * FROM solicitudes_modificacion WHERE id = ?').get(req.params.id);
  if (!request) return err(res, 'NOT_FOUND', 'Solicitud no encontrada', 404);
  if (request.estado !== 'Pendiente') return err(res, 'ALREADY_PROCESSED', 'Esta solicitud ya fue procesada', 400);

  const { accion, comentarios_admin } = req.body;
  if (!['aprobar', 'rechazar'].includes(accion)) {
    return err(res, 'VALIDATION_ERROR', 'Acción inválida. Use aprobar o rechazar', 400);
  }

  // ACID transaction wrapper for Processing
  const processTransaction = db.transaction((reqId, adminUser, act, comments) => {
    // 1. Fetch Request
    const reqRow = db.prepare('SELECT * FROM solicitudes_modificacion WHERE id = ?').get(reqId);
    if (!reqRow) throw new Error('Solicitud no encontrada');
    if (reqRow.estado !== 'Pendiente') throw new Error('Esta solicitud ya fue procesada');

    const reservaId = reqRow.reserva_id;
    const tipoModificacion = reqRow.tipo_modificacion;

    // 2. Fetch current Reservation
    const reservation = db.prepare('SELECT * FROM reservas_hotel WHERE id = ?').get(reservaId);
    if (!reservation) throw new Error('Reserva vinculada no encontrada');

    if (act === 'rechazar') {
      // Restore original state
      const prevData = JSON.parse(reqRow.datos_anteriores);
      const originalEstado = prevData.reserva_estado_anterior || prevData.estado;
      if (originalEstado) {
        db.prepare("UPDATE reservas_hotel SET estado = ? WHERE id = ?").run(originalEstado, reservaId);
      }

      // Update request status to Rechazado
      db.prepare(`
        UPDATE solicitudes_modificacion 
        SET estado = 'Rechazado', procesado_por = ?, fecha_procesamiento = datetime('now'), comentarios_admin = ?
        WHERE id = ?
      `).run(adminUser, comments || null, reqId);

      return { success: true, message: 'Solicitud rechazada con éxito y reserva restaurada.' };
    }

    // act === 'aprobar'
    const newFields = JSON.parse(reqRow.snapshot_datos);

    if (tipoModificacion === 'editar_pago') {
      const transaccionOriginalId = reqRow.transaccion_original_id;
      if (!transaccionOriginalId) throw new Error('transaccion_original_id faltante en la solicitud de pago');

      const payment = db.prepare('SELECT * FROM folio_hotel WHERE id = ? AND reserva_id = ?').get(transaccionOriginalId, reservaId);
      if (!payment) throw new Error('Transacción de pago original no encontrada');

      // Update payment fields in folio_hotel
      const allowedPaymentFields = ['monto', 'metodo_pago', 'concepto', 'referencia', 'tipo', 'fecha'];
      const paymentUpdates = [];
      const paymentParams = [];
      for (const field of allowedPaymentFields) {
        if (newFields[field] !== undefined) {
          paymentUpdates.push(`${field} = ?`);
          paymentParams.push(newFields[field]);
        }
      }
      if (paymentUpdates.length > 0) {
        db.prepare(`UPDATE folio_hotel SET ${paymentUpdates.join(', ')} WHERE id = ?`).run(...paymentParams, transaccionOriginalId);
      }

      // Recalculate totals
      const totalPaid = db.prepare("SELECT SUM(monto) as total FROM folio_hotel WHERE reserva_id = ? AND tipo = 'credito'").get(reservaId).total || 0;
      const newMontoPagado = Math.round(totalPaid * 100) / 100;

      const debits = db.prepare("SELECT * FROM folio_hotel WHERE reserva_id = ? AND tipo = 'debito'").all(reservaId);
      let newProductosAdicionales = 0;
      for (const d of debits) {
        if (!d.concepto.startsWith('Habitación:') && !d.concepto.startsWith('Impuesto Turismo')) {
          newProductosAdicionales += d.monto;
        }
      }
      newProductosAdicionales = Math.round(newProductosAdicionales * 100) / 100;

      // Recalculate with merged values
      const merged = { ...reservation, monto_pagado: newMontoPagado, productos_adicionales: newProductosAdicionales };
      const totals = calcReservation(merged);
      Object.assign(merged, totals);

      // Restore reservation state from original state (since it's approved, un-lock it!)
      const prevData = JSON.parse(reqRow.datos_anteriores);
      const originalEstado = prevData.reserva_estado_anterior || prevData.estado || 'Confirmada';
      merged.estado = originalEstado;

      // Update reservation
      db.prepare(`
        UPDATE reservas_hotel SET 
          productos_adicionales = ?, subtotal = ?, impuesto_pct = ?, impuesto_monto = ?,
          monto_total = ?, deposito_sugerido = ?, monto_pagado = ?, saldo_pendiente = ?,
          estado = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        merged.productos_adicionales, merged.subtotal, merged.impuesto_pct, merged.impuesto_monto,
        merged.monto_total, merged.deposito_sugerido, merged.monto_pagado, merged.saldo_pendiente,
        merged.estado, reservaId
      );

    } else if (tipoModificacion === 'editar_reserva') {
      // Modify reservation details in reservas_hotel
      const merged = { ...reservation, ...newFields };

      // Validate room availability
      if (newFields.habitacion_id || newFields.check_in || newFields.check_out) {
        const roomId = merged.habitacion_id;
        const ci = merged.check_in;
        const co = merged.check_out;
        if (roomId) {
          const conflict = db.prepare(`
            SELECT id, cliente FROM reservas_hotel
            WHERE habitacion_id = ? AND id != ? AND estado NOT IN ('Cancelada', 'No-Show', 'Check-Out')
              AND check_in < ? AND check_out > ?
          `).get(roomId, reservaId, co, ci);
          if (conflict) {
            throw new Error(`La habitación ya está ocupada por ${conflict.cliente} del ${ci} al ${co}`);
          }
        }
      }

      // Recalculate nights
      merged.noches = calcNoches(merged.check_in, merged.check_out);

      // Recalculate totals
      let totals;
      if (merged.plan_codigo) {
        const plan = db.prepare('SELECT * FROM planes_tarifa WHERE codigo = ? AND activo = 1').get(merged.plan_codigo);
        if (plan) {
          totals = calcReservationWithRates(plan.id, merged.check_in, merged.check_out, merged.adultos, merged.menores, merged.mascotas);
          merged.plan_nombre = plan.nombre;
          merged.precio_adulto_noche = plan.precio_adulto_noche;
          merged.precio_menor_noche = plan.precio_menor_noche;
          merged.precio_mascota_noche = plan.precio_mascota_noche;
        } else {
          totals = calcReservation(merged);
        }
      } else {
        totals = calcReservation(merged);
      }
      Object.assign(merged, totals);

      // Restore state from original reservation state (since it's approved, un-lock it!)
      const prevData = JSON.parse(reqRow.datos_anteriores);
      const originalEstado = prevData.estado || 'Confirmada';
      merged.estado = originalEstado;

      // Update reservas_hotel table
      db.prepare(`
        UPDATE reservas_hotel SET 
          cliente = ?, apellido = ?, email = ?, whatsapp = ?, telefono = ?, nacionalidad = ?,
          habitacion_id = ?, tipo_habitacion = ?, check_in = ?, check_out = ?, noches = ?, hora_llegada = ?,
          adultos = ?, menores = ?, mascotas = ?, plan_codigo = ?, plan_nombre = ?,
          precio_adulto_noche = ?, precio_menor_noche = ?, precio_mascota_noche = ?,
          subtotal = ?, productos_adicionales = ?, impuesto_pct = ?, impuesto_monto = ?, monto_total = ?,
          deposito_sugerido = ?, monto_pagado = ?, saldo_pendiente = ?, estado = ?, fuente = ?, notas = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        merged.cliente, merged.apellido, merged.email, merged.whatsapp, merged.telefono, merged.nacionalidad,
        merged.habitacion_id, merged.tipo_habitacion, merged.check_in, merged.check_out, merged.noches, merged.hora_llegada,
        merged.adultos, merged.menores, merged.mascotas, merged.plan_codigo, merged.plan_nombre,
        merged.precio_adulto_noche, merged.precio_menor_noche, merged.precio_mascota_noche,
        merged.subtotal, merged.productos_adicionales, merged.impuesto_pct, merged.impuesto_monto, merged.monto_total,
        merged.deposito_sugerido, merged.monto_pagado, merged.saldo_pendiente, merged.estado, merged.fuente, merged.notas,
        reservaId
      );
    }

    // Update request status to Aprobado
    db.prepare(`
      UPDATE solicitudes_modificacion 
      SET estado = 'Aprobado', procesado_por = ?, fecha_procesamiento = datetime('now'), comentarios_admin = ?
      WHERE id = ?
    `).run(adminUser, comments || null, reqId);

    return { success: true, message: 'Solicitud aprobada y reserva/folios actualizados con éxito.' };
  });

  try {
    const result = processTransaction(request.id, req.user.nombre || req.user.email, accion, comentarios_admin);
    return ok(res, result);
  } catch (error) {
    console.error('Error procesando la solicitud:', error);
    return err(res, 'TRANSACTION_FAILED', error.message, 500);
  }
});

// ── NOTIFICATION TEMPLATES ROUTES ──

// Define default templates structure for recovery/restore purposes
const DEFAULT_TEMPLATES = {
  confirmacion: {
    email: {
      asunto: '✅ Reserva Confirmada #{{id}} — {{hotel_nombre}}',
      contenido: `<h2>✅ ¡Reserva Confirmada!</h2>
<p style="color:#4a5568;">Hola <strong>{{cliente_nombre_completo}}</strong>, tu reserva ha sido confirmada. ¡Te esperamos!</p>

<table class="detail-table">
  <tr><td>📋 Reserva</td><td>#{{id}}</td></tr>
  <tr><td>📅 Check-in</td><td><strong>{{check_in_formateado}}</strong></td></tr>
  <tr><td>📅 Check-out</td><td><strong>{{check_out_formateado}}</strong></td></tr>
  <tr><td>🌙 Noches</td><td>{{noches}}</td></tr>
  <tr><td>🏠 Habitación</td><td>{{habitacion}}</td></tr>
  <tr><td>🍽️ Plan</td><td>{{plan}}</td></tr>
  <tr><td>👥 Huéspedes</td><td>{{adultos}} adultos, {{menores}} menores</td></tr>
</table>

<div class="highlight">
  <div class="amount">{{monto_total}}</div>
  <div class="label">Total de tu estadía</div>
  <div style="margin-top:8px;font-size:13px;color:#22863a;">✓ Pagado: {{monto_pagado}} | Saldo: {{saldo_pendiente}}</div>
</div>

<p style="color:#718096;font-size:14px;">
  <strong>Check-in:</strong> A partir de las 2:00 PM<br>
  <strong>Check-out:</strong> Antes de las 12:00 PM<br>
  <strong>Dirección:</strong> {{hotel_direccion}}
</p>

<p style="text-align:center;">
  <a href="{{hotel_url}}" class="btn">Ver Detalles</a>
</p>

<p style="color:#a0aec0;font-size:12px;">Si necesitas hacer cambios, contáctanos por WhatsApp al {{hotel_telefono}} o responde a este correo.</p>`
    },
    whatsapp: {
      asunto: null,
      contenido: `✅ *Reserva Confirmada* — {{hotel_nombre}}

Hola {{cliente_nombre_completo}} 👋

Tu reserva ha sido confirmada:
📋 #{{id}}
📅 {{check_in}} → {{check_out}} ({{noches}} noches)
🏠 {{habitacion}}
💰 Total: {{monto_total}}

Check-in: 2:00 PM
Check-out: 12:00 PM

¡Te esperamos! 🌊🌴`
    }
  },
  bienvenida: {
    email: {
      asunto: '🎉 ¡Bienvenido! Reserva Hospedado #{{id}} — {{hotel_nombre}}',
      contenido: `<h2>🎉 ¡Bienvenido a {{hotel_nombre}}!</h2>
<p style="color:#4a5568;">Hola <strong>{{cliente_nombre_completo}}</strong>, tu habitación <strong>{{habitacion}}</strong> está lista. ¡Esperamos que disfrutes tu estadía con nosotros!</p>

<table class="detail-table">
  <tr><td>📋 Reserva</td><td>#{{id}}</td></tr>
  <tr><td>📅 Check-in</td><td>{{check_in_formateado}}</td></tr>
  <tr><td>📅 Check-out</td><td>{{check_out_formateado}}</td></tr>
  <tr><td>🏠 Habitación</td><td>{{habitacion}}</td></tr>
</table>

<div class="highlight">
  <div class="label">Información Útil:</div>
  <p style="margin:8px 0 0;font-size:14px;color:#4a5568;">
    📶 <strong>WiFi:</strong> Hotel Panamá Canal Guest<br>
    🍽️ <strong>Restaurante:</strong> 7:00 AM - 10:00 PM<br>
    🌊 ¡Disfruta de la playa y la naturaleza!
  </p>
</div>`
    },
    whatsapp: {
      asunto: null,
      contenido: `🎉 *¡Bienvenido!* — {{hotel_nombre}}

Hola {{cliente_nombre_completo}}, ¡tu check-in ha sido registrado con éxito!

📋 Reserva #{{id}}
🏠 Habitación: {{habitacion}}
📅 Check-out: {{check_out}} (12:00 PM)

📶 WiFi: Hotel Panamá Canal Guest
🍽️ Restaurante: 7:00 AM - 10:00 PM

🎉 ¡Disfruta tu estadía con nosotros! 🌴🌊`
    }
  },
  checkout: {
    email: {
      asunto: '👋 ¡Gracias por tu visita! Reserva Check-Out #{{id}} — {{hotel_nombre}}',
      contenido: `<h2>👋 ¡Gracias por hospedarte con nosotros!</h2>
<p style="color:#4a5568;">Hola <strong>{{cliente_nombre_completo}}</strong>, esperamos que hayas tenido un excelente viaje y que hayas disfrutado tu estadía en {{hotel_nombre}}.</p>

<table class="detail-table">
  <tr><td>📋 Reserva</td><td>#{{id}}</td></tr>
  <tr><td>🏠 Habitación</td><td>{{habitacion}}</td></tr>
  <tr><td>📅 Check-out</td><td>{{check_out_formateado}}</td></tr>
</table>

<div class="highlight">
  <div class="amount">{{monto_total}}</div>
  <div class="label">Total de tu estadía</div>
  <div style="margin-top:8px;font-size:13px;color:#22863a;">✓ Pagado: {{monto_pagado}} | Saldo: {{saldo_pendiente}}</div>
</div>

<p style="color:#4a5568;font-size:14px;">¿Disfrutaste tu estadía? Tu opinión es muy valiosa para nosotros. Por favor déjanos una reseña en Google o TripAdvisor. ⭐⭐⭐⭐⭐</p>
<p style="color:#718096;font-size:13px;">¡Esperamos verte pronto de regreso en nuestro pequeño paraíso!</p>`
    },
    whatsapp: {
      asunto: null,
      contenido: `👋 *¡Gracias por tu visita!* — {{hotel_nombre}}

Hola {{cliente_nombre_completo}}, tu salida ha sido registrada con éxito.

📋 Reserva #{{id}}
🏠 Habitación: {{habitacion}}
💰 Total: {{monto_total}}
✅ Pagado: {{monto_pagado}}
⚠️ Saldo pendiente: {{saldo_pendiente}}

🙏 ¡Muchas gracias por hospedarte con nosotros! Esperamos verte de nuevo muy pronto. ¡Buen viaje de regreso! 🌊🌴`
    }
  },
  pago: {
    email: {
      asunto: '💳 Pago Registrado con Éxito — Reserva #{{id}}',
      contenido: `<h2>💳 Pago Registrado con Éxito</h2>
<p style="color:#4a5568;">Hola <strong>{{cliente_nombre_completo}}</strong>, hemos recibido y registrado tu abono a tu estadía en {{hotel_nombre}}.</p>

<div class="highlight">
  <div class="amount" style="color:#22863a;">+ {{pago_monto}}</div>
  <div class="label">{{pago_concepto}} — {{pago_metodo}}</div>
  <div style="font-size:12px;color:#718096;margin-top:4px;">Ref: {{pago_referencia}} | Fecha: {{pago_fecha}}</div>
</div>

<table class="detail-table">
  <tr><td>📋 Reserva</td><td>#{{id}}</td></tr>
  <tr><td>🏠 Habitación</td><td>{{habitacion}}</td></tr>
  <tr><td>💰 Total estadía</td><td>{{monto_total}}</td></tr>
  <tr><td>✅ Total pagado</td><td style="color:#22863a;">{{monto_pagado}}</td></tr>
  <tr><td>📊 Saldo</td><td style="font-weight:bold;color:#e53e3e;">{{saldo_pendiente}}</td></tr>
</table>

<p style="color:#718096;font-size:12px;margin-top:20px;text-align:center;">Si tienes alguna pregunta sobre este cargo, no dudes en escribirnos por WhatsApp al {{hotel_telefono}}.</p>`
    },
    whatsapp: {
      asunto: null,
      contenido: `💳 *Pago Registrado* — {{hotel_nombre}}

Hola {{cliente_nombre_completo}}, hemos registrado un nuevo pago para tu reserva:

✅ Monto: {{pago_monto}}
📝 Concepto: {{pago_concepto}}
💳 Método: {{pago_metodo}}

📋 Reserva: #{{id}}
💰 Total: {{monto_total}}
✅ Pagado: {{monto_pagado}}
⚠️ Saldo pendiente: {{saldo_pendiente}}

¡Muchas gracias! 🙏`
    }
  },
  recordatorio: {
    email: {
      asunto: '📅 Recordatorio — Tu estadía es {{etiqueta_dias}} — {{hotel_nombre}}',
      contenido: `<h2>📅 ¡Falta poco para tu viaje!</h2>
<p style="color:#4a5568;">Hola <strong>{{cliente_nombre_completo}}</strong>, te recordamos que tu reserva en {{hotel_nombre}} inicia <strong>{{etiqueta_dias}}</strong>.</p>

<table class="detail-table">
  <tr><td>📅 Check-in</td><td><strong>{{check_in_formateado}}</strong> (A partir de las 2:00 PM)</td></tr>
  <tr><td>📅 Check-out</td><td>{{check_out_formateado}} (Antes de las 12:00 PM)</td></tr>
  <tr><td>🏠 Habitación</td><td>{{habitacion}}</td></tr>
  <tr><td>🍽️ Plan</td><td>{{plan}}</td></tr>
</table>

<div class="highlight">
  <div class="label">Saldo pendiente a tu llegada:</div>
  <div class="amount" style="color:#e53e3e;">{{saldo_pendiente}}</div>
</div>

<p style="color:#718096;font-size:14px;">
  <strong>📍 Dirección:</strong> {{hotel_direccion}}<br>
  <strong>🅿️ Estacionamiento:</strong> Disponible y gratuito en el hotel<br>
  <strong>📶 WiFi:</strong> Conexión disponible de alta velocidad
</p>

<p style="color:#4a5568;">¡El mar, la playa y el sol te esperan! Buen viaje. 🌴🌊🌊</p>`
    },
    whatsapp: {
      asunto: null,
      contenido: `📅 *Recordatorio* — {{hotel_nombre}}

Hola {{cliente_nombre_completo}} 👋

Te recordamos que tu estadía inicia *{{etiqueta_dias}}*:

📅 Check-in: {{check_in}} (2:00 PM)
🏠 Habitación: {{habitacion}}
💰 Saldo pendiente: {{saldo_pendiente}}

📍 Ubicación: {{hotel_direccion}}

¡Te esperamos con la mejor energía! 🌊🌴`
    }
  },
  admin_notif: {
    email: {
      asunto: '🔔 Nueva Reserva — {{cliente_nombre_completo}} — {{check_in_formateado}}',
      contenido: `<h2>🔔 Nueva Reserva Recibida</h2>
<p style="color:#4a5568;">Se ha registrado una nueva reserva en el sistema de Hotel Panamá Canal.</p>

<table class="detail-table">
  <tr><td>👤 Huésped</td><td><strong>{{cliente_nombre_completo}}</strong></td></tr>
  <tr><td>📧 Email</td><td>{{email}}</td></tr>
  <tr><td>📱 WhatsApp/Tel</td><td>{{whatsapp}}</td></tr>
  <tr><td>📅 Check-in</td><td><strong>{{check_in_formateado}}</strong></td></tr>
  <tr><td>📅 Check-out</td><td><strong>{{check_out_formateado}}</strong></td></tr>
  <tr><td>🌙 Noches</td><td>{{noches}}</td></tr>
  <tr><td>🏠 Habitación</td><td>{{habitacion}}</td></tr>
  <tr><td>🍽️ Plan</td><td>{{plan}}</td></tr>
  <tr><td>💰 Total</td><td><strong>{{monto_total}}</strong></td></tr>
  <tr><td>📝 Fuente</td><td>{{fuente}}</td></tr>
  <tr><td>📝 Notas</td><td>{{notas}}</td></tr>
</table>

<p style="text-align:center;">
  <a href="{{hotel_url}}" class="btn">Ir al PMS de Hotel Panamá Canal</a>
</p>`
    }
  }
};

// 1. Get all templates
router.get('/notificaciones/plantillas', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const templates = db.prepare('SELECT codigo, canal, nombre, asunto, contenido, variables, updated_at FROM notificaciones_plantillas ORDER BY nombre ASC, canal ASC').all();
    
    // Parse variables JSON string if needed
    const parsedTemplates = templates.map(t => ({
      ...t,
      variables: t.variables ? JSON.parse(t.variables) : []
    }));
    
    ok(res, parsedTemplates);
  } catch (e) {
    console.error('Error fetching templates:', e);
    err(res, 'SERVER_ERROR', 'Error al obtener las plantillas', 500);
  }
});

// 2. Get single template by code and canal
router.get('/notificaciones/plantillas/:codigo/:canal', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { codigo, canal } = req.params;
    const db = getDb();
    const template = db.prepare('SELECT codigo, canal, nombre, asunto, contenido, variables, updated_at FROM notificaciones_plantillas WHERE codigo = ? AND canal = ?').get(codigo, canal);
    
    if (!template) {
      return err(res, 'NOT_FOUND', 'Plantilla no encontrada', 404);
    }
    
    template.variables = template.variables ? JSON.parse(template.variables) : [];
    ok(res, template);
  } catch (e) {
    console.error('Error fetching template:', e);
    err(res, 'SERVER_ERROR', 'Error al obtener la plantilla', 500);
  }
});

// 3. Update single template by code and canal
router.put('/notificaciones/plantillas/:codigo/:canal', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { codigo, canal } = req.params;
    const { asunto, contenido } = req.body;
    
    if (contenido === undefined || contenido === null) {
      return err(res, 'VALIDATION_ERROR', 'El contenido de la plantilla es requerido');
    }
    
    const db = getDb();
    
    // Check if template exists
    const template = db.prepare('SELECT codigo FROM notificaciones_plantillas WHERE codigo = ? AND canal = ?').get(codigo, canal);
    if (!template) {
      return err(res, 'NOT_FOUND', 'Plantilla no encontrada', 404);
    }
    
    db.prepare(`
      UPDATE notificaciones_plantillas 
      SET asunto = ?, contenido = ?, updated_at = datetime('now')
      WHERE codigo = ? AND canal = ?
    `).run(asunto || null, contenido, codigo, canal);
    
    ok(res, { success: true, message: 'Plantilla actualizada con éxito' });
  } catch (e) {
    console.error('Error updating template:', e);
    err(res, 'SERVER_ERROR', 'Error al actualizar la plantilla', 500);
  }
});

// 4. Restore single template by code and canal
router.post('/notificaciones/plantillas/:codigo/:canal/restaurar', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { codigo, canal } = req.params;
    
    const codeDefaults = DEFAULT_TEMPLATES[codigo];
    if (!codeDefaults || !codeDefaults[canal]) {
      return err(res, 'NOT_FOUND', 'Plantilla por defecto no encontrada para este código/canal', 404);
    }
    
    const db = getDb();
    
    const template = db.prepare('SELECT codigo FROM notificaciones_plantillas WHERE codigo = ? AND canal = ?').get(codigo, canal);
    if (!template) {
      return err(res, 'NOT_FOUND', 'Plantilla no encontrada en base de datos', 404);
    }
    
    const { asunto, contenido } = codeDefaults[canal];
    
    db.prepare(`
      UPDATE notificaciones_plantillas 
      SET asunto = ?, contenido = ?, updated_at = datetime('now')
      WHERE codigo = ? AND canal = ?
    `).run(asunto, contenido, codigo, canal);
    
    ok(res, { success: true, message: 'Plantilla restaurada a los valores predeterminados', asunto, contenido });
  } catch (e) {
    console.error('Error restoring template:', e);
    err(res, 'SERVER_ERROR', 'Error al restaurar la plantilla', 500);
  }
});

// Helper for simple replacement
function renderTemplate(templateBody, context) {
  if (!templateBody) return '';
  return templateBody.replace(/\{\{([a-zA-Z0-9_\-]+)\}\}/g, (match, p1) => {
    return context.hasOwnProperty(p1) ? (context[p1] !== null && context[p1] !== undefined ? context[p1] : '') : match;
  });
}

// 5. Preview single template by code and canal with dummy/mock context
router.post('/notificaciones/plantillas/:codigo/:canal/preview', requireAuth, requireRole('admin'), (req, res) => {
  try {
    const { codigo, canal } = req.params;
    const { asuntoCustom, contenidoCustom } = req.body;
    
    const db = getDb();
    const config = db.prepare('SELECT * FROM configuracion_sistema WHERE id = 1').get() || {};
    
    // Build dummy/mock context
    const mockContext = {
      id: 9999,
      cliente: 'Juan',
      apellido: 'Pérez',
      cliente_nombre_completo: 'Juan Pérez',
      email: 'juan.perez@example.com',
      telefono: '+507 6123-4567',
      whatsapp: '+507 6123-4567',
      check_in: '2026-06-15',
      check_out: '2026-06-18',
      check_in_formateado: 'lun, 15 jun 2026',
      check_out_formateado: 'jue, 18 jun 2026',
      noches: 3,
      hora_llegada: '15:30',
      adultos: 2,
      menores: 1,
      mascotas: 0,
      habitacion: 'Bohío 1',
      plan: 'Estadía Todo Incluido',
      plan_codigo: 'TI',
      subtotal: '$300.00',
      impuesto_monto: '$30.00',
      monto_total: '$330.00',
      monto_pagado: '$150.00',
      saldo_pendiente: '$180.00',
      pago_monto: '$150.00',
      pago_concepto: 'Abono 50% reserva',
      pago_metodo: 'Transferencia',
      pago_referencia: 'TXN-98765',
      pago_fecha: '2026-05-20',
      dias_restantes: 5,
      etiqueta_dias: 'en 5 días',
      fuente: 'Directa',
      notas: 'Llega tarde, requiere cuna.',
      
      // Dynamic property values from configuracion_sistema:
      hotel_nombre: config.nombre_propiedad || 'Hotel Panamá Canal',
      hotel_url: 'https://example.invalid',
      hotel_telefono: config.hotel_telefono || '',
      hotel_correo: config.smtp_from || 'reservas@example.invalid',
      hotel_politica_cancelacion: config.hotel_politica_cancelacion || 'Las cancelaciones realizadas hasta 48 horas antes de la llegada no tienen cargo. Las cancelaciones tardías o no-show tienen una penalidad de 1 noche.',
      hotel_politica_reembolso: config.hotel_politica_reembolso || 'Los reembolsos se procesarán dentro de los 5-7 días hábiles posteriores a la aprobación, utilizando el mismo método de pago original.',
      hotel_direccion: config.hotel_direccion || 'Por configurar'
    };
    
    // Load from DB if custom not provided
    let template = null;
    if (asuntoCustom === undefined || contenidoCustom === undefined) {
      template = db.prepare('SELECT asunto, contenido FROM notificaciones_plantillas WHERE codigo = ? AND canal = ?').get(codigo, canal);
    }
    
    const rawSubject = asuntoCustom !== undefined ? asuntoCustom : (template?.asunto || '');
    const rawBody = contenidoCustom !== undefined ? contenidoCustom : (template?.contenido || '');
    
    const renderedSubject = rawSubject ? renderTemplate(rawSubject, mockContext) : '';
    const renderedBody = renderTemplate(rawBody, mockContext);
    
    let finalHtml = '';
    if (canal === 'email') {
      finalHtml = baseTemplate(renderedBody, renderedSubject, config);
    } else {
      finalHtml = renderedBody;
    }
    
    ok(res, {
      asunto: renderedSubject,
      contenido: finalHtml
    });
  } catch (e) {
    console.error('Error previewing template:', e);
    err(res, 'SERVER_ERROR', 'Error al generar la vista previa', 500);
  }
});

module.exports = router;
