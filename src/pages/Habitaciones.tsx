import { useState, useEffect, useMemo } from 'react';
import { api } from '../api/client';
import { X } from 'lucide-react';

const limpiezaColors: Record<string, string> = {
  'Sucia': 'bg-red-100 text-red-700 border-red-300',
  'Limpia': 'bg-green-100 text-green-700 border-green-300',
  'Inspeccionada': 'bg-blue-100 text-blue-700 border-blue-300',
};

const limpiezaEmoji: Record<string, string> = { 'Sucia': '🔴', 'Limpia': '🟢', 'Inspeccionada': '🔵' };

const estadoHabColors: Record<string, string> = {
  'Vacía': 'text-gray-500',
  'Ocupada': 'text-orange-600 font-medium',
};

const typeOrder: Record<string, number> = { 'Familiar': 1, 'Doble': 2, 'Estándar': 3, 'Camping': 4, 'Bohío': 1, 'Salón': 2, 'Restaurante': 3 };

export default function Habitaciones() {
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number[]>([]);
  const [editRoom, setEditRoom] = useState<any>(null);
  const [editForm, setEditForm] = useState({ asignado_a: '', no_molestar: 0, comentarios: '' });
  const [catFilter, setCatFilter] = useState('');
  const [limpiezaFilter, setLimpiezaFilter] = useState('');
  const [activeDropdownRoomId, setActiveDropdownRoomId] = useState<number | null>(null);

  const load = () => { api.get('/habitaciones').then(r => { setRooms(r.data); setLoading(false); }); };
  useEffect(() => { load(); }, []);

  const toggleLimpieza = async (id: number, current: string) => {
    const next = current === 'Sucia' ? 'Limpia' : current === 'Limpia' ? 'Inspeccionada' : 'Sucia';
    await api.patch(`/habitaciones/${id}/limpieza`, { estado_limpieza: next });
    load();
  };

  const toggleSelect = (id: number) => {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  };

  const bulkAction = async (estado: string) => {
    if (selected.length === 0) return;
    await api.patch('/habitaciones/masiva', { ids: selected, estado_limpieza: estado });
    setSelected([]);
    load();
  };

  const openEdit = (room: any) => {
    setEditRoom(room);
    setEditForm({ asignado_a: room.asignado_a || '', no_molestar: room.no_molestar || 0, comentarios: room.comentarios || '' });
  };

  const saveEdit = async () => {
    await api.patch(`/habitaciones/${editRoom.id}`, editForm);
    setEditRoom(null);
    load();
  };

  // Filter rooms
  const filteredRooms = useMemo(() => {
    let r = rooms;
    if (catFilter) r = r.filter(room => room.categoria === catFilter);
    if (limpiezaFilter) r = r.filter(room => room.estado_limpieza === limpiezaFilter);
    return r;
  }, [rooms, catFilter, limpiezaFilter]);

  // Dynamic grouping by categoria > tipo
  const categoryGroups = useMemo(() => {
    const catMap: Record<string, Record<string, any[]>> = {};
    for (const r of filteredRooms) {
      const cat = r.categoria || 'Estadía';
      if (!catMap[cat]) catMap[cat] = {};
      (catMap[cat][r.tipo] = catMap[cat][r.tipo] || []).push(r);
    }
    const catOrder = ['Estadía', 'Pasadía'];
    return catOrder.filter(c => catMap[c]).map(cat => ({
      categoria: cat,
      groups: Object.entries(catMap[cat])
        .sort(([a], [b]) => (typeOrder[a] || 99) - (typeOrder[b] || 99))
        .map(([tipo, rms]) => ({ tipo, rooms: rms }))
    }));
  }, [filteredRooms]);

  const stats = {
    limpia: rooms.filter(r => r.estado_limpieza === 'Limpia').length,
    sucia: rooms.filter(r => r.estado_limpieza === 'Sucia').length,
    inspeccionada: rooms.filter(r => r.estado_limpieza === 'Inspeccionada').length,
    ocupada: rooms.filter(r => r.estado_habitacion === 'Ocupada').length,
    estadia: rooms.filter(r => r.categoria === 'Estadía').length,
    pasadia: rooms.filter(r => r.categoria === 'Pasadía').length,
  };

  if (loading) return <div className="animate-pulse text-gray-400 p-8">Cargando...</div>;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-gray-800">Gestión de Limpieza</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="px-3 py-1.5 bg-green-50 text-green-700 rounded-lg">🟢 {stats.limpia} Limpias</span>
          <span className="px-3 py-1.5 bg-red-50 text-red-700 rounded-lg">🔴 {stats.sucia} Sucias</span>
          <span className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg">🔵 {stats.inspeccionada} Inspecc.</span>
          <span className="px-3 py-1.5 bg-orange-50 text-orange-700 rounded-lg">🛏️ {stats.ocupada} Ocupadas</span>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-3 mb-4 flex flex-wrap gap-2 items-center shadow-sm">
        <span className="text-xs text-gray-400 font-medium">Categoría:</span>
        <button onClick={() => setCatFilter('')} className={`px-3 py-1.5 text-xs rounded-lg transition font-medium ${!catFilter ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>Todas</button>
        <button onClick={() => setCatFilter('Estadía')} className={`px-3 py-1.5 text-xs rounded-lg transition font-medium ${catFilter === 'Estadía' ? 'bg-ocean-500 text-white' : 'bg-ocean-50 text-ocean-700 hover:bg-ocean-100'}`}>🏨 Estadía ({stats.estadia})</button>
        <button onClick={() => setCatFilter('Pasadía')} className={`px-3 py-1.5 text-xs rounded-lg transition font-medium ${catFilter === 'Pasadía' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>☀️ Pasadía ({stats.pasadia})</button>
        <span className="text-gray-200 mx-1">|</span>
        <span className="text-xs text-gray-400 font-medium">Limpieza:</span>
        <button onClick={() => setLimpiezaFilter('')} className={`px-3 py-1.5 text-xs rounded-lg transition ${!limpiezaFilter ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'}`}>Todas</button>
        <button onClick={() => setLimpiezaFilter('Sucia')} className={`px-3 py-1.5 text-xs rounded-lg transition ${limpiezaFilter === 'Sucia' ? 'bg-red-500 text-white' : 'bg-red-50 text-red-600'}`}>Sucia</button>
        <button onClick={() => setLimpiezaFilter('Limpia')} className={`px-3 py-1.5 text-xs rounded-lg transition ${limpiezaFilter === 'Limpia' ? 'bg-green-500 text-white' : 'bg-green-50 text-green-600'}`}>Limpia</button>
        <button onClick={() => setLimpiezaFilter('Inspeccionada')} className={`px-3 py-1.5 text-xs rounded-lg transition ${limpiezaFilter === 'Inspeccionada' ? 'bg-blue-500 text-white' : 'bg-blue-50 text-blue-600'}`}>Inspecc.</button>
        <span className="text-gray-200 mx-1">|</span>
        <span className="text-xs text-gray-400 font-medium">Seleccionar:</span>
        <button onClick={() => setSelected(filteredRooms.map(r => r.id))} className="px-3 py-1.5 text-xs rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition font-medium">☑ Todas visibles</button>
        <button onClick={() => setSelected(rooms.filter(r => r.categoria === 'Estadía').map(r => r.id))} className="px-3 py-1.5 text-xs rounded-lg bg-ocean-50 text-ocean-700 hover:bg-ocean-100 transition">🏨 Estadía</button>
        <button onClick={() => setSelected(rooms.filter(r => r.categoria === 'Pasadía').map(r => r.id))} className="px-3 py-1.5 text-xs rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition">☀️ Pasadía</button>
        {selected.length > 0 && <button onClick={() => setSelected([])} className="px-3 py-1.5 text-xs rounded-lg bg-gray-50 text-gray-500 hover:bg-gray-100 transition">✕ Ninguna</button>}
      </div>

      {/* Bulk Actions */}
      {selected.length > 0 && (
        <div className="bg-ocean-50 border border-ocean-200 rounded-xl p-3 mb-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-ocean-700">{selected.length} seleccionadas</span>
          <button onClick={() => bulkAction('Limpia')} className="px-3 py-1.5 bg-green-500 text-white text-xs rounded-lg hover:bg-green-600 transition">✓ Marcar Limpia</button>
          <button onClick={() => bulkAction('Inspeccionada')} className="px-3 py-1.5 bg-blue-500 text-white text-xs rounded-lg hover:bg-blue-600 transition">✓ Marcar Inspeccionada</button>
          <button onClick={() => bulkAction('Sucia')} className="px-3 py-1.5 bg-red-500 text-white text-xs rounded-lg hover:bg-red-600 transition">✗ Marcar Sucia</button>
          <button onClick={() => setSelected([])} className="text-xs text-gray-500 ml-auto hover:text-gray-700">Cancelar</button>
        </div>
      )}

      {/* Room Groups */}
      {categoryGroups.map(catGroup => (
        <div key={catGroup.categoria} className="mb-6">
          <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-t-xl text-sm font-bold uppercase tracking-wider ${catGroup.categoria === 'Estadía' ? 'bg-ocean-100 text-ocean-800' : 'bg-amber-100 text-amber-800'}`}>
            {catGroup.categoria === 'Estadía' ? '🏨' : '☀️'} {catGroup.categoria}
          </div>
          <div className={`border-t-4 ${catGroup.categoria === 'Estadía' ? 'border-ocean-400' : 'border-amber-400'}`}>
            {catGroup.groups.map(g => (
              <div key={g.tipo} className="mb-4 mt-3">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 ml-1">{g.tipo} ({g.rooms.length})</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
                  {g.rooms.map(room => (
                    <div key={room.id} className={`bg-white rounded-lg p-3 shadow-sm border-2 transition ${
                      selected.includes(room.id) ? 'border-ocean-400 ring-2 ring-ocean-200' : 'border-transparent hover:border-gray-200'
                    }`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <input type="checkbox" checked={selected.includes(room.id)} onChange={() => toggleSelect(room.id)} className="rounded w-3.5 h-3.5" />
                          <span className="font-bold text-gray-800 text-sm">{room.nombre}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {room.comentarios && (
                            <div className="relative group/tooltip inline-block mr-1">
                              <span className="cursor-pointer text-xs hover:scale-110 transition duration-150" title="Ver Comentarios">💬</span>
                              <div className="absolute bottom-full right-0 mb-2 hidden group-hover/tooltip:block w-48 p-2.5 bg-gray-900/95 backdrop-blur-md border border-white/10 text-white text-[11px] leading-relaxed rounded-xl shadow-xl z-30 pointer-events-none text-left">
                                <p className="font-bold text-ocean-400 text-[9px] uppercase tracking-wider mb-0.5">Notas del Personal:</p>
                                <p className="font-medium text-gray-200">{room.comentarios}</p>
                                <div className="absolute top-full right-2 border-4 border-transparent border-t-gray-900/95" />
                              </div>
                            </div>
                          )}
                          <span className={`text-[10px] ${estadoHabColors[room.estado_habitacion] || ''}`}>{room.estado_habitacion}</span>
                          <button onClick={() => openEdit(room)} className="text-gray-300 hover:text-gray-500 text-xs" title="Editar">⚙️</button>
                        </div>
                      </div>
                      
                      <div className="relative">
                        <button
                          onClick={() => setActiveDropdownRoomId(activeDropdownRoomId === room.id ? null : room.id)}
                          className={`w-full px-2.5 py-1.5 rounded-xl text-xs font-bold border transition duration-150 flex items-center justify-between shadow-sm ${
                            room.estado_limpieza === 'Limpia'
                              ? 'bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200 text-emerald-800 hover:from-emerald-100 hover:to-teal-100'
                              : room.estado_limpieza === 'Inspeccionada'
                              ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200 text-blue-800 hover:from-blue-100 hover:to-indigo-100'
                              : 'bg-gradient-to-r from-rose-50 to-pink-50 border-rose-200 text-rose-800 hover:from-rose-100 hover:to-pink-100'
                          }`}
                        >
                          <span>{limpiezaEmoji[room.estado_limpieza] || '⚪'} {room.estado_limpieza}</span>
                          <span className="text-[9px] opacity-60">▼</span>
                        </button>
                        {activeDropdownRoomId === room.id && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setActiveDropdownRoomId(null)} />
                            <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-xl z-20 p-1 flex flex-col gap-0.5 animate-in fade-in slide-in-from-top-1 duration-150">
                              {[
                                { id: 'Limpia', label: 'Limpia', emoji: '🟢', color: 'hover:bg-green-50 hover:text-green-700' },
                                { id: 'Inspeccionada', label: 'Inspeccionada', emoji: '🔵', color: 'hover:bg-blue-50 hover:text-blue-700' },
                                { id: 'Sucia', label: 'Sucia', emoji: '🔴', color: 'hover:bg-red-50 hover:text-red-700' },
                              ].map(opt => (
                                <button
                                  key={opt.id}
                                  onClick={async () => {
                                    setActiveDropdownRoomId(null);
                                    await api.patch(`/habitaciones/${room.id}/limpieza`, { estado_limpieza: opt.id });
                                    load();
                                  }}
                                  className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-semibold text-gray-700 transition ${opt.color} flex items-center gap-1.5`}
                                >
                                  <span>{opt.emoji}</span>
                                  <span>{opt.label}</span>
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>

                      {(room.no_molestar === 1 || room.asignado_a) && (
                        <div className="mt-1.5 space-y-0.5">
                          {room.no_molestar === 1 && <div className="text-[10px] text-red-500 font-medium">🚫 No Molestar</div>}
                          {room.asignado_a && <div className="text-[10px] text-gray-400">👤 {room.asignado_a}</div>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {filteredRooms.length === 0 && <div className="text-center text-gray-400 py-8">No hay habitaciones con los filtros seleccionados</div>}

      {/* Edit Modal */}
      {editRoom && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEditRoom(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-800">{editRoom.nombre} — Detalles</h2>
              <button onClick={() => setEditRoom(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">Asignado a</label>
                <input value={editForm.asignado_a} onChange={e => setEditForm(f => ({ ...f, asignado_a: e.target.value }))}
                  className="input" placeholder="Nombre del staff" />
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-500">No Molestar</label>
                <button onClick={() => setEditForm(f => ({ ...f, no_molestar: f.no_molestar ? 0 : 1 }))}
                  className={`w-12 h-6 rounded-full transition flex items-center ${editForm.no_molestar ? 'bg-red-500 justify-end' : 'bg-gray-200 justify-start'}`}>
                  <span className="w-5 h-5 bg-white rounded-full shadow mx-0.5 transition" />
                </button>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">Comentarios</label>
                <textarea value={editForm.comentarios} onChange={e => setEditForm(f => ({ ...f, comentarios: e.target.value }))}
                  className="input min-h-[60px]" placeholder="Notas de la habitación..." />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={saveEdit} className="flex-1 py-2.5 bg-mahana-500 text-white rounded-xl font-medium hover:bg-mahana-600 transition">Guardar</button>
              <button onClick={() => setEditRoom(null)} className="px-4 py-2.5 text-gray-500 hover:bg-gray-100 rounded-xl transition">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
