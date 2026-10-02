import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Plus, Edit2, Trash2, X, Save, BedDouble, Users, Camera, Upload, ExternalLink } from 'lucide-react';

const emptyRoom = {
  nombre: '', tipo: '', capacidad_min: 1, capacidad_max: 2,
  descripcion_camas: '', piso: '',
};

export default function AdminHabitaciones() {
  const [rooms, setRooms] = useState<any[]>([]);
  const [tipos, setTipos] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...emptyRoom });
  const [customTipo, setCustomTipo] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [tipoFotos, setTipoFotos] = useState<Record<string, string>>({});
  const [uploadingTipo, setUploadingTipo] = useState('');

  const isAdmin = JSON.parse(localStorage.getItem('pms_user') || '{}')?.rol === 'admin';

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/habitaciones/todas'),
      api.get('/habitaciones/tipos'),
    ]).then(([r, t]) => {
      setRooms(r.data);
      setTipos(t.data);
    }).finally(() => setLoading(false));
    // Load room type photos
    api.get('/habitaciones/tipo-fotos').then(r => setTipoFotos(r.data)).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const set = (field: string, value: any) => setForm(f => ({ ...f, [field]: value }));

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyRoom });
    setCustomTipo('');
    setError('');
    setShowForm(true);
  };

  const openEdit = (room: any) => {
    setEditing(room);
    setForm({
      nombre: room.nombre,
      tipo: room.tipo,
      capacidad_min: room.capacidad_min || 1,
      capacidad_max: room.capacidad_max || room.capacidad || 2,
      descripcion_camas: room.descripcion_camas || '',
      piso: room.piso || '',
    });
    setCustomTipo('');
    setError('');
    setShowForm(true);
  };

  const handleSave = async () => {
    setError('');
    const tipo = customTipo || form.tipo;
    if (!form.nombre || !tipo) { setError('Nombre y tipo son requeridos'); return; }
    if (form.capacidad_min > form.capacidad_max) { setError('Mínimo no puede ser mayor que máximo'); return; }

    try {
      const payload = { ...form, tipo };
      if (editing) {
        await api.put(`/habitaciones/${editing.id}`, payload);
        setSuccess(`${form.nombre} actualizada ✓`);
      } else {
        await api.post('/habitaciones', payload);
        setSuccess(`${form.nombre} creada ✓`);
      }
      setShowForm(false);
      load();
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: any) {
      const detailedMessage = e?.response?.data?.error?.message || e?.response?.data?.message || e.message || 'Error guardando habitación';
      setError(detailedMessage);
      alert(detailedMessage);
    }
  };

  const handleDelete = async (room: any) => {
    if (!confirm(`¿Eliminar ${room.nombre}? Se desactivará y no aparecerá en futuras reservas.`)) return;
    try {
      await api.delete(`/habitaciones/${room.id}`);
      setSuccess(`${room.nombre} eliminada ✓`);
      load();
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: any) {
      const detailedMessage = e?.response?.data?.error?.message || e?.response?.data?.message || e.message || 'Error eliminando habitación';
      setError(detailedMessage);
      alert(detailedMessage);
      setTimeout(() => setError(''), 5000);
    }
  };

  const handleReactivate = async (room: any) => {
    try {
      await api.put(`/habitaciones/${room.id}`, { activa: 1 });
      setSuccess(`${room.nombre} reactivada ✓`);
      load();
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: any) {
      const detailedMessage = e?.response?.data?.error?.message || e?.response?.data?.message || e.message || 'Error reactivando habitación';
      setError(detailedMessage);
      alert(detailedMessage);
      setTimeout(() => setError(''), 5000);
    }
  };

  const grouped = Object.entries(
    rooms.reduce((acc: Record<string, any[]>, r) => {
      (acc[r.tipo] = acc[r.tipo] || []).push(r);
      return acc;
    }, {})
  ).sort(([a], [b]) => a.localeCompare(b));

  if (loading) return <div className="animate-pulse text-gray-400 p-8">Cargando...</div>;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Administrar Habitaciones</h1>
          <p className="text-sm text-gray-400 mt-0.5">{rooms.filter(r => r.activa).length} activas • {rooms.filter(r => !r.activa).length} inactivas</p>
        </div>
        {isAdmin && (
          <button onClick={openCreate}
            className="flex items-center gap-2 bg-mahana-500 text-white px-5 py-2.5 rounded-xl hover:bg-mahana-600 transition font-medium">
            <Plus size={18} /> Nueva Habitación
          </button>
        )}
      </div>

      {success && <div className="bg-green-50 text-green-700 px-4 py-3 rounded-xl text-sm mb-4">{success}</div>}
      {error && !showForm && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm mb-4">{error}</div>}

      {/* Room Groups */}
      {grouped.map(([tipo, typeRooms]) => (
        <div key={tipo} className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            {/* Room type photo */}
            <div className="relative group">
              {tipoFotos[tipo] ? (
                <div className="w-16 h-16 rounded-xl overflow-hidden">
                  <img src={tipoFotos[tipo]} alt={tipo} className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-16 h-16 rounded-xl bg-gray-100 flex items-center justify-center">
                  <Camera size={20} className="text-gray-300" />
                </div>
              )}
              {isAdmin && (
                <label className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-xl opacity-0 group-hover:opacity-100 cursor-pointer transition">
                  <Upload size={16} className="text-white" />
                  <input type="file" accept="image/*" className="hidden" disabled={uploadingTipo === tipo}
                    onChange={async (e) => {
                      if (!e.target.files?.[0]) return;
                      setUploadingTipo(tipo);
                      try {
                        const fd = new FormData();
                        fd.append('foto', e.target.files[0]);
                        const resp = await api.post(`/habitaciones/tipo/${tipo}/foto`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
                        setTipoFotos(prev => ({ ...prev, [tipo]: resp.data.imagen }));
                        setSuccess(`Foto de ${tipo} actualizada ✓`);
                        setTimeout(() => setSuccess(''), 3000);
                      } catch (e: any) {
                        const detailedMessage = e?.response?.data?.error?.message || e?.response?.data?.message || e.message || 'Error subiendo foto';
                        setError(detailedMessage);
                        alert(detailedMessage);
                        setTimeout(() => setError(''), 5000);
                      }
                      setUploadingTipo('');
                    }} />
                </label>
              )}
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">{tipo}</h2>
              <span className="text-xs text-gray-300">{typeRooms.length} habitacion{typeRooms.length > 1 ? 'es' : ''}</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {typeRooms.map((room: any) => (
              <div key={room.id} className={`bg-white rounded-xl p-4 shadow-sm border transition ${!room.activa ? 'opacity-50 border-red-200' : 'border-transparent hover:border-gray-200'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-gray-800">{room.nombre}</span>
                  {isAdmin && (
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(room)} className="p-1.5 text-gray-300 hover:text-ocean-500 rounded transition" title="Editar">
                        <Edit2 size={14} />
                      </button>
                      {room.activa ? (
                        <button onClick={() => handleDelete(room)} className="p-1.5 text-gray-300 hover:text-red-500 rounded transition" title="Eliminar">
                          <Trash2 size={14} />
                        </button>
                      ) : (
                        <button onClick={() => handleReactivate(room)} className="text-xs text-green-500 hover:text-green-700 px-2" title="Reactivar">
                          Reactivar
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="space-y-1 text-xs text-gray-500">
                  <div className="flex items-center gap-1.5">
                    <Users size={12} />
                    <span>{room.capacidad_min || 1} - {room.capacidad_max || room.capacidad} personas</span>
                  </div>
                  {room.descripcion_camas && (
                    <div className="flex items-center gap-1.5">
                      <BedDouble size={12} />
                      <span>{room.descripcion_camas}</span>
                    </div>
                  )}
                  {room.piso && <div className="text-gray-400">Piso: {room.piso}</div>}
                  {!room.activa && <div className="text-red-400 font-medium">⚠ Inactiva</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {rooms.length === 0 && (
        <div className="bg-white rounded-xl p-12 text-center text-gray-400">
          No hay habitaciones. Crea tu primera habitación para comenzar.
        </div>
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-800">{editing ? `Editar ${editing.nombre}` : 'Nueva Habitación'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            {error && <div className="bg-red-50 text-red-600 px-3 py-2 rounded-lg text-sm mb-4">{error}</div>}

            <div className="space-y-4">
              {/* Nombre */}
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Nombre de la habitación *</label>
                <input value={form.nombre} onChange={e => set('nombre', e.target.value)}
                  className="input" placeholder="Ej: FAM(5), CAMP(1), Suite A" />
              </div>

              {/* Tipo */}
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Tipo / Categoría *</label>
                <div className="flex gap-2">
                  <select value={customTipo ? '__custom__' : form.tipo}
                    onChange={e => {
                      if (e.target.value === '__custom__') { setCustomTipo(''); set('tipo', ''); }
                      else { setCustomTipo(''); set('tipo', e.target.value); }
                    }}
                    className="input flex-1">
                    <option value="">Seleccionar tipo</option>
                    {tipos.map(t => <option key={t} value={t}>{t}</option>)}
                    <option value="__custom__">+ Nuevo tipo...</option>
                  </select>
                  {(customTipo !== '' || form.tipo === '' && !tipos.length) && (
                    <input value={customTipo} onChange={e => setCustomTipo(e.target.value)}
                      className="input flex-1" placeholder="Ej: Camping, Suite, Cabaña" autoFocus />
                  )}
                </div>
              </div>

              {/* Capacidad */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Mínimo personas</label>
                  <input type="number" min={1} value={form.capacidad_min}
                    onChange={e => set('capacidad_min', parseInt(e.target.value) || 1)} className="input" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Máximo personas</label>
                  <input type="number" min={1} value={form.capacidad_max}
                    onChange={e => set('capacidad_max', parseInt(e.target.value) || 1)} className="input" />
                </div>
              </div>

              {/* Camas */}
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Descripción de camas</label>
                <input value={form.descripcion_camas} onChange={e => set('descripcion_camas', e.target.value)}
                  className="input" placeholder="Ej: 1 King + 1 Litera, 2 Hamacas, etc." />
              </div>

              {/* Piso */}
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Piso / Ubicación</label>
                <input value={form.piso} onChange={e => set('piso', e.target.value)}
                  className="input" placeholder="Ej: Planta baja, Segundo piso" />
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button onClick={handleSave}
                className="flex-1 py-2.5 bg-mahana-500 text-white rounded-xl font-medium hover:bg-mahana-600 transition flex items-center justify-center gap-2">
                <Save size={16} /> {editing ? 'Guardar Cambios' : 'Crear Habitación'}
              </button>
              <button onClick={() => setShowForm(false)}
                className="px-4 py-2.5 text-gray-500 hover:bg-gray-100 rounded-xl transition">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
