import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { BarChart3, TrendingUp, DollarSign, Users, Calendar, CreditCard, Hotel, FileText, AlertTriangle, ArrowDownRight, ArrowUpRight, Percent, Clock } from 'lucide-react';

const fmt = (n: number | null | undefined) => n != null ? `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '$0.00';
const pct = (n: number | null | undefined) => n != null ? `${Math.round(Number(n))}%` : '0%';

const barColors = ['#92400e', '#d97706', '#059669', '#0891b2', '#7c3aed', '#ec4899', '#64748b', '#dc2626'];

function MiniBar({ data, labelKey, valueKey, maxVal }: { data: any[]; labelKey: string; valueKey: string; maxVal?: number }) {
  const max = maxVal || Math.max(...data.map(d => d[valueKey] || 0), 1);
  return (
    <div className="space-y-2">
      {data.map((row, i) => (
        <div key={i}>
          <div className="flex justify-between text-xs mb-0.5">
            <span className="text-gray-600 font-medium truncate">{row[labelKey] || 'N/A'}</span>
            <span className="text-gray-800 font-bold">{fmt(row[valueKey])}</span>
          </div>
          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(row[valueKey] / max) * 100}%`, backgroundColor: barColors[i % barColors.length] }} />
          </div>
          {row.reservas != null && <span className="text-[10px] text-gray-400">{row.reservas} reserva{row.reservas !== 1 ? 's' : ''}</span>}
        </div>
      ))}
      {data.length === 0 && <p className="text-xs text-gray-300 text-center py-3">Sin datos</p>}
    </div>
  );
}

function DailyChart({ data }: { data: { fecha: string; revenue: number; reservas: number }[] }) {
  if (data.length === 0) return <p className="text-xs text-gray-300 text-center py-8">Sin datos para este período</p>;
  const max = Math.max(...data.map(d => d.revenue), 1);
  const barW = Math.max(12, Math.min(36, Math.floor(600 / data.length)));
  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-1 min-h-[160px] pb-6 relative" style={{ minWidth: data.length * (barW + 4) }}>
        {data.map((d, i) => {
          const h = Math.max(4, (d.revenue / max) * 140);
          const day = d.fecha.slice(8);
          return (
            <div key={i} className="flex flex-col items-center group relative">
              <div className="absolute -top-8 bg-gray-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap z-10">
                {d.fecha}: {fmt(d.revenue)} ({d.reservas} res.)
              </div>
              <div className="rounded-t transition-all duration-300 group-hover:opacity-80" style={{ width: barW, height: h, background: `linear-gradient(to top, #78350f, #d97706)` }} />
              <span className="text-[9px] text-gray-400 mt-1 absolute -bottom-5">{day}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Reportes() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [desde, setDesde] = useState(() => {
    const d = new Date(); d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [hasta, setHasta] = useState(() => new Date().toISOString().split('T')[0]);
  const [preset, setPreset] = useState('este_mes');

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/reportes/financiero?desde=${desde}&hasta=${hasta}`)
      .then(r => setData(r.data))
      .catch(e => console.error('Report error:', e))
      .finally(() => setLoading(false));
  }, [desde, hasta]);

  useEffect(() => { load(); }, [load]);

  const setPresetRange = (key: string) => {
    setPreset(key);
    const now = new Date();
    let d: Date, h: Date;
    switch (key) {
      case 'hoy': d = h = now; break;
      case 'esta_semana': { d = new Date(now); d.setDate(now.getDate() - now.getDay()); h = now; break; }
      case 'este_mes': { d = new Date(now.getFullYear(), now.getMonth(), 1); h = now; break; }
      case 'mes_pasado': { d = new Date(now.getFullYear(), now.getMonth() - 1, 1); h = new Date(now.getFullYear(), now.getMonth(), 0); break; }
      case 'este_ano': { d = new Date(now.getFullYear(), 0, 1); h = now; break; }
      case 'todo': { d = new Date(2018, 0, 1); h = now; break; }
      default: return;
    }
    setDesde(d.toISOString().split('T')[0]);
    setHasta(h.toISOString().split('T')[0]);
  };

  if (loading && !data) return <div className="animate-pulse text-gray-400 p-8">Cargando reportes...</div>;

  const r = data?.resumen || {};

  return (
    <div>
      {/* Header + Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><BarChart3 size={24} className="text-mahana-500" /> Reportes Financieros</h1>
          <p className="text-sm text-gray-400">{data?.periodo?.desde} — {data?.periodo?.hasta}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { key: 'hoy', label: 'Hoy' },
            { key: 'esta_semana', label: 'Semana' },
            { key: 'este_mes', label: 'Este mes' },
            { key: 'mes_pasado', label: 'Mes pasado' },
            { key: 'este_ano', label: 'Año' },
            { key: 'todo', label: 'Todo' },
          ].map(p => (
            <button key={p.key} onClick={() => setPresetRange(p.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${preset === p.key ? 'bg-mahana-500 text-white shadow' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
              {p.label}
            </button>
          ))}
          <div className="flex items-center gap-1 text-xs">
            <input type="date" value={desde} onChange={e => { setDesde(e.target.value); setPreset('custom'); }} className="px-2 py-1.5 border rounded-lg text-xs" />
            <span className="text-gray-300">—</span>
            <input type="date" value={hasta} onChange={e => { setHasta(e.target.value); setPreset('custom'); }} className="px-2 py-1.5 border rounded-lg text-xs" />
          </div>
        </div>
      </div>

      {loading && <div className="text-center text-xs text-gray-400 mb-2">Actualizando...</div>}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3 mb-6">
        <KPICard icon={DollarSign} label="Revenue Total" value={fmt(r.revenue_total)} color="emerald" />
        <KPICard icon={CreditCard} label="Cobrado" value={fmt(r.cobrado)} color="blue" sub={r.revenue_total > 0 ? `${Math.round((r.cobrado / r.revenue_total) * 100)}% del total` : ''} />
        <KPICard icon={AlertTriangle} label="Pendiente" value={fmt(r.pendiente)} color="amber" />
        <KPICard icon={FileText} label="Reservas" value={r.total || 0} color="purple" sub={`${r.activas || 0} activas · ${r.canceladas || 0} canc.`} />
        <KPICard icon={Hotel} label="Ocupación" value={pct(r.occupancy)} color="mahana" sub={`${r.total_rooms} rooms`} />
        <KPICard icon={TrendingUp} label="Ticket Promedio" value={fmt(r.ticket_promedio)} color="gray" sub={r.promedio_noches ? `~${Math.round(r.promedio_noches)} noches` : ''} />
      </div>

      {/* Daily Chart */}
      <div className="bg-white rounded-xl shadow-sm p-5 mb-6 border border-gray-100">
        <h2 className="text-sm font-bold text-gray-600 mb-4 flex items-center gap-2"><TrendingUp size={16} /> Revenue Diario</h2>
        <DailyChart data={data?.diario || []} />
      </div>

      {/* Breakdown Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
        {/* By Plan */}
        <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
          <h3 className="text-sm font-bold text-gray-600 mb-4 flex items-center gap-2"><BarChart3 size={14} /> Por Plan / Tarifa</h3>
          <MiniBar data={data?.por_plan || []} labelKey="plan" valueKey="revenue" />
        </div>

        {/* By Source */}
        <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
          <h3 className="text-sm font-bold text-gray-600 mb-4 flex items-center gap-2"><Users size={14} /> Por Fuente</h3>
          <MiniBar data={data?.por_fuente || []} labelKey="fuente" valueKey="revenue" />
        </div>

        {/* By Room Type */}
        <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
          <h3 className="text-sm font-bold text-gray-600 mb-4 flex items-center gap-2"><Hotel size={14} /> Por Tipo Habitación</h3>
          <MiniBar data={data?.por_tipo_habitacion || []} labelKey="tipo" valueKey="revenue" />
        </div>
      </div>

      {/* Payment Methods + Recent Payments */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Payment Methods */}
        <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
          <h3 className="text-sm font-bold text-gray-600 mb-4 flex items-center gap-2"><CreditCard size={14} /> Métodos de Pago</h3>
          <MiniBar data={data?.por_metodo_pago || []} labelKey="metodo" valueKey="total" />
        </div>

        {/* Recent Payments */}
        <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
          <h3 className="text-sm font-bold text-gray-600 mb-4 flex items-center gap-2"><Clock size={14} /> Pagos Recientes</h3>
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {(data?.pagos_recientes || []).map((p: any) => (
              <div key={p.id} className="flex items-center justify-between text-xs py-1.5 border-b border-gray-50 last:border-0">
                <div>
                  <span className="font-medium text-gray-700">{p.cliente} {p.apellido}</span>
                  <span className="text-gray-400 ml-2">{p.concepto}</span>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <span className="font-bold text-emerald-600">{fmt(p.monto)}</span>
                  <span className="block text-[10px] text-gray-400">{p.metodo_pago} · {p.fecha}</span>
                </div>
              </div>
            ))}
            {(data?.pagos_recientes || []).length === 0 && <p className="text-xs text-gray-300 text-center py-3">Sin pagos en este período</p>}
          </div>
        </div>
      </div>

      {/* Pending Balances */}
      {(data?.saldos_pendientes || []).length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-5 border border-amber-200">
          <h3 className="text-sm font-bold text-amber-700 mb-4 flex items-center gap-2"><AlertTriangle size={14} /> Saldos Pendientes</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b">
                  <th className="text-left py-2 font-medium">Reserva</th>
                  <th className="text-left py-2 font-medium">Huésped</th>
                  <th className="text-left py-2 font-medium">Plan</th>
                  <th className="text-left py-2 font-medium">Fechas</th>
                  <th className="text-right py-2 font-medium">Total</th>
                  <th className="text-right py-2 font-medium">Pagado</th>
                  <th className="text-right py-2 font-medium">Pendiente</th>
                </tr>
              </thead>
              <tbody>
                {(data?.saldos_pendientes || []).map((s: any) => (
                  <tr key={s.id} className="border-b border-gray-50">
                    <td className="py-2 font-mono text-gray-500">#{s.id}</td>
                    <td className="py-2 font-medium text-gray-700">{s.cliente} {s.apellido}</td>
                    <td className="py-2 text-gray-500">{s.plan_nombre}</td>
                    <td className="py-2 text-gray-400">{s.check_in} → {s.check_out}</td>
                    <td className="py-2 text-right">{fmt(s.monto_total)}</td>
                    <td className="py-2 text-right text-emerald-600">{fmt(s.monto_pagado)}</td>
                    <td className="py-2 text-right font-bold text-amber-600">{fmt(s.saldo_pendiente)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function KPICard({ icon: Icon, label, value, color, sub }: { icon: any; label: string; value: string | number; color: string; sub?: string }) {
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-600',
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
    purple: 'bg-purple-50 text-purple-600',
    mahana: 'bg-amber-50 text-amber-700',
    gray: 'bg-gray-50 text-gray-600',
  };
  const c = colorMap[color] || colorMap.gray;
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100 hover:shadow-md transition">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${c}`}><Icon size={16} /></div>
        <span className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{label}</span>
      </div>
      <div className="text-xl font-bold text-gray-800">{value}</div>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}
