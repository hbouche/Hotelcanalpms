import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Link } from 'react-router-dom';
import { DollarSign, Search, Filter, Plus, X, MessageCircle, Calendar } from 'lucide-react';

export default function Saldos() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterEstado, setFilterEstado] = useState('todos');
  const [sortBy, setSortBy] = useState<'saldo' | 'fecha' | 'cliente'>('saldo');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');

  // New states for CxC Cuponeras & Terceros (Fase 4)
  const [activeTab, setActiveTab] = useState<'clientes' | 'terceros'>('clientes');
  const [tercerosData, setTercerosData] = useState<any[]>([]);
  const [tercerosLoading, setTercerosLoading] = useState(false);
  const [selectedTerceros, setSelectedTerceros] = useState<number[]>([]);
  const [reconciling, setReconciling] = useState(false);
  const [comision, setComision] = useState('0');

  const isAdmin = JSON.parse(localStorage.getItem('pms_user') || '{}')?.rol === 'admin';

  // Quick payment modal state
  const [pagoModal, setPagoModal] = useState<any>(null); // reservation object or null
  const [pagoForm, setPagoForm] = useState({ monto: '', concepto: 'Abono', metodo_pago: 'efectivo', referencia: '' });
  const [pagoLoading, setPagoLoading] = useState(false);

  const loadData = () => {
    setLoading(true);
    api.get('/hotel/saldos').then(r => setData(r.data)).finally(() => setLoading(false));
  };

  const loadTerceros = () => {
    setTercerosLoading(true);
    api.get('/hotel/saldos/terceros')
      .then(r => {
        setTercerosData(r.data);
        setSelectedTerceros([]);
      })
      .catch(e => console.error('Error loading terceros:', e))
      .finally(() => setTercerosLoading(false));
  };

  useEffect(() => {
    loadData();
    loadTerceros();
  }, []);

  const openPagoModal = (reserva: any) => {
    setPagoModal(reserva);
    setPagoForm({ monto: reserva.saldo_pendiente?.toFixed(2) || '', concepto: 'Abono', metodo_pago: 'efectivo', referencia: '' });
  };

  const submitPago = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pagoForm.monto || parseFloat(pagoForm.monto) <= 0) return;
    setPagoLoading(true);
    try {
      await api.post(`/hotel/reservas/${pagoModal.id}/folio`, {
        ...pagoForm,
        monto: parseFloat(pagoForm.monto),
        tipo: 'credito'
      });
      setPagoModal(null);
      loadData();
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || 'Error registrando pago');
    } finally { setPagoLoading(false); }
  };

  const handleReconciliar = async () => {
    if (selectedTerceros.length === 0) return;
    if (!confirm(`¿Está seguro de reconciliar contablemente ${selectedTerceros.length} cobro(s)?`)) return;
    setReconciling(true);
    try {
      const comisionPct = parseFloat(comision) || 0;
      const selectedItems = tercerosData.filter((x: any) => selectedTerceros.includes(x.id));
      const totalOriginalSelected = selectedItems.reduce((s, x) => s + (x.monto || 0), 0);
      const totalDescuentoSelected = totalOriginalSelected * (1 - comisionPct / 100);

      await api.post('/hotel/saldos/reconciliar', {
        ids: selectedTerceros,
        comision: comisionPct,
        monto_descuento: totalDescuentoSelected
      });
      alert('Movimientos reconciliados con éxito');
      loadTerceros();
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || 'Error reconciliando movimientos');
    } finally {
      setReconciling(false);
    }
  };

  const buildWhatsAppLink = (r: any) => {
    if (!r.whatsapp) return null;
    const phone = r.whatsapp.replace(/[^0-9]/g, '');
    if (!phone) return null;
    const msg = encodeURIComponent(
      `Hola ${r.cliente} 👋\n\nLe recordamos que tiene un saldo pendiente de $${r.saldo_pendiente?.toFixed(2)} en Hotel Panamá Canal.\n\n` +
      `Reserva: ${r.check_in} → ${r.check_out}\nHabitación: ${r.habitacion_nombre || '-'}\nTotal: $${r.monto_total?.toFixed(2)}\nPagado: $${r.monto_pagado?.toFixed(2)}\nSaldo: $${r.saldo_pendiente?.toFixed(2)}\n\n` +
      `¿Cómo desea realizar su pago? Aceptamos efectivo, transferencia, Yappy y tarjeta. ¡Gracias! 🙏`
    );
    return `https://wa.me/${phone}?text=${msg}`;
  };

  if (loading) return <div className="animate-pulse text-gray-400 p-8">Cargando...</div>;

  // Filter & sort
  let filtered = data.filter((r: any) => {
    if (search) {
      const q = search.toLowerCase();
      if (!r.cliente?.toLowerCase().includes(q) && !r.apellido?.toLowerCase().includes(q) && !r.habitacion_nombre?.toLowerCase().includes(q)) return false;
    }
    if (filterEstado !== 'todos' && r.estado !== filterEstado) return false;
    if (fechaDesde && r.check_in < fechaDesde) return false;
    if (fechaHasta && r.check_in > fechaHasta) return false;
    return true;
  });

  if (sortBy === 'saldo') filtered.sort((a: any, b: any) => (b.saldo_pendiente || 0) - (a.saldo_pendiente || 0));
  else if (sortBy === 'fecha') filtered.sort((a: any, b: any) => a.check_in?.localeCompare(b.check_in));
  else if (sortBy === 'cliente') filtered.sort((a: any, b: any) => a.cliente?.localeCompare(b.cliente));

  const filteredTerceros = tercerosData.filter((f: any) => 
    !search || f.cliente?.toLowerCase().includes(search.toLowerCase()) || f.referencia?.toLowerCase().includes(search.toLowerCase())
  );

  const totalSaldo = filtered.reduce((s: number, r: any) => s + (r.saldo_pendiente || 0), 0);
  const totalMonto = filtered.reduce((s: number, r: any) => s + (r.monto_total || 0), 0);
  const totalPagado = filtered.reduce((s: number, r: any) => s + (r.monto_pagado || 0), 0);
  const estadosUnicos = [...new Set(data.map((r: any) => r.estado))].sort();

  const totalOfertaSimple = filteredTerceros.filter(f => f.metodo_pago === 'cuponera_oferta_simple').reduce((s, f) => s + (f.monto || 0), 0);
  const totalPaHoy = filteredTerceros.filter(f => f.metodo_pago === 'cuponera_pahoy').reduce((s, f) => s + (f.monto || 0), 0);
  const totalAlCobro = filteredTerceros.filter(f => f.metodo_pago === 'al_cobro').reduce((s, f) => s + (f.monto || 0), 0);
  const totalTercerosSum = filteredTerceros.reduce((s, f) => s + (f.monto || 0), 0);

  const comisionPct = parseFloat(comision) || 0;
  const totalTercerosDescuento = filteredTerceros.reduce((s, f) => s + (f.monto || 0) * (1 - comisionPct / 100), 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Cuentas por Cobrar</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {activeTab === 'clientes' 
              ? `${filtered.length} reservas con saldo pendiente` 
              : `${filteredTerceros.length} cobros de terceros pendientes de conciliación`
            }
          </p>
        </div>
        <div className="bg-red-50 text-red-700 px-5 py-3 rounded-xl font-semibold text-lg">
          Total CxC: ${activeTab === 'clientes' ? totalSaldo.toFixed(2) : (comisionPct > 0 ? totalTercerosDescuento.toFixed(2) : totalTercerosSum.toFixed(2))}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        <button
          onClick={() => { setActiveTab('clientes'); setSearch(''); }}
          className={`py-3 px-6 font-semibold text-sm border-b-2 transition ${
            activeTab === 'clientes'
              ? 'border-ocean-600 text-ocean-600 font-bold'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          CxC Clientes ({filtered.length})
        </button>
        <button
          onClick={() => { setActiveTab('terceros'); setSearch(''); }}
          className={`py-3 px-6 font-semibold text-sm border-b-2 transition ${
            activeTab === 'terceros'
              ? 'border-ocean-600 text-ocean-600 font-bold'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          CxC Cuponeras & Terceros ({filteredTerceros.length})
        </button>
      </div>

      {activeTab === 'clientes' ? (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-blue-400">
              <div className="text-2xl font-bold text-gray-800">${totalMonto.toFixed(2)}</div>
              <div className="text-xs text-gray-400">Total Facturado</div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-green-400">
              <div className="text-2xl font-bold text-green-600">${totalPagado.toFixed(2)}</div>
              <div className="text-xs text-gray-400">Total Cobrado</div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-red-400">
              <div className="text-2xl font-bold text-red-600">${totalSaldo.toFixed(2)}</div>
              <div className="text-xs text-gray-400">Pendiente por Cobrar</div>
            </div>
          </div>

          {/* Search & Filters */}
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                className="input pl-9 w-full" placeholder="Buscar por cliente o habitación..." />
            </div>
            <div className="flex items-center gap-2">
              <Filter size={16} className="text-gray-400" />
              <select value={filterEstado} onChange={e => setFilterEstado(e.target.value)} className="input text-sm">
                <option value="todos">Todos los estados</option>
                {estadosUnicos.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="input text-sm">
              <option value="saldo">Mayor saldo primero</option>
              <option value="fecha">Fecha check-in</option>
              <option value="cliente">Nombre A-Z</option>
            </select>
          </div>

          {/* Date Range Filters */}
          <div className="flex flex-wrap gap-3 mb-4 items-center">
            <Calendar size={16} className="text-gray-400" />
            <span className="text-xs text-gray-400">Check-in:</span>
            <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} className="input text-sm" placeholder="Desde" />
            <span className="text-xs text-gray-400">→</span>
            <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} className="input text-sm" placeholder="Hasta" />
            {(fechaDesde || fechaHasta) && (
              <button onClick={() => { setFechaDesde(''); setFechaHasta(''); }} className="text-xs text-red-400 hover:text-red-600 flex items-center gap-1">
                <X size={12} /> Limpiar
              </button>
            )}
          </div>

          {/* Table */}
          {filtered.length === 0 ? (
            <div className="bg-white rounded-xl p-12 text-center text-gray-400">
              {search || filterEstado !== 'todos' || fechaDesde || fechaHasta ? 'No hay resultados para los filtros aplicados' : 'No hay saldos pendientes 🎉'}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                    <tr>
                      <th className="px-4 py-3 text-left">Cliente</th>
                      <th className="px-4 py-3 text-left">Habitación</th>
                      <th className="px-4 py-3 text-left">Check-in</th>
                      <th className="px-4 py-3 text-left">Plan</th>
                      <th className="px-4 py-3 text-center">Estado</th>
                      <th className="px-4 py-3 text-right">Total</th>
                      <th className="px-4 py-3 text-right">Pagado</th>
                      <th className="px-4 py-3 text-right">Saldo</th>
                      <th className="px-4 py-3 text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map((r: any) => {
                      const pct = r.monto_total > 0 ? Math.round((r.monto_pagado / r.monto_total) * 100) : 0;
                      const estadoClass = r.estado === 'Hospedado' ? 'bg-green-100 text-green-700'
                        : r.estado === 'Confirmada' ? 'bg-blue-100 text-blue-700'
                        : r.estado === 'Pendiente' ? 'bg-yellow-100 text-yellow-700'
                        : r.estado === 'Check-Out' ? 'bg-gray-100 text-gray-600'
                        : 'bg-gray-100 text-gray-500';
                      const waLink = buildWhatsAppLink(r);
                      return (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium">
                            <Link to={`/reservas/${r.id}`} className="text-ocean-600 hover:underline">{r.cliente} {r.apellido || ''}</Link>
                          </td>
                          <td className="px-4 py-3 text-gray-500">{r.habitacion_nombre || '-'}</td>
                          <td className="px-4 py-3 text-gray-500">{r.check_in}</td>
                          <td className="px-4 py-3 text-gray-500">{r.plan_nombre || '-'}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${estadoClass}`}>{r.estado}</span>
                          </td>
                          <td className="px-4 py-3 text-right font-medium">${r.monto_total?.toFixed(2)}</td>
                          <td className="px-4 py-3 text-right text-green-600">${r.monto_pagado?.toFixed(2)}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex flex-col items-end gap-1">
                              <span className="text-red-600 font-bold">${r.saldo_pendiente?.toFixed(2)}</span>
                              <div className="flex items-center gap-1">
                                <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${pct >= 100 ? 'bg-green-500' : pct >= 50 ? 'bg-blue-400' : 'bg-red-400'}`}
                                    style={{ width: `${Math.min(100, pct)}%` }} />
                                </div>
                                <span className="text-xs text-gray-400">{pct}%</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => openPagoModal(r)} title="Registrar pago"
                                className="p-1.5 rounded-lg text-green-500 hover:bg-green-50 hover:text-green-700 transition">
                                <Plus size={16} />
                              </button>
                              {waLink && (
                                <a href={waLink} target="_blank" rel="noopener noreferrer" title="Recordatorio WhatsApp"
                                  className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-50 hover:text-emerald-700 transition">
                                  <MessageCircle size={16} />
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-gray-50 font-semibold text-sm">
                    <tr>
                      <td className="px-4 py-3" colSpan={5}>TOTAL ({filtered.length} reservas)</td>
                      <td className="px-4 py-3 text-right">${totalMonto.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-green-600">${totalPagado.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-red-600">${totalSaldo.toFixed(2)}</td>
                      <td className="px-4 py-3"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Summary Cards for Cuponeras & Terceros */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-amber-400">
              <div className="text-2xl font-bold text-gray-800">${totalOfertaSimple.toFixed(2)}</div>
              <div className="text-xs text-gray-400">Oferta Simple (Cupón)</div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-purple-400">
              <div className="text-2xl font-bold text-purple-700">${totalPaHoy.toFixed(2)}</div>
              <div className="text-xs text-gray-400">PaHoy (Cupón)</div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-blue-400">
              <div className="text-2xl font-bold text-blue-700">${totalAlCobro.toFixed(2)}</div>
              <div className="text-xs text-gray-400">Al Cobro (CXC)</div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-red-400 bg-red-50/10">
              <div className="text-2xl font-bold text-red-600">${totalTercerosSum.toFixed(2)}</div>
              <div className="text-xs text-gray-400">Total CxC Terceros</div>
            </div>
          </div>

          {/* Search bar and Batch Reconcile button */}
          <div className="flex flex-wrap gap-3 mb-4 items-center justify-between">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                className="input pl-9 w-full" placeholder="Buscar por cliente, cupón o referencia..." />
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">Comisión (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={comision}
                  onChange={e => setComision(e.target.value)}
                  className="input py-1.5 px-3 w-20 text-sm focus:outline-none focus:border-ocean-400"
                  placeholder="0"
                />
              </div>
              {!isAdmin && (
                <span className="text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-100 font-medium">
                  ⚠️ Solo administradores pueden reconciliar
                </span>
              )}
              <button
                onClick={handleReconciliar}
                disabled={selectedTerceros.length === 0 || reconciling || !isAdmin}
                className="px-4 py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition flex items-center gap-2 shadow-sm"
              >
                {reconciling ? 'Reconciliando...' : `✓ Reconciliar Cobros (${selectedTerceros.length})`}
              </button>
            </div>
          </div>

          {/* Table for Terceros */}
          {filteredTerceros.length === 0 ? (
            <div className="bg-white rounded-xl p-12 text-center text-gray-400">
              {search ? 'No hay resultados para los filtros aplicados' : 'No hay cobros de terceros pendientes por conciliar contablemente 🎉'}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                    <tr>
                      <th className="px-4 py-3 text-center w-10">
                        <input
                          type="checkbox"
                          checked={filteredTerceros.length > 0 && selectedTerceros.length === filteredTerceros.length}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedTerceros(filteredTerceros.map(x => x.id));
                            } else {
                              setSelectedTerceros([]);
                            }
                          }}
                          className="rounded border-gray-300 text-ocean-600 focus:ring-ocean-500"
                        />
                      </th>
                      <th className="px-4 py-3 text-left">Cliente</th>
                      <th className="px-4 py-3 text-left">Habitación</th>
                      <th className="px-4 py-3 text-left">Estadía</th>
                      <th className="px-4 py-3 text-left">Concepto</th>
                      <th className="px-4 py-3 text-left">Método Pago</th>
                      <th className="px-4 py-3 text-left">Referencia</th>
                      <th className="px-4 py-3 text-right">Monto</th>
                      <th className="px-4 py-3 text-left">Registrado Por</th>
                      <th className="px-4 py-3 text-left">Fecha Pago</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredTerceros.map((f: any) => {
                      const metodoClass = f.metodo_pago === 'cuponera_oferta_simple' ? 'bg-amber-100 text-amber-800'
                        : f.metodo_pago === 'cuponera_pahoy' ? 'bg-purple-100 text-purple-800'
                        : 'bg-blue-100 text-blue-800';
                      const metodoLabel = f.metodo_pago === 'cuponera_oferta_simple' ? 'Oferta Simple'
                        : f.metodo_pago === 'cuponera_pahoy' ? 'PaHoy'
                        : 'Al Cobro (CXC)';
                      return (
                        <tr key={f.id} className={`hover:bg-gray-50 ${selectedTerceros.includes(f.id) ? 'bg-ocean-50/20' : ''}`}>
                          <td className="px-4 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={selectedTerceros.includes(f.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedTerceros(prev => [...prev, f.id]);
                                } else {
                                  setSelectedTerceros(prev => prev.filter(id => id !== f.id));
                                }
                              }}
                              className="rounded border-gray-300 text-ocean-600 focus:ring-ocean-500"
                            />
                          </td>
                          <td className="px-4 py-3 font-medium">
                            <Link to={`/reservas/${f.reserva_id}`} className="text-ocean-600 hover:underline">{f.cliente} {f.apellido || ''}</Link>
                          </td>
                          <td className="px-4 py-3 text-gray-500">{f.habitacion_nombre || '-'}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">
                            {f.check_in} a {f.check_out}
                          </td>
                          <td className="px-4 py-3 text-gray-700">{f.concepto}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${metodoClass}`}>{metodoLabel}</span>
                          </td>
                          <td className="px-4 py-3 text-gray-500 font-mono text-xs">{f.referencia || '-'}</td>
                          <td className="px-4 py-3 text-right font-bold text-gray-800">
                            {comisionPct > 0 ? (
                              <div className="flex flex-col items-end">
                                <span className="text-xs text-gray-400 line-through">${f.monto?.toFixed(2)}</span>
                                <span className="text-green-600">${(f.monto * (1 - comisionPct / 100)).toFixed(2)}</span>
                              </div>
                            ) : (
                              `$${f.monto?.toFixed(2)}`
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{f.registrado_por || '-'}</td>
                          <td className="px-4 py-3 text-gray-400 text-xs">{f.fecha}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-gray-50 font-semibold text-sm">
                    <tr>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3" colSpan={6}>TOTAL ({filteredTerceros.length} cobros)</td>
                      <td className="px-4 py-3 text-right font-bold text-red-600">
                        {comisionPct > 0 ? (
                          <div className="flex flex-col items-end">
                            <span className="text-xs text-gray-400 line-through">${totalTercerosSum.toFixed(2)}</span>
                            <span>${totalTercerosDescuento.toFixed(2)}</span>
                          </div>
                        ) : (
                          `$${totalTercerosSum.toFixed(2)}`
                        )}
                      </td>
                      <td className="px-4 py-3" colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Quick Payment Modal */}
      {pagoModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setPagoModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-gray-800">Registrar Pago</h3>
                <button onClick={() => setPagoModal(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
              </div>
              <div className="text-sm text-gray-500 mt-1">
                {pagoModal.cliente} {pagoModal.apellido || ''} — {pagoModal.habitacion_nombre || 'Sin hab.'}
              </div>
              <div className="flex gap-4 mt-2 text-xs text-gray-400">
                <span>Total: <span className="font-medium text-gray-600">${pagoModal.monto_total?.toFixed(2)}</span></span>
                <span>Pagado: <span className="font-medium text-green-600">${pagoModal.monto_pagado?.toFixed(2)}</span></span>
                <span>Saldo: <span className="font-bold text-red-600">${pagoModal.saldo_pendiente?.toFixed(2)}</span></span>
              </div>
            </div>
            <form onSubmit={submitPago} className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Monto *</label>
                  <input type="number" step="0.01" min="0.01" value={pagoForm.monto}
                    onChange={e => setPagoForm(p => ({ ...p, monto: e.target.value }))}
                    required className="input" placeholder="0.00" autoFocus />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Método</label>
                  <select value={pagoForm.metodo_pago} onChange={e => setPagoForm(p => ({ ...p, metodo_pago: e.target.value }))} className="input">
                    <option value="efectivo">Efectivo</option>
                    <option value="transferencia">Transferencia</option>
                    <option value="yappy">Yappy</option>
                    <option value="tarjeta">Tarjeta (POS)</option>
                    <option value="al_cobro">Al Cobro (CXC)</option>
                    <option value="cuponera_oferta_simple">Oferta Simple (Cupón)</option>
                    <option value="cuponera_pahoy">PaHoy (Cupón)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Concepto</label>
                  <input value={pagoForm.concepto} onChange={e => setPagoForm(p => ({ ...p, concepto: e.target.value }))} className="input" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Referencia</label>
                  <input value={pagoForm.referencia} onChange={e => setPagoForm(p => ({ ...p, referencia: e.target.value }))} className="input" placeholder="#" />
                </div>
              </div>
              {/* Quick amount buttons */}
              <div className="flex gap-2">
                <button type="button" onClick={() => setPagoForm(p => ({ ...p, monto: pagoModal.saldo_pendiente?.toFixed(2) }))}
                  className="text-xs px-3 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition">
                  Saldo completo (${pagoModal.saldo_pendiente?.toFixed(2)})
                </button>
                <button type="button" onClick={() => setPagoForm(p => ({ ...p, monto: (pagoModal.saldo_pendiente / 2)?.toFixed(2) }))}
                  className="text-xs px-3 py-1 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition">
                  50% (${(pagoModal.saldo_pendiente / 2)?.toFixed(2)})
                </button>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={pagoLoading}
                  className="flex-1 px-4 py-2.5 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 disabled:opacity-50 transition">
                  {pagoLoading ? 'Guardando...' : '✓ Registrar Pago'}
                </button>
                <button type="button" onClick={() => setPagoModal(null)}
                  className="px-4 py-2.5 text-gray-500 text-sm rounded-lg hover:bg-gray-100 transition">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
