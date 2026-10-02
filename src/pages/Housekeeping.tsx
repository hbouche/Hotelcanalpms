import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BedDouble, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../api/client';

type CleaningState = 'Sucia' | 'Limpia' | 'Inspeccionada';
type CleaningCount = { estado_limpieza: CleaningState; c: number };
export interface HousekeepingSummary {
  housekeeping: true;
  ocupacion: { total: number; ocupadas: number; porcentaje: number };
  hoy: { llegadas: number; salidas: number; hospedados: number };
  limpieza: CleaningCount[];
  limpieza_estadia: CleaningCount[];
  limpieza_pasadia: CleaningCount[];
}
export interface HousekeepingRoom {
  id: number;
  nombre: string;
  tipo: string;
  categoria: string;
  estado_limpieza: CleaningState;
  estado_habitacion?: string;
  no_molestar?: number;
}
export interface Occupancy {
  id: number;
  habitacion_id: number;
  check_in: string;
  check_out: string;
  estado: string;
}
interface HousekeepingSchedule {
  housekeeping: true;
  habitaciones: HousekeepingRoom[];
  reservas: Occupancy[];
}

const cleaningStyles: Record<CleaningState, string> = {
  Sucia: 'bg-red-50 text-red-700 border-red-200',
  Limpia: 'bg-green-50 text-green-700 border-green-200',
  Inspeccionada: 'bg-blue-50 text-blue-700 border-blue-200',
};
const cleaningStates: CleaningState[] = ['Sucia', 'Limpia', 'Inspeccionada'];

function LoadError({ retry }: { retry: () => void }) {
  return <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">No se pudieron cargar los datos de limpieza. <button onClick={retry} className="font-semibold underline">Reintentar</button></div>;
}

export function HousekeepingDashboard() {
  const [data, setData] = useState<HousekeepingSummary | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    api.get('/hotel/dashboard').then(r => {
      if (r.data?.housekeeping !== true) throw new Error('Unexpected dashboard response');
      if (active) setData(r.data);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [refresh]);
  if (error) return <LoadError retry={() => setRefresh(n => n + 1)} />;
  if (!data) return <div role="status" className="animate-pulse p-8 text-gray-400">Cargando resumen de limpieza...</div>;
  return <HousekeepingDashboardView data={data} />;
}

export function HousekeepingDashboardView({ data }: { data: HousekeepingSummary }) {
  const stats = [
    { label: 'Habitaciones ocupadas', value: `${data.ocupacion.ocupadas} / ${data.ocupacion.total}` },
    { label: 'Ocupación hoy', value: `${data.ocupacion.porcentaje}%` },
    { label: 'Llegadas hoy', value: data.hoy.llegadas },
    { label: 'Salidas hoy', value: data.hoy.salidas },
    { label: 'Hospedados hoy', value: data.hoy.hospedados },
  ];
  return <div>
    <h1 className="mb-2 text-2xl font-bold text-gray-800">Dashboard de limpieza</h1>
    <p className="mb-6 text-sm text-gray-500">Ocupación de hoy y estado de las habitaciones</p>
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
      {stats.map(stat => <div key={stat.label} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="text-2xl font-bold text-gray-800">{stat.value}</div>
        <div className="mt-1 text-sm text-gray-500">{stat.label}</div>
      </div>)}
    </div>
    <div className="mb-6 grid gap-4 lg:grid-cols-3">
      {[
        { title: 'Todas las habitaciones', counts: data.limpieza },
        { title: 'Estadía', counts: data.limpieza_estadia },
        { title: 'Pasadía', counts: data.limpieza_pasadia },
      ].map(group => <section key={group.title} className="rounded-xl bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-gray-800">{group.title}</h2>
        <div className="grid grid-cols-3 gap-2">
          {cleaningStates.map(state => <div key={state} className={`rounded-lg border p-2 text-center ${cleaningStyles[state]}`}>
            <div className="text-xl font-bold">{group.counts?.find(c => c.estado_limpieza === state)?.c || 0}</div>
            <div className="text-xs">{state}</div>
          </div>)}
        </div>
      </section>)}
    </div>
    {data.ocupacion.total === 0 && <p className="mb-6 rounded-xl bg-gray-100 p-4 text-sm text-gray-600">Aún no hay habitaciones configuradas.</p>}
    <div className="flex flex-wrap gap-3">
      <Link to="/habitaciones" className="inline-flex items-center gap-2 rounded-lg bg-mahana-500 px-4 py-2 text-sm font-semibold text-white"><BedDouble size={18} />Gestionar limpieza</Link>
      <Link to="/calendario" className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700"><CalendarDays size={18} />Ver ocupación</Link>
    </div>
  </div>;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}
function today() {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  return date;
}
const DAYS_TO_SHOW = 14;
const occupancyLabels: Record<string, { label: string; color: string }> = {
  Confirmada: { label: 'Reservada', color: 'bg-blue-100 text-blue-800 border-blue-300' },
  Hospedado: { label: 'Ocupada', color: 'bg-green-100 text-green-800 border-green-300' },
  'Check-Out': { label: 'Salida', color: 'bg-gray-100 text-gray-700 border-gray-300' },
  Pendiente: { label: 'Pendiente', color: 'bg-amber-100 text-amber-800 border-amber-300' },
};

export function HousekeepingCalendar() {
  const [startDate, setStartDate] = useState(today);
  const [jumpDate, setJumpDate] = useState('');
  const [category, setCategory] = useState('');
  const [data, setData] = useState<HousekeepingSchedule | null>(null);
  const [error, setError] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const dates = useMemo(() => Array.from({ length: DAYS_TO_SHOW }, (_, i) => addDays(startDate, i)), [startDate]);
  const desde = dateKey(dates[0]);
  const hasta = dateKey(addDays(dates[dates.length - 1], 1));
  useEffect(() => {
    let active = true;
    setData(null);
    setError(false);
    api.get(`/hotel/calendario?desde=${desde}&hasta=${hasta}`).then(r => {
      if (r.data?.housekeeping !== true) throw new Error('Unexpected calendar response');
      if (active) setData(r.data);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [desde, hasta, refresh]);

  const updateCleaning = async (roomId: number, state: CleaningState) => {
    if (saving) return;
    setSaving(true);
    setSaveError('');
    try {
      await api.patch(`/habitaciones/${roomId}/limpieza`, { estado_limpieza: state });
      setRefresh(n => n + 1);
    } catch {
      setSaveError('No se pudo actualizar la limpieza. Inténtelo de nuevo.');
    } finally { setSaving(false); }
  };

  return <div>
    <h1 className="mb-2 text-2xl font-bold text-gray-800">Calendario de ocupación</h1>
    <p className="mb-4 text-sm text-gray-500">Entradas y salidas por habitación para organizar la limpieza</p>
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <button aria-label="Semana anterior" onClick={() => setStartDate(d => addDays(d, -7))} className="rounded-lg p-2 hover:bg-gray-100"><ChevronLeft size={20} /></button>
      <button onClick={() => setStartDate(today())} className="rounded-lg border bg-white px-4 py-2 text-sm">Hoy</button>
      <button aria-label="Semana siguiente" onClick={() => setStartDate(d => addDays(d, 7))} className="rounded-lg p-2 hover:bg-gray-100"><ChevronRight size={20} /></button>
      <span className="text-sm text-gray-500">{desde} – {dateKey(dates[dates.length - 1])}</span>
      <label className="ml-2 text-sm text-gray-600">Ir a fecha <input aria-label="Ir a fecha" type="date" value={jumpDate} onChange={e => setJumpDate(e.target.value)} className="rounded-lg border bg-white px-2 py-1.5" /></label>
      <button disabled={!jumpDate} onClick={() => { const date = new Date(`${jumpDate}T12:00:00`); if (!isNaN(date.getTime())) setStartDate(date); }} className="rounded-lg bg-ocean-500 px-3 py-2 text-sm text-white disabled:opacity-40">Ir</button>
      <label className="ml-2 text-sm text-gray-600">Categoría <select aria-label="Categoría" value={category} onChange={e => setCategory(e.target.value)} className="rounded-lg border bg-white px-2 py-1.5">
        <option value="">Todas</option><option>Estadía</option><option>Pasadía</option>
      </select></label>
    </div>
    {saveError && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{saveError}</p>}
    {error ? <LoadError retry={() => setRefresh(n => n + 1)} /> : !data ? <div role="status" className="animate-pulse p-8 text-gray-400">Cargando ocupación...</div> : <HousekeepingCalendarGrid rooms={data.habitaciones.filter(room => !category || room.categoria === category)} reservations={data.reservas} dates={dates} saving={saving} onCleaningChange={updateCleaning} />}
    <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-600">
      {Object.values(occupancyLabels).map(state => <span key={state.label} className="flex items-center gap-1"><span className={`h-3 w-3 rounded border ${state.color}`} />{state.label}</span>)}
      <span>La salida de una estadía se muestra en el día de salida</span>
    </div>
  </div>;
}

export function HousekeepingCalendarGrid({ rooms, reservations, dates, saving, onCleaningChange }: {
  rooms: HousekeepingRoom[];
  reservations: Occupancy[];
  dates: Date[];
  saving: boolean;
  onCleaningChange: (roomId: number, state: CleaningState) => void;
}) {
  if (!rooms.length) return <p className="rounded-xl bg-white p-8 text-center text-gray-500">No hay habitaciones con los filtros seleccionados</p>;
  const keys = dates.map(dateKey);
  const roomsByCategory = [...rooms].sort((a, b) => (a.categoria || '').localeCompare(b.categoria || '') || a.tipo.localeCompare(b.tipo) || a.nombre.localeCompare(b.nombre, undefined, { numeric: true }));
  return <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
    <div className="min-w-[1100px]" role="table" aria-label="Ocupación anónima por habitación">
      <div role="row" className="flex border-b border-gray-200 bg-gray-50">
        <div role="columnheader" className="w-52 shrink-0 border-r px-3 py-3 text-xs font-semibold text-gray-600">Habitación / Limpieza</div>
        {dates.map((date, i) => <div role="columnheader" key={keys[i]} className={`min-w-0 flex-1 border-r py-2 text-center text-xs ${keys[i] === dateKey(today()) ? 'bg-ocean-50 font-bold text-ocean-700' : 'text-gray-500'}`}>
          <div>{date.toLocaleDateString('es', { weekday: 'short' })}</div><div>{date.toLocaleDateString('es', { day: '2-digit', month: '2-digit' })}</div>
        </div>)}
      </div>
      {roomsByCategory.map(room => <div role="row" key={room.id} className="flex border-b border-gray-100">
        <div role="rowheader" className="w-52 shrink-0 border-r p-3">
          <div className="text-sm font-semibold text-gray-800">{room.nombre}</div>
          <div className="mb-1 text-xs text-gray-500">{room.categoria} · {room.tipo}</div>
          {room.no_molestar === 1 && <div className="mb-1 text-xs font-semibold text-red-600">No molestar</div>}
          <select aria-label={`Limpieza de ${room.nombre}`} value={room.estado_limpieza} disabled={saving} onChange={e => onCleaningChange(room.id, e.target.value as CleaningState)} className={`w-full rounded-lg border px-2 py-1 text-xs disabled:opacity-50 ${cleaningStyles[room.estado_limpieza] || ''}`}>
            {cleaningStates.map(state => <option key={state}>{state}</option>)}
          </select>
        </div>
        {keys.map(key => {
          const stays = reservations.filter(res => res.habitacion_id === room.id && occupancyLabels[res.estado] && res.check_in <= key && (res.check_out > key || res.check_in === res.check_out && res.check_out === key));
          const departures = reservations.filter(res => res.habitacion_id === room.id && occupancyLabels[res.estado] && res.check_out === key && res.check_in !== res.check_out);
          return <div role="cell" key={key} className={`min-w-0 flex-1 space-y-1 border-r p-1 ${key === dateKey(today()) ? 'bg-ocean-50/30' : ''}`}>
            {departures.map(res => <div key={`exit-${res.id}`} className="rounded border border-gray-200 bg-gray-50 px-1 py-1 text-center text-[10px] text-gray-600" title={`Salida: ${res.check_out}`}>Salida</div>)}
            {stays.map(res => {
              const status = occupancyLabels[res.estado];
              return <div key={res.id} className={`rounded border px-1 py-1.5 text-center text-[10px] ${status.color}`} title={`${status.label}. Entrada: ${res.check_in}. Salida: ${res.check_out}`}>
                {res.check_in === key ? 'Llegada' : status.label}
              </div>;
            })}
          </div>;
        })}
      </div>)}
    </div>
  </div>;
}
