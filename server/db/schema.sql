-- Hotel Panamá Canal PMS - Database Schema
-- SQLite

-- ═══ HABITACIONES ═══
CREATE TABLE IF NOT EXISTS habitaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,                   -- "FAM(1)", "CAMP(3)", "BOHIO(2)"
  tipo TEXT NOT NULL,                     -- "Familiar", "Doble", "Estándar", "Camping", "Bohío", "Salón", "Restaurante"
  categoria TEXT DEFAULT 'Estadía',       -- "Estadía" o "Pasadía"
  capacidad INTEGER DEFAULT 2,
  capacidad_min INTEGER DEFAULT 1,        -- Mínimo de personas
  capacidad_max INTEGER DEFAULT 4,        -- Máximo de personas
  descripcion_camas TEXT,                 -- "1 King + 1 Litera", etc.
  piso TEXT,
  estado_limpieza TEXT DEFAULT 'Sucia',   -- Sucia, Limpia, Inspeccionada
  estado_habitacion TEXT DEFAULT 'Vacía', -- Vacía, Ocupada
  asignado_a TEXT,
  no_molestar INTEGER DEFAULT 0,
  comentarios TEXT,
  activa INTEGER DEFAULT 1
);

-- ═══ PLANES DE TARIFA / PRODUCTOS ═══
CREATE TABLE IF NOT EXISTS planes_tarifa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  categoria TEXT DEFAULT 'Estadía',       -- "Estadía", "Pasadía", "Otro"
  precio_adulto_noche REAL NOT NULL,
  precio_menor_noche REAL DEFAULT 0,
  precio_mascota_noche REAL DEFAULT 0,
  -- Rich product fields
  incluye TEXT,                           -- JSON array: ["Habitación", "Desayuno", "Cena"]
  horario TEXT,                           -- "Check-in 3PM / Check-out 11AM" or "9AM - 5PM"
  extras_disponibles TEXT,                -- JSON array: ["Spa $25", "Tour $15"]
  tipos_aplicables TEXT,                  -- JSON array of room types: ["Familiar","Doble"] or ["Bohío","Salón"]
  imagen TEXT,                            -- URL or path to product image
  visible_web INTEGER DEFAULT 0,          -- 1 = visible in public booking widget
  lleva_impuesto INTEGER DEFAULT 1,       -- 1 = si, 0 = no (exento)
  impuesto_pct REAL DEFAULT 0,           -- % de impuesto personalizado
  activo INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ═══ REGLAS DE TARIFA POR DÍA ═══
CREATE TABLE IF NOT EXISTS reglas_tarifa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  tipo_dia TEXT NOT NULL,                 -- "entre_semana" (Dom-Jue), "fin_de_semana" (Vie-Sáb), "festivo"
  precio_adulto REAL NOT NULL,
  precio_menor REAL DEFAULT 0,
  precio_mascota REAL DEFAULT 0,
  activo INTEGER DEFAULT 1,
  FOREIGN KEY (plan_id) REFERENCES planes_tarifa(id)
);

-- ═══ DÍAS FESTIVOS ═══
CREATE TABLE IF NOT EXISTS dias_festivos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL UNIQUE,             -- "2026-01-01"
  nombre TEXT NOT NULL                    -- "Año Nuevo"
);

CREATE INDEX IF NOT EXISTS idx_reglas_plan ON reglas_tarifa(plan_id);
CREATE INDEX IF NOT EXISTS idx_festivos_fecha ON dias_festivos(fecha);

-- ═══ RESERVAS DE HOTEL ═══
CREATE TABLE IF NOT EXISTS reservas_hotel (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Huésped principal
  cliente TEXT NOT NULL,
  apellido TEXT,
  email TEXT,
  whatsapp TEXT,
  telefono TEXT,
  nacionalidad TEXT,
  -- Habitación
  habitacion_id INTEGER,
  tipo_habitacion TEXT,
  -- Fechas
  check_in TEXT NOT NULL,
  check_out TEXT NOT NULL,
  noches INTEGER,
  hora_llegada TEXT,
  -- Huéspedes
  adultos INTEGER DEFAULT 1,
  menores INTEGER DEFAULT 0,
  mascotas INTEGER DEFAULT 0,
  -- Plan y tarifas (snapshot al crear)
  plan_codigo TEXT,
  plan_nombre TEXT,
  precio_adulto_noche REAL,
  precio_menor_noche REAL,
  precio_mascota_noche REAL,
  -- Cálculos
  subtotal REAL DEFAULT 0,
  productos_adicionales REAL DEFAULT 0,
  impuesto_pct REAL DEFAULT 0,
  impuesto_monto REAL DEFAULT 0,
  monto_total REAL DEFAULT 0,
  deposito_sugerido REAL DEFAULT 0,
  monto_pagado REAL DEFAULT 0,
  saldo_pendiente REAL DEFAULT 0,
  -- Estado
  estado TEXT DEFAULT 'Pendiente',
  fuente TEXT DEFAULT 'Teléfono',
  notas TEXT,
  grupo_codigo TEXT,
  es_maestra INTEGER DEFAULT 0,
  metodo_pago TEXT,
  referencia TEXT,
  parent_reserva_id INTEGER,
  facturacion_consolidada INTEGER DEFAULT 1,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (habitacion_id) REFERENCES habitaciones(id),
  FOREIGN KEY (parent_reserva_id) REFERENCES reservas_hotel(id) ON DELETE SET NULL
);

-- ═══ FOLIO / MOVIMIENTOS ═══
CREATE TABLE IF NOT EXISTS folio_hotel (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reserva_id INTEGER NOT NULL,
  tipo TEXT NOT NULL,               -- "credito" o "debito"
  concepto TEXT NOT NULL,
  monto REAL NOT NULL,
  metodo_pago TEXT,
  referencia TEXT,
  registrado_por TEXT,
  fecha TEXT DEFAULT (date('now')),
  reconciliado INTEGER DEFAULT 0,         -- 0 = no, 1 = reconciliado (CxC cuponeras/terceros)
  fecha_reconciliacion TEXT,              -- Fecha de la conciliación contable
  comision_porcentaje REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (reserva_id) REFERENCES reservas_hotel(id)
);

-- ═══ HUÉSPEDES ADICIONALES ═══
CREATE TABLE IF NOT EXISTS huespedes_reserva (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reserva_id INTEGER NOT NULL,
  nombre TEXT,
  apellido TEXT,
  tipo TEXT DEFAULT 'adulto',
  email TEXT,
  telefono TEXT,
  FOREIGN KEY (reserva_id) REFERENCES reservas_hotel(id)
);

-- ═══ USUARIOS ═══
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nombre TEXT NOT NULL,
  rol TEXT DEFAULT 'staff',       -- admin, staff
  activo INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ═══ CONFIGURACIÓN ═══
CREATE TABLE IF NOT EXISTS config_hotel (
  clave TEXT PRIMARY KEY,
  valor TEXT,
  descripcion TEXT
);

-- ═══ DOCUMENTOS / ARCHIVOS ═══
CREATE TABLE IF NOT EXISTS documentos_reserva (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reserva_id INTEGER REFERENCES reservas_hotel(id),
  tipo TEXT NOT NULL,          -- 'cedula', 'pasaporte', 'recibo', 'otro'
  nombre_original TEXT,
  nombre_archivo TEXT NOT NULL,
  mime_type TEXT,
  tamaño INTEGER,
  notas TEXT,
  subido_por TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ═══ API KEYS (para agentes AI) ═══
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT NOT NULL UNIQUE,       -- bcrypt hash del API key
  key_preview TEXT NOT NULL,           -- últimos 8 chars para identificar: "...abc12345"
  nombre TEXT NOT NULL,                -- "BEE Smart Agent", "WhatsApp Bot"
  permisos TEXT DEFAULT 'read',        -- "read", "write", "admin"
  rate_limit INTEGER DEFAULT 100,      -- requests por minuto
  activo INTEGER DEFAULT 1,
  last_used TEXT,
  request_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ═══ WEBHOOKS ═══
CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,                    -- "https://example.com/webhook"
  eventos TEXT NOT NULL,                -- JSON array: ["reserva.creada", "pago.registrado"]
  secret TEXT,                         -- HMAC signing secret
  activo INTEGER DEFAULT 1,
  last_triggered TEXT,
  fail_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ═══ DIRECTORIO DE HUÉSPEDES ═══
CREATE TABLE IF NOT EXISTS huespedes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  apellido TEXT,
  email TEXT,
  telefono TEXT,
  direccion TEXT,
  ciudad TEXT,
  pais TEXT,
  provincia TEXT,
  codigo_postal TEXT,
  total_reservas INTEGER DEFAULT 0,
  noches_estadia INTEGER DEFAULT 0,
  total_ingresos REAL DEFAULT 0,
  ultima_estadia TEXT,              -- fecha última estadía
  huesped_habitual INTEGER DEFAULT 0,
  estado_huesped TEXT,
  fuente_import TEXT,               -- "Cloudbeds", "Manual", etc.
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_huespedes_email ON huespedes(email);
CREATE INDEX IF NOT EXISTS idx_huespedes_nombre ON huespedes(nombre, apellido);

-- ═══ NOTIFICATION LOG ═══
CREATE TABLE IF NOT EXISTS notificaciones_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reserva_id INTEGER REFERENCES reservas_hotel(id),
  tipo TEXT NOT NULL,                     -- 'confirmacion', 'estado', 'pago', 'recordatorio'
  canal TEXT NOT NULL,                    -- 'email', 'whatsapp'
  destinatario TEXT,
  resultado TEXT,                         -- JSON with delivery status
  contenido TEXT,                         -- HTML or text message content
  created_at TEXT DEFAULT (datetime('now'))
);

-- ═══ ÍNDICES ═══
CREATE INDEX IF NOT EXISTS idx_reservas_checkin ON reservas_hotel(check_in);
CREATE INDEX IF NOT EXISTS idx_reservas_checkout ON reservas_hotel(check_out);
CREATE INDEX IF NOT EXISTS idx_reservas_estado ON reservas_hotel(estado);
CREATE INDEX IF NOT EXISTS idx_reservas_habitacion ON reservas_hotel(habitacion_id);
CREATE INDEX IF NOT EXISTS idx_documentos_reserva ON documentos_reserva(reserva_id);
CREATE INDEX IF NOT EXISTS idx_folio_reserva ON folio_hotel(reserva_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_notif_reserva ON notificaciones_log(reserva_id);
CREATE INDEX IF NOT EXISTS idx_reservas_grupo ON reservas_hotel(grupo_codigo);

-- ═══ CONFIGURACIÓN DINÁMICA DEL SISTEMA ═══
CREATE TABLE IF NOT EXISTS configuracion_sistema (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  smtp_host TEXT,
  smtp_port INTEGER DEFAULT 587,
  smtp_user TEXT,
  smtp_pass TEXT,
  smtp_from TEXT,
  admin_email TEXT,
  notifications_enabled INTEGER DEFAULT 0,
  wa_api_url TEXT,
  wa_api_token TEXT,
  wa_from_number TEXT,
  wa_enabled INTEGER DEFAULT 0,
  hotel_telefono TEXT,
  hotel_politica_cancelacion TEXT,
  hotel_politica_reembolso TEXT,
  hotel_direccion TEXT,
  email_provider TEXT DEFAULT 'smtp',
  resend_api_key TEXT,
  resend_from_email TEXT
);

-- ═══ AUDITORÍA DE REVERSIONES CONTABLES ═══
CREATE TABLE IF NOT EXISTS reversiones_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reserva_id INTEGER,
  folio_id INTEGER,
  monto REAL,
  concepto_original TEXT,
  motivo TEXT,
  reversado_por TEXT,
  fecha TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (reserva_id) REFERENCES reservas_hotel(id),
  FOREIGN KEY (folio_id) REFERENCES folio_hotel(id)
);

-- ═══ SOLICITUDES DE MODIFICACIÓN (DOUBLE APPROVAL / 4-EYES WORKFLOW) ═══
CREATE TABLE IF NOT EXISTS solicitudes_modificacion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reserva_id INTEGER NOT NULL,
  tipo_modificacion TEXT NOT NULL,
  transaccion_original_id INTEGER,
  estado TEXT DEFAULT 'Pendiente',
  usuario_solicitante TEXT NOT NULL,
  justificacion TEXT NOT NULL,
  snapshot_datos TEXT NOT NULL,
  datos_anteriores TEXT NOT NULL,
  procesado_por TEXT,
  fecha_procesamiento TEXT,
  comentarios_admin TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (reserva_id) REFERENCES reservas_hotel(id) ON DELETE CASCADE,
  FOREIGN KEY (transaccion_original_id) REFERENCES folio_hotel(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_reserva ON solicitudes_modificacion(reserva_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_estado ON solicitudes_modificacion(estado);

-- ═══ PLANTILLAS DE NOTIFICACIÓN ═══
CREATE TABLE IF NOT EXISTS notificaciones_plantillas (
  codigo TEXT NOT NULL,
  canal TEXT NOT NULL DEFAULT 'email',
  nombre TEXT NOT NULL,
  asunto TEXT,
  contenido TEXT NOT NULL,
  variables TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (codigo, canal)
);

-- ═══ CRM & COTIZACIONES CUSTOM ═══
CREATE TABLE IF NOT EXISTS leads_clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  apellido TEXT,
  email TEXT,
  telefono TEXT,
  notas TEXT,
  estado TEXT DEFAULT 'Borrador', -- Borrador, Enviada, En Negociación, Aceptada, Rechazada
  atendido INTEGER DEFAULT 0,
  fecha_seguimiento TEXT,
  oferta_mejora INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cotizaciones_custom (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  check_in TEXT,
  check_out TEXT,
  noches INTEGER,
  adultos INTEGER DEFAULT 1,
  menores INTEGER DEFAULT 0,
  mascotas INTEGER DEFAULT 0,
  plan_codigo TEXT,
  habitaciones_seleccionadas TEXT, -- JSON array de IDs de habitaciones: [1, 2]
  items_adicionales TEXT,          -- JSON array de items: [{"nombre": "DJ", "precio": 300}, ...]
  subtotal REAL DEFAULT 0,
  descuento REAL DEFAULT 0,
  descuento_tipo TEXT DEFAULT 'fijo', -- 'fijo' o 'porcentaje'
  impuesto_pct REAL DEFAULT 0,
  impuesto_monto REAL DEFAULT 0,
  monto_total REAL DEFAULT 0,
  deposito_sugerido REAL DEFAULT 0,
  notas TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (lead_id) REFERENCES leads_clientes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS servicios_adicionales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  precio_base REAL NOT NULL,
  tipo_precio TEXT DEFAULT 'global', -- 'global' o 'por_persona'
  activo INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_leads_estado ON leads_clientes(estado);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_lead ON cotizaciones_custom(lead_id);

-- ═══ AUDITORÍA DE ELIMINACIÓN DE RESERVAS ═══
CREATE TABLE IF NOT EXISTS reservas_eliminadas_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reserva_id INTEGER,
  cliente TEXT NOT NULL,
  check_in TEXT,
  check_out TEXT,
  monto_total REAL,
  motivo TEXT,
  eliminado_por TEXT,
  fecha TEXT DEFAULT (datetime('now'))
);

-- Authentication metadata only: never store submitted identifiers, secrets or IPs.
CREATE TABLE IF NOT EXISTS accesos_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  resultado TEXT NOT NULL CHECK (resultado IN ('exitoso', 'fallido')),
  fecha TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_accesos_usuario_resultado ON accesos_log(usuario_id, resultado, id DESC);
