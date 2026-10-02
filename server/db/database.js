const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { hashPassword } = require('../auth');

const { DB_PATH, RESTORE_MARKER, acquireStorageLease } = require('../data-paths');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db;
let releaseStorage;

function getDb() {
  if (!db) {
    releaseStorage = acquireStorageLease();
    try {
    if (fs.existsSync(RESTORE_MARKER)) {
      throw new Error('An interrupted restore needs operator recovery before the PMS can start');
    }
    db = new Database(DB_PATH);
    fs.chmodSync(DB_PATH, 0o600);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');

    // Initialize schema
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    
    // If the table already exists, migrate it before executing the schema to avoid index creation errors
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reservas_hotel'").get();
    if (tableExists) {
      const resCols = db.prepare('PRAGMA table_info(reservas_hotel)').all().map(c => c.name);
      if (!resCols.includes('grupo_codigo')) {
        db.exec('ALTER TABLE reservas_hotel ADD COLUMN grupo_codigo TEXT');
      }
      if (!resCols.includes('es_maestra')) {
        db.exec('ALTER TABLE reservas_hotel ADD COLUMN es_maestra INTEGER DEFAULT 0');
      }
      if (!resCols.includes('metodo_pago')) {
        db.exec('ALTER TABLE reservas_hotel ADD COLUMN metodo_pago TEXT');
      }
      if (!resCols.includes('referencia')) {
        db.exec('ALTER TABLE reservas_hotel ADD COLUMN referencia TEXT');
      }
      if (!resCols.includes('parent_reserva_id')) {
        db.exec('ALTER TABLE reservas_hotel ADD COLUMN parent_reserva_id INTEGER');
      }
      if (!resCols.includes('facturacion_consolidada')) {
        db.exec('ALTER TABLE reservas_hotel ADD COLUMN facturacion_consolidada INTEGER DEFAULT 1');
      }
    }

    const notifExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notificaciones_log'").get();
    if (notifExists) {
      const notifCols = db.prepare('PRAGMA table_info(notificaciones_log)').all().map(c => c.name);
      if (!notifCols.includes('contenido')) {
        db.exec('ALTER TABLE notificaciones_log ADD COLUMN contenido TEXT');
      }
    }

    const folioExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='folio_hotel'").get();
    if (folioExists) {
      const folioCols = db.prepare('PRAGMA table_info(folio_hotel)').all().map(c => c.name);
      if (!folioCols.includes('comision_porcentaje')) {
        db.exec('ALTER TABLE folio_hotel ADD COLUMN comision_porcentaje REAL DEFAULT 0');
      }
    }

    const configSysExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='configuracion_sistema'").get();
    if (configSysExists) {
      const sysCols = db.prepare('PRAGMA table_info(configuracion_sistema)').all().map(c => c.name);
      if (!sysCols.includes('hotel_telefono')) {
        db.exec('ALTER TABLE configuracion_sistema ADD COLUMN hotel_telefono TEXT');
      }
      if (!sysCols.includes('hotel_politica_cancelacion')) {
        db.exec('ALTER TABLE configuracion_sistema ADD COLUMN hotel_politica_cancelacion TEXT');
      }
      if (!sysCols.includes('hotel_politica_reembolso')) {
        db.exec('ALTER TABLE configuracion_sistema ADD COLUMN hotel_politica_reembolso TEXT');
      }
      if (!sysCols.includes('hotel_direccion')) {
        db.exec('ALTER TABLE configuracion_sistema ADD COLUMN hotel_direccion TEXT');
      }
      if (!sysCols.includes('email_provider')) {
        db.exec("ALTER TABLE configuracion_sistema ADD COLUMN email_provider TEXT DEFAULT 'smtp'");
      }
      if (!sysCols.includes('resend_api_key')) {
        db.exec('ALTER TABLE configuracion_sistema ADD COLUMN resend_api_key TEXT');
      }
      if (!sysCols.includes('resend_from_email')) {
        db.exec('ALTER TABLE configuracion_sistema ADD COLUMN resend_from_email TEXT');
      }
    }

    const servicesExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='servicios_adicionales'").get();
    if (servicesExists) {
      const cols = db.prepare('PRAGMA table_info(servicios_adicionales)').all().map(c => c.name);
      if (!cols.includes('tipo_precio')) {
        db.exec("ALTER TABLE servicios_adicionales ADD COLUMN tipo_precio TEXT DEFAULT 'global'");
      }
    }

    const leadsExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='leads_clientes'").get();
    if (leadsExists) {
      const cols = db.prepare('PRAGMA table_info(leads_clientes)').all().map(c => c.name);
      if (!cols.includes('atendido')) {
        db.exec('ALTER TABLE leads_clientes ADD COLUMN atendido INTEGER DEFAULT 0');
      }
      if (!cols.includes('fecha_seguimiento')) {
        db.exec('ALTER TABLE leads_clientes ADD COLUMN fecha_seguimiento TEXT');
      }
      if (!cols.includes('oferta_mejora')) {
        db.exec('ALTER TABLE leads_clientes ADD COLUMN oferta_mejora INTEGER DEFAULT 0');
      }
    }

    db.exec(schema);

    // Source-derived fixtures run only in isolated automated tests.
    if (process.env.NODE_ENV === 'test') {
    // ── Seed habitaciones ──
    const roomCount = db.prepare('SELECT COUNT(*) as c FROM habitaciones').get();
    if (roomCount.c === 0) {
      const insertRoom = db.prepare('INSERT INTO habitaciones (nombre, tipo, categoria, capacidad, capacidad_min, capacidad_max, descripcion_camas) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const seedRooms = db.transaction(() => {
        // Estadía
        for (let i = 1; i <= 4; i++) insertRoom.run(`FAM(${i})`, 'Familiar', 'Estadía', 6, 2, 6, '1 King + 1 Litera');
        for (let i = 1; i <= 5; i++) insertRoom.run(`DOB(${i})`, 'Doble', 'Estadía', 4, 2, 4, '1 Queen + 1 Sencilla');
        for (let i = 1; i <= 3; i++) insertRoom.run(`EST(${i})`, 'Estándar', 'Estadía', 3, 2, 3, '1 Doble + 1 Sencilla');
        for (let i = 1; i <= 20; i++) insertRoom.run(`CAMP(${i})`, 'Camping', 'Estadía', 2, 1, 2, 'Tienda / Hamaca');
        // Pasadía
        for (let i = 1; i <= 17; i++) insertRoom.run(`BOHIO(${i})`, 'Bohío', 'Pasadía', 10, 1, 10, 'Bohío techado');
        insertRoom.run('SALON(1)', 'Salón', 'Pasadía', 50, 1, 50, 'Salón para eventos (~50 personas)');
        insertRoom.run('REST(1)', 'Restaurante', 'Pasadía', 40, 1, 40, 'Área de restaurante');
      });
      seedRooms();
      console.log('✅ Seeded habitaciones (Estadía + Pasadía)');
    } else {
      // Migration: add columns if missing and rename types
      const cols = db.prepare('PRAGMA table_info(habitaciones)').all().map(c => c.name);
      if (!cols.includes('capacidad_min')) {
        db.exec('ALTER TABLE habitaciones ADD COLUMN capacidad_min INTEGER DEFAULT 1');
        db.exec('ALTER TABLE habitaciones ADD COLUMN capacidad_max INTEGER DEFAULT 4');
        db.exec('ALTER TABLE habitaciones ADD COLUMN descripcion_camas TEXT');
      }
      if (!cols.includes('categoria')) {
        db.exec("ALTER TABLE habitaciones ADD COLUMN categoria TEXT DEFAULT 'Estadía'");
        // Rename old types
        db.exec("UPDATE habitaciones SET tipo = 'Doble' WHERE tipo = 'Standard'");
        db.exec("UPDATE habitaciones SET tipo = 'Estándar' WHERE tipo = 'Sencilla'");
        // Rename old room names
        db.exec("UPDATE habitaciones SET nombre = REPLACE(nombre, 'STD(', 'DOB(') WHERE nombre LIKE 'STD(%'");
        db.exec("UPDATE habitaciones SET nombre = REPLACE(nombre, 'SEN(', 'EST(') WHERE nombre LIKE 'SEN(%'");
        // Update capacity for renamed types
        db.exec("UPDATE habitaciones SET capacidad_min=2, capacidad_max=6, descripcion_camas='1 King + 1 Litera' WHERE tipo='Familiar'");
        db.exec("UPDATE habitaciones SET capacidad_min=2, capacidad_max=4, descripcion_camas='1 Queen + 1 Sencilla' WHERE tipo='Doble'");
        db.exec("UPDATE habitaciones SET capacidad_min=2, capacidad_max=3, descripcion_camas='1 Doble + 1 Sencilla' WHERE tipo='Estándar'");
        // Seed new rooms if not exist
        const insertRoom = db.prepare('INSERT INTO habitaciones (nombre, tipo, categoria, capacidad, capacidad_min, capacidad_max, descripcion_camas) VALUES (?, ?, ?, ?, ?, ?, ?)');
        const hasCamping = db.prepare("SELECT COUNT(*) as c FROM habitaciones WHERE tipo = 'Camping'").get().c;
        if (hasCamping === 0) {
          for (let i = 1; i <= 20; i++) insertRoom.run(`CAMP(${i})`, 'Camping', 'Estadía', 2, 1, 2, 'Tienda / Hamaca');
        }
        const hasBohio = db.prepare("SELECT COUNT(*) as c FROM habitaciones WHERE tipo = 'Bohío'").get().c;
        if (hasBohio === 0) {
          for (let i = 1; i <= 17; i++) insertRoom.run(`BOHIO(${i})`, 'Bohío', 'Pasadía', 10, 1, 10, 'Bohío techado');
          insertRoom.run('SALON(1)', 'Salón', 'Pasadía', 50, 1, 50, 'Salón para eventos (~50 personas)');
          insertRoom.run('REST(1)', 'Restaurante', 'Pasadía', 40, 1, 40, 'Área de restaurante');
        }
        console.log('✅ Migrated habitaciones: categoría + tipos renombrados + nuevas unidades');
      }
    }

    // ── Seed planes de tarifa ──
    const planCount = db.prepare('SELECT COUNT(*) as c FROM planes_tarifa').get();
    if (planCount.c === 0) {
      const insertPlan = db.prepare(`INSERT INTO planes_tarifa 
        (codigo, nombre, descripcion, categoria, precio_adulto_noche, precio_menor_noche, precio_mascota_noche, incluye, horario, extras_disponibles, tipos_aplicables, visible_web) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      // Estadía
      insertPlan.run('oferta_simple', 'Oferta Simple', 'Solo habitación, sin comidas', 'Estadía', 50, 25, 15,
        JSON.stringify(['Habitación', 'Estacionamiento', 'WiFi']),
        'Check-in 3:00 PM / Check-out 11:00 AM',
        JSON.stringify(['Desayuno $12', 'Almuerzo $15', 'Cena $18', 'Spa $25']),
        JSON.stringify(['Familiar', 'Doble', 'Estándar', 'Camping']), 0);
      insertPlan.run('demo_exp', 'Plan de prueba', 'Habitación + Desayuno buffet', 'Estadía', 70, 35, 15,
        JSON.stringify(['Habitación', 'Desayuno Buffet', 'Piscina', 'WiFi', 'Estacionamiento']),
        'Check-in 3:00 PM / Check-out 11:00 AM / Desayuno 7-10 AM',
        JSON.stringify(['Almuerzo $15', 'Cena $18', 'Spa $25', 'Tour $20']),
        JSON.stringify(['Familiar', 'Doble', 'Estándar']), 1);
      insertPlan.run('todo_incluido', 'Todo Incluido', 'Habitación + 3 comidas completas', 'Estadía', 90, 45, 15,
        JSON.stringify(['Habitación', 'Desayuno Buffet', 'Almuerzo', 'Cena', 'Piscina', 'WiFi', 'Estacionamiento', 'Snacks']),
        'Check-in 3:00 PM / Check-out 11:00 AM / Desayuno 7-10 AM / Almuerzo 12-3 PM / Cena 6-9 PM',
        JSON.stringify(['Spa $25', 'Tour $20', 'Masaje $30']),
        JSON.stringify(['Familiar', 'Doble', 'Estándar']), 1);
      insertPlan.run('open_bar', 'Open Bar Premium', 'Habitación + comidas + open bar ilimitado', 'Estadía', 120, 60, 15,
        JSON.stringify(['Habitación', 'Desayuno Buffet', 'Almuerzo', 'Cena', 'Open Bar', 'Piscina', 'WiFi', 'Estacionamiento', 'Snacks', 'Room Service']),
        'Check-in 3:00 PM / Check-out 11:00 AM / Bar 10 AM - 12 AM',
        JSON.stringify(['Spa $25', 'Tour $20']),
        JSON.stringify(['Familiar', 'Doble']), 0);
      // Pasadía
      insertPlan.run('pasadia_entrada', 'Pasadía Entrada', 'Solo acceso al área de piscina y playa', 'Pasadía', 5.50, 3, 0,
        JSON.stringify(['Acceso Piscina', 'Acceso Playa', 'Estacionamiento']),
        '9:00 AM - 5:00 PM',
        JSON.stringify(['Almuerzo $12', 'Cerveza $3', 'Cóctel $5', 'Bohío $15']),
        JSON.stringify(['Bohío', 'Salón', 'Restaurante']), 0);
      insertPlan.run('pasadia_comidas', 'Pasadía Comidas + Semi Open Bar', 'Acceso + comida + bebidas incluidas', 'Pasadía', 35, 20, 0,
        JSON.stringify(['Acceso Piscina', 'Acceso Playa', 'Almuerzo', 'Semi Open Bar (cerveza, ron, vodka)', 'Estacionamiento']),
        '9:00 AM - 5:00 PM / Almuerzo 12-2 PM / Bar 10 AM - 4 PM',
        JSON.stringify(['Cóctel Premium $5', 'Bohío $10', 'Masaje $25']),
        JSON.stringify(['Bohío', 'Salón', 'Restaurante']), 0);
      console.log('✅ Seeded planes (Estadía + Pasadía) con campos ricos');
    } else {
      // Migration: add new product columns if missing
      const planCols = db.prepare('PRAGMA table_info(planes_tarifa)').all().map(c => c.name);
      if (!planCols.includes('categoria')) {
        db.exec("ALTER TABLE planes_tarifa ADD COLUMN categoria TEXT DEFAULT 'Estadía'");
      }
      if (!planCols.includes('incluye')) {
        db.exec("ALTER TABLE planes_tarifa ADD COLUMN incluye TEXT");
        db.exec("ALTER TABLE planes_tarifa ADD COLUMN horario TEXT");
        db.exec("ALTER TABLE planes_tarifa ADD COLUMN extras_disponibles TEXT");
        db.exec("ALTER TABLE planes_tarifa ADD COLUMN tipos_aplicables TEXT");
        db.exec("ALTER TABLE planes_tarifa ADD COLUMN imagen TEXT");
        db.exec("ALTER TABLE planes_tarifa ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))");
        // Populate existing plans with rich data
        const updatePlan = db.prepare('UPDATE planes_tarifa SET incluye=?, horario=?, extras_disponibles=?, tipos_aplicables=? WHERE codigo=?');
        updatePlan.run(JSON.stringify(['Habitación', 'Estacionamiento', 'WiFi']), 'Check-in 3PM / Check-out 11AM', JSON.stringify(['Desayuno $12']), JSON.stringify(['Familiar','Doble','Estándar','Camping']), 'oferta_simple');
        updatePlan.run(JSON.stringify(['Habitación', 'Desayuno Buffet', 'Piscina', 'WiFi']), 'Check-in 3PM / Check-out 11AM', JSON.stringify(['Almuerzo $15', 'Spa $25']), JSON.stringify(['Familiar','Doble','Estándar']), 'demo_exp');
        updatePlan.run(JSON.stringify(['Habitación', 'Desayuno', 'Almuerzo', 'Cena', 'Piscina']), 'Check-in 3PM / Check-out 11AM', JSON.stringify(['Spa $25']), JSON.stringify(['Familiar','Doble','Estándar']), 'todo_incluido');
        updatePlan.run(JSON.stringify(['Habitación', 'Desayuno', 'Almuerzo', 'Cena', 'Open Bar', 'Piscina']), 'Check-in 3PM / Bar 10AM-12AM', JSON.stringify(['Spa $25']), JSON.stringify(['Familiar','Doble']), 'open_bar');
        updatePlan.run(JSON.stringify(['Acceso Piscina', 'Playa', 'Estacionamiento']), '9AM - 5PM', JSON.stringify(['Almuerzo $12', 'Bohío $15']), JSON.stringify(['Bohío','Salón','Restaurante']), 'pasadia_entrada');
        updatePlan.run(JSON.stringify(['Piscina', 'Playa', 'Almuerzo', 'Semi Open Bar']), '9AM - 5PM', JSON.stringify(['Cóctel Premium $5']), JSON.stringify(['Bohío','Salón','Restaurante']), 'pasadia_comidas');
        console.log('✅ Migrated planes: campos ricos (incluye, horario, extras, tipos)');
      }
      if (!planCols.includes('visible_web')) {
        db.exec("ALTER TABLE planes_tarifa ADD COLUMN visible_web INTEGER DEFAULT 0");
        db.exec("UPDATE planes_tarifa SET visible_web = 1 WHERE codigo IN ('demo_exp', 'todo_incluido')");
        console.log('✅ Migrated: visible_web (demo_exp + todo_incluido enabled)');
      }
      // Seed Pasadía plans if missing
      const hasPasadia = db.prepare("SELECT COUNT(*) as c FROM planes_tarifa WHERE codigo LIKE 'pasadia%'").get().c;
      if (hasPasadia === 0) {
        const insertPlan = db.prepare('INSERT INTO planes_tarifa (codigo, nombre, descripcion, categoria, precio_adulto_noche, precio_menor_noche, precio_mascota_noche) VALUES (?, ?, ?, ?, ?, ?, ?)');
        insertPlan.run('pasadia_entrada', 'Pasadía Entrada', 'Solo entrada al día', 'Pasadía', 5.50, 3, 0);
        insertPlan.run('pasadia_comidas', 'Pasadía Comidas + Semi Open Bar', 'Entrada + comidas + semi open bar', 'Pasadía', 35, 20, 0);
      }

      // Migration: add tax columns to planes_tarifa if missing
      if (!planCols.includes('lleva_impuesto')) {
        db.exec("ALTER TABLE planes_tarifa ADD COLUMN lleva_impuesto INTEGER DEFAULT 1");
        db.exec("ALTER TABLE planes_tarifa ADD COLUMN impuesto_pct REAL DEFAULT 10");
        console.log('✅ Migrated planes_tarifa: lleva_impuesto + impuesto_pct');
      }

      // Migration: add reconciliation columns to folio_hotel if missing
      const folioCols = db.prepare('PRAGMA table_info(folio_hotel)').all().map(c => c.name);
      if (!folioCols.includes('reconciliado')) {
        db.exec("ALTER TABLE folio_hotel ADD COLUMN reconciliado INTEGER DEFAULT 0");
        db.exec("ALTER TABLE folio_hotel ADD COLUMN fecha_reconciliacion TEXT");
        console.log('✅ Migrated folio_hotel: reconciliado + fecha_reconciliacion');
      }
    }

    db.prepare('UPDATE planes_tarifa SET impuesto_pct = 10').run();
    } // end test-only inventory/rate fixtures

    // ── Seed config ──
    const configCount = db.prepare('SELECT COUNT(*) as c FROM config_hotel').get();
    if (configCount.c === 0) {
      const insertConfig = db.prepare('INSERT INTO config_hotel (clave, valor, descripcion) VALUES (?, ?, ?)');
      insertConfig.run('impuesto_turismo_pct', process.env.NODE_ENV === 'test' ? '10' : '0', 'Impuesto turismo (%)');
      insertConfig.run('deposito_sugerido_pct', process.env.NODE_ENV === 'test' ? '50' : '0', 'Depósito sugerido (%)');
      insertConfig.run('moneda', 'USD', 'Moneda');
      insertConfig.run('nombre_propiedad', 'Hotel Panamá Canal', 'Nombre del hotel');
      insertConfig.run('paypal_client_id', '', 'PayPal Client ID');
      insertConfig.run('paypal_secret', '', 'PayPal Secret');
      insertConfig.run('paypal_mode', 'sandbox', 'PayPal mode: sandbox o live');
      console.log('✅ Seeded config');
    }

    if (process.env.NODE_ENV === 'test') {
    // ── Seed reglas de tarifa por día ──
    const reglasCount = db.prepare('SELECT COUNT(*) as c FROM reglas_tarifa').get();
    if (reglasCount.c === 0) {
      const insertRegla = db.prepare('INSERT INTO reglas_tarifa (plan_id, tipo_dia, precio_adulto, precio_menor, precio_mascota) VALUES (?, ?, ?, ?, ?)');
      const allPlans = db.prepare('SELECT id, codigo, precio_adulto_noche, precio_menor_noche, precio_mascota_noche FROM planes_tarifa').all();
      const seedReglas = db.transaction(() => {
        for (const p of allPlans) {
          // Entre semana = base price (already in plan)
          insertRegla.run(p.id, 'entre_semana', p.precio_adulto_noche, p.precio_menor_noche, p.precio_mascota_noche);
          // Fin de semana = ~25-30% más
          const wkendMult = p.codigo.startsWith('pasadia') ? 1.20 : 1.25;
          insertRegla.run(p.id, 'fin_de_semana',
            Math.round(p.precio_adulto_noche * wkendMult * 100) / 100,
            Math.round(p.precio_menor_noche * wkendMult * 100) / 100,
            p.precio_mascota_noche);
          // Festivo = ~40-50% más
          const festMult = p.codigo.startsWith('pasadia') ? 1.40 : 1.50;
          insertRegla.run(p.id, 'festivo',
            Math.round(p.precio_adulto_noche * festMult * 100) / 100,
            Math.round(p.precio_menor_noche * festMult * 100) / 100,
            p.precio_mascota_noche);
        }
      });
      seedReglas();
      console.log('✅ Seeded reglas de tarifa (entre_semana/fin_de_semana/festivo)');
    }

    // ── Seed días festivos (Panamá) ──
    const festivosCount = db.prepare('SELECT COUNT(*) as c FROM dias_festivos').get();
    if (festivosCount.c === 0) {
      const insertFestivo = db.prepare('INSERT INTO dias_festivos (fecha, nombre) VALUES (?, ?)');
      const festivos = [
        ['2026-01-01', 'Año Nuevo'], ['2026-01-09', 'Día de los Mártires'],
        ['2026-02-16', 'Carnaval Lunes'], ['2026-02-17', 'Carnaval Martes'],
        ['2026-04-03', 'Viernes Santo'], ['2026-05-01', 'Día del Trabajo'],
        ['2026-11-03', 'Separación de Colombia'], ['2026-11-04', 'Día de la Bandera'],
        ['2026-11-05', 'Consolidación de Colón'], ['2026-11-10', 'Primer Grito de Independencia'],
        ['2026-11-28', 'Independencia de España'], ['2026-12-08', 'Día de las Madres'],
        ['2026-12-25', 'Navidad'],
      ];
      for (const [f, n] of festivos) insertFestivo.run(f, n);
      console.log('✅ Seeded días festivos (Panamá 2026)');
    }

    } // end test-only prices and calendar

    // No default production login. An operator provides initial credentials in the host's secure UI.
    const userCount = db.prepare('SELECT COUNT(*) as c FROM usuarios').get();
    const isTest = process.env.NODE_ENV === 'test';
    const initialAdminEmail = isTest ? 'admin@example.invalid' : process.env.INITIAL_ADMIN_EMAIL;
    const adminEmail = (initialAdminEmail || '').trim().toLowerCase();
    const adminPassword = isTest ? 'test-only-admin-password' : process.env.INITIAL_ADMIN_PASSWORD;
    if (userCount.c === 0 && initialAdminEmail && adminPassword) {
      // Match login and staff-account normalization; never log credential values.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw new Error('INITIAL_ADMIN_EMAIL must be a valid email address');
      if (!isTest && adminPassword.length < 8) throw new Error('INITIAL_ADMIN_PASSWORD must have at least 8 characters');
      db.prepare('INSERT INTO usuarios (email, password_hash, nombre, rol) VALUES (?, ?, ?, ?)')
        .run(adminEmail, hashPassword(adminPassword), 'Administrador', 'admin');
      console.log('Initial administrator created (credentials are never logged).');
    }

    // Clean hotel setup: external accounts, contact details and policies start unset.
    db.prepare(`INSERT OR IGNORE INTO configuracion_sistema
      (id, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, admin_email,
       notifications_enabled, wa_api_url, wa_api_token, wa_from_number, wa_enabled,
       hotel_telefono, hotel_politica_cancelacion, hotel_politica_reembolso, hotel_direccion)
      VALUES (1, '', 587, '', '', '', '', 0, '', '', '', 0, '', '', '', '')`).run();

    // ── Seed notificaciones_plantillas ──
    const templatesCount = db.prepare('SELECT COUNT(*) as c FROM notificaciones_plantillas').get();
    if (templatesCount.c === 0) {
      const insertTemplate = db.prepare(`
        INSERT INTO notificaciones_plantillas (codigo, canal, nombre, asunto, contenido, variables)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      const seedTemplates = db.transaction(() => {
        // 1. Confirmacion - Email
        insertTemplate.run(
          'confirmacion', 'email', 'Confirmación de Reserva', '✅ Reserva Confirmada #{{id}} — {{hotel_nombre}}',
          `<h2>✅ ¡Reserva Confirmada!</h2>
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

<p style="color:#a0aec0;font-size:12px;">Si necesitas hacer cambios, contáctanos por WhatsApp al {{hotel_telefono}} o responde a este correo.</p>`,
          JSON.stringify(["id", "cliente", "apellido", "cliente_nombre_completo", "check_in_formateado", "check_out_formateado", "noches", "habitacion", "plan", "adultos", "menores", "monto_total", "monto_pagado", "saldo_pendiente", "hotel_nombre", "hotel_telefono", "hotel_url", "hotel_correo"])
        );

        // 2. Confirmacion - WhatsApp
        insertTemplate.run(
          'confirmacion', 'whatsapp', 'Confirmación de Reserva', null,
          `✅ *Reserva Confirmada* — {{hotel_nombre}}

Hola {{cliente_nombre_completo}} 👋

Tu reserva ha sido confirmada:
📋 #{{id}}
📅 {{check_in}} → {{check_out}} ({{noches}} noches)
🏠 {{habitacion}}
💰 Total: {{monto_total}}

Check-in: 2:00 PM
Check-out: 12:00 PM

¡Te esperamos! 🌊🌴`,
          JSON.stringify(["id", "cliente", "apellido", "cliente_nombre_completo", "check_in", "check_out", "noches", "habitacion", "monto_total", "hotel_nombre", "hotel_telefono", "hotel_url"])
        );

        // 3. Bienvenida - Email
        insertTemplate.run(
          'bienvenida', 'email', 'Bienvenida (Check-In)', '🎉 ¡Bienvenido! Reserva Hospedado #{{id}} — {{hotel_nombre}}',
          `<h2>🎉 ¡Bienvenido a {{hotel_nombre}}!</h2>
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
    📶 <strong>WiFi:</strong> Por configurar<br>
    🍽️ <strong>Restaurante:</strong> Por configurar<br>
    Consulta en recepción los servicios disponibles
  </p>
</div>`,
          JSON.stringify(["id", "cliente", "apellido", "cliente_nombre_completo", "check_in_formateado", "check_out_formateado", "habitacion", "hotel_nombre", "hotel_telefono", "hotel_url", "hotel_correo"])
        );

        // 4. Bienvenida - WhatsApp
        insertTemplate.run(
          'bienvenida', 'whatsapp', 'Bienvenida (Check-In)', null,
          `🎉 *¡Bienvenido!* — {{hotel_nombre}}

Hola {{cliente_nombre_completo}}, ¡tu check-in ha sido registrado con éxito!

📋 Reserva #{{id}}
🏠 Habitación: {{habitacion}}
📅 Check-out: {{check_out}} (12:00 PM)

📶 WiFi: Por configurar
🍽️ Restaurante: Por configurar

🎉 ¡Disfruta tu estadía con nosotros! 🌴🌊`,
          JSON.stringify(["id", "cliente", "apellido", "cliente_nombre_completo", "id", "habitacion", "check_out", "hotel_nombre"])
        );

        // 5. Checkout - Email
        insertTemplate.run(
          'checkout', 'email', 'Agradecimiento (Check-Out)', '👋 ¡Gracias por tu visita! Reserva Check-Out #{{id}} — {{hotel_nombre}}',
          `<h2>👋 ¡Gracias por hospedarte con nosotros!</h2>
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
<p style="color:#718096;font-size:13px;">¡Esperamos verte pronto de regreso en nuestro pequeño paraíso!</p>`,
          JSON.stringify(["id", "cliente", "apellido", "cliente_nombre_completo", "check_in_formateado", "check_out_formateado", "habitacion", "monto_total", "monto_pagado", "saldo_pendiente", "hotel_nombre", "hotel_telefono", "hotel_url", "hotel_correo"])
        );

        // 6. Checkout - WhatsApp
        insertTemplate.run(
          'checkout', 'whatsapp', 'Agradecimiento (Check-Out)', null,
          `👋 *¡Gracias por tu visita!* — {{hotel_nombre}}

Hola {{cliente_nombre_completo}}, tu salida ha sido registrada con éxito.

📋 Reserva #{{id}}
🏠 Habitación: {{habitacion}}
💰 Total: {{monto_total}}
✅ Pagado: {{monto_pagado}}
⚠️ Saldo pendiente: {{saldo_pendiente}}

🙏 ¡Muchas gracias por hospedarte con nosotros! Esperamos verte de nuevo muy pronto. ¡Buen viaje de regreso! 🌊🌴`,
          JSON.stringify(["id", "cliente", "apellido", "cliente_nombre_completo", "habitacion", "monto_total", "monto_pagado", "saldo_pendiente", "hotel_nombre"])
        );

        // 7. Pago - Email
        insertTemplate.run(
          'pago', 'email', 'Recibo de Pago', '💳 Pago Registrado con Éxito — Reserva #{{id}}',
          `<h2>💳 Pago Registrado con Éxito</h2>
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

<p style="color:#718096;font-size:12px;margin-top:20px;text-align:center;">Si tienes alguna pregunta sobre este cargo, no dudes en escribirnos por WhatsApp al {{hotel_telefono}}.</p>`,
          JSON.stringify(["id", "cliente", "apellido", "cliente_nombre_completo", "habitacion", "monto_total", "monto_pagado", "saldo_pendiente", "pago_monto", "pago_concepto", "pago_metodo", "pago_referencia", "pago_fecha", "hotel_nombre", "hotel_telefono", "hotel_url", "hotel_correo"])
        );

        // 8. Pago - WhatsApp
        insertTemplate.run(
          'pago', 'whatsapp', 'Recibo de Pago', null,
          `💳 *Pago Registrado* — {{hotel_nombre}}

Hola {{cliente_nombre_completo}}, hemos registrado un nuevo pago para tu reserva:

✅ Monto: {{pago_monto}}
📝 Concepto: {{pago_concepto}}
💳 Método: {{pago_metodo}}

📋 Reserva: #{{id}}
💰 Total: {{monto_total}}
✅ Pagado: {{monto_pagado}}
⚠️ Saldo pendiente: {{saldo_pendiente}}

¡Muchas gracias! 🙏`,
          JSON.stringify(["id", "cliente", "apellido", "cliente_nombre_completo", "pago_monto", "pago_concepto", "pago_metodo", "monto_total", "monto_pagado", "saldo_pendiente", "hotel_nombre"])
        );

        // 9. Recordatorio - Email
        insertTemplate.run(
          'recordatorio', 'email', 'Recordatorio de Estadía', '📅 Recordatorio — Tu estadía es {{etiqueta_dias}} — {{hotel_nombre}}',
          `<h2>📅 ¡Falta poco para tu viaje!</h2>
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

<p style="color:#4a5568;">¡El mar, la playa y el sol te esperan! Buen viaje. 🌴🌊🌊</p>`,
          JSON.stringify(["id", "cliente", "apellido", "cliente_nombre_completo", "check_in_formateado", "check_out_formateado", "habitacion", "plan", "saldo_pendiente", "dias_restantes", "etiqueta_dias", "hotel_nombre", "hotel_telefono", "hotel_url", "hotel_correo"])
        );

        // 10. Recordatorio - WhatsApp
        insertTemplate.run(
          'recordatorio', 'whatsapp', 'Recordatorio de Estadía', null,
          `📅 *Recordatorio* — {{hotel_nombre}}

Hola {{cliente_nombre_completo}} 👋

Te recordamos que tu estadía inicia *{{etiqueta_dias}}*:

📅 Check-in: {{check_in}} (2:00 PM)
🏠 Habitación: {{habitacion}}
💰 Saldo pendiente: {{saldo_pendiente}}

📍 Ubicación: {{hotel_direccion}}

¡Te esperamos con la mejor energía! 🌊🌴`,
          JSON.stringify(["id", "cliente", "apellido", "cliente_nombre_completo", "check_in", "habitacion", "saldo_pendiente", "etiqueta_dias", "hotel_nombre"])
        );

        // 11. Admin Notif - Email
        insertTemplate.run(
          'admin_notif', 'email', 'Notificación de Nueva Reserva (Admin)', '🔔 Nueva Reserva — {{cliente_nombre_completo}} — {{check_in_formateado}}',
          `<h2>🔔 Nueva Reserva Recibida</h2>
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
</p>`,
          JSON.stringify(["id", "cliente", "apellido", "cliente_nombre_completo", "email", "telefono", "whatsapp", "check_in_formateado", "check_out_formateado", "noches", "habitacion", "plan", "monto_total", "fuente", "notas", "hotel_nombre", "hotel_url"])
        );
      });
      seedTemplates();
      console.log('✅ Seeded notificaciones_plantillas database tables successfully');
    }

    if (process.env.NODE_ENV === 'test') {
    // ── Seed servicios_adicionales ──
    const servicesTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='servicios_adicionales'").get();
    if (servicesTableExists) {
      const activeServices = db.prepare('SELECT COUNT(*) as c FROM servicios_adicionales').get().c;
      if (activeServices === 0) {
        const insertService = db.prepare('INSERT INTO servicios_adicionales (nombre, descripcion, precio_base, tipo_precio, activo) VALUES (?, ?, ?, ?, 1)');
        const seedServices = db.transaction(() => {
          insertService.run('Desayuno para Grupo 👥', 'Servicio de buffet de desayuno para grupos', 10.00, 'por_persona');
          insertService.run('Tour Guiado 🌴', 'Tour guiado por las áreas de playa y senderos', 25.00, 'por_persona');
          insertService.run('Servicio de Animador 🎉', 'Animación y juegos grupales', 150.00, 'global');
          insertService.run('Servicio de DJ 🎵', 'DJ con equipamiento de sonido completo', 300.00, 'global');
          insertService.run('Transporte Especial 🚐', 'Servicio de van de ida y vuelta para grupos', 80.00, 'global');
        });
        seedServices();
        console.log('✅ Seeded servicios_adicionales successfully');
      } else {
        // Migration update for existing records
        db.prepare("UPDATE servicios_adicionales SET tipo_precio = 'por_persona' WHERE nombre IN ('Desayuno para Grupo 👥', 'Tour Guiado 🌴') AND (tipo_precio IS NULL OR tipo_precio = 'global')").run();
      }
    }

    } // end test-only service fixtures

    console.log('✅ Database initialized at', DB_PATH);
    } catch (error) {
      resetDb();
      throw error;
    }
  }
  return db;
}

// ── Table whitelist ──
const VALID_TABLES = [
  'habitaciones', 'planes_tarifa', 'reservas_hotel', 'folio_hotel', 
  'huespedes_reserva', 'huespedes', 'usuarios', 'config_hotel',
  'configuracion_sistema', 'reversiones_log', 'solicitudes_modificacion',
  'notificaciones_plantillas', 'leads_clientes', 'cotizaciones_custom', 'servicios_adicionales'
];



function validateTable(table) {
  if (!VALID_TABLES.includes(table)) throw new Error(`Invalid table: ${table}`);
}

// ── Generic CRUD ──
function findAll(table, { where = {}, orderBy = 'id DESC', page = 1, limit = 50 } = {}) {
  validateTable(table);
  const d = getDb();
  const conditions = [];
  const values = [];

  for (const [key, value] of Object.entries(where)) {
    if (value === undefined || value === null || value === '') continue;
    if (key.endsWith('_gte')) { conditions.push(`${key.replace('_gte', '')} >= ?`); values.push(value); }
    else if (key.endsWith('_lte')) { conditions.push(`${key.replace('_lte', '')} <= ?`); values.push(value); }
    else if (key.endsWith('_like')) { conditions.push(`${key.replace('_like', '')} LIKE ?`); values.push(`%${value}%`); }
    else { conditions.push(`${key} = ?`); values.push(value); }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;
  const { total } = d.prepare(`SELECT COUNT(*) as total FROM ${table} ${whereClause}`).get(...values);
  const data = d.prepare(`SELECT * FROM ${table} ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...values, limit, offset);
  return { data, meta: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) } };
}

function findById(table, id) {
  validateTable(table);
  return getDb().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
}

function create(table, data) {
  validateTable(table);
  const d = getDb();
  const fields = Object.keys(data);
  const placeholders = fields.map(() => '?').join(', ');
  const result = d.prepare(`INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders})`).run(...Object.values(data));
  return findById(table, result.lastInsertRowid);
}

function update(table, id, data) {
  validateTable(table);
  const d = getDb();
  try {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all();
    if (cols.some(c => c.name === 'updated_at')) data.updated_at = new Date().toISOString();
  } catch {}
  const fields = Object.keys(data);
  if (fields.length === 0) return findById(table, id);
  const setClause = fields.map(f => `${f} = ?`).join(', ');
  d.prepare(`UPDATE ${table} SET ${setClause} WHERE id = ?`).run(...Object.values(data), id);
  return findById(table, id);
}

function remove(table, id) {
  validateTable(table);
  const item = findById(table, id);
  if (!item) return null;
  getDb().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  return item;
}

function resetDb() {
  if (db) {
    db.close();
    db = null;
  }
  if (releaseStorage) {
    releaseStorage();
    releaseStorage = null;
  }
}

module.exports = { getDb, findAll, findById, create, update, remove, resetDb };
