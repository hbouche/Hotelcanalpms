const { getDb, findById } = require('../db/database');

// Get config value
function getConfig(key) {
  const db = getDb();
  const row = db.prepare('SELECT valor FROM config_hotel WHERE clave = ?').get(key);
  return row ? row.valor : null;
}

// Robust timezone-proof helper to parse any date input to a UTC timestamp
function parseDateToUTC(dateInput) {
  if (!dateInput) return Date.now();
  if (dateInput instanceof Date) {
    return Date.UTC(dateInput.getUTCFullYear(), dateInput.getUTCMonth(), dateInput.getUTCDate());
  }
  if (typeof dateInput === 'string') {
    const sanitizedInput = dateInput.replace(/\//g, '-');
    const dateStr = sanitizedInput.includes('T') ? sanitizedInput.split('T')[0] : sanitizedInput;
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      const day = parseInt(parts[2], 10);
      return Date.UTC(year, month - 1, day);
    }
  }
  const d = new Date(dateInput);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// Determine day type for a date (strictly timezone-proof)
function getDayType(dateStr) {
  const db = getDb();
  // Check holidays first
  const festivo = db.prepare('SELECT id FROM dias_festivos WHERE fecha = ?').get(dateStr);
  if (festivo) return 'festivo';

  // Parse using the UTC-based helper
  const utcTime = parseDateToUTC(dateStr);
  const d = new Date(utcTime);
  const dow = d.getUTCDay();

  // Fin de semana = Friday(5) and Saturday(6)
  if (dow === 5 || dow === 6) return 'fin_de_semana';
  return 'entre_semana';
}

// Get rate for a plan + day type
function getRateForDay(planId, tipoDia) {
  const db = getDb();
  return db.prepare('SELECT * FROM reglas_tarifa WHERE plan_id = ? AND tipo_dia = ? AND activo = 1').get(planId, tipoDia);
}

// Calculate reservation totals (day-aware and category-aware)
function calcReservation(data) {
  const adultos = Math.max(1, parseInt(data.adultos) || 1);
  const menores = Math.max(0, parseInt(data.menores) || 0);
  const mascotas = Math.max(0, parseInt(data.mascotas) || 0);
  const noches = Math.max(1, parseInt(data.noches) || 1);
  const precioAdulto = Math.max(0, parseFloat(data.precio_adulto_noche) || 0);
  const precioMenor = Math.max(0, parseFloat(data.precio_menor_noche) || 0);
  const precioMascota = Math.max(0, parseFloat(data.precio_mascota_noche) || 0);
  const extras = Math.max(0, parseFloat(data.productos_adicionales) || 0);

  let impuestoPct = Number(getConfig('impuesto_turismo_pct') ?? 0);
  
  // If plan information is provided, fetch it
  let plan = null;
  if (data.plan_id) {
    plan = findById('planes_tarifa', data.plan_id);
  } else if (data.plan_codigo) {
    const db = getDb();
    plan = db.prepare('SELECT * FROM planes_tarifa WHERE codigo = ?').get(data.plan_codigo);
  }

  if (plan) {
    if (plan.lleva_impuesto === 0) {
      impuestoPct = 0;
    } else if (plan.impuesto_pct !== undefined && plan.impuesto_pct !== null) {
      impuestoPct = plan.impuesto_pct;
    }
  }

  // Explicit override in data (if defined)
  if (data.impuesto_pct !== undefined && data.impuesto_pct !== null && data.impuesto_pct !== '') {
    impuestoPct = parseFloat(data.impuesto_pct);
  }
  if (data.lleva_impuesto === 0 || data.lleva_impuesto === '0' || data.lleva_impuesto === false) {
    impuestoPct = 0;
  }

  const depositoPct = Number(getConfig('deposito_sugerido_pct') ?? 0);

  // For Pasadía, pricing is per person and not multiplied by nights
  const esPasadia = plan && plan.categoria === 'Pasadía';
  const subtotalMultiplier = esPasadia ? 1 : noches;

  const baseAdultosMonto = plan?.base_cobro === 'habitacion' ? precioAdulto : adultos * precioAdulto;
  const subtotal = Math.round((baseAdultosMonto + (menores * precioMenor) + (mascotas * precioMascota)) * subtotalMultiplier * 100) / 100;
  const impuestoMonto = Math.round((subtotal + extras) * (impuestoPct / 100) * 100) / 100;
  const montoTotal = Math.round((subtotal + extras + impuestoMonto) * 100) / 100;
  const depositoSugerido = Math.round(montoTotal * (depositoPct / 100) * 100) / 100;
  const montoPagado = Math.max(0, parseFloat(data.monto_pagado) || 0);
  const saldoPendiente = Math.round((montoTotal - montoPagado) * 100) / 100;

  return {
    subtotal,
    productos_adicionales: extras,
    impuesto_pct: impuestoPct,
    impuesto_monto: impuestoMonto,
    monto_total: montoTotal,
    deposito_sugerido: depositoSugerido,
    monto_pagado: montoPagado,
    saldo_pendiente: saldoPendiente
  };
}

// Calculate with day-based rates (strictly timezone-proof and category-aware)
function calcReservationWithRates(planId, checkIn, checkOut, adultos, menores, mascotas) {
  const db = getDb();
  const clAdultos = Math.max(1, parseInt(adultos) || 1);
  const clMenores = Math.max(0, parseInt(menores) || 0);
  const clMascotas = Math.max(0, parseInt(mascotas) || 0);
  const noches = Math.max(1, calcNoches(checkIn, checkOut));
  const plan = findById('planes_tarifa', planId);

  let impuestoPct = Number(getConfig('impuesto_turismo_pct') ?? 0);
  if (plan) {
    if (plan.lleva_impuesto === 0) {
      impuestoPct = 0;
    } else if (plan.impuesto_pct !== undefined && plan.impuesto_pct !== null) {
      impuestoPct = plan.impuesto_pct;
    }
  }

  const depositoPct = Number(getConfig('deposito_sugerido_pct') ?? 0);

  const desglose = []; // per-night breakdown
  let subtotal = 0;

  const startUtc = parseDateToUTC(checkIn);
  const esPasadia = plan && plan.categoria === 'Pasadía';

  // For Pasadía, the loop runs exactly once (since noches = 1 if checkIn === checkOut)
  const iterations = esPasadia ? 1 : noches;

  for (let i = 0; i < iterations; i++) {
    const d = new Date(startUtc);
    d.setUTCDate(d.getUTCDate() + i);

    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    const tipoDia = getDayType(dateStr);
    const rate = getRateForDay(planId, tipoDia);

    let pAdulto, pMenor, pMascota;
    if (rate) {
      pAdulto = Math.max(0, rate.precio_adulto);
      pMenor = Math.max(0, rate.precio_menor);
      pMascota = Math.max(0, rate.precio_mascota);
    } else {
      // Fallback to plan base price
      pAdulto = plan ? Math.max(0, plan.precio_adulto_noche) : 0;
      pMenor = plan ? Math.max(0, plan.precio_menor_noche) : 0;
      pMascota = plan ? Math.max(0, plan.precio_mascota_noche) : 0;
    }

    const baseAdultosMonto = plan?.base_cobro === 'habitacion' ? pAdulto : clAdultos * pAdulto;
    const nightTotal = Math.round((baseAdultosMonto + (clMenores * pMenor) + (clMascotas * pMascota)) * 100) / 100;
    subtotal += nightTotal;

    // Check if holiday
    const festivo = db.prepare('SELECT nombre FROM dias_festivos WHERE fecha = ?').get(dateStr);

    desglose.push({
      fecha: dateStr,
      dia: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][d.getUTCDay()],
      tipo_dia: tipoDia,
      festivo_nombre: festivo?.nombre || null,
      precio_adulto: pAdulto,
      precio_menor: pMenor,
      precio_mascota: pMascota,
      total_noche: nightTotal
    });
  }

  subtotal = Math.round(subtotal * 100) / 100;
  const impuestoMonto = Math.round(subtotal * (impuestoPct / 100) * 100) / 100;
  const montoTotal = Math.round((subtotal + impuestoMonto) * 100) / 100;
  const depositoSugerido = Math.round(montoTotal * (depositoPct / 100) * 100) / 100;

  return {
    subtotal, impuesto_pct: impuestoPct, impuesto_monto: impuestoMonto,
    monto_total: montoTotal, deposito_sugerido: depositoSugerido,
    desglose
  };
}

// Calculate nights between two dates (strictly timezone-proof)
function calcNoches(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 1;
  const t1 = parseDateToUTC(checkIn);
  const t2 = parseDateToUTC(checkOut);
  const diff = Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 1;
}

module.exports = {
  getConfig,
  getDayType,
  getRateForDay,
  calcReservation,
  calcReservationWithRates,
  calcNoches,
  parseDateToUTC
};
