#!/usr/bin/env node
'use strict';
// Run in the EXISTING Render Shell after backup and authorized normal preload.
// Creates only synthetic bookings using the real public API. Reads/cancels ONLY their exact IDs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {DATA_DIR,RESTORE_MARKER}=require('../data-paths');
const {BATCH,TYPES,seedNormalWeb}=require('../normal-web-seed');
const filename=path.join(DATA_DIR,'hotel-canal.db');
if(!fs.existsSync(filename)||fs.existsSync(RESTORE_MARKER))throw Error('Existing healthy hotel storage required');
const db=new (require('better-sqlite3'))(filename);db.pragma('busy_timeout=5000');
const base='https://hotel-panama-canal-pms.onrender.com/api/v1/public';
const day=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
const unique='HB verification '+require('node:crypto').randomUUID();
async function call(p,body){const r=await fetch(base+p,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const d=await r.json();assert(r.ok&&d.success,d.error?.message||r.status);return d.data;}
async function available(cat,ci,co,type){const d=await call('/disponibilidad?'+new URLSearchParams({categoria:cat,check_in:ci,check_out:co}));return d.tipos_disponibles.find(t=>t.tipo===type)?.disponibles||0;}
(async()=>{
  const counts=()=>db.prepare('SELECT entity,COUNT(*) AS n FROM hb_web_seed_rows WHERE batch=? GROUP BY entity ORDER BY entity').all(BATCH);
  const firstCounts=counts();seedNormalWeb(db);assert.deepEqual(counts(),firstCounts);
  const results=[];
  for(let i=0;i<3;i++){
    const cat=i===2?'Pasadía':'Estadía',ci=day(120+i*3),co=i===2?ci:day(121+i*3),before=await available(cat,ci,co,TYPES[i]);assert(before>0);
    const body={cliente:unique,apellido:'FICTICIO',email:'hb-verification@example.invalid',whatsapp:'',check_in:ci,check_out:co,tipo_habitacion:TYPES[i],plan_codigo:BATCH+'-'+['A','B','PAS'][i],adultos:2,monto_pagado:0};
    const saved=await call('/reservar',body),id=saved.reserva_id;
    try{
      const row=db.prepare('SELECT id,cliente,email,plan_codigo,estado,monto_total,monto_pagado,fuente FROM reservas_hotel WHERE id=?').get(id);
      assert.equal(row.cliente,unique);assert.equal(row.email,body.email);assert.equal(row.plan_codigo,body.plan_codigo);assert.equal(row.estado,'Pendiente');assert.equal(row.monto_pagado,0);assert.equal(row.monto_total,i===2?77:100);assert.equal(row.fuente,'Website');
      assert.equal(await available(cat,ci,co,TYPES[i]),before-1);
      results.push({id,product:body.plan_codigo,normalReceptionRow:true,pending:true,total:row.monto_total,paid:0,inventoryBefore:before,inventoryAfter:before-1});
    }finally{
      // Controlled business-state change, not restore/reset: only this run's exact synthetic Pending row.
      const result=db.prepare("UPDATE reservas_hotel SET estado='Cancelada' WHERE id=? AND cliente=? AND email=? AND plan_codigo=? AND estado='Pendiente' AND monto_pagado=0 AND fuente='Website'").run(id,unique,body.email,body.plan_codigo);
      assert.equal(result.changes,1,'Synthetic cancellation guard failed; do not alter other rows');
    }
    assert.equal(await available(cat,ci,co,TYPES[i]),before);results.at(-1).cancelled=true;results.at(-1).inventoryRestored=true;
  }
  assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
  console.log(JSON.stringify({batch:BATCH,seedIdempotent:true,ownedCounts:counts(),normalBookingsVerifiedAndCancelled:results,communications:'Suppressed for these test-rate products; no payments registered'},null,2));
})().catch(e=>{console.error('Normal booking verification failed:',e.message);process.exitCode=1;}).finally(()=>db.close());
