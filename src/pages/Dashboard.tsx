import { useState, useEffect, useMemo } from 'react';
import { api } from '../api/client';
import { BedDouble, ArrowDownRight, ArrowUpRight, DollarSign, CalendarDays, Users, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';

const estadoColor: Record<string, string> = {
  'Confirmada': 'bg-blue-100 text-blue-700',
  'Hospedado': 'bg-green-100 text-green-700',
  'Check-Out': 'bg-gray-100 text-gray-600',
  'Pendiente': 'bg-yellow-100 text-yellow-700',
  'Cancelada': 'bg-red-100 text-red-700',
  'No-Show': 'bg-red-50 text-red-500',
};

const pieColors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#6b7280'];
const periodos = [
  { key: 'dia', label: 'Hoy' },
  { key: 'semana', label: 'Semana' },
  { key: 'mes', label: 'Mes' },
  { key: 'total', label: 'Total' },
];

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [periodo, setPeriodo] = useState('mes');

  const load = (p: string) => {
    setLoading(true);
    api.get(`/hotel/dashboard?periodo=${p}`).then(r => setData(r.data)).finally(() => setLoading(false));
  };

  useEffect(() => { load(periodo); }, [periodo]);

  if (loading && !data) return <div className="animate-pulse text-gray-400 p-8">Cargando dashboard...</div>;
  if (!data) return null;

  const periodoLabel = periodos.find(p => p.key === periodo)?.label || 'Mes';
  const hist = data.historico;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
        {/* Period Filter */}
        <div className="flex bg-white rounded-lg border border-gray-200 overflow-hidden">
          {periodos.map(p => (
            <button key={p.key} onClick={() => setPeriodo(p.key)}
              className={`px-4 py-2 text-sm font-medium transition ${periodo === p.key ? 'bg-mahana-500 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {(data.ocupacion?.estadia?.total || 0) + (data.ocupacion?.pasadia?.total || 0) === 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <h2 className="font-semibold">Bienvenido a Hotel Panamá Canal</h2>
          <p className="mt-1">Esta instalación comienza vacía. Configure habitaciones, productos, tarifas, contactos y políticas antes de registrar reservas. Los pagos y las integraciones externas están deshabilitados.</p>
          <Link to="/admin/habitaciones" className="mt-3 inline-block font-semibold underline">Configurar habitaciones</Link>
        </div>
      )}

      {/* Stats Cards — with Estadía/Pasadía split */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {/* Estadía Column */}
        <div className="bg-white rounded-xl p-5 shadow-sm border-t-4 border-ocean-400">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-ocean-400 to-ocean-500 flex items-center justify-center">
              <BedDouble size={16} className="text-white" />
            </div>
            <span className="text-sm font-bold text-ocean-700">🏨 Estadía</span>
          </div>
          <div className="text-2xl font-bold text-gray-800">{data.ocupacion.estadia?.pct || 0}%</div>
          <div className="text-sm text-gray-400">Ocupación ({periodoLabel}) • {data.ocupacion.estadia?.ocupadas || 0} noches/{data.ocupacion.estadia?.total || 0} hab</div>
          <div className="text-xs text-gray-300 mt-1">{data.financiero.reservas_estadia || 0} reservas ({periodoLabel})</div>
        </div>
        {/* Pasadía Column */}
        <div className="bg-white rounded-xl p-5 shadow-sm border-t-4 border-amber-400">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center">
              <CalendarDays size={16} className="text-white" />
            </div>
            <span className="text-sm font-bold text-amber-700">☀️ Pasadía</span>
          </div>
          <div className="text-2xl font-bold text-gray-800">{data.ocupacion.pasadia?.pct || 0}%</div>
          <div className="text-sm text-gray-400">Ocupación ({periodoLabel}) • {data.ocupacion.pasadia?.ocupadas || 0} noches/{data.ocupacion.pasadia?.total || 0} hab</div>
          <div className="text-xs text-gray-300 mt-1">{data.financiero.reservas_pasadia || 0} reservas ({periodoLabel})</div>
        </div>
        {/* Financial */}
        <div className="bg-white rounded-xl p-5 shadow-sm border-t-4 border-mahana-400">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-mahana-400 to-mahana-500 flex items-center justify-center">
              <DollarSign size={16} className="text-white" />
            </div>
            <span className="text-sm font-bold text-mahana-700">💰 Finanzas</span>
          </div>
          <div className="text-2xl font-bold text-gray-800">${data.financiero.ingresos_periodo.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          <div className="text-sm text-gray-400">Ingresos ({periodoLabel})</div>
          <div className="text-xs text-red-400 mt-1">Saldo pend: ${data.financiero.saldo_pendiente_total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
      </div>

      {/* Dual Occupancy Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl p-5 shadow-sm border-t-4 border-ocean-400">
          <h3 className="font-semibold text-ocean-700 mb-1">🏨 Ocupación Estadía</h3>
          <p className="text-xs text-gray-400 mb-3">{data.ocupacion.estadia?.pct || 0}% promedio ({periodoLabel})</p>
          <OccupancyBarChart timeline={data.timeline_estadia || []} color="ocean" />
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm border-t-4 border-amber-400">
          <h3 className="font-semibold text-amber-700 mb-1">☀️ Ocupación Pasadía</h3>
          <p className="text-xs text-gray-400 mb-3">{data.ocupacion.pasadia?.pct || 0}% promedio ({periodoLabel})</p>
          <OccupancyBarChart timeline={data.timeline_pasadia || []} color="amber" />
        </div>
      </div>

      {/* Revenue Pie + Reservas por Tipo */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-gray-700 mb-4">Ingresos por Plan ({periodoLabel})</h3>
          <RevenuePie data={data.ingresos_por_plan || []} />
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-gray-700 mb-3">Reservas por Tipo ({periodoLabel})</h3>
          <OccupancyByType data={data.ocupacion_por_tipo || []} />
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-gray-700 mb-3">Resumen Hoy</h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg p-3 text-center bg-green-50 border-l-4 border-green-400">
              <div className="text-2xl font-bold text-gray-800">{data.hoy.llegadas}</div>
              <div className="text-xs text-gray-500">Llegadas</div>
            </div>
            <div className="rounded-lg p-3 text-center bg-amber-50 border-l-4 border-amber-400">
              <div className="text-2xl font-bold text-gray-800">{data.hoy.salidas}</div>
              <div className="text-xs text-gray-500">Salidas</div>
            </div>
            <div className="rounded-lg p-3 text-center bg-ocean-50 border-l-4 border-ocean-400">
              <div className="text-2xl font-bold text-gray-800">{data.hoy.hospedados}</div>
              <div className="text-xs text-gray-500">Hospedados</div>
            </div>
          </div>
        </div>
      </div>

      {/* Limpieza split by category */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <LimpiezaCard title="🏨 Limpieza Estadía" data={data.limpieza_estadia || []} accent="ocean" />
        <LimpiezaCard title="☀️ Limpieza Pasadía" data={data.limpieza_pasadia || []} accent="amber" />
      </div>

      {/* ══════════════════════════════════════ */}
      {/* HISTORIAL CLOUDBEDS — filtered by period */}
      {/* ══════════════════════════════════════ */}
      {hist && hist.total_reservas > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <Users size={22} className="text-purple-600" />
              📊 Historial Cloudbeds ({periodoLabel})
            </h2>
            <Link to="/huespedes" className="text-sm text-mahana-600 hover:underline">Ver todos →</Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4 border border-purple-200">
              <div className="flex items-center gap-2 mb-2">
                <Users size={18} className="text-purple-600" />
                <span className="text-xs font-medium text-purple-700">Clientes ({periodoLabel})</span>
              </div>
              <div className="text-2xl font-bold text-gray-800">{(hist.total_clientes || 0).toLocaleString()}</div>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-emerald-100 rounded-xl p-4 border border-green-200">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign size={18} className="text-green-600" />
                <span className="text-xs font-medium text-green-700">Ingresos ({periodoLabel})</span>
              </div>
              <div className="text-2xl font-bold text-gray-800">${(hist.total_ingresos || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            </div>
            <div className="bg-gradient-to-br from-ocean-50 to-blue-100 rounded-xl p-4 border border-ocean-200">
              <div className="flex items-center gap-2 mb-2">
                <CalendarDays size={18} className="text-ocean-600" />
                <span className="text-xs font-medium text-ocean-700">Reservas ({periodoLabel})</span>
              </div>
              <div className="text-2xl font-bold text-gray-800">{(hist.total_reservas || 0).toLocaleString()}</div>
            </div>
            <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl p-4 border border-amber-200">
              <div className="flex items-center gap-2 mb-2">
                <BedDouble size={18} className="text-amber-600" />
                <span className="text-xs font-medium text-amber-700">Noches ({periodoLabel})</span>
              </div>
              <div className="text-2xl font-bold text-gray-800">{(hist.total_noches || 0).toLocaleString()}</div>
            </div>
          </div>

          {(data.historico_por_tipo || []).length > 0 && (
            <div className="bg-white rounded-xl p-5 shadow-sm border-t-4 border-purple-400">
              <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <TrendingUp size={16} className="text-purple-600" /> Por Tipo de Habitación ({periodoLabel})
              </h3>
              <div className="space-y-2">
                {(data.historico_por_tipo || []).map((t: any, i: number) => {
                  const maxRev = Math.max(...(data.historico_por_tipo || []).map((r: any) => r.ingresos || 0), 1);
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between text-xs mb-0.5">
                        <span className="font-semibold text-gray-700">{t.tipo_habitacion}</span>
                        <span className="text-gray-500">${(t.ingresos || 0).toLocaleString()} • {t.reservas} reservas</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2.5">
                        <div className="h-2.5 rounded-full bg-gradient-to-r from-purple-400 to-purple-600 transition-all"
                          style={{ width: `${Math.max(3, ((t.ingresos || 0) / maxRev) * 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recent reservations */}
      <div className="bg-white rounded-xl shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">Reservas Recientes</h2>
          <Link to="/reservas/nueva" className="text-sm bg-mahana-500 text-white px-4 py-2 rounded-lg hover:bg-mahana-600 transition">+ Nueva Reserva</Link>
        </div>
        {data.recientes.length === 0 ? (
          <div className="p-8 text-center text-gray-400">Sin reservas aún</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-left">Habitación</th>
                  <th className="px-4 py-3 text-left">Check-in</th>
                  <th className="px-4 py-3 text-left">Noches</th>
                  <th className="px-4 py-3 text-left">Plan</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.recientes.map((r: any) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link to={`/reservas/${r.id}`} className="text-ocean-600 hover:underline font-medium">{r.cliente}</Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{r.habitacion_nombre || '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{r.check_in}</td>
                    <td className="px-4 py-3 text-gray-500">{r.noches}</td>
                    <td className="px-4 py-3 text-gray-500">{r.plan_nombre || '-'}</td>
                    <td className="px-4 py-3 text-right font-medium">${r.monto_total?.toFixed(2)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${estadoColor[r.estado] || 'bg-gray-100'}`}>{r.estado}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Stat Card ──
function StatCard({ icon: Icon, label, value, sub, color }: any) {
  const bg = color === 'ocean' ? 'from-ocean-400 to-ocean-500' : color === 'green' ? 'from-emerald-400 to-emerald-500' : color === 'purple' ? 'from-violet-400 to-violet-500' : color === 'amber' ? 'from-amber-400 to-amber-500' : 'from-mahana-400 to-mahana-500';
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${bg} flex items-center justify-center`}>
          <Icon size={20} className="text-white" />
        </div>
      </div>
      <div className="text-2xl font-bold text-gray-800">{value}</div>
      <div className="text-sm text-gray-400">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

// ── Occupancy Bar Chart ──
function OccupancyBarChart({ timeline, color = 'ocean' }: { timeline: any[]; color?: string }) {
  if (!timeline.length) return <div className="text-gray-400 text-sm">Sin datos</div>;
  const maxPct = Math.max(...timeline.map(t => t.pct), 10);
  const barTheme = color === 'amber'
    ? { high: 'bg-amber-500', mid: 'bg-amber-300', low: 'bg-amber-200', zero: 'bg-gray-200' }
    : { high: 'bg-ocean-500', mid: 'bg-ocean-300', low: 'bg-ocean-200', zero: 'bg-gray-200' };

  return (
    <div className="flex items-end gap-1" style={{ height: '160px' }}>
      {timeline.map((t, i) => {
        const barH = Math.max(2, (t.pct / Math.max(maxPct, 1)) * 130);
        const barColor = t.pct >= 60 ? barTheme.high : t.pct >= 30 ? barTheme.mid : t.pct > 0 ? barTheme.low : barTheme.zero;
        const label = t.fecha.slice(5);
        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-end gap-0.5" title={`${label}: ${t.pct}% (${t.ocupadas})`}>
            <span className="text-[10px] text-gray-500 font-medium">{t.pct}%</span>
            <div className={`w-full rounded-t-sm ${barColor} transition-all duration-300`} style={{ height: `${barH}px` }} />
            <span className="text-[9px] text-gray-400 mt-0.5">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Limpieza Card (by category) ──
function LimpiezaCard({ title, data, accent }: { title: string; data: any[]; accent: string }) {
  const borderColor = accent === 'amber' ? 'border-amber-400' : 'border-ocean-400';
  const getLimpColor = (e: string) =>
    e === 'Limpia' ? 'border-green-400 bg-green-50' : e === 'Sucia' ? 'border-red-400 bg-red-50' : 'border-blue-400 bg-blue-50';
  const total = data.reduce((s, d) => s + d.c, 0);
  const limpia = data.find(d => d.estado_limpieza === 'Limpia')?.c || 0;

  return (
    <div className={`bg-white rounded-xl p-5 shadow-sm border-t-4 ${borderColor}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-700">{title}</h3>
        <span className="text-xs text-gray-400">{limpia}/{total} limpias</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {data.map((l: any) => (
          <div key={l.estado_limpieza} className={`rounded-lg p-2.5 text-center border-l-4 ${getLimpColor(l.estado_limpieza)}`}>
            <div className="text-xl font-bold text-gray-800">{l.c}</div>
            <div className="text-[10px] text-gray-500">{l.estado_limpieza}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Revenue by Plan Pie Chart ──
function RevenuePie({ data }: { data: any[] }) {
  const total = data.reduce((s: number, d: any) => s + d.total, 0);
  if (total === 0) return <div className="text-gray-400 text-sm text-center py-8">Sin datos</div>;

  let cumAngle = 0;
  const slices = data.map((d, i) => {
    const angle = (d.total / total) * 360;
    const startAngle = cumAngle;
    cumAngle += angle;
    return { ...d, startAngle, angle, color: pieColors[i % pieColors.length] };
  });

  const toRad = (deg: number) => (deg - 90) * (Math.PI / 180);
  const arcPath = (cx: number, cy: number, r: number, start: number, end: number) => {
    const s = { x: cx + r * Math.cos(toRad(start)), y: cy + r * Math.sin(toRad(start)) };
    const e = { x: cx + r * Math.cos(toRad(end)), y: cy + r * Math.sin(toRad(end)) };
    const large = end - start > 180 ? 1 : 0;
    return `M${cx},${cy} L${s.x},${s.y} A${r},${r} 0 ${large} 1 ${e.x},${e.y} Z`;
  };

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 120 120" style={{ width: '140px', height: '140px' }}>
        {slices.map((s, i) => (
          <path key={i} d={arcPath(60, 60, 50, s.startAngle, s.startAngle + s.angle - 0.5)}
            fill={s.color} className="hover:opacity-80 transition" />
        ))}
        <circle cx={60} cy={60} r={25} fill="white" />
        <text x={60} y={57} textAnchor="middle" fontSize={10} fontWeight="bold" fill="#1f2937">${Math.round(total)}</text>
        <text x={60} y={68} textAnchor="middle" fontSize={5} fill="#9ca3af">ingresos</text>
      </svg>
      <div className="flex flex-wrap gap-2 mt-2 justify-center">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-1 text-xs text-gray-600">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
            {s.plan_nombre} (${Math.round(s.total)})
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Occupancy by Room Type ──
function OccupancyByType({ data }: { data: any[] }) {
  if (!data.length) return <div className="text-gray-400 text-sm text-center py-4">Sin datos</div>;
  const max = Math.max(...data.map(d => d.reservas), 1);
  const catColors: Record<string, string> = { 'Estadía': 'bg-ocean-400', 'Pasadía': 'bg-amber-400' };

  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <div key={i}>
          <div className="flex items-center justify-between text-xs mb-0.5">
            <span className="text-gray-600 font-medium">{d.tipo}</span>
            <span className="text-gray-400">{d.reservas} res.</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div className={`h-2 rounded-full transition-all ${catColors[d.categoria] || 'bg-gray-400'}`}
              style={{ width: `${(d.reservas / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
