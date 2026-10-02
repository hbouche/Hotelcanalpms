/**
 * ══════════════════════════════════════════════
 * Hotel Panamá Canal PMS — Cloudbeds Import Module
 * ══════════════════════════════════════════════
 * 
 * Parses CSV/XLSX exports from Cloudbeds and maps
 * them into our PMS schema (reservas_hotel, folio_hotel).
 * 
 * Handles:
 * - Smart column detection (fuzzy header matching)
 * - Status mapping (Cloudbeds → PMS)
 * - Room assignment by name or type
 * - Financial calculations
 * - Duplicate detection
 * - Payment/transaction import
 */

const Papa = require('papaparse');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// ══════════════════════════════════════
// COLUMN MAPPING — Cloudbeds variations
// ══════════════════════════════════════

// Each PMS field has multiple possible Cloudbeds header names
const COLUMN_MAP = {
  reservation_id: [
    'room reservation number', 'reservation number', 'reservation id', 'reservation_id', 'reservationid', 'res id', 'booking id',
    'booking_id', 'id', 'confirmation', 'confirmation number', 'conf #', 'conf#'
  ],
  first_name: [
    'primary guest full name', 'guest full name', 'first name', 'first_name', 'firstname', 'guest first name', 'guest_first_name',
    'nombre', 'guest name', 'name'
  ],
  last_name: [
    'last name', 'last_name', 'lastname', 'surname', 'guest last name',
    'guest_last_name', 'apellido', 'family name'
  ],
  email: [
    'email', 'e-mail', 'guest email', 'guest_email', 'correo', 'email address'
  ],
  phone: [
    'phone', 'telephone', 'phone number', 'phone_number', 'guest phone',
    'guest_phone', 'tel', 'telefono', 'teléfono', 'mobile', 'cell'
  ],
  check_in: [
    'check-in date', 'check in date', 'check-in', 'check_in', 'checkin', 'check in', 'arrival', 'arrival date',
    'arrival_date', 'start date', 'start_date', 'fecha entrada', 'fecha_entrada'
  ],
  check_out: [
    'check-out date', 'check out date', 'check-out', 'check_out', 'checkout', 'check out', 'departure', 'departure date',
    'departure_date', 'end date', 'end_date', 'fecha salida', 'fecha_salida'
  ],
  nights: [
    'room nights', 'nights', 'noches', 'length of stay', 'los', 'duration', 'stay length',
    'total nights', 'no. of nights'
  ],
  room_type: [
    'room types', 'room type', 'room_type', 'roomtype', 'type', 'accommodation type',
    'accommodation', 'tipo habitacion', 'tipo habitación', 'tipo_habitacion',
    'room type name', 'room category'
  ],
  room_name: [
    'room numbers', 'room number', 'room', 'room #', 'room_number', 'room name', 'room_name',
    'assignment', 'assigned room', 'habitacion', 'habitación', 'room no',
    'room no.', 'unit', 'unit name'
  ],
  adults: [
    'adults', 'adult', 'adultos', 'no. of adults', 'number of adults',
    'adult guests', 'pax adults', 'adult count'
  ],
  children: [
    'children', 'child', 'kids', 'menores', 'niños', 'no. of children',
    'number of children', 'child guests', 'pax children', 'child count'
  ],
  status: [
    'status', 'estado', 'reservation status', 'booking status', 'res status',
    'state'
  ],
  total: [
    'grand total', 'total', 'total amount', 'amount', 'total price',
    'reservation total', 'monto total', 'monto_total', 'total charge',
    'total (usd)', 'total ($)'
  ],
  balance: [
    'balance', 'balance due', 'remaining', 'saldo', 'saldo pendiente',
    'outstanding', 'amount due', 'unpaid'
  ],
  paid: [
    'paid', 'amount paid', 'total paid', 'payments', 'pagado', 'monto pagado',
    'collected', 'received'
  ],
  source: [
    'source', 'channel', 'booking source', 'booking_source', 'fuente',
    'origin', 'booking channel', 'ota', 'channel name'
  ],
  created: [
    'created', 'created at', 'created_at', 'booking date', 'booking_date',
    'reservation date', 'date created', 'date booked', 'booked on',
    'fecha creacion', 'fecha_creacion'
  ],
  notes: [
    'notes', 'note', 'notas', 'comments', 'guest notes', 'special requests',
    'remarks', 'internal notes', 'memo'
  ],
  country: [
    'country', 'nationality', 'nacionalidad', 'pais', 'país', 'guest country',
    'country of residence'
  ],
  // Additional fields
  rate_plan: [
    'rate plan', 'rate_plan', 'plan', 'package', 'rate', 'plan name',
    'rate plan name', 'tariff'
  ],
  arrival_time: [
    'arrival time', 'eta', 'estimated arrival', 'check-in time',
    'hora llegada', 'hora_llegada'
  ],
};

// ══════════════════════════════════════
// STATUS MAPPING
// ══════════════════════════════════════

const STATUS_MAP = {
  // English Cloudbeds statuses
  'confirmed':    'Confirmada',
  'not confirmed': 'Pendiente',
  'unconfirmed':  'Pendiente',
  'pending':      'Pendiente',
  'checked in':   'Hospedado',
  'in-house':     'Hospedado',
  'in house':     'Hospedado',
  'checked out':  'Check-Out',
  'check-out':    'Check-Out',
  'checkout':     'Check-Out',
  'cancelled':    'Cancelada',
  'canceled':     'Cancelada',
  'no show':      'No-Show',
  'no-show':      'No-Show',
  'noshow':       'No-Show',
  // Spanish (in case Cloudbeds is in Spanish)
  'confirmada':   'Confirmada',
  'pendiente':    'Pendiente',
  'hospedado':    'Hospedado',
  'cancelada':    'Cancelada',
};

// ══════════════════════════════════════
// SOURCE MAPPING
// ══════════════════════════════════════

const SOURCE_MAP = {
  'booking.com':    'Booking.com',
  'booking':        'Booking.com',
  'expedia':        'Expedia',
  'airbnb':         'Airbnb',
  'direct':         'Directo',
  'walk-in':        'Walk-In',
  'walkin':         'Walk-In',
  'walk in':        'Walk-In',
  'phone':          'Teléfono',
  'telephone':      'Teléfono',
  'email':          'Email',
  'website':        'Website',
  'booking engine': 'Website',
  'front desk':     'Recepción',
  'agoda':          'Agoda',
  'tripadvisor':    'TripAdvisor',
  'google':         'Google',
  'whatsapp':       'WhatsApp',
};

// ══════════════════════════════════════
// PARSER
// ══════════════════════════════════════

/**
 * Parse file contents based on extension
 * @param {Buffer} fileBuffer
 * @param {string} filename
 * @returns {{ headers: string[], rows: object[] }}
 */
function parseFile(fileBuffer, filename) {
  const ext = path.extname(filename).toLowerCase();

  if (ext === '.xlsx' || ext === '.xls') {
    return parseExcel(fileBuffer);
  } else {
    return parseCSV(fileBuffer);
  }
}

function parseCSV(buffer) {
  const text = buffer.toString('utf-8');
  // Try to detect delimiter
  const firstLine = text.split('\n')[0];
  const delimiter = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';

  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    delimiter,
    transformHeader: h => h.trim(),
  });

  return {
    headers: result.meta.fields || [],
    rows: result.data,
    errors: result.errors,
  };
}

function parseExcel(buffer) {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellNF: true,
    cellStyles: true,
    cellDates: true,
    cellFormula: true,
    sheetStubs: true
  });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Pre-process Column A to resolve HYPERLINK formulas to actual names
  for (const key in sheet) {
    if (key.startsWith('A') && sheet[key]) {
      const cell = sheet[key];
      if (cell.f && cell.f.startsWith('HYPERLINK(')) {
        // Extract the second argument of HYPERLINK
        const match = cell.f.match(/HYPERLINK\(".*?",\s*"([^"]+)"\)/);
        if (match && match[1]) {
          cell.v = match[1];
          cell.t = 's';
          cell.w = match[1];
          cell.h = match[1];
        } else {
          const displayMatch = cell.f.match(/display=([^&"]+)/);
          if (displayMatch && displayMatch[1]) {
            const decoded = decodeURIComponent(displayMatch[1]);
            cell.v = decoded;
            cell.t = 's';
            cell.w = decoded;
            cell.h = decoded;
          }
        }
      }
    }
  }

  // Check if this sheet starts with the Cloudbeds history metadata
  // (metadata headers typically shift actual headers down to row 6 / index 5)
  const cellA6Val = sheet['A6'] ? (sheet['A6'].v || '').toString().toLowerCase() : '';
  const isHistoryReport = cellA6Val.includes('name') || cellA6Val.includes('guest') || cellA6Val.includes('nombre') || cellA6Val.includes('primary');
  
  const rangeVal = isHistoryReport ? 5 : 0;
  const data = XLSX.utils.sheet_to_json(sheet, { range: rangeVal, defval: '' });
  const headers = data.length > 0 ? Object.keys(data[0]) : [];

  return {
    headers,
    rows: data,
    errors: [],
  };
}

// ══════════════════════════════════════
// COLUMN DETECTION
// ══════════════════════════════════════

/**
 * Auto-detect which file headers map to which PMS fields
 * @param {string[]} fileHeaders 
 * @returns {{ mapping: object, unmapped: string[] }}
 */
function detectColumns(fileHeaders) {
  const mapping = {};     // pmsField -> fileHeader
  const used = new Set();
  const normalized = fileHeaders.map(h => h.toLowerCase().trim());

  // Helper to safely check if a variant is a full word match in a header
  const isWordMatch = (header, variant) => {
    const escaped = variant.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    // If the variant starts/ends with alphanumeric, enforce boundary, otherwise don't.
    const startBoundary = /^[a-z0-9]/i.test(variant) ? '\\b' : '';
    const endBoundary = /[a-z0-9]$/i.test(variant) ? '\\b' : '';
    const regex = new RegExp(startBoundary + escaped + endBoundary);
    return regex.test(header);
  };

  for (const [pmsField, variations] of Object.entries(COLUMN_MAP)) {
    for (const variant of variations) {
      const idx = normalized.indexOf(variant);
      if (idx !== -1 && !used.has(idx)) {
        mapping[pmsField] = fileHeaders[idx]; // original case
        used.add(idx);
        break;
      }
    }
  }

  // Also try partial matching for headers not yet mapped
  for (const [pmsField, variations] of Object.entries(COLUMN_MAP)) {
    if (mapping[pmsField]) continue; // already mapped
    for (const variant of variations) {
      const idx = normalized.findIndex((h, i) => !used.has(i) && isWordMatch(h, variant));
      if (idx !== -1) {
        mapping[pmsField] = fileHeaders[idx];
        used.add(idx);
        break;
      }
    }
  }

  const unmapped = fileHeaders.filter((_, i) => !used.has(i));
  return { mapping, unmapped };
}

// ══════════════════════════════════════
// DATE PARSER
// ══════════════════════════════════════

/**
 * Parse various date formats into YYYY-MM-DD
 */
function parseDate(value) {
  if (!value) return null;

  // If already a Date object (from XLSX)
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }

  const str = String(value).trim();
  if (!str) return null;

  // ISO format: 2026-03-15 or 2026-03-15T...
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.substring(0, 10);
  }

  // US format: 03/15/2026 or 3/15/2026
  const usMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (usMatch) {
    return `${usMatch[3]}-${usMatch[1].padStart(2, '0')}-${usMatch[2].padStart(2, '0')}`;
  }

  // EU format: 15/03/2026 (day > 12 tells us it's DD/MM)
  const euMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (euMatch && parseInt(euMatch[1]) > 12) {
    return `${euMatch[3]}-${euMatch[2].padStart(2, '0')}-${euMatch[1].padStart(2, '0')}`;
  }

  // Try native Date parse as fallback
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }

  return null;
}

// ══════════════════════════════════════
// ROW PROCESSOR
// ══════════════════════════════════════

/**
 * Extract a row's value using the detected mapping
 */
function getValue(row, mapping, pmsField) {
  const header = mapping[pmsField];
  if (!header) return null;
  const val = row[header];
  if (val === undefined || val === null || val === '') return null;
  return typeof val === 'string' ? val.trim() : val;
}

/**
 * Process a single row into a PMS reservation object
 */
function processRow(row, mapping, rooms, plans, guestsMap) {
  const errors = [];
  const warnings = [];

  // Helper to clean promotional suffixes from guest names
  const cleanPromoName = (name) => {
    if (!name) return '';
    let cleaned = String(name).trim();
    const suffixes = [
      /ofert[as]\s+simple/i,
      /mahana\s+experience/i,
      /tod[os]\s+incluid[os]/i,
      /todo\s+incluido/i,
      /experiencia\s+mahana/i
    ];
    suffixes.forEach(regex => {
      cleaned = cleaned.replace(regex, '');
    });
    return cleaned.replace(/\s+/g, ' ').trim();
  };

  // ── Required: Guest name ──
  let rawCliente = getValue(row, mapping, 'first_name');
  let rawApellido = getValue(row, mapping, 'last_name');

  let cliente = cleanPromoName(rawCliente);
  let apellido = cleanPromoName(rawApellido);
  
  // Handle case where full name is in one field
  if (cliente && !apellido && cliente.includes(' ')) {
    const parts = cliente.split(' ');
    cliente = parts[0];
    apellido = parts.slice(1).join(' ');
  }

  if (!cliente) {
    errors.push('Sin nombre de huésped');
    return { data: null, errors, warnings };
  }

  // ── Required: Dates ──
  const checkIn = parseDate(getValue(row, mapping, 'check_in'));
  const checkOut = parseDate(getValue(row, mapping, 'check_out'));

  if (!checkIn) {
    errors.push('Sin fecha de check-in');
    return { data: null, errors, warnings };
  }
  if (!checkOut) {
    errors.push('Sin fecha de check-out');
    return { data: null, errors, warnings };
  }

  if (checkOut <= checkIn) {
    errors.push(`Check-out (${checkOut}) no es posterior a check-in (${checkIn})`);
    return { data: null, errors, warnings };
  }

  // ── Nights ──
  const rawNights = getValue(row, mapping, 'nights');
  const d1 = new Date(checkIn);
  const d2 = new Date(checkOut);
  const calcNoches = Math.ceil((d2 - d1) / (1000 * 60 * 60 * 24));
  const noches = rawNights ? parseInt(rawNights) : calcNoches;

  // ── Room ──
  let habitacionId = null;
  let tipoHabitacion = '';
  
  const roomName = getValue(row, mapping, 'room_name');
  const roomType = getValue(row, mapping, 'room_type');

  // Try to match room by name
  if (roomName && String(roomName).trim() !== '-' && String(roomName).trim() !== '') {
    const room = rooms.find(r => 
      r.nombre.toLowerCase() === String(roomName).toLowerCase() ||
      r.nombre.toLowerCase().includes(String(roomName).toLowerCase())
    );
    if (room) {
      habitacionId = room.id;
      tipoHabitacion = room.tipo;
    } else {
      warnings.push(`Habitación "${roomName}" no encontrada en PMS`);
    }
  }

  // Try to match by room type
  if (!habitacionId && roomType) {
    tipoHabitacion = mapRoomType(roomType);
    // Find rooms of this specific type (distribute evenly)
    const matchingRooms = rooms.filter(r => r.tipo.toLowerCase() === tipoHabitacion.toLowerCase());
    if (matchingRooms.length > 0) {
      if (!global.roomRotationIndex) global.roomRotationIndex = {};
      if (global.roomRotationIndex[tipoHabitacion] === undefined) {
        global.roomRotationIndex[tipoHabitacion] = 0;
      }
      const roomIdx = global.roomRotationIndex[tipoHabitacion] % matchingRooms.length;
      const room = matchingRooms[roomIdx];
      global.roomRotationIndex[tipoHabitacion]++;
      
      habitacionId = room.id;
    } else {
      warnings.push(`Tipo "${roomType}" no mapeado a habitación PMS`);
    }
  }

  // ── Status ──
  const rawStatus = getValue(row, mapping, 'status');
  let estado = 'Confirmada';
  if (rawStatus) {
    const mapped = STATUS_MAP[String(rawStatus).toLowerCase()];
    if (mapped) {
      estado = mapped;
    } else {
      warnings.push(`Estado desconocido: "${rawStatus}", usando "Confirmada"`);
    }
  }

  // ── Guests ──
  const adultos = parseInt(getValue(row, mapping, 'adults')) || 1;
  const menores = parseInt(getValue(row, mapping, 'children')) || 0;

  // ── Financial ──
  const rawTotal = getValue(row, mapping, 'total');
  const rawBalance = getValue(row, mapping, 'balance');
  const rawPaid = getValue(row, mapping, 'paid');

  const montoTotal = parseFloat(rawTotal === '-' ? 0 : rawTotal) || 0;
  const saldoPendiente = parseFloat(rawBalance === '-' ? 0 : rawBalance) || 0;
  const montoPagado = parseFloat(rawPaid === '-' ? 0 : rawPaid) || (montoTotal - saldoPendiente);

  // ── Source ──
  const rawSource = getValue(row, mapping, 'source');
  let fuente = 'Cloudbeds';
  if (rawSource) {
    const mapped = SOURCE_MAP[String(rawSource).toLowerCase()];
    fuente = mapped || rawSource;
  }

  // ── Other fields ──
  const reservationId = getValue(row, mapping, 'reservation_id');
  let email = getValue(row, mapping, 'email') || '';
  let phone = getValue(row, mapping, 'phone') || '';
  let nationality = getValue(row, mapping, 'country') || '';
  const notes = getValue(row, mapping, 'notes');
  const createdAt = parseDate(getValue(row, mapping, 'created'));
  const ratePlan = getValue(row, mapping, 'rate_plan');
  const arrivalTime = getValue(row, mapping, 'arrival_time');

  // Enriquecer correo, teléfono y nacionalidad desde el directorio maestro de huéspedes si es posible
  if (guestsMap) {
    const fullNameLower = `${cliente} ${apellido}`.trim().toLowerCase();
    const guestMatch = (email && guestsMap.get(email.trim().toLowerCase())) || guestsMap.get(fullNameLower);
    
    if (guestMatch) {
      if (!email && guestMatch.email) email = guestMatch.email;
      if (!phone && guestMatch.telefono) phone = guestMatch.telefono;
      if (!nationality && guestMatch.pais) nationality = guestMatch.pais;
    }
  }

  // ── Build note with reference ──
  const noteParts = [];
  if (reservationId) noteParts.push(`CB#${reservationId}`);
  if (notes) noteParts.push(notes);
  const fullNotes = noteParts.join(' | ');

  // ── Calculate financials ──
  const impuestoPct = 10;
  const subtotal = montoTotal > 0 ? Math.round((montoTotal / (1 + impuestoPct / 100)) * 100) / 100 : 0;
  const impuestoMonto = Math.round((montoTotal - subtotal) * 100) / 100;
  const depositoPct = 50;
  const depositoSugerido = Math.round(montoTotal * (depositoPct / 100) * 100) / 100;

  // ── Price per night (reverse-calculated) ──
  const precioNoche = noches > 0 && subtotal > 0
    ? Math.round((subtotal / noches / Math.max(adultos, 1)) * 100) / 100
    : 0;

  const data = {
    cliente,
    apellido: apellido || '',
    email: email || '',
    whatsapp: phone || '',
    telefono: phone || '',
    nacionalidad: nationality || '',
    habitacion_id: habitacionId,
    tipo_habitacion: tipoHabitacion,
    check_in: checkIn,
    check_out: checkOut,
    noches,
    hora_llegada: arrivalTime || null,
    adultos,
    menores,
    mascotas: 0,
    plan_codigo: null,
    plan_nombre: ratePlan || '',
    precio_adulto_noche: precioNoche,
    precio_menor_noche: 0,
    precio_mascota_noche: 0,
    subtotal,
    productos_adicionales: 0,
    impuesto_pct: impuestoPct,
    impuesto_monto: impuestoMonto,
    monto_total: montoTotal,
    deposito_sugerido: depositoSugerido,
    monto_pagado: Math.max(0, montoPagado),
    saldo_pendiente: Math.max(0, montoTotal - Math.max(0, montoPagado)),
    estado,
    fuente: `${fuente} (CB Import)`,
    notas: fullNotes,
    created_by: 'Cloudbeds Import',
    created_at: createdAt || new Date().toISOString(),
    // Extra reference for duplicate detection
    _cb_reservation_id: reservationId,
    _cb_raw_status: rawStatus,
  };

  return { data, errors, warnings };
}

// ══════════════════════════════════════
// ROOM TYPE MAPPING
// ══════════════════════════════════════

function mapRoomType(cbType) {
  if (!cbType) return '';
  const lower = String(cbType).toLowerCase();

  // Direct matches
  if (lower.includes('familiar') || lower.includes('family')) return 'Familiar';
  if (lower.includes('doble') || lower.includes('double') || lower.includes('twin')) return 'Doble';
  if (lower.includes('estándar') || lower.includes('estandar') || lower.includes('standard')) return 'Estándar';
  if (lower.includes('camping') || lower.includes('tent') || lower.includes('glamping')) return 'Camping';
  if (lower.includes('bohío') || lower.includes('bohio') || lower.includes('cabana') || lower.includes('cabaña')) return 'Bohío';
  if (lower.includes('salón') || lower.includes('salon') || lower.includes('hall') || lower.includes('event')) return 'Salón';
  if (lower.includes('restaurante') || lower.includes('restaurant') || lower.includes('dining')) return 'Restaurante';
  if (lower.includes('suite')) return 'Familiar';
  if (lower.includes('single') || lower.includes('sencilla')) return 'Estándar';

  return cbType; // return as-is if no match
}

// ══════════════════════════════════════
// IMPORT RUNNER
// ══════════════════════════════════════

/**
 * Import parsed rows into PMS database
 * @param {object} db - SQLite database instance  
 * @param {object[]} rows - Parsed file rows
 * @param {object} mapping - Column mapping
 * @param {object} options - { dryRun, skipDuplicates }
 * @returns {object} Import results
 */
function runImport(db, rows, mapping, options = {}) {
  const { dryRun = false, skipDuplicates = true } = options;

  // Get rooms and plans for matching
  const rooms = db.prepare('SELECT * FROM habitaciones WHERE activa = 1 ORDER BY id').all();
  const plans = db.prepare('SELECT * FROM planes_tarifa WHERE activo = 1').all();

  // Load unified guests directory from guests.xlsx if it exists
  const guestsMap = new Map();
  try {
    const guestsPath = 'C:\\Users\\Usuario\\Downloads\\guests.xlsx';
    if (fs.existsSync(guestsPath)) {
      const workbook = XLSX.readFile(guestsPath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const guests = XLSX.utils.sheet_to_json(sheet);
      
      guests.forEach(g => {
        const email = g['Correo electrónico'] ? String(g['Correo electrónico']).trim().toLowerCase() : '';
        const name = g['Nombre'] ? String(g['Nombre']).trim() : '';
        const lastName = g['Apellido'] ? String(g['Apellido']).trim() : '';
        const fullName = `${name} ${lastName}`.trim().toLowerCase();
        
        const guestData = {
          email: email || '',
          telefono: g['Teléfono'] ? String(g['Teléfono']).trim() : '',
          pais: g['País'] ? String(g['País']).trim() : '',
        };
        
        if (email) {
          guestsMap.set(email, guestData);
        }
        if (fullName) {
          guestsMap.set(fullName, guestData);
        }
      });
      console.log(`Loaded ${guestsMap.size} guests from master directory guests.xlsx for enrichment.`);
    }
  } catch (e) {
    console.error('Failed to load guests.xlsx master directory for enrichment:', e.message);
  }

  const results = {
    total: rows.length,
    imported: 0,
    duplicates: 0,
    errors: 0,
    skipped: 0,
    details: [], // per-row results
  };

  const importTxn = db.transaction(() => {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;

      try {
        const { data, errors, warnings } = processRow(row, mapping, rooms, plans, guestsMap);

        if (errors.length > 0) {
          results.errors++;
          results.details.push({ row: rowNum, status: 'error', errors, warnings });
          continue;
        }

        // ── Duplicate check ──
        if (skipDuplicates) {
          const existing = db.prepare(`
            SELECT id FROM reservas_hotel 
            WHERE LOWER(cliente) = LOWER(?) AND check_in = ? AND check_out = ?
              AND estado NOT IN ('Cancelada', 'No-Show')
          `).get(data.cliente, data.check_in, data.check_out);

          // Also check by Cloudbeds reservation ID in notes
          let existingByCbId = null;
          if (data._cb_reservation_id) {
            existingByCbId = db.prepare(`
              SELECT id FROM reservas_hotel WHERE notas LIKE ?
            `).get(`%CB#${data._cb_reservation_id}%`);
          }

          if (existing || existingByCbId) {
            results.duplicates++;
            results.details.push({
              row: rowNum,
              status: 'duplicate',
              guest: `${data.cliente} ${data.apellido}`,
              dates: `${data.check_in} → ${data.check_out}`,
              existingId: (existing || existingByCbId)?.id,
              warnings,
            });
            continue;
          }
        }

        if (dryRun) {
          results.imported++;
          results.details.push({
            row: rowNum,
            status: 'preview',
            guest: `${data.cliente} ${data.apellido}`,
            dates: `${data.check_in} → ${data.check_out}`,
            room: data.tipo_habitacion || '—',
            total: data.monto_total,
            estado: data.estado,
            warnings,
          });
          continue;
        }

        // ── Insert reservation ──
        // Remove internal fields
        const cbId = data._cb_reservation_id;
        const cbStatus = data._cb_raw_status;
        delete data._cb_reservation_id;
        delete data._cb_raw_status;

        const fields = Object.keys(data);
        const placeholders = fields.map(() => '?').join(', ');
        const insertResult = db.prepare(
          `INSERT INTO reservas_hotel (${fields.join(', ')}) VALUES (${placeholders})`
        ).run(...Object.values(data));

        const reservaId = insertResult.lastInsertRowid;

        // ── Create folio entries ──
        if (data.subtotal > 0) {
          db.prepare(
            'INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, registrado_por, fecha) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(reservaId, 'debito', `Hospedaje (${data.noches} noches)`, data.subtotal, 'CB Import', data.check_in);
        }
        if (data.impuesto_monto > 0) {
          db.prepare(
            'INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, registrado_por, fecha) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(reservaId, 'debito', `Impuesto ${data.impuesto_pct}%`, data.impuesto_monto, 'CB Import', data.check_in);
        }
        if (data.monto_pagado > 0) {
          db.prepare(
            'INSERT INTO folio_hotel (reserva_id, tipo, concepto, monto, registrado_por, fecha) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(reservaId, 'credito', 'Pago registrado (Cloudbeds)', data.monto_pagado, 'CB Import', data.check_in);
        }

        // ── Update room status for active reservations ──
        if (data.habitacion_id && data.estado === 'Hospedado') {
          db.prepare('UPDATE habitaciones SET estado_habitacion = ? WHERE id = ?').run('Ocupada', data.habitacion_id);
        }

        results.imported++;
        results.details.push({
          row: rowNum,
          status: 'imported',
          reservaId,
          guest: `${data.cliente} ${data.apellido}`,
          dates: `${data.check_in} → ${data.check_out}`,
          room: data.tipo_habitacion || '—',
          total: data.monto_total,
          estado: data.estado,
          warnings,
        });

      } catch (e) {
        results.errors++;
        results.details.push({
          row: rowNum,
          status: 'error',
          errors: [e.message],
          warnings: [],
        });
      }
    }
  });

  if (!dryRun) {
    importTxn(); // Run as single transaction (atomic)
  } else {
    // For dry run, process without transaction
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;
      try {
        const { data, errors, warnings } = processRow(row, mapping, rooms, plans, guestsMap);
        if (errors.length > 0) {
          results.errors++;
          results.details.push({ row: rowNum, status: 'error', errors, warnings });
          continue;
        }
        // Duplicate check
        if (skipDuplicates) {
          const existing = db.prepare(`
            SELECT id FROM reservas_hotel 
            WHERE LOWER(cliente) = LOWER(?) AND check_in = ? AND check_out = ?
              AND estado NOT IN ('Cancelada', 'No-Show')
          `).get(data.cliente, data.check_in, data.check_out);
          let existingByCbId = null;
          if (data._cb_reservation_id) {
            existingByCbId = db.prepare(`SELECT id FROM reservas_hotel WHERE notas LIKE ?`).get(`%CB#${data._cb_reservation_id}%`);
          }
          if (existing || existingByCbId) {
            results.duplicates++;
            results.details.push({ row: rowNum, status: 'duplicate', guest: `${data.cliente} ${data.apellido}`, dates: `${data.check_in} → ${data.check_out}`, existingId: (existing || existingByCbId)?.id, warnings });
            continue;
          }
        }
        results.imported++;
        results.details.push({
          row: rowNum, status: 'preview',
          guest: `${data.cliente} ${data.apellido}`,
          dates: `${data.check_in} → ${data.check_out}`,
          room: data.tipo_habitacion || '—',
          total: data.monto_total,
          estado: data.estado,
          warnings,
        });
      } catch (e) {
        results.errors++;
        results.details.push({ row: rowNum, status: 'error', errors: [e.message], warnings: [] });
      }
    }
  }

  return results;
}

module.exports = {
  parseFile,
  detectColumns,
  runImport,
  COLUMN_MAP,
  STATUS_MAP,
  SOURCE_MAP,
};
