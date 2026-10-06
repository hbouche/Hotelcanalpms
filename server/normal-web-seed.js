'use strict';
const BATCH='HB-WEB-20261006';
const TYPES=['Habitación A (prueba)','Habitación B (prueba)','Pasadía (prueba)'];
function seedNormalWeb(db){
  const columns=db.prepare('PRAGMA table_info(planes_tarifa)').all().map(c=>c.name);
  if(!columns.includes('base_cobro')) db.exec("ALTER TABLE planes_tarifa ADD COLUMN base_cobro TEXT NOT NULL DEFAULT 'persona'");
  db.exec('CREATE TABLE IF NOT EXISTS hb_web_seed_rows (batch TEXT, entity TEXT, row_id INTEGER, natural_key TEXT, PRIMARY KEY(batch,entity,natural_key))');
  db.exec('CREATE TABLE IF NOT EXISTS hb_web_seed_batches (batch TEXT PRIMARY KEY, completed_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  if(db.prepare('SELECT batch FROM hb_web_seed_batches WHERE batch=?').get(BATCH))return {batch:BATCH,alreadyLoaded:true};
  const owned=(entity,key)=>db.prepare('SELECT row_id FROM hb_web_seed_rows WHERE batch=? AND entity=? AND natural_key=?').get(BATCH,entity,key);
  const record=(entity,key,id)=>db.prepare('INSERT INTO hb_web_seed_rows VALUES (?,?,?,?)').run(BATCH,entity,id,key);
  return db.transaction(()=>{
    for(const type of TYPES){
      const foreign=db.prepare("SELECT h.id FROM habitaciones h LEFT JOIN hb_web_seed_rows m ON m.entity='habitaciones' AND m.row_id=h.id AND m.batch=? WHERE h.tipo=? AND m.row_id IS NULL").get(BATCH,type);
      if(foreign)throw Error('Preload type collision; existing inventory untouched');
    }
    for(let i=1;i<=21;i++){
      const pass=i===21,type=pass?TYPES[2]:i<=10?TYPES[0]:TYPES[1];
      const name=pass?BATCH+'-PAS-01':BATCH+'-'+String(i).padStart(3,'0');
      const prior=owned('habitaciones',name);
      if(prior){const row=db.prepare('SELECT * FROM habitaciones WHERE id=?').get(prior.row_id);if(!row||row.nombre!==name||row.tipo!==type)throw Error('Owned preload room changed; review required');continue;}
      if(db.prepare('SELECT id FROM habitaciones WHERE nombre=?').get(name))throw Error('Preload room collision; existing data untouched');
      const id=db.prepare('INSERT INTO habitaciones (nombre,tipo,categoria,capacidad,capacidad_min,capacidad_max,estado_limpieza,estado_habitacion,comentarios,activa) VALUES (?,?,?,?,?,?,\'Inspeccionada\',\'Vacía\',?,1)').run(name,type,pass?'Pasadía':'Estadía',pass?6:i<=10?2:4,1,pass?6:i<=10?2:4,BATCH+' · Inventario de prueba autorizado; no aforo comercial confirmado').lastInsertRowid;
      record('habitaciones',name,id);
    }
    for(let i=0;i<3;i++){
      const code=BATCH+'-'+['A','B','PAS'][i],prior=owned('planes_tarifa',code);
      if(prior){const row=db.prepare('SELECT * FROM planes_tarifa WHERE id=?').get(prior.row_id);if(!row||row.codigo!==code)throw Error('Owned preload product changed; review required');continue;}
      if(db.prepare('SELECT id FROM planes_tarifa WHERE codigo=?').get(code))throw Error('Preload product collision; existing data untouched');
      const pass=i===2;
      const id=db.prepare('INSERT INTO planes_tarifa (codigo,nombre,descripcion,categoria,precio_adulto_noche,precio_menor_noche,precio_mascota_noche,incluye,horario,tipos_aplicables,visible_web,lleva_impuesto,impuesto_pct,activo,base_cobro,imagen) VALUES (?,?,?,?,?,?,0,?,?,?,?,1,0,1,?,?)').run(code,pass?'Oferta pasadía · Prueba':'Habitación '+['A','B'][i]+' · Prueba',BATCH+' · Tarifa ilustrativa; impuestos de ejemplo 0%, condiciones por confirmar. Imágenes conceptuales IA.',pass?'Pasadía':'Estadía',pass?38.50:100,pass?38.50:0,'[]','Por confirmar',JSON.stringify([TYPES[i]]),1,pass?'persona':'habitacion','https://hotel-panama-canal-web-demo.onrender.com/assets/'+['demo-room-wide.webp','demo-room-bed.webp','demo-daypass-offer.webp'][i]).lastInsertRowid;
      record('planes_tarifa',code,id);
    }
    for(let i=0;i<3;i++){
      const key='foto_tipo_'+TYPES[i];
      if(owned('config_hotel',key))continue;
      if(db.prepare('SELECT clave FROM config_hotel WHERE clave=?').get(key))throw Error('Preload photo setting collision; existing setting untouched');
      const value='https://hotel-panama-canal-web-demo.onrender.com/assets/'+['demo-room-wide.webp','demo-room-bed.webp','demo-pool.webp'][i];
      const id=db.prepare('INSERT INTO config_hotel (clave,valor) VALUES (?,?)').run(key,value).lastInsertRowid;
      record('config_hotel',key,id);
    }
    db.prepare('INSERT INTO hb_web_seed_batches (batch) VALUES (?)').run(BATCH);
    return {batch:BATCH,rooms:20,daypassUnits:1,products:3};
  }).immediate();
}
function isWebTestReservation(reservation){return reservation?.plan_codigo?.startsWith(BATCH+'-')===true;}
module.exports={seedNormalWeb,isWebTestReservation,BATCH,TYPES};
