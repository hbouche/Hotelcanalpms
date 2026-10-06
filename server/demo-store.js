'use strict';
// Independent DEMO database. Never imports the hotel database, jobs or integrations.
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR } = require('./data-paths');
const PRODUCTS = [
  { id: 'demo-room-a', name: 'DEMO Habitación A', kind: 'night', cents: 10000, capacity: 2, units: 10 },
  { id: 'demo-room-b', name: 'DEMO Habitación B', kind: 'night', cents: 10000, capacity: 4, units: 10 },
  { id: 'demo-daypass', name: 'DEMO Oferta pasadía', kind: 'day', cents: 3850, capacity: 6, units: 1 },
];
function openDemo(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new Database(filename);
  fs.chmodSync(filename, 0o600);
  db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 5000'); db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS demo_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS demo_products (id TEXT PRIMARY KEY, name TEXT, kind TEXT, cents INTEGER, capacity INTEGER, units INTEGER, demo INTEGER NOT NULL DEFAULT 1 CHECK(demo=1));
    CREATE TABLE IF NOT EXISTS demo_rooms (id TEXT PRIMARY KEY, product_id TEXT REFERENCES demo_products(id), demo INTEGER NOT NULL DEFAULT 1 CHECK(demo=1));
    CREATE TABLE IF NOT EXISTS demo_bookings (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, product_id TEXT REFERENCES demo_products(id), arrival TEXT, departure TEXT, people INTEGER, cents INTEGER, state TEXT DEFAULT 'Confirmada DEMO', seeded INTEGER DEFAULT 0, demo INTEGER NOT NULL DEFAULT 1 CHECK(demo=1), created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS demo_credits (id TEXT PRIMARY KEY, booking_id TEXT REFERENCES demo_bookings(id), cents INTEGER, label TEXT DEFAULT 'Crédito ficticio DEMO', demo INTEGER NOT NULL DEFAULT 1 CHECK(demo=1));`);
  const version = db.prepare("SELECT value FROM demo_meta WHERE key='catalog'").get();
  if (version && version.value !== 'HB-2ROOMS-100-DAY3850-v2') { db.close(); throw new Error('Unexpected DEMO catalog; migration requires review'); }
  db.transaction(() => {
    for (const p of PRODUCTS) db.prepare('INSERT OR IGNORE INTO demo_products (id,name,kind,cents,capacity,units) VALUES (@id,@name,@kind,@cents,@capacity,@units)').run(p);
    for (let i = 1; i <= 20; i++) db.prepare('INSERT OR IGNORE INTO demo_rooms (id,product_id) VALUES (?,?)').run(`DEMO-${String(i).padStart(3,'0')}`, i <= 10 ? 'demo-room-a' : 'demo-room-b');
    const fixtures = [
      ['demo-seed-001','demo-room-a','2026-10-16','2026-10-18',2,20000,'Confirmada DEMO'],
      ['demo-seed-002','demo-room-b','2026-10-16','2026-10-17',2,10000,'Pendiente DEMO'],
      ['demo-seed-003','demo-room-b','2026-10-17','2026-10-19',4,20000,'Confirmada DEMO'],
      ['demo-seed-004','demo-room-a','2026-10-14','2026-10-16',1,20000,'Hospedado DEMO'],
      ['demo-seed-005','demo-room-a','2026-10-16','2026-10-17',2,10000,'Cancelada DEMO'],
      ['demo-seed-006','demo-daypass','2026-10-16','2026-10-16',3,11550,'Confirmada DEMO'],
    ];
    for (const f of fixtures) db.prepare('INSERT OR IGNORE INTO demo_bookings (id,request_id,product_id,arrival,departure,people,cents,state,seeded) VALUES (?,?,?,?,?,?,?,?,1)').run(f[0],f[0],...f.slice(1));
    for (const [i,b,c] of [['001','001',10000],['003','003',10000],['004','004',20000]]) db.prepare('INSERT OR IGNORE INTO demo_credits (id,booking_id,cents) VALUES (?,?,?)').run(`demo-credit-${i}`,`demo-seed-${b}`,c);
    db.prepare("INSERT OR IGNORE INTO demo_meta VALUES ('catalog','HB-2ROOMS-100-DAY3850-v2')").run();
  })();
  function quote(input) {
    const p = PRODUCTS.find(p => p.id === input.product_id);
    const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s+'T00:00:00Z')) && new Date(s+'T00:00:00Z').toISOString().slice(0,10) === s;
    if (!p || !validDate(input.arrival) || !validDate(input.departure)) throw new Error('Producto o fechas DEMO inválidos');
    const nights = (Date.parse(input.departure)-Date.parse(input.arrival))/86400000;
    const today = new Date().toISOString().slice(0,10);
    if (input.arrival < today || input.arrival > new Date(Date.now()+365*86400000).toISOString().slice(0,10) || (p.kind === 'day' ? nights !== 0 : nights < 1 || nights > 30)) throw new Error('Revisa las fechas DEMO');
    if (!Number.isInteger(input.people) || input.people < 1 || input.people > p.capacity) throw new Error('Cantidad de personas DEMO inválida');
    return { product:p, nights, cents:p.cents*(p.kind === 'day' ? input.people : nights) };
  }
  function reserve(input) {
    return db.transaction(() => {
      const q = quote(input);
      if (!/^[0-9a-f-]{36}$/i.test(input.request_id || '')) throw new Error('Identificador DEMO inválido');
      const prior = db.prepare('SELECT * FROM demo_bookings WHERE request_id=?').get(input.request_id);
      if (prior) {
        if (prior.product_id !== input.product_id || prior.arrival !== input.arrival || prior.departure !== input.departure || prior.people !== input.people) throw new Error('La solicitud DEMO ya existe con otros datos');
        return prior;
      }
      if (db.prepare('SELECT COUNT(*) AS n FROM demo_bookings WHERE seeded=0').get().n >= 500) throw new Error('Límite de pruebas DEMO alcanzado');
      const used = q.product.kind === 'day'
        ? db.prepare("SELECT COALESCE(SUM(people),0) AS n FROM demo_bookings WHERE product_id=? AND arrival=? AND state!='Cancelada DEMO'").get(input.product_id,input.arrival).n
        : db.prepare("SELECT COUNT(*) AS n FROM demo_bookings WHERE product_id=? AND arrival<? AND departure>? AND state!='Cancelada DEMO'").get(input.product_id,input.departure,input.arrival).n;
      if (q.product.kind === 'day' ? used+input.people>q.product.capacity : used>=q.product.units) throw new Error('Sin disponibilidad en el inventario DEMO');
      const id = 'DEMO-'+require('node:crypto').randomUUID();
      db.prepare('INSERT INTO demo_bookings (id,request_id,product_id,arrival,departure,people,cents) VALUES (?,?,?,?,?,?,?)').run(id,input.request_id,input.product_id,input.arrival,input.departure,input.people,q.cents);
      return db.prepare('SELECT * FROM demo_bookings WHERE id=?').get(id);
    }).immediate();
  }
  return { db, quote, reserve, products:PRODUCTS };
}
let store;
function getDemoStore() {
  if (!store) store = openDemo(path.join(DATA_DIR,'demo','hotel-canal-demo-v2.db'));
  return store;
}
module.exports = { openDemo, getDemoStore };
