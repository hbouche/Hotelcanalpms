import { useState, useEffect, Fragment } from 'react';
import { api } from '../api/client';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, MoreHorizontal } from 'lucide-react';
import { useContextMenu } from '../hooks/useContextMenu';
import ContextMenu from '../components/ContextMenu';

const estadoColor: Record<string, string> = {
  'Confirmada': 'bg-blue-100 text-blue-700',
  'Hospedado': 'bg-green-100 text-green-700',
  'Check-Out': 'bg-gray-100 text-gray-600',
  'Pendiente': 'bg-yellow-100 text-yellow-700',
  'Cancelada': 'bg-red-100 text-red-700',
  'No-Show': 'bg-red-50 text-red-500',
};

export default function Reservas() {
  const navigate = useNavigate();
  const [reservas, setReservas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState('');
  const [filtroCliente, setFiltroCliente] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [userRole, setUserRole] = useState('receptionist');

  // Sorting States
  const [sortField, setSortField] = useState<'id' | 'check_in' | 'check_out' | 'monto_total' | 'cliente'>('check_in');
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  // Grouping States
  const [groupBy, setGroupBy] = useState<'none' | 'mes' | 'estado' | 'categoria'>('none');

  const getMesAnio = (dateStr: string) => {
    if (!dateStr) return 'Sin fecha';
    const parts = dateStr.split('-');
    if (parts.length < 2) return 'Sin fecha';
    const meses = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    const mesIndex = parseInt(parts[1]) - 1;
    if (mesIndex < 0 || mesIndex > 11) return 'Sin fecha';
    return `${meses[mesIndex]} ${parts[0]}`;
  };

  const toggleSort = (field: 'id' | 'check_in' | 'check_out' | 'monto_total' | 'cliente') => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(field === 'check_in' || field === 'check_out' ? true : false);
    }
  };

  const renderSortIndicator = (field: string) => {
    if (sortField !== field) return null;
    return sortAsc ? ' ▲' : ' ▼';
  };

  // Quick Payment Modal States
  const [quickPayReservaId, setQuickPayReservaId] = useState<number | null>(null);
  const [quickPayForm, setQuickPayForm] = useState({ monto: '', concepto: '', metodo_pago: 'efectivo', referencia: '' });
  const [quickPayLoading, setQuickPayLoading] = useState(false);

  // Initialize context menu
  const { contextMenu, handleContextMenu, closeMenu } = useContextMenu();

  const [pendingCount, setPendingCount] = useState(0);

  // Retrieve user role on mount
  useEffect(() => {
    api.get('/auth/me')
      .then(r => {
        if (r.data && r.data.rol) {
          setUserRole(r.data.rol);
          if (r.data.rol === 'cleaning') {
            navigate('/');
          }
        }
      })
      .catch(() => {});
  }, [navigate]);

  // Fetch pending count
  useEffect(() => {
    if (userRole !== 'cleaning') {
      api.get('/hotel/reservas?estado=Pendiente')
        .then(r => {
          if (Array.isArray(r.data)) {
            setPendingCount(r.data.length);
          }
        })
        .catch(() => {});
    }
  }, [userRole]);

  const load = () => {
    setLoading(true);
    let q = '/hotel/reservas?limit=100';
    const apiEstado = (filtroEstado === 'Rechazada' || filtroEstado === 'Cancelada') ? 'Cancelada' : filtroEstado;
    if (apiEstado) q += `&estado=${apiEstado}`;
    if (filtroCliente) q += `&cliente=${filtroCliente}`;
    api.get(q).then(r => {
      let data = Array.isArray(r.data) ? r.data : [];
      if (filtroEstado === 'Rechazada') {
        data = data.filter((res: any) => res.fuente && res.fuente.toLowerCase().includes('web'));
      } else if (filtroEstado === 'Cancelada') {
        data = data.filter((res: any) => !res.fuente || !res.fuente.toLowerCase().includes('web'));
      }
      setReservas(data);
    }).catch(e => console.error(e)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [filtroEstado]);

  const handleContextMenuAction = async (actionType: string, payload: any) => {
    closeMenu();
    if (actionType === 'view_details') {
      navigate(`/reservas/${payload.reserva.id}`);
    } else if (actionType === 'check_in') {
      try {
        await api.patch(`/hotel/reservas/${payload.reserva.id}/status`, { estado: 'Hospedado' });
        load();
      } catch (err: any) {
        alert(err?.response?.data?.error?.message || 'Error al hacer Check-In');
      }
    } else if (actionType === 'check_out') {
      try {
        await api.patch(`/hotel/reservas/${payload.reserva.id}/status`, { estado: 'Check-Out' });
        load();
      } catch (err: any) {
        alert(err?.response?.data?.error?.message || 'Error al hacer Check-Out');
      }
    } else if (actionType === 'register_payment') {
      setQuickPayReservaId(payload.reserva.id);
      setQuickPayForm({
        monto: payload.reserva.saldo_pendiente ? String(payload.reserva.saldo_pendiente) : '',
        concepto: 'Abono rápido desde listado',
        metodo_pago: 'efectivo',
        referencia: '',
      });
    } else if (actionType === 'cancel_reserva') {
      if (confirm(`¿Estás seguro de que deseas cancelar la reserva de ${payload.reserva.cliente}?`)) {
        try {
          await api.patch(`/hotel/reservas/${payload.reserva.id}/status`, { estado: 'Cancelada' });
          load();
        } catch (err: any) {
          alert(err?.response?.data?.error?.message || 'Error al cancelar la reserva');
        }
      }
    }
  };

  const submitQuickPay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickPayReservaId || !quickPayForm.monto || parseFloat(quickPayForm.monto) <= 0) return;
    setQuickPayLoading(true);
    try {
      await api.post(`/hotel/reservas/${quickPayReservaId}/folio`, {
        ...quickPayForm,
        monto: parseFloat(quickPayForm.monto),
        tipo: 'credito',
      });
      setQuickPayReservaId(null);
      load();
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || 'Error al registrar pago');
    } finally {
      setQuickPayLoading(false);
    }
  };

  // Filter by category client-side (reserva has habitacion info)
  const filteredReservas = filtroCategoria
    ? reservas.filter(r => r.categoria_habitacion === filtroCategoria)
    : reservas;

  const sortedReservas = [...filteredReservas].sort((a: any, b: any) => {
    let aVal = a[sortField];
    let bVal = b[sortField];
    
    if (sortField === 'cliente') {
      aVal = `${a.cliente || ''} ${a.apellido || ''}`.trim().toLowerCase();
      bVal = `${b.cliente || ''} ${b.apellido || ''}`.trim().toLowerCase();
    } else if (typeof aVal === 'string') {
      aVal = aVal.toLowerCase();
      bVal = bVal.toLowerCase();
    }
    
    if (aVal < bVal) return sortAsc ? -1 : 1;
    if (aVal > bVal) return sortAsc ? 1 : -1;
    return 0;
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Reservas</h1>
        <Link to="/reservas/nueva" className="flex items-center gap-2 bg-mahana-500 text-white px-5 py-2.5 rounded-xl hover:bg-mahana-600 transition font-medium">
          <Plus size={18} /> Nueva Reserva
        </Link>
      </div>

      {pendingCount > 0 && (
        <div className="bg-amber-50 border border-amber-200/60 rounded-2xl p-4 mb-4 flex items-center justify-between shadow-sm animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-xl text-amber-600 animate-pulse">
              ⚠️
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-800">Tienes {pendingCount} reserva{pendingCount !== 1 ? 's' : ''} pendiente{pendingCount !== 1 ? 's' : ''} de aprobación</p>
              <p className="text-xs text-amber-600 font-medium">Estas reservas aún no aparecen confirmadas en el inventario y deben ser gestionadas.</p>
            </div>
          </div>
          <Link to="/aprobaciones" className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-semibold shadow-sm hover:shadow-md transition">
            Gestionar Aprobaciones
          </Link>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 mb-4 flex flex-wrap gap-3 items-center shadow-sm">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-3 text-gray-400" />
          <input type="text" placeholder="Buscar cliente..." value={filtroCliente} onChange={e => setFiltroCliente(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load()}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-mahana-400 outline-none text-sm" />
        </div>
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
          className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-mahana-400 outline-none">
          <option value="">Todos los estados</option>
          <option value="Pendiente">Pendiente</option>
          <option value="Confirmada">Confirmada</option>
          <option value="Hospedado">Hospedado</option>
          <option value="Check-Out">Check-Out</option>
          <option value="Rechazada">Rechazada</option>
          <option value="Cancelada">Cancelada</option>
          <option value="No-Show">No-Show</option>
        </select>
        {/* Category Filter */}
        <div className="flex items-center gap-1">
          <button onClick={() => setFiltroCategoria('')} className={`px-3 py-2 text-xs rounded-lg font-medium transition ${!filtroCategoria ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>Todas</button>
          <button onClick={() => setFiltroCategoria('Estadía')} className={`px-3 py-2 text-xs rounded-lg font-medium transition ${filtroCategoria === 'Estadía' ? 'bg-ocean-500 text-white' : 'bg-ocean-50 text-ocean-700 hover:bg-ocean-100'}`}>🏨 Estadía</button>
          <button onClick={() => setFiltroCategoria('Pasadía')} className={`px-3 py-2 text-xs rounded-lg font-medium transition ${filtroCategoria === 'Pasadía' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>☀️ Pasadía</button>
        </div>
        {/* Grouping Selector */}
        <div className="flex items-center gap-1 border-l border-gray-200 pl-3">
          <span className="text-xs font-semibold text-gray-400 mr-1">Agrupar:</span>
          <button onClick={() => setGroupBy('none')} className={`px-2.5 py-2 text-xs rounded-lg font-medium transition ${groupBy === 'none' ? 'bg-gray-800 text-white' : 'bg-gray-105 text-gray-600 hover:bg-gray-200'}`}>Ninguno</button>
          <button onClick={() => setGroupBy('mes')} className={`px-2.5 py-2 text-xs rounded-lg font-medium transition ${groupBy === 'mes' ? 'bg-ocean-600 text-white' : 'bg-ocean-50 text-ocean-700 hover:bg-ocean-100'}`}>📅 Mes</button>
          <button onClick={() => setGroupBy('estado')} className={`px-2.5 py-2 text-xs rounded-lg font-medium transition ${groupBy === 'estado' ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}>🏷️ Estado</button>
          <button onClick={() => setGroupBy('categoria')} className={`px-2.5 py-2 text-xs rounded-lg font-medium transition ${groupBy === 'categoria' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>🏨 Cat</button>
        </div>
        <button onClick={load} className="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 text-sm font-medium">Buscar</button>
      </div>

      {/* Table */}
      {loading ? <div className="animate-pulse text-gray-400 p-8">Cargando...</div> : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          {sortedReservas.length === 0 ? (
            <div className="p-12 text-center text-gray-400">No hay reservas</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                  <tr>
                    <th className="px-4 py-3 text-left cursor-pointer hover:bg-gray-100 select-none transition" onClick={() => toggleSort('id')}>ID{renderSortIndicator('id')}</th>
                    <th className="px-4 py-3 text-left cursor-pointer hover:bg-gray-100 select-none transition" onClick={() => toggleSort('cliente')}>Cliente{renderSortIndicator('cliente')}</th>
                    <th className="px-4 py-3 text-center">Categoría</th>
                    <th className="px-4 py-3 text-left">Habitación</th>
                    <th className="px-4 py-3 text-left cursor-pointer hover:bg-gray-100 select-none transition" onClick={() => toggleSort('check_in')}>Check-in{renderSortIndicator('check_in')}</th>
                    <th className="px-4 py-3 text-left cursor-pointer hover:bg-gray-100 select-none transition" onClick={() => toggleSort('check_out')}>Check-out{renderSortIndicator('check_out')}</th>
                    <th className="px-4 py-3 text-center">Noches</th>
                    <th className="px-4 py-3 text-left">Plan</th>
                    <th className="px-4 py-3 text-right cursor-pointer hover:bg-gray-100 select-none transition" onClick={() => toggleSort('monto_total')}>Total{renderSortIndicator('monto_total')}</th>
                    <th className="px-4 py-3 text-right">Saldo</th>
                    <th className="px-4 py-3 text-center">Estado</th>
                    <th className="px-4 py-3 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(() => {
                    if (groupBy === 'none') {
                      return sortedReservas.map((r: any) => (
                        <tr
                          key={r.id}
                          className="hover:bg-gray-50 cursor-pointer"
                          onContextMenu={(e) => {
                            handleContextMenu(e, { type: 'reserva', reserva: r });
                          }}
                        >
                          <td className="px-4 py-3 text-gray-400 text-xs">{r.id}</td>
                          <td className="px-4 py-3 font-medium">
                            <Link to={`/reservas/${r.id}`} className="text-ocean-600 hover:underline">
                              {r.cliente} {r.plan_nombre ? <span className="text-xs text-gray-400 ml-1">{r.plan_nombre}</span> : ''}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${r.categoria_habitacion === 'Pasadía' ? 'bg-amber-100 text-amber-700' : 'bg-ocean-100 text-ocean-700'}`}>
                              {r.categoria_habitacion === 'Pasadía' ? '☀️' : '🏨'} {r.categoria_habitacion || 'Estadía'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-500">{r.habitacion_nombre || r.tipo_habitacion || '-'}</td>
                          <td className="px-4 py-3 text-gray-500">{r.check_in}</td>
                          <td className="px-4 py-3 text-gray-500">{r.check_out}</td>
                          <td className="px-4 py-3 text-center text-gray-500">{r.noches}</td>
                          <td className="px-4 py-3 text-gray-500">{r.plan_nombre || '-'}</td>
                          <td className="px-4 py-3 text-right font-medium">${r.monto_total?.toFixed(2)}</td>
                          <td className={`px-4 py-3 text-right font-medium ${r.saldo_pendiente > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            ${r.saldo_pendiente?.toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${estadoColor[r.estado] || 'bg-gray-100'}`}>
                              {r.estado === 'Cancelada' && r.fuente && r.fuente.toLowerCase().includes('web') ? 'Rechazada' : r.estado}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={(e) => {
                                handleContextMenu(e, { type: 'reserva', reserva: r });
                              }}
                              className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
                              title="Opciones"
                            >
                              <MoreHorizontal size={18} />
                            </button>
                          </td>
                        </tr>
                      ));
                    }

                    // Otherwise group them
                    const groups: Record<string, any[]> = {};
                    sortedReservas.forEach((r: any) => {
                      let key = '';
                      if (groupBy === 'mes') {
                        key = getMesAnio(r.check_in);
                      } else if (groupBy === 'estado') {
                        key = r.estado === 'Cancelada' && r.fuente && r.fuente.toLowerCase().includes('web') ? 'Rechazada' : r.estado;
                      } else if (groupBy === 'categoria') {
                        key = r.categoria_habitacion || 'Estadía';
                      }
                      if (!groups[key]) groups[key] = [];
                      groups[key].push(r);
                    });

                    // Order groups chronologically if mes is selected
                    const groupEntries = Object.entries(groups);
                    if (groupBy === 'mes') {
                      groupEntries.sort((a, b) => {
                        const dateA = a[1][0]?.check_in || '';
                        const dateB = b[1][0]?.check_in || '';
                        return sortAsc ? dateA.localeCompare(dateB) : dateB.localeCompare(dateA);
                      });
                    }

                    return groupEntries.map(([groupName, items]) => (
                      <Fragment key={groupName}>
                        <tr className="bg-gray-50/70 select-none">
                          <td colSpan={12} className="px-4 py-2 text-left uppercase tracking-wider font-semibold text-ocean-700 bg-ocean-50/20 text-[10px] border-y border-gray-100">
                            {groupName} ({items.length})
                          </td>
                        </tr>
                        {items.map((r: any) => (
                          <tr
                            key={r.id}
                            className="hover:bg-gray-50 cursor-pointer"
                            onContextMenu={(e) => {
                              handleContextMenu(e, { type: 'reserva', reserva: r });
                            }}
                          >
                            <td className="px-4 py-3 text-gray-400 text-xs">{r.id}</td>
                            <td className="px-4 py-3 font-medium">
                              <Link to={`/reservas/${r.id}`} className="text-ocean-600 hover:underline">
                                {r.cliente} {r.plan_nombre ? <span className="text-xs text-gray-400 ml-1">{r.plan_nombre}</span> : ''}
                              </Link>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${r.categoria_habitacion === 'Pasadía' ? 'bg-amber-100 text-amber-700' : 'bg-ocean-100 text-ocean-700'}`}>
                                {r.categoria_habitacion === 'Pasadía' ? '☀️' : '🏨'} {r.categoria_habitacion || 'Estadía'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-500">{r.habitacion_nombre || r.tipo_habitacion || '-'}</td>
                            <td className="px-4 py-3 text-gray-500">{r.check_in}</td>
                            <td className="px-4 py-3 text-gray-500">{r.check_out}</td>
                            <td className="px-4 py-3 text-center text-gray-500">{r.noches}</td>
                            <td className="px-4 py-3 text-gray-500">{r.plan_nombre || '-'}</td>
                            <td className="px-4 py-3 text-right font-medium">${r.monto_total?.toFixed(2)}</td>
                            <td className={`px-4 py-3 text-right font-medium ${r.saldo_pendiente > 0 ? 'text-red-600' : 'text-green-600'}`}>
                              ${r.saldo_pendiente?.toFixed(2)}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${estadoColor[r.estado] || 'bg-gray-100'}`}>
                                {r.estado === 'Cancelada' && r.fuente && r.fuente.toLowerCase().includes('web') ? 'Rechazada' : r.estado}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                              <button
                                onClick={(e) => {
                                  handleContextMenu(e, { type: 'reserva', reserva: r });
                                }}
                                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
                                title="Opciones"
                              >
                                <MoreHorizontal size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Context Menu */}
      {contextMenu.visible && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          data={contextMenu.data}
          onAction={handleContextMenuAction}
          onClose={closeMenu}
          userRole={userRole}
        />
      )}

      {/* Quick Payment Modal */}
      {quickPayReservaId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setQuickPayReservaId(null)}>
          <form onSubmit={submitQuickPay} className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-800">Registrar Pago Rápido</h2>
              <button type="button" onClick={() => setQuickPayReservaId(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Monto *</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-gray-400 font-bold">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={quickPayForm.monto}
                    onChange={e => setQuickPayForm(f => ({ ...f, monto: e.target.value }))}
                    required
                    className="w-full pl-7 pr-3 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 outline-none font-medium"
                    placeholder="0.00"
                    autoFocus
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Concepto</label>
                <input
                  type="text"
                  value={quickPayForm.concepto}
                  onChange={e => setQuickPayForm(f => ({ ...f, concepto: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 outline-none text-sm"
                  placeholder="Ej: Abono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Método de Pago</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'efectivo', label: '💵 Efectivo' },
                    { id: 'transferencia', label: '🏦 Transfer' },
                    { id: 'yappy', label: '📱 Yappy' },
                    { id: 'tarjeta', label: '💳 Tarjeta' },
                  ].map(method => (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => setQuickPayForm(f => ({ ...f, metodo_pago: method.id }))}
                      className={`py-2 rounded-xl text-xs font-semibold border transition ${
                        quickPayForm.metodo_pago === method.id
                          ? 'border-green-500 bg-green-50 text-green-700 font-bold ring-2 ring-green-100'
                          : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                      }`}
                    >
                      {method.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Referencia</label>
                <input
                  type="text"
                  value={quickPayForm.referencia}
                  onChange={e => setQuickPayForm(f => ({ ...f, referencia: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 outline-none text-sm"
                  placeholder="Número de control o comprobante"
                />
              </div>
            </div>

            <div className="flex gap-2.5 mt-6">
              <button
                type="submit"
                disabled={quickPayLoading}
                className="flex-1 py-2.5 bg-green-500 text-white rounded-xl font-bold text-sm hover:bg-green-600 transition shadow-lg shadow-green-100 flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {quickPayLoading ? 'Procesando...' : 'Aplicar Abono'}
              </button>
              <button
                type="button"
                onClick={() => setQuickPayReservaId(null)}
                className="px-4 py-2.5 text-gray-500 hover:bg-gray-100 rounded-xl text-sm font-semibold transition"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
