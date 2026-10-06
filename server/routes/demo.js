'use strict';
const router = require('express').Router();
const { getDemoStore } = require('../demo-store');
router.use((req,res,next) => { res.set('Cache-Control','no-store'); next(); });
router.get('/catalog', (req,res,next) => {
  try { const s=getDemoStore(); res.json({success:true,data:{demo:true,persistent:true,products:s.products,room_count:20,seeded_reservations:6,seeded_credits:3,pricing_note:'Precios ficticios DEMO. Impuestos y condiciones comerciales sin confirmar.'}}); } catch(e) {next(e);}
});
router.post('/reservations', (req,res) => {
  try {
    const allowed=['product_id','arrival','departure','people','request_id'];
    if (!req.body || Object.keys(req.body).some(k=>!allowed.includes(k))) throw new Error('No enviar datos personales; solo campos DEMO');
    const booking=getDemoStore().reserve(req.body);
    res.status(201).json({success:true,data:{...booking,persistent:true,message:'Reserva de prueba guardada en la base DEMO separada. No es una reserva del hotel.'}});
  } catch(e) { res.status(400).json({success:false,error:{message:e.message}}); }
});
router.get('/reservations/:id', (req,res) => {
  const booking=getDemoStore().db.prepare('SELECT * FROM demo_bookings WHERE id=? AND seeded=0').get(req.params.id);
  if(!booking) return res.status(404).json({success:false,error:{message:'Reserva DEMO no encontrada'}});
  res.json({success:true,data:{...booking,persistent:true}});
});
router.delete('/reservations/:id', (req,res) => {
  const db=getDemoStore().db;
  const booking=db.prepare('SELECT * FROM demo_bookings WHERE id=? AND seeded=0').get(req.params.id);
  if(!booking) return res.status(404).json({success:false,error:{message:'Reserva DEMO no encontrada'}});
  db.prepare("UPDATE demo_bookings SET state='Cancelada DEMO' WHERE id=? AND seeded=0").run(req.params.id);
  res.json({success:true,data:{...booking,state:'Cancelada DEMO',persistent:true}});
});
module.exports=router;
