import { useState } from 'react';

const API = '/api/v1/public';
type AvailableType = { tipo: string; disponibles: number; capacidad_max: number };

// Public GETs only. No token, customer fields, uploads, payments or mutation endpoint.
export default function BookingDemo() {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [arrival, setArrival] = useState(today);
  const [departure, setDeparture] = useState(tomorrow);
  const [category, setCategory] = useState('Estadía');
  const [status, setStatus] = useState('Elige las fechas para probar la conexión pública con el PMS.');
  const [types, setTypes] = useState<AvailableType[]>([]);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [simulated, setSimulated] = useState(false);
  const [paid, setPaid] = useState(false);
  async function check() {
    if (!arrival || !departure || (category === 'Pasadía' ? departure < arrival : departure <= arrival)) {
      setStatus('Revisa las fechas: el alojamiento requiere al menos una noche. El pasadía permite entrada y salida el mismo día.'); return;
    }
    setLoading(true); setConnected(false); setTypes([]); setSimulated(false); setPaid(false);
    try {
      const params = new URLSearchParams({ check_in: arrival, check_out: departure, categoria: category });
      const response = await fetch(`${API}/disponibilidad?${params}`, { credentials: 'omit' });
      const payload = await response.json();
      if (!response.ok || !payload.success || !Array.isArray(payload.data?.tipos_disponibles)) throw new Error();
      setTypes(payload.data.tipos_disponibles); setConnected(true);
      setStatus(payload.data.tipos_disponibles.length ? 'Conexión verificada: respuesta de la consulta pública del PMS.' : 'Conexión verificada. El PMS no devuelve categorías disponibles para estas fechas.');
    } catch { setStatus('No se pudo completar la consulta pública. Prueba otra vez; el escenario ficticio sigue disponible.'); }
    finally { setLoading(false); }
  }
  return <div className="min-h-screen bg-stone-50 text-stone-800">
    <div className="bg-emerald-950 text-white text-center p-3 text-sm">DEMO · SOLO LECTURA · Sin reservas, archivos ni pagos reales</div>
    <header className="max-w-5xl mx-auto px-5 py-6 flex flex-wrap justify-between gap-4"><strong>HOTEL PANAMA CANAL<small className="block font-normal tracking-widest">CONVENTION CENTER · COLÓN</small></strong><a className="underline" href="https://wa.me/50769900199" target="_blank" rel="noopener noreferrer">Consulta comercial por WhatsApp ↗</a></header>
    <main className="max-w-5xl mx-auto p-5 pb-16"><p className="text-sm tracking-widest text-emerald-800">WEBSITE + PMS EXISTENTE</p><h1 className="font-serif text-4xl md:text-6xl mt-3 mb-6">Prueba la experiencia<br />de consulta.</h1><p className="max-w-2xl text-lg">Consulta la disponibilidad publicada por el PMS y explora un escenario ficticio de recepción. Esta prueba no modifica el inventario ni registra huéspedes.</p>
      <section className="bg-white rounded-2xl border p-6 mt-8"><h2 className="font-serif text-2xl">1. Consulta conectada</h2><p className="text-sm mt-2">Respuesta actual de la API pública. La cantidad devuelta no confirma el inventario comercial ni asegura una reserva.</p>
        <form onSubmit={e => { e.preventDefault(); check(); }} className="grid md:grid-cols-4 gap-4 mt-6">
          <label>Experiencia<select className="block border rounded p-3 w-full" value={category} onChange={e => {setCategory(e.target.value);setConnected(false);setTypes([]); if(e.target.value==='Pasadía') setDeparture(arrival);}}><option>Estadía</option><option>Pasadía</option></select></label>
          <label>Entrada<input className="block border rounded p-3 w-full" type="date" required min={today} value={arrival} onChange={e => {setArrival(e.target.value);setConnected(false);setTypes([]);if(category==='Pasadía')setDeparture(e.target.value);}} /></label>
          <label>Salida<input className="block border rounded p-3 w-full" type="date" required min={arrival} value={departure} onChange={e => {setDeparture(e.target.value);setConnected(false);setTypes([]);}} /></label>
          <button className="bg-emerald-900 text-white rounded p-3 self-end disabled:opacity-50" disabled={loading}>{loading ? 'Consultando…' : 'Consultar PMS'}</button>
        </form><p role="status" className="p-4 bg-stone-100 mt-5 rounded">{connected ? '✓ ' : ''}{status}</p>
        <div className="grid sm:grid-cols-3 gap-4 mt-4">{types.map(t => <article key={t.tipo} className="border rounded p-4"><h3 className="font-semibold">{t.tipo}</h3><p>{t.disponibles} disponibles en la respuesta</p><p className="text-sm">Capacidad máxima publicada: {t.capacidad_max}</p></article>)}</div>
      </section>
      <section className="bg-emerald-950 text-white rounded-2xl p-6 mt-6"><h2 className="font-serif text-2xl">2. Escenario de recepción ficticio</h2><p className="mt-3">DEMO-001 · Huésped ficticio · Clásica DEMO · 2 adultos · 1 noche</p><p>Ejemplo: USD 45 por adulto × 2 = USD 90. Sin impuesto de ejemplo. No es tarifa comercial.</p><div className="flex flex-wrap gap-3 mt-5"><button className="border rounded p-3 disabled:opacity-50" onClick={()=>setSimulated(true)} disabled={simulated}>{simulated?'Check-in simulado ✓':'Simular check-in'}</button><button className="border rounded p-3 disabled:opacity-50" onClick={()=>setPaid(true)} disabled={paid}>{paid?'Abono simulado ✓':'Simular abono manual de USD 30'}</button><button className="border rounded p-3" onClick={()=>{setSimulated(false);setPaid(false);}}>Reiniciar escenario</button></div><p aria-live="polite" className="mt-4">Estado: {simulated?'Hospedado ficticio':'Confirmada ficticia'} · Saldo simulado: USD {paid?'60':'90'}.</p><p className="text-sm mt-4 text-emerald-100">Estos botones solo cambian la memoria de esta página. Recargar reinicia el ejemplo. No se envían datos al servidor.</p></section>
      <p className="text-sm mt-6">No se solicitan datos personales. Para una cotización comercial usa el contacto del hotel. El enlace website → PMS permite esta consulta; no constituye sincronización del inventario.</p>
    </main></div>;
}
