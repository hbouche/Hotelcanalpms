import { useState, useEffect } from 'react';
import { Users, Search, Globe, Star, TrendingUp, Mail, Phone, Calendar, ChevronLeft, ChevronRight, ArrowUpDown } from 'lucide-react';
import { api } from '../api/client';

interface Huesped {
  id: number;
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  pais: string;
  ciudad: string;
  total_reservas: number;
  noches_estadia: number;
  total_ingresos: number;
  ultima_estadia: string;
  huesped_habitual: number;
}

export default function Huespedes() {
  const [guests, setGuests] = useState<Huesped[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState<any>({});
  const [sortBy, setSortBy] = useState<'ingresos' | 'reservas' | 'nombre' | 'reciente'>('ingresos');
  const [onlyHabitual, setOnlyHabitual] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [selected, setSelected] = useState<Huesped | null>(null);

  const load = () => {
    setLoading(true);
    const params: any = { page, limit: 50 };
    if (search) params.q = search;
    if (onlyHabitual) params.habitual = '1';
    api.get('/hotel/huespedes', { params })
      .then(r => {
        setGuests(r.data);
        setMeta(r.meta || {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [page, onlyHabitual]);
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); load(); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Load aggregate stats
  useEffect(() => {
    api.get('/hotel/huespedes', { params: { limit: 1 } })
      .then(r => {
        const total = r.meta?.total || 0;
        // Get additional stats
        api.get('/hotel/huespedes/stats').then(s => setStats({ total, ...s.data })).catch(() => setStats({ total }));
      }).catch(() => {});
  }, []);

  const formatDate = (d: string) => {
    if (!d) return '—';
    try {
      return new Date(d + 'T12:00:00').toLocaleDateString('es-PA', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return d; }
  };

  const sorted = [...guests].sort((a, b) => {
    if (sortBy === 'ingresos') return b.total_ingresos - a.total_ingresos;
    if (sortBy === 'reservas') return b.total_reservas - a.total_reservas;
    if (sortBy === 'reciente') return (b.ultima_estadia || '').localeCompare(a.ultima_estadia || '');
    return (a.nombre + a.apellido).localeCompare(b.nombre + b.apellido);
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Users size={28} className="text-mahana-600" /> Directorio de Huéspedes
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {meta.total?.toLocaleString() || '—'} huéspedes registrados
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
              <Users size={20} className="text-purple-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-800">{meta.total?.toLocaleString() || '—'}</div>
              <div className="text-xs text-gray-500">Total Huéspedes</div>
            </div>
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
              <TrendingUp size={20} className="text-green-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-800">
                ${guests.length > 0 ? guests.reduce((s, g) => s + g.total_ingresos, 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '—'}
              </div>
              <div className="text-xs text-gray-500">Ingresos (página)</div>
            </div>
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
              <Star size={20} className="text-amber-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-800">
                {guests.filter(g => g.huesped_habitual).length}
              </div>
              <div className="text-xs text-gray-500">Habituales (página)</div>
            </div>
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-ocean-100 flex items-center justify-center">
              <Globe size={20} className="text-ocean-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-800">
                {new Set(guests.map(g => g.pais).filter(Boolean)).size}
              </div>
              <div className="text-xs text-gray-500">Países (página)</div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[250px]">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por nombre, email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mahana-200 focus:border-mahana-400"
          />
        </div>
        <button
          onClick={() => setOnlyHabitual(!onlyHabitual)}
          className={`px-4 py-2.5 rounded-lg text-sm font-medium border transition ${onlyHabitual ? 'bg-amber-50 border-amber-300 text-amber-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >
          <Star size={14} className="inline mr-1" /> Habituales
        </button>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as any)}
          className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600"
        >
          <option value="ingresos">Mayor ingreso</option>
          <option value="reservas">Más reservas</option>
          <option value="reciente">Más reciente</option>
          <option value="nombre">Nombre A-Z</option>
        </select>
      </div>

      {/* Guest Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400 animate-pulse">Cargando huéspedes...</div>
        ) : sorted.length === 0 ? (
          <div className="p-12 text-center text-gray-400">No se encontraron huéspedes</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-gray-500 font-medium">Huésped</th>
                  <th className="px-4 py-3 text-left text-gray-500 font-medium">Contacto</th>
                  <th className="px-4 py-3 text-left text-gray-500 font-medium">País</th>
                  <th className="px-4 py-3 text-center text-gray-500 font-medium cursor-pointer hover:text-gray-700" onClick={() => setSortBy('reservas')}>
                    Reservas <ArrowUpDown size={12} className="inline" />
                  </th>
                  <th className="px-4 py-3 text-center text-gray-500 font-medium">Noches</th>
                  <th className="px-4 py-3 text-right text-gray-500 font-medium cursor-pointer hover:text-gray-700" onClick={() => setSortBy('ingresos')}>
                    Ingresos <ArrowUpDown size={12} className="inline" />
                  </th>
                  <th className="px-4 py-3 text-left text-gray-500 font-medium cursor-pointer hover:text-gray-700" onClick={() => setSortBy('reciente')}>
                    Última Estadía <ArrowUpDown size={12} className="inline" />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sorted.map(g => (
                  <tr key={g.id} className="hover:bg-gray-50/50 transition cursor-pointer" onClick={() => setSelected(selected?.id === g.id ? null : g)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold ${g.huesped_habitual ? 'bg-amber-500' : 'bg-mahana-400'}`}>
                          {g.nombre.charAt(0)}{g.apellido?.charAt(0) || ''}
                        </div>
                        <div>
                          <div className="font-medium text-gray-800">
                            {g.nombre} {g.apellido}
                            {g.huesped_habitual ? <Star size={12} className="inline ml-1 text-amber-500 fill-amber-500" /> : null}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {g.email && (
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          <Mail size={12} /> <span className="truncate max-w-[180px]">{g.email}</span>
                        </div>
                      )}
                      {g.telefono && (
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          <Phone size={12} /> {g.telefono}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-600">{g.pais || '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block min-w-[28px] px-2 py-0.5 rounded-full text-xs font-semibold ${g.total_reservas >= 5 ? 'bg-green-100 text-green-700' : g.total_reservas >= 2 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                        {g.total_reservas}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">{g.noches_estadia}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-semibold ${g.total_ingresos >= 500 ? 'text-green-700' : g.total_ingresos >= 100 ? 'text-gray-800' : 'text-gray-500'}`}>
                        ${g.total_ingresos.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <Calendar size={12} />
                        {formatDate(g.ultima_estadia)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {meta.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>Página {page} de {meta.pages} ({meta.total?.toLocaleString()} huéspedes)</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">
              <ChevronLeft size={16} />
            </button>
            <button disabled={page >= meta.pages} onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Detail Panel */}
      {selected && (
        <div className="fixed inset-y-0 right-0 w-96 bg-white shadow-2xl border-l border-gray-200 z-50 overflow-y-auto">
          <div className="p-6 space-y-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-bold ${selected.huesped_habitual ? 'bg-amber-500' : 'bg-mahana-500'}`}>
                  {selected.nombre.charAt(0)}{selected.apellido?.charAt(0) || ''}
                </div>
                <div>
                  <h3 className="font-bold text-gray-800 text-lg">{selected.nombre} {selected.apellido}</h3>
                  {selected.huesped_habitual ? <span className="text-xs text-amber-600 font-medium">⭐ Huésped Habitual</span> : null}
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <div className="space-y-3">
              {selected.email && (
                <div className="flex items-center gap-3 text-sm">
                  <Mail size={16} className="text-gray-400" />
                  <a href={`mailto:${selected.email}`} className="text-ocean-600 hover:underline">{selected.email}</a>
                </div>
              )}
              {selected.telefono && (
                <div className="flex items-center gap-3 text-sm">
                  <Phone size={16} className="text-gray-400" />
                  <span className="text-gray-700">{selected.telefono}</span>
                </div>
              )}
              {selected.pais && (
                <div className="flex items-center gap-3 text-sm">
                  <Globe size={16} className="text-gray-400" />
                  <span className="text-gray-700">{selected.pais}{selected.ciudad ? `, ${selected.ciudad}` : ''}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-gray-800">{selected.total_reservas}</div>
                <div className="text-xs text-gray-500">Reservas</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-gray-800">{selected.noches_estadia}</div>
                <div className="text-xs text-gray-500">Noches</div>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center col-span-2">
                <div className="text-2xl font-bold text-green-700">${selected.total_ingresos.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                <div className="text-xs text-gray-500">Ingresos Totales</div>
              </div>
            </div>

            {selected.ultima_estadia && (
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">Última Estadía</div>
                <div className="font-medium text-gray-800">{formatDate(selected.ultima_estadia)}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
