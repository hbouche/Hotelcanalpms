'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'hotel-normal-web-test-'));
process.env.EXTERNAL_INTEGRATIONS_ENABLED='false';process.env.CARD_PAYMENTS_ENABLED='false';
const db=new (require('better-sqlite3'))(':memory:');db.exec(fs.readFileSync(path.join(__dirname,'../db/schema.sql'),'utf8'));
const model={getDb:()=>db,findById:(table,id)=>db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id),create:(table,data)=>{const keys=Object.keys(data);const id=db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...Object.values(data)).lastInsertRowid;return db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);},update:(table,id,data)=>{const keys=Object.keys(data);db.prepare(`UPDATE ${table} SET ${keys.map(k=>k+'=?').join(',')} WHERE id=?`).run(...Object.values(data),id);return db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);}};
require.cache[require.resolve('../db/database')]={id:require.resolve('../db/database'),filename:require.resolve('../db/database'),loaded:true,exports:model};
// Test-only authorization stub. No production credentials or accounts are created.
const authPath=require.resolve('../auth'),auth=require('../auth');const pass=(req,res,next)=>{req.user={id:1,rol:'admin',nombre:'Synthetic test operator'};next();};
require.cache[authPath].exports={...auth,requireAuth:pass,requireRole:()=>pass,requireOperations:pass,requireHousekeeping:pass};
const {seedNormalWeb,BATCH,TYPES}=require('../normal-web-seed');
test('normal inventory preload is additive/idempotent and normal reservations change availability and reception',async()=>{
  db.prepare("INSERT INTO habitaciones (nombre,tipo,categoria,comentarios) VALUES ('Existing-untouched','Existing','Estadía','Existing sentinel')").run();
  const sentinel=db.prepare("SELECT * FROM habitaciones WHERE nombre='Existing-untouched'").get();
  db.prepare("INSERT INTO planes_tarifa (codigo,nombre,precio_adulto_noche,precio_menor_noche,visible_web) VALUES ('Existing-plan','Existing per-person plan',50,25,1)").run();
  seedNormalWeb(db);seedNormalWeb(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM habitaciones').get().n,22);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM planes_tarifa').get().n,4);assert.deepEqual(db.prepare('SELECT * FROM habitaciones WHERE id=?').get(sentinel.id),sentinel);
  const express=require('express'),app=express();app.use(express.json());app.use('/api/v1/public',require('../routes/public'));app.use('/api/v1',require('../routes/hotel'));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/api/v1';
  const call=async(p,method='GET',body)=>{const r=await fetch(base+p,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
  const day=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10),arrival=day(40),departure=day(42);
  const availability=async(cat,ci,co,type)=>{const d=await call('/public/disponibilidad?'+new URLSearchParams({categoria:cat,check_in:ci,check_out:co}));return d.data.data.tipos_disponibles.find(t=>t.tipo===type)?.disponibles||0;};
  try{
    const legacy=await call('/public/cotizar?'+new URLSearchParams({plan:'Existing-plan',check_in:arrival,check_out:departure,adultos:'3'}));assert.equal(legacy.data.data.subtotal,300);
    const quote=await call('/public/cotizar?'+new URLSearchParams({plan:BATCH+'-A',check_in:arrival,check_out:departure,adultos:'2'}));assert.equal(quote.data.data.subtotal,200);
    assert.equal(await availability('Estadía',arrival,departure,TYPES[0]),10);
    const created=await call('/public/reservar','POST',{cliente:'Synthetic HB booking',apellido:'FICTICIO',email:'synthetic@example.invalid',check_in:arrival,check_out:departure,tipo_habitacion:TYPES[0],plan_codigo:BATCH+'-A',adultos:2,monto_pagado:999});assert.equal(created.status,201);
    const id=created.data.data.reserva_id;const reception=await call('/hotel/reservas/'+id);assert.equal(reception.data.data.estado,'Pendiente');assert.equal(reception.data.data.monto_pagado,0);assert.equal(reception.data.data.monto_total,200);assert.equal(await availability('Estadía',arrival,departure,TYPES[0]),9);
    assert.equal((await call('/hotel/reservas/'+id+'/status','PATCH',{estado:'Cancelada'})).status,200);assert.equal(await availability('Estadía',arrival,departure,TYPES[0]),10);
    const room=db.prepare('SELECT * FROM habitaciones WHERE tipo=?').get(TYPES[2]),date=day(50);
    const body={cliente:'Synthetic day pass',habitacion_id:room.id,check_in:date,check_out:date,plan_codigo:BATCH+'-PAS',adultos:2,estado:'Pendiente'};
    const passBooking=await call('/hotel/reservas','POST',body);assert.equal(passBooking.status,201,JSON.stringify(passBooking));assert.equal(passBooking.data.data.monto_total,77);
    assert.equal(await availability('Pasadía',date,date,TYPES[2]),0);
    assert.notEqual((await call('/hotel/reservas','POST',body)).status,201);
    const calendar=await call('/hotel/calendario?desde='+date+'&hasta='+date);assert(calendar.data.data.reservas.some(r=>r.id===passBooking.data.data.id));
    assert.equal((await call('/hotel/reservas/'+passBooking.data.data.id+'/status','PATCH',{estado:'Cancelada'})).status,200);assert.equal(await availability('Pasadía',date,date,TYPES[2]),1);
    seedNormalWeb(db);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM habitaciones').get().n,22);assert.deepEqual(db.prepare('SELECT * FROM habitaciones WHERE id=?').get(sentinel.id),sentinel);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
  }finally{await new Promise(r=>server.close(r));}
});
