import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { Plus, Edit2, Trash2, X, Check, Clock, Tag, Star, Package, Calendar, DollarSign, Camera, Eye, Upload, ExternalLink } from 'lucide-react';

const catColors: Record<string, { bg: string; text: string; border: string; badge: string }> = {
  'Estadía': { bg: 'bg-ocean-50', text: 'text-ocean-700', border: 'border-ocean-400', badge: 'bg-ocean-100 text-ocean-700' },
  'Pasadía': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-400', badge: 'bg-amber-100 text-amber-700' },
  'Otro': { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-400', badge: 'bg-gray-100 text-gray-700' },
};

const tipoDiaLabels: Record<string, { label: string; emoji: string; color: string }> = {
  'entre_semana': { label: 'Entre Semana', emoji: '📅', color: 'text-blue-600 bg-blue-50' },
  'fin_de_semana': { label: 'Fin de Semana', emoji: '🎉', color: 'text-orange-600 bg-orange-50' },
  'festivo': { label: 'Festivo', emoji: '🎊', color: 'text-red-600 bg-red-50' },
};

const allRoomTypes = ['Familiar', 'Doble', 'Estándar', 'Camping', 'Bohío', 'Salón', 'Restaurante'];

const emptyForm = {
  codigo: '', nombre: '', descripcion: '', categoria: 'Estadía',
  precio_adulto_noche: 0, precio_menor_noche: 0, precio_mascota_noche: 0,
  incluye: [] as string[], horario: '', extras_disponibles: [] as string[],
  tipos_aplicables: [] as string[], imagen: '', activo: 1, visible_web: 0,
  lleva_impuesto: 0, impuesto_pct: 0
};

const emptyReglas = [
  { tipo_dia: 'entre_semana', precio_adulto: 0, precio_menor: 0, precio_mascota: 0 },
  { tipo_dia: 'fin_de_semana', precio_adulto: 0, precio_menor: 0, precio_mascota: 0 },
  { tipo_dia: 'festivo', precio_adulto: 0, precio_menor: 0, precio_mascota: 0 },
];

export default function Productos() {
  const [planes, setPlanes] = useState<any[]>([]);
  const [reglasMap, setReglasMap] = useState<Record<number, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [catFilter, setCatFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [reglas, setReglas] = useState<any[]>(JSON.parse(JSON.stringify(emptyReglas)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [newIncluye, setNewIncluye] = useState('');
  const [newExtra, setNewExtra] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [tab, setTab] = useState<'info' | 'tarifas'>('info');
  const [photoUploading, setPhotoUploading] = useState(false);

  // Holidays
  const [festivos, setFestivos] = useState<any[]>([]);
  const [showFestivos, setShowFestivos] = useState(false);
  const [newFecha, setNewFecha] = useState('');
  const [newNombre, setNewNombre] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get(`/hotel/planes?all=${showInactive ? '1' : '0'}`),
      api.get('/hotel/festivos'),
    ]).then(([planesRes, festivosRes]) => {
      setPlanes(planesRes.data);
      setFestivos(festivosRes.data);
      // Load rate rules for all plans
      const ids = planesRes.data.map((p: any) => p.id);
      Promise.all(ids.map((id: number) => api.get(`/hotel/planes/${id}/reglas`))).then(results => {
        const map: Record<number, any[]> = {};
        ids.forEach((id: number, i: number) => { map[id] = results[i].data; });
        setReglasMap(map);
      });
    }).finally(() => setLoading(false));
  }, [showInactive]);

  useEffect(() => { load(); }, [load]);

  const filtered = planes.filter(p => !catFilter || p.categoria === catFilter);

  const openNew = () => {
    setForm({ ...emptyForm });
    setReglas(JSON.parse(JSON.stringify(emptyReglas)));
    setEditingId(null);
    setError('');
    setTab('info');
    setShowModal(true);
  };

  const openEdit = (plan: any) => {
    setForm({
      codigo: plan.codigo, nombre: plan.nombre, descripcion: plan.descripcion || '',
      categoria: plan.categoria || 'Estadía',
      precio_adulto_noche: plan.precio_adulto_noche, precio_menor_noche: plan.precio_menor_noche || 0,
      precio_mascota_noche: plan.precio_mascota_noche || 0,
      incluye: plan.incluye || [], horario: plan.horario || '',
      extras_disponibles: plan.extras_disponibles || [],
      tipos_aplicables: plan.tipos_aplicables || [],
      imagen: plan.imagen || '', activo: plan.activo, visible_web: plan.visible_web || 0,
      lleva_impuesto: plan.lleva_impuesto !== undefined ? plan.lleva_impuesto : 0,
      impuesto_pct: plan.impuesto_pct !== undefined ? plan.impuesto_pct : 0
    });
    // Load existing rate rules
    const existingReglas = reglasMap[plan.id] || [];
    const merged = emptyReglas.map(er => {
      const found = existingReglas.find((r: any) => r.tipo_dia === er.tipo_dia);
      return found ? { tipo_dia: found.tipo_dia, precio_adulto: found.precio_adulto, precio_menor: found.precio_menor, precio_mascota: found.precio_mascota } : { ...er, precio_adulto: plan.precio_adulto_noche, precio_menor: plan.precio_menor_noche || 0, precio_mascota: plan.precio_mascota_noche || 0 };
    });
    setReglas(merged);
    setEditingId(plan.id);
    setError('');
    setTab('info');
    setShowModal(true);
  };

  const save = async () => {
    if (!form.codigo || !form.nombre) { setError('Código y nombre son requeridos'); return; }
    setSaving(true); setError('');
    try {
      const payload = {
        ...form,
        precio_adulto_noche: Number(form.precio_adulto_noche),
        precio_menor_noche: Number(form.precio_menor_noche),
        precio_mascota_noche: Number(form.precio_mascota_noche),
        lleva_impuesto: Number(form.lleva_impuesto),
        impuesto_pct: Number(form.impuesto_pct)
      };
      let planId = editingId;
      if (editingId) {
        await api.put(`/hotel/planes/${editingId}`, payload);
      } else {
        const r = await api.post('/hotel/planes', payload);
        planId = r.data.id;
      }
      // Save rate rules
      await api.put(`/hotel/planes/${planId}/reglas`, {
        reglas: reglas.map(r => ({ ...r, precio_adulto: Number(r.precio_adulto), precio_menor: Number(r.precio_menor), precio_mascota: Number(r.precio_mascota) }))
      });
      setShowModal(false);
      load();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.message || 'Error guardando');
    }
    setSaving(false);
  };

  const toggleActive = async (plan: any) => {
    if (plan.activo) { await api.delete(`/hotel/planes/${plan.id}`); }
    else { await api.put(`/hotel/planes/${plan.id}`, { activo: 1 }); }
    load();
  };

  const addIncluye = () => { if (newIncluye.trim()) { setForm(f => ({ ...f, incluye: [...f.incluye, newIncluye.trim()] })); setNewIncluye(''); } };
  const removeIncluye = (i: number) => setForm(f => ({ ...f, incluye: f.incluye.filter((_, idx) => idx !== i) }));
  const addExtra = () => { if (newExtra.trim()) { setForm(f => ({ ...f, extras_disponibles: [...f.extras_disponibles, newExtra.trim()] })); setNewExtra(''); } };
  const removeExtra = (i: number) => setForm(f => ({ ...f, extras_disponibles: f.extras_disponibles.filter((_, idx) => idx !== i) }));
  const toggleTipo = (tipo: string) => setForm(f => ({ ...f, tipos_aplicables: f.tipos_aplicables.includes(tipo) ? f.tipos_aplicables.filter(t => t !== tipo) : [...f.tipos_aplicables, tipo] }));
  const set = (field: string, value: any) => setForm(f => ({ ...f, [field]: value }));

  const uploadPhoto = async (planId: number, file: File) => {
    setPhotoUploading(true);
    try {
      const fd = new FormData();
      fd.append('foto', file);
      const resp = await api.post(`/hotel/planes/${planId}/foto`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      set('imagen', resp.data.imagen);
      load();
    } catch (e: any) { setError(e.response?.data?.error?.message || 'Error subiendo foto'); }
    setPhotoUploading(false);
  };

  const updateRegla = (index: number, field: string, value: any) => {
    setReglas(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  };

  // Auto-fill reglas when base price changes
  const syncReglasFromBase = () => {
    const base = Number(form.precio_adulto_noche);
    const baseMenor = Number(form.precio_menor_noche);
    const baseMascota = Number(form.precio_mascota_noche);
    setReglas([
      { tipo_dia: 'entre_semana', precio_adulto: base, precio_menor: baseMenor, precio_mascota: baseMascota },
      { tipo_dia: 'fin_de_semana', precio_adulto: Math.round(base * 1.25 * 100) / 100, precio_menor: Math.round(baseMenor * 1.25 * 100) / 100, precio_mascota: baseMascota },
      { tipo_dia: 'festivo', precio_adulto: Math.round(base * 1.50 * 100) / 100, precio_menor: Math.round(baseMenor * 1.50 * 100) / 100, precio_mascota: baseMascota },
    ]);
  };

  const addFestivo = async () => {
    if (!newFecha || !newNombre) return;
    try {
      await api.post('/hotel/festivos', { fecha: newFecha, nombre: newNombre });
      setNewFecha(''); setNewNombre('');
      load();
    } catch {}
  };

  const deleteFestivo = async (id: number) => {
    await api.delete(`/hotel/festivos/${id}`);
    load();
  };

  if (loading) return <div className="animate-pulse text-gray-400 p-8">Cargando productos...</div>;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Productos & Tarifas</h1>
          <p className="text-sm text-gray-400">{planes.length} productos • {festivos.length} días festivos</p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/reservar" target="_blank" rel="noopener" className="flex items-center gap-1 px-3 py-2 bg-amber-50 text-amber-700 rounded-xl hover:bg-amber-100 transition text-sm font-medium border border-amber-200">
            <ExternalLink size={14} /> Vista Cliente
          </a>
          <button onClick={() => setShowFestivos(!showFestivos)} className="flex items-center gap-1 px-3 py-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition text-sm font-medium">
            <Calendar size={14} /> Festivos ({festivos.length})
          </button>
          <label className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="rounded" />
            Inactivos
          </label>
          <button onClick={openNew} className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-mahana-500 to-mahana-600 text-white rounded-xl hover:shadow-lg transition text-sm font-medium">
            <Plus size={16} /> Nuevo Producto
          </button>
        </div>
      </div>

      {/* Festivos Panel */}
      {showFestivos && (
        <div className="bg-white rounded-xl shadow-sm p-4 mb-4 border-t-4 border-red-400">
          <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">🎊 Días Festivos</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2 mb-3">
            {festivos.map(f => (
              <div key={f.id} className="flex items-center justify-between px-3 py-2 bg-red-50 rounded-lg text-sm">
                <div><div className="font-medium text-red-700">{f.nombre}</div><div className="text-[10px] text-red-400">{f.fecha}</div></div>
                <button onClick={() => deleteFestivo(f.id)} className="text-red-300 hover:text-red-500 ml-1"><X size={14} /></button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 items-end">
            <div><label className="text-xs text-gray-400">Fecha</label><input type="date" value={newFecha} onChange={e => setNewFecha(e.target.value)} className="input" /></div>
            <div className="flex-1"><label className="text-xs text-gray-400">Nombre</label><input value={newNombre} onChange={e => setNewNombre(e.target.value)} className="input" placeholder="Ej: Semana Santa" /></div>
            <button onClick={addFestivo} className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 transition">Agregar</button>
          </div>
        </div>
      )}

      {/* Category Filter */}
      <div className="bg-white rounded-xl p-3 mb-4 flex flex-wrap gap-2 items-center shadow-sm">
        <span className="text-xs text-gray-400 font-medium">Categoría:</span>
        <button onClick={() => setCatFilter('')} className={`px-3 py-1.5 text-xs rounded-lg transition font-medium ${!catFilter ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'}`}>Todas ({planes.length})</button>
        <button onClick={() => setCatFilter('Estadía')} className={`px-3 py-1.5 text-xs rounded-lg transition font-medium ${catFilter === 'Estadía' ? 'bg-ocean-500 text-white' : 'bg-ocean-50 text-ocean-700'}`}>🏨 Estadía ({planes.filter(p => p.categoria === 'Estadía').length})</button>
        <button onClick={() => setCatFilter('Pasadía')} className={`px-3 py-1.5 text-xs rounded-lg transition font-medium ${catFilter === 'Pasadía' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700'}`}>☀️ Pasadía ({planes.filter(p => p.categoria === 'Pasadía').length})</button>
      </div>

      {/* Product Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(plan => {
          const colors = catColors[plan.categoria] || catColors['Otro'];
          const planReglas = reglasMap[plan.id] || [];
          return (
            <div key={plan.id} className={`bg-white rounded-xl shadow-sm border-t-4 ${colors.border} hover:shadow-md transition ${!plan.activo ? 'opacity-60' : ''} overflow-hidden`}>
              {/* Product Photo */}
              {plan.imagen ? (
                <div className="h-36 overflow-hidden relative">
                  <img src={plan.imagen} alt={plan.nombre} className="w-full h-full object-cover" />
                  {plan.visible_web ? <span className="absolute top-2 right-2 px-2 py-0.5 bg-emerald-500 text-white text-[10px] font-bold rounded-full flex items-center gap-1"><Eye size={10} /> Web</span> : null}
                </div>
              ) : (
                <div className={`h-12 ${colors.bg} flex items-center justify-end px-3`}>
                  {plan.visible_web ? <span className="px-2 py-0.5 bg-emerald-500 text-white text-[10px] font-bold rounded-full flex items-center gap-1"><Eye size={10} /> Web</span> : null}
                </div>
              )}
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-bold text-gray-800 text-lg">{plan.nombre}</h3>
                    <div className="flex flex-wrap gap-1 items-center mt-1">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${colors.badge}`}>
                        {plan.categoria === 'Pasadía' ? '☀️' : '🏨'} {plan.categoria}
                      </span>
                      {plan.lleva_impuesto === 0 ? (
                        <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[10px] font-bold">Exento</span>
                      ) : (
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full text-[10px] font-bold">Tasa: {plan.impuesto_pct}%</span>
                      )}
                    </div>
                    {!plan.activo && <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-600">INACTIVO</span>}
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-gray-800">${plan.precio_adulto_noche}</div>
                    <div className="text-[10px] text-gray-400">base /{plan.categoria === 'Pasadía' ? 'persona' : 'noche'}</div>
                  </div>
                </div>

                <p className="text-sm text-gray-500 mb-3">{plan.descripcion}</p>

                {/* Rate Rules Summary */}
                {planReglas.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs font-semibold text-gray-500 mb-1 flex items-center gap-1"><DollarSign size={12} /> Tarifas por Día</div>
                    <div className="grid grid-cols-3 gap-1 text-center">
                      {planReglas.map((r: any) => {
                        const info = tipoDiaLabels[r.tipo_dia] || { label: r.tipo_dia, emoji: '📅', color: 'text-gray-600 bg-gray-50' };
                        return (
                          <div key={r.tipo_dia} className={`px-2 py-1.5 rounded-lg ${info.color} text-[10px]`}>
                            <div className="font-bold">{info.emoji} {info.label}</div>
                            <div className="text-sm font-bold">${r.precio_adulto}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Incluye */}
                {plan.incluye?.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs font-semibold text-gray-500 mb-1 flex items-center gap-1"><Check size={12} /> Incluye</div>
                    <div className="flex flex-wrap gap-1">
                      {plan.incluye.map((item: string, i: number) => (
                        <span key={i} className="px-2 py-0.5 bg-green-50 text-green-700 text-[10px] rounded-full border border-green-200">{item}</span>
                      ))}
                    </div>
                  </div>
                )}

                {plan.horario && <div className="text-xs text-gray-500 mb-2 flex items-center gap-1"><Clock size={12} className="text-gray-400" /> {plan.horario}</div>}

                {plan.extras_disponibles?.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs font-semibold text-gray-500 mb-1 flex items-center gap-1"><Star size={12} /> Extras</div>
                    <div className="flex flex-wrap gap-1">
                      {plan.extras_disponibles.map((item: string, i: number) => (
                        <span key={i} className="px-2 py-0.5 bg-purple-50 text-purple-700 text-[10px] rounded-full border border-purple-200">{item}</span>
                      ))}
                    </div>
                  </div>
                )}

                {plan.tipos_aplicables?.length > 0 && (
                  <div className="mb-2">
                    <div className="text-xs font-semibold text-gray-500 mb-1 flex items-center gap-1"><Tag size={12} /> Aplica a</div>
                    <div className="flex flex-wrap gap-1">
                      {plan.tipos_aplicables.map((tipo: string, i: number) => (
                        <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-[10px] rounded-full">{tipo}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="border-t border-gray-100 px-5 py-2.5 flex items-center justify-between">
                <span className="text-[10px] text-gray-300 font-mono">{plan.codigo}</span>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(plan)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-ocean-600 transition" title="Editar">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={() => toggleActive(plan)} className={`p-1.5 rounded-lg transition ${plan.activo ? 'hover:bg-red-50 text-gray-400 hover:text-red-500' : 'hover:bg-green-50 text-gray-400 hover:text-green-500'}`}
                    title={plan.activo ? 'Desactivar' : 'Reactivar'}>
                    {plan.activo ? <Trash2 size={14} /> : <Check size={14} />}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <Package size={48} className="mx-auto mb-3 opacity-30" />
          <p>No hay productos en esta categoría</p>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-8 px-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mb-10">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-800">{editingId ? 'Editar Producto' : 'Nuevo Producto'}</h2>
              <button onClick={() => setShowModal(false)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><X size={20} /></button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-100">
              <button onClick={() => setTab('info')} className={`flex-1 py-3 text-sm font-medium transition ${tab === 'info' ? 'border-b-2 border-mahana-500 text-mahana-700' : 'text-gray-400'}`}>📦 Información</button>
              <button onClick={() => setTab('tarifas')} className={`flex-1 py-3 text-sm font-medium transition ${tab === 'tarifas' ? 'border-b-2 border-mahana-500 text-mahana-700' : 'text-gray-400'}`}>💰 Tarifas por Día</button>
            </div>

            <div className="p-6 space-y-5 max-h-[65vh] overflow-y-auto">
              {error && <div className="bg-red-50 text-red-600 px-3 py-2 rounded-lg text-sm">{error}</div>}

              {tab === 'info' && (
                <>
                  {/* Category */}
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-2">Categoría *</label>
                    <div className="flex gap-2">
                      {['Estadía', 'Pasadía', 'Otro'].map(cat => (
                        <button key={cat} type="button" onClick={() => set('categoria', cat)}
                          className={`flex-1 py-3 px-4 rounded-xl text-sm font-medium border-2 transition ${
                            form.categoria === cat
                              ? cat === 'Estadía' ? 'border-ocean-400 bg-ocean-50 text-ocean-700'
                                : cat === 'Pasadía' ? 'border-amber-400 bg-amber-50 text-amber-700'
                                : 'border-gray-400 bg-gray-50 text-gray-700'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}>
                          {cat === 'Estadía' ? '🏨' : cat === 'Pasadía' ? '☀️' : '📦'} {cat}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Basic Info */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-500 mb-1">Código *</label>
                      <input value={form.codigo} onChange={e => set('codigo', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                        disabled={!!editingId} className={`input ${editingId ? 'bg-gray-100' : ''}`} placeholder="todo_incluido" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-500 mb-1">Nombre *</label>
                      <input value={form.nombre} onChange={e => set('nombre', e.target.value)} className="input" placeholder="Todo Incluido" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">Descripción</label>
                    <textarea value={form.descripcion} onChange={e => set('descripcion', e.target.value)} className="input min-h-[60px]" placeholder="Descripción del producto..." />
                  </div>

                  {/* Photo Upload + Visible Web */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-2 flex items-center gap-1"><Camera size={14} /> Foto del producto</label>
                      {form.imagen ? (
                        <div className="relative rounded-xl overflow-hidden h-32">
                          <img src={form.imagen} alt="Product" className="w-full h-full object-cover" />
                          <button onClick={() => set('imagen', '')} className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"><X size={12} /></button>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center justify-center h-32 rounded-xl border-2 border-dashed border-gray-300 hover:border-amber-400 cursor-pointer transition bg-gray-50 hover:bg-amber-50">
                          {photoUploading ? (
                            <span className="text-sm text-gray-400">Subiendo...</span>
                          ) : (
                            <>
                              <Upload size={24} className="text-gray-300 mb-1" />
                              <span className="text-xs text-gray-400">Click para subir foto</span>
                            </>
                          )}
                          <input type="file" accept="image/*" className="hidden" disabled={!editingId || photoUploading}
                            onChange={e => { if (e.target.files?.[0] && editingId) uploadPhoto(editingId, e.target.files[0]); }} />
                        </label>
                      )}
                      {!editingId && <p className="text-[10px] text-gray-400 mt-1">Guarda primero para subir foto</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-2 flex items-center gap-1"><Eye size={14} /> Visible en Web</label>
                      <button type="button" onClick={() => set('visible_web', form.visible_web ? 0 : 1)}
                        className={`w-full py-3 px-4 rounded-xl text-sm font-medium border-2 transition flex items-center justify-center gap-2 ${
                          form.visible_web ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-400 hover:border-gray-300'
                        }`}>
                        <Eye size={16} /> {form.visible_web ? 'Visible en widget de reservas' : 'Oculto en widget de reservas'}
                      </button>
                      <p className="text-[10px] text-gray-400 mt-1">Los productos visibles aparecen en el widget público de reservas del website</p>
                    </div>
                  </div>

                  {/* Prices (base) */}
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-2">Precio Base <span className="text-gray-400 font-normal text-xs">(entre semana)</span></label>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Adulto / {form.categoria === 'Pasadía' ? 'persona' : 'noche'} *</label>
                        <input type="number" step="0.01" min="0" value={form.precio_adulto_noche} onChange={e => {
                          const v = e.target.value;
                          set('precio_adulto_noche', v);
                          setReglas(prev => prev.map(r => r.tipo_dia === 'entre_semana' ? { ...r, precio_adulto: v } : r));
                        }} className="input" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Menor</label>
                        <input type="number" step="0.01" min="0" value={form.precio_menor_noche} onChange={e => {
                          const v = e.target.value;
                          set('precio_menor_noche', v);
                          setReglas(prev => prev.map(r => r.tipo_dia === 'entre_semana' ? { ...r, precio_menor: v } : r));
                        }} className="input" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Mascota</label>
                        <input type="number" step="0.01" min="0" value={form.precio_mascota_noche} onChange={e => {
                          const v = e.target.value;
                          set('precio_mascota_noche', v);
                          setReglas(prev => prev.map(r => r.tipo_dia === 'entre_semana' ? { ...r, precio_mascota: v } : r));
                        }} className="input" />
                      </div>
                    </div>
                  </div>

                  {/* Impuestos */}
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                    <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1">🏦 Impuestos de la Tarifa</label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">¿Aplica Impuesto?</label>
                        <select value={form.lleva_impuesto} onChange={e => set('lleva_impuesto', parseInt(e.target.value))} className="input">
                          <option value={1}>Sí (Lleva impuesto)</option>
                          <option value={0}>No (Tarifa exenta)</option>
                        </select>
                      </div>
                      {form.lleva_impuesto === 1 && (
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Porcentaje de Impuesto (%)</label>
                          <input type="number" step="0.1" min="0" max="100" value={form.impuesto_pct} onChange={e => set('impuesto_pct', parseFloat(e.target.value))} className="input" />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Horario */}
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">Horario</label>
                    <input value={form.horario} onChange={e => set('horario', e.target.value)} className="input" placeholder="Check-in 3PM / Check-out 11AM" />
                  </div>

                  {/* Incluye */}
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-2">¿Qué incluye?</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {form.incluye.map((item, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-50 text-green-700 text-xs rounded-full border border-green-200">
                          {item}<button type="button" onClick={() => removeIncluye(i)} className="hover:text-red-500"><X size={12} /></button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input value={newIncluye} onChange={e => setNewIncluye(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addIncluye())} className="input flex-1" placeholder="Ej: Desayuno Buffet" />
                      <button type="button" onClick={addIncluye} className="px-3 py-2 bg-green-500 text-white rounded-lg text-xs hover:bg-green-600 transition">+</button>
                    </div>
                  </div>

                  {/* Extras */}
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-2">Extras disponibles</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {form.extras_disponibles.map((item, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-50 text-purple-700 text-xs rounded-full border border-purple-200">
                          {item}<button type="button" onClick={() => removeExtra(i)} className="hover:text-red-500"><X size={12} /></button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input value={newExtra} onChange={e => setNewExtra(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addExtra())} className="input flex-1" placeholder="Ej: Spa $25" />
                      <button type="button" onClick={addExtra} className="px-3 py-2 bg-purple-500 text-white rounded-lg text-xs hover:bg-purple-600 transition">+</button>
                    </div>
                  </div>

                  {/* Tipos Aplicables */}
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-2">Aplica a</label>
                    <div className="flex flex-wrap gap-2">
                      {allRoomTypes.map(tipo => (
                        <button key={tipo} type="button" onClick={() => toggleTipo(tipo)}
                          className={`px-3 py-1.5 text-xs rounded-lg border transition ${form.tipos_aplicables.includes(tipo) ? 'bg-ocean-500 text-white border-ocean-500' : 'bg-white text-gray-600 border-gray-200 hover:border-ocean-300'}`}>
                          {form.tipos_aplicables.includes(tipo) && '✓ '}{tipo}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {tab === 'tarifas' && (
                <>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700 mb-2">
                    💡 Define precios diferentes según el día de la semana. <strong>Entre Semana</strong> = Dom-Jue, <strong>Fin de Semana</strong> = Vie-Sáb, <strong>Festivo</strong> = días feriados configurados.
                  </div>

                  <button type="button" onClick={syncReglasFromBase} className="text-xs text-ocean-600 hover:text-ocean-700 underline mb-2">
                    ↻ Auto-calcular desde precio base (+25% fin semana, +50% festivo)
                  </button>

                  <div className="space-y-4">
                    {reglas.map((regla, idx) => {
                      const info = tipoDiaLabels[regla.tipo_dia] || { label: regla.tipo_dia, emoji: '📅', color: 'text-gray-600 bg-gray-50' };
                      return (
                        <div key={regla.tipo_dia} className={`rounded-xl p-4 border ${info.color} border-current/20`}>
                          <div className="font-semibold text-sm mb-3">{info.emoji} {info.label}
                            <span className="text-xs font-normal ml-2">
                              {regla.tipo_dia === 'entre_semana' && '(Domingo a Jueves)'}
                              {regla.tipo_dia === 'fin_de_semana' && '(Viernes y Sábado)'}
                              {regla.tipo_dia === 'festivo' && '(Días feriados configurados)'}
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">Adulto</label>
                              <input type="number" step="0.01" min="0" value={regla.precio_adulto}
                                onChange={e => updateRegla(idx, 'precio_adulto', e.target.value)}
                                className="input" />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">Menor</label>
                              <input type="number" step="0.01" min="0" value={regla.precio_menor}
                                onChange={e => updateRegla(idx, 'precio_menor', e.target.value)}
                                className="input" />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">Mascota</label>
                              <input type="number" step="0.01" min="0" value={regla.precio_mascota}
                                onChange={e => updateRegla(idx, 'precio_mascota', e.target.value)}
                                className="input" />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-5 py-2.5 text-gray-500 hover:bg-gray-100 rounded-xl transition text-sm">Cancelar</button>
              <button onClick={save} disabled={saving}
                className="px-6 py-2.5 bg-gradient-to-r from-mahana-500 to-mahana-600 text-white font-medium rounded-xl hover:shadow-lg transition disabled:opacity-50 text-sm">
                {saving ? 'Guardando...' : editingId ? 'Guardar Cambios' : 'Crear Producto'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
