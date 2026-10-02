import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { api } from '../api/client';
import { ChevronLeft, ChevronRight, CalendarDays, Loader2 } from 'lucide-react';

function OnlinePaymentsDisabled(_props: {
  clientId: string; mode: string; monto: number; descripcion: string; onSuccess: (orderId: string) => void; onError: (msg: string) => void
}) {
  return <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Pagos online por configurar. No hay una pasarela conectada.</p>
}

import { useNavigate } from 'react-router-dom';
import InteractivePopover from '../components/InteractivePopover';
import { useContextMenu } from '../hooks/useContextMenu';
import ContextMenu from '../components/ContextMenu';
import RoomRow from '../components/RoomRow';
import { HousekeepingCalendar } from './Housekeeping';



const estadoColors: Record<string, string> = {
  'Confirmada': 'bg-blue-400',
  'Hospedado': 'bg-green-500',
  'Check-Out': 'bg-gray-400',
  'Pendiente': 'bg-yellow-400',
  'Cancelada': 'bg-red-400',
  'No-Show': 'bg-red-300',
};

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDate(d: Date) {
  return d.toISOString().split('T')[0];
}

function daysBetween(d1: string, d2: string) {
  return Math.ceil((new Date(d2).getTime() - new Date(d1).getTime()) / (1000 * 60 * 60 * 24));
}

const DAYS_TO_SHOW = 14;
const ROOM_COL_W = 'w-36 min-w-[144px]';

export default function Calendario({ userRole }: { userRole?: string }) {
  if (userRole === 'cleaning') return <HousekeepingCalendar />;
  if (userRole !== 'admin' && userRole !== 'receptionist') return <div role="status" className="p-8 text-gray-400">Verificando permisos...</div>;
  return <OperationsCalendar userRole={userRole} />;
}

function OperationsCalendar({ userRole }: { userRole: string }) {
  const navigate = useNavigate();
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [jumpDate, setJumpDate] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState<{ reserva: any; x: number; y: number } | null>(null);
  const [catFilter, setCatFilter] = useState('');
  const [activeGroupCode, setActiveGroupCode] = useState<string | null>(null);

  // Quick Payment Modal States
  const [quickPayReservaId, setQuickPayReservaId] = useState<number | null>(null);
  const [quickPayForm, setQuickPayForm] = useState({ monto: '', concepto: '', metodo_pago: 'efectivo', referencia: '' });
  const [quickPayLoading, setQuickPayLoading] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [posConfirmed, setPosConfirmed] = useState(false);
  const [paypalConfig, setPaypalConfig] = useState<any>({ paypal_enabled: false, paypal_client_id: '', paypal_mode: 'sandbox' });

  useEffect(() => {
    api.get('/public/paypal-config')
      .then(r => {
        if (r.data) setPaypalConfig({ paypal_enabled: false, paypal_client_id: '', paypal_mode: 'sandbox' });
      })
      .catch(e => console.error('Error fetching paypal config:', e));
  }, []);

  // Hover references to prevent high-frequency re-renders & flickering
  const leaveTimeoutRef = useRef<any>(null);
  const enterTimeoutRef = useRef<any>(null);

  const { contextMenu, handleContextMenu, closeMenu } = useContextMenu();


  const dates = useMemo(() => {
    return Array.from({ length: DAYS_TO_SHOW }, (_, i) => addDays(startDate, i));
  }, [startDate]);

  const desde = formatDate(dates[0]);
  const hasta = formatDate(addDays(dates[dates.length - 1], 1));

  const load = () => {
    setLoading(true);
    api.get(`/hotel/calendario?desde=${desde}&hasta=${hasta}`)
      .then(r => setData(r.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [desde, hasta]);

  const prev = () => setStartDate(d => addDays(d, -7));
  const next = () => setStartDate(d => addDays(d, 7));
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); setStartDate(d); };
  const jumpTo = () => {
    if (jumpDate) {
      const d = new Date(jumpDate + 'T00:00:00');
      if (!isNaN(d.getTime())) setStartDate(d);
    }
  };

  // Group rooms by categoria > tipo — two-level grouping
  const categoryGroups = useMemo(() => {
    if (!data?.habitaciones) return [];
    const catMap: Record<string, Record<string, any[]>> = {};
    for (const r of data.habitaciones) {
      const cat = r.categoria || 'Estadía';
      if (!catMap[cat]) catMap[cat] = {};
      (catMap[cat][r.tipo] = catMap[cat][r.tipo] || []).push(r);
    }
    // Order: Estadía first, then Pasadía
    const catOrder = ['Estadía', 'Pasadía'];
    const typeOrder: Record<string, number> = { 'Familiar': 1, 'Doble': 2, 'Estándar': 3, 'Camping': 4, 'Bohío': 1, 'Salón': 2, 'Restaurante': 3 };
    return catOrder
      .filter(cat => catMap[cat])
      .filter(cat => !catFilter || cat === catFilter)
      .map(cat => ({
        categoria: cat,
        groups: Object.entries(catMap[cat])
          .sort(([a], [b]) => (typeOrder[a] || 99) - (typeOrder[b] || 99))
          .map(([tipo, rooms]) => ({ tipo, rooms }))
      }));
  }, [data?.habitaciones, catFilter]);

  const getReservationsForRoom = useCallback((roomId: number) => {
    if (!data?.reservas) return [];
    return data.reservas.filter((r: any) => r.habitacion_id === roomId);
  }, [data?.reservas]);

  // Callbacks for memoized RoomRow
  const handleCellClick = useCallback((roomId: number, dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00');
    const nextDay = new Date(d);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayStr = nextDay.toISOString().split('T')[0];
    navigate(`/reservas/nueva?check_in=${dateStr}&check_out=${nextDayStr}&habitacion_id=${roomId}`);
  }, [navigate]);

  const handleCellContextMenu = useCallback((e: React.MouseEvent, room: any, date: string) => {
    handleContextMenu(e, { type: 'empty_cell', room, date });
  }, [handleContextMenu]);

  const handleReservaMouseEnter = useCallback((e: React.MouseEvent, res: any) => {
    if (leaveTimeoutRef.current) clearTimeout(leaveTimeoutRef.current);
    if (enterTimeoutRef.current) clearTimeout(enterTimeoutRef.current);
    if (res.grupo_codigo) {
      setActiveGroupCode(res.grupo_codigo);
    }
    const clientX = e.clientX;
    const clientY = e.clientY;
    enterTimeoutRef.current = setTimeout(() => {
      setTooltip({ reserva: res, x: clientX, y: clientY });
    }, 150);
  }, []);

  const handleReservaMouseLeave = useCallback(() => {
    if (enterTimeoutRef.current) clearTimeout(enterTimeoutRef.current);
    setActiveGroupCode(null);
    leaveTimeoutRef.current = setTimeout(() => {
      setTooltip(null);
    }, 200);
  }, []);

  const handleReservaContextMenu = useCallback((e: React.MouseEvent, res: any) => {
    setTooltip(null);
    handleContextMenu(e, { type: 'reserva', reserva: res });
  }, [handleContextMenu]);

  const handleReassignRoom = useCallback(async (reservaId: number, roomId: number) => {
    try {
      await api.put(`/hotel/reservas/${reservaId}`, { habitacion_id: roomId });
      load();
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || 'Error al reasignar habitación');
    }
  }, []);

  const isToday = (d: Date) => formatDate(d) === formatDate(new Date());
  const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

  const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  // Handle actions executed from inside the interactive popover
  const handlePopoverAction = async (actionType: string, reservaId: number) => {
    setTooltip(null);
    if (actionType === 'view_details') {
      navigate(`/reservas/${reservaId}`);
    } else if (actionType === 'check_in') {
      try {
        await api.patch(`/hotel/reservas/${reservaId}/status`, { estado: 'Hospedado' });
        load();
      } catch (err: any) {
        alert(err?.response?.data?.error?.message || 'Error al hacer Check-In');
      }
    } else if (actionType === 'check_out') {
      try {
        await api.patch(`/hotel/reservas/${reservaId}/status`, { estado: 'Check-Out' });
        load();
      } catch (err: any) {
        alert(err?.response?.data?.error?.message || 'Error al hacer Check-Out');
      }
    } else if (actionType === 'approve_reserva') {
      try {
        await api.patch(`/hotel/reservas/${reservaId}/status`, { estado: 'Confirmada' });
        load();
      } catch (err: any) {
        alert(err?.response?.data?.error?.message || 'Error al aprobar la reserva');
      }
    } else if (actionType === 'reject_reserva') {
      if (confirm('¿Estás seguro de que deseas rechazar y cancelar esta reserva pendiente?')) {
        try {
          await api.patch(`/hotel/reservas/${reservaId}/status`, { estado: 'Cancelada' });
          load();
        } catch (err: any) {
          alert(err?.response?.data?.error?.message || 'Error al rechazar la reserva');
        }
      }
    } else if (actionType === 'register_payment') {
      setQuickPayReservaId(reservaId);
      setReceiptFile(null);
      setDragActive(false);
      setPosConfirmed(false);
      const resObj = data?.reservas?.find((r: any) => r.id === reservaId);
      if (resObj) {
        setQuickPayForm({
          monto: resObj.saldo_pendiente ? String(resObj.saldo_pendiente) : '',
          concepto: 'Abono rápido desde Calendario',
          metodo_pago: 'efectivo',
          referencia: '',
        });
      }
    }
  };

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
    } else if (actionType === 'approve_reserva') {
      try {
        await api.patch(`/hotel/reservas/${payload.reserva.id}/status`, { estado: 'Confirmada' });
        load();
      } catch (err: any) {
        alert(err?.response?.data?.error?.message || 'Error al aprobar la reserva');
      }
    } else if (actionType === 'reject_reserva') {
      if (confirm(`¿Estás seguro de que deseas rechazar y cancelar la reserva pendiente de ${payload.reserva.cliente}?`)) {
        try {
          await api.patch(`/hotel/reservas/${payload.reserva.id}/status`, { estado: 'Cancelada' });
          load();
        } catch (err: any) {
          alert(err?.response?.data?.error?.message || 'Error al rechazar la reserva');
        }
      }
    } else if (actionType === 'register_payment') {
      setQuickPayReservaId(payload.reserva.id);
      setReceiptFile(null);
      setDragActive(false);
      setPosConfirmed(false);
      setQuickPayForm({
        monto: payload.reserva.saldo_pendiente ? String(payload.reserva.saldo_pendiente) : '',
        concepto: 'Abono rápido desde Calendario',
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
    } else if (actionType === 'create_booking') {
      navigate(`/reservas/nueva?check_in=${payload.date}&check_out=${formatDate(addDays(new Date(payload.date + 'T12:00:00'), 1))}&habitacion_id=${payload.room.id}`);
    } else if (actionType === 'set_clean' || actionType === 'set_dirty' || actionType === 'set_inspected') {
      const cleanState = actionType === 'set_clean' ? 'Limpia' : actionType === 'set_dirty' ? 'Sucia' : 'Inspeccionada';
      try {
        await api.patch(`/habitaciones/${payload.room.id}/limpieza`, { estado_limpieza: cleanState });
        load();
      } catch (err: any) {
        alert(err?.response?.data?.error?.message || 'Error al actualizar limpieza');
      }
    }
  };


  const submitQuickPay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickPayReservaId || !quickPayForm.monto || parseFloat(quickPayForm.monto) <= 0) return;
    if (quickPayForm.metodo_pago === 'tarjeta' && !posConfirmed) {
      alert('Por favor, confirme que la transacción en la máquina POS fue exitosa.');
      return;
    }
    setQuickPayLoading(true);
    try {
      await api.post(`/hotel/reservas/${quickPayReservaId}/folio`, {
        ...quickPayForm,
        monto: parseFloat(quickPayForm.monto),
        tipo: 'credito',
      });

      if (receiptFile) {
        const formData = new FormData();
        formData.append('archivo', receiptFile);
        formData.append('tipo', 'recibo');
        formData.append('notas', `Comprobante de abono rápido desde Calendario por $${parseFloat(quickPayForm.monto).toFixed(2)}.`);
        await api.post(`/hotel/reservas/${quickPayReservaId}/documentos`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      }

      setQuickPayReservaId(null);
      setReceiptFile(null);
      setPosConfirmed(false);
      load();
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || 'Error al registrar pago');
    } finally {
      setQuickPayLoading(false);
    }
  };

  if (loading && !data) return <div className="animate-pulse text-gray-400 p-8">Cargando calendario...</div>;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-gray-800">Calendario</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={prev} className="p-2 hover:bg-gray-100 rounded-lg transition"><ChevronLeft size={20} /></button>
          <button onClick={today} className="px-4 py-2 text-sm font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition">Hoy</button>
          <button onClick={next} className="p-2 hover:bg-gray-100 rounded-lg transition"><ChevronRight size={20} /></button>
          <span className="text-sm text-gray-500 ml-1">
            {monthNames[dates[0].getMonth()]} {dates[0].getDate()} — {monthNames[dates[dates.length - 1].getMonth()]} {dates[dates.length - 1].getDate()}, {dates[dates.length - 1].getFullYear()}
          </span>
          {/* Date Picker Search */}
          <div className="flex items-center gap-1 ml-2">
            <CalendarDays size={16} className="text-gray-400" />
            <input type="date" value={jumpDate} onChange={e => setJumpDate(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-ocean-400" />
            <button onClick={jumpTo} disabled={!jumpDate}
              className="px-3 py-1.5 text-xs bg-ocean-500 text-white rounded-lg hover:bg-ocean-600 transition disabled:opacity-40">Ir</button>
          </div>
          {/* Category Filter */}
          <div className="flex items-center gap-1 ml-2">
            <button onClick={() => setCatFilter('')} className={`px-3 py-1.5 text-xs rounded-lg font-medium transition ${!catFilter ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>Todas</button>
            <button onClick={() => setCatFilter('Estadía')} className={`px-3 py-1.5 text-xs rounded-lg font-medium transition ${catFilter === 'Estadía' ? 'bg-ocean-500 text-white' : 'bg-ocean-50 text-ocean-700 hover:bg-ocean-100'}`}>🏨 Estadía</button>
            <button onClick={() => setCatFilter('Pasadía')} className={`px-3 py-1.5 text-xs rounded-lg font-medium transition ${catFilter === 'Pasadía' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>☀️ Pasadía</button>
          </div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        {/* Date Headers */}
        <div className="flex border-b border-gray-200 bg-white">
          <div className={`${ROOM_COL_W} flex-shrink-0 bg-gray-50 border-r border-gray-200 px-3 py-2`}>
            <span className="text-xs font-semibold text-gray-500 uppercase">Habitación</span>
          </div>
          <div className="flex-1 flex">
            {dates.map((d, i) => (
              <div key={i} className={`flex-1 min-w-[50px] text-center border-r border-gray-100 py-2 ${isToday(d) ? 'bg-ocean-50' : isWeekend(d) ? 'bg-gray-50' : ''}`}>
                <div className="text-xs text-gray-400">{dayNames[d.getDay()]}</div>
                <div className={`text-sm font-semibold ${isToday(d) ? 'text-ocean-600' : 'text-gray-700'}`}>{d.getDate()}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Room Rows */}
        {categoryGroups.map(catGroup => (
          <div key={catGroup.categoria}>
            {/* Category Header */}
            <div className="flex border-b border-gray-300 bg-gradient-to-r from-mahana-50 to-white">
              <div className={`${ROOM_COL_W} flex-shrink-0 px-3 py-2 border-r border-gray-300`}>
                <span className="text-xs font-bold text-mahana-700 uppercase tracking-wider">{catGroup.categoria === 'Estadía' ? '🏨 Estadía' : '☀️ Pasadía'}</span>
              </div>
              <div className="flex-1" />
            </div>

            {catGroup.groups.map(group => (
              <div key={group.tipo}>
                {/* Type Sub-Header */}
                <div className="flex border-b border-gray-200 bg-gray-50">
                  <div className={`${ROOM_COL_W} flex-shrink-0 px-3 py-1 border-r border-gray-200`}>
                    <span className="text-[11px] font-semibold text-gray-500 uppercase">{group.tipo} ({group.rooms.length})</span>
                  </div>
                  <div className="flex-1" />
                </div>

                {/* Individual Room Rows */}
                {group.rooms.map((room: any) => {
                  const reservations = getReservationsForRoom(room.id);
                  return (
                    <RoomRow
                      key={room.id}
                      room={room}
                      dates={dates}
                      reservations={reservations}
                      onCellClick={handleCellClick}
                      onCellContextMenu={handleCellContextMenu}
                      onReservaMouseEnter={handleReservaMouseEnter}
                      onReservaMouseLeave={handleReservaMouseLeave}
                      onReservaContextMenu={handleReservaContextMenu}
                      activeGroupCode={activeGroupCode}
                      onReassignRoom={handleReassignRoom}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Interactive Popover */}
      {tooltip && (
        <div
          onMouseEnter={() => {
            if (leaveTimeoutRef.current) clearTimeout(leaveTimeoutRef.current);
          }}
          onMouseLeave={() => {
            if (enterTimeoutRef.current) clearTimeout(enterTimeoutRef.current);
            leaveTimeoutRef.current = setTimeout(() => {
              setTooltip(null);
            }, 200);
          }}
        >
          <InteractivePopover
            reserva={tooltip.reserva}
            x={tooltip.x}
            y={tooltip.y}
            onClose={() => setTooltip(null)}
            onAction={handlePopoverAction}
            userRole={userRole}
          />
        </div>
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
                    { id: 'tarjeta', label: '💳 Tarjeta POS' },
                    { id: 'tarjeta_credito', label: '💳 Tarjeta Crédito' },
                    { id: 'paypal', label: '🔵 PayPal' },
                    { id: 'al_cobro', label: '📝 Al Cobro (CXC)' },
                    { id: 'cuponera_oferta_simple', label: '🏷️ Oferta Simple' },
                    { id: 'cuponera_pahoy', label: '⚡ PaHoy' },
                  ].map(method => (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => {
                        setQuickPayForm(f => ({ ...f, metodo_pago: method.id }));
                        setPosConfirmed(false);
                      }}
                      className={`py-2 px-3 rounded-xl text-xs font-semibold border transition text-left flex items-center justify-between ${
                        quickPayForm.metodo_pago === method.id
                          ? 'border-green-500 bg-green-50 text-green-700 font-bold ring-2 ring-green-100'
                          : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                      }`}
                    >
                      <span>{method.label}</span>
                      {quickPayForm.metodo_pago === method.id && <span className="text-green-500 text-xs">✓</span>}
                    </button>
                  ))}
                </div>
              </div>

              {quickPayForm.metodo_pago === 'tarjeta' && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 space-y-2">
                  <p className="font-semibold">⚠️ Advertencia de POS</p>
                  <p>Confirme que la transacción en la máquina POS fue exitosa antes de registrar el pago en el sistema.</p>
                  <label className="flex items-center gap-2 cursor-pointer mt-1 font-semibold">
                    <input
                      type="checkbox"
                      checked={posConfirmed}
                      onChange={e => setPosConfirmed(e.target.checked)}
                      className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                    />
                    <span>Confirmar transacción exitosa</span>
                  </label>
                </div>
              )}

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

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  📄 Adjuntar Comprobante (Opcional)
                </label>
                <div
                  onDragOver={e => { e.preventDefault(); setDragActive(true); }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={e => {
                    e.preventDefault();
                    setDragActive(false);
                    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                      setReceiptFile(e.dataTransfer.files[0]);
                    }
                  }}
                  className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition ${
                    dragActive
                      ? 'border-green-500 bg-green-50 text-green-700 font-semibold border-solid'
                      : receiptFile
                      ? 'border-green-300 bg-green-50 text-green-700 font-semibold border-solid'
                      : 'border-gray-200 hover:border-gray-300 text-gray-500 bg-gray-50'
                  }`}
                  onClick={() => document.getElementById('quick-pay-file')?.click()}
                >
                  <input
                    id="quick-pay-file"
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={e => {
                      if (e.target.files && e.target.files[0]) {
                        setReceiptFile(e.target.files[0]);
                      }
                    }}
                    className="hidden"
                  />
                  {receiptFile ? (
                    <div className="space-y-1">
                      <p className="text-xs font-bold truncate">✓ {receiptFile.name}</p>
                      <p className="text-[10px] text-green-600">{(receiptFile.size / 1024).toFixed(1)} KB - Click para cambiar</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold">Arrastre el comprobante aquí o haga clic</p>
                      <p className="text-[10px] text-gray-400">PDF, JPG, PNG (máx. 5MB)</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {(() => {
              const isOnlineQuickPay = (quickPayForm.metodo_pago === 'paypal' || quickPayForm.metodo_pago === 'tarjeta_credito') && parseFloat(quickPayForm.monto) > 0;
              return (
                <div className="flex gap-2.5 mt-6 flex-col">
                  {isOnlineQuickPay ? (
                    <div className="flex flex-col gap-2 w-full">
                      {paypalConfig.paypal_enabled && paypalConfig.paypal_client_id ? (
                        <div className="w-full">
                          <OnlinePaymentsDisabled
                            clientId={paypalConfig.paypal_client_id}
                            mode={paypalConfig.paypal_mode}
                            monto={parseFloat(quickPayForm.monto)}
                            descripcion={`Hotel Panamá Canal - Pago rapido reserva #${quickPayReservaId}`}
                            onSuccess={async (orderId) => {
                              setQuickPayLoading(true);
                              try {
                                await api.post(`/hotel/reservas/${quickPayReservaId}/folio`, {
                                  monto: parseFloat(quickPayForm.monto),
                                  concepto: quickPayForm.concepto || 'Abono online (PayPal)',
                                  tipo: 'credito',
                                  metodo_pago: quickPayForm.metodo_pago,
                                  referencia: orderId
                                });
                                setQuickPayReservaId(null);
                                setReceiptFile(null);
                                setPosConfirmed(false);
                                load();
                              } catch (err: any) {
                                alert(err.message || 'Error registrando el pago');
                              } finally {
                                setQuickPayLoading(false);
                              }
                            }}
                            onError={(msg) => alert(msg)}
                          />
                        </div>
                      ) : (
                        <div className="text-xs text-gray-500 bg-gray-50 p-3 rounded-lg text-center">
                          Pagos online por configurar. No hay una pasarela conectada.
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setQuickPayReservaId(null)}
                        className="w-full py-2.5 text-gray-500 hover:bg-gray-100 rounded-xl text-sm font-semibold transition border border-gray-200"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2.5 w-full">
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
                        className="px-4 py-2.5 text-gray-500 hover:bg-gray-100 rounded-xl text-sm font-semibold transition border border-gray-200"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
          </form>
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

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mt-4 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-400" /> Confirmada</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500" /> Hospedado</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-400" /> Pendiente</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-400" /> Check-Out</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-400" /> Cancelada</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400" /> Limpia</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> Sucia</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" /> Inspecc.</span>
      </div>
    </div>
  );
}

