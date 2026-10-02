// v2 — cancel/edit/folio-totals
import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { ArrowLeft, Plus, Edit2, X, Check, Upload, FileText, Trash2, Image, Mail, Phone, Eye, RefreshCw, Calendar, XCircle, CheckCircle2, ShieldAlert, ExternalLink, Loader2 } from 'lucide-react';

function OnlinePaymentsDisabled(_props: {
  clientId: string; mode: string; monto: number; descripcion: string; onSuccess: (orderId: string) => void; onError: (msg: string) => void
}) {
  return <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Pagos online por configurar. No hay una pasarela conectada.</p>
}

const estadoColor: Record<string, string> = {
  'Confirmada': 'bg-blue-100 text-blue-700',
  'Hospedado': 'bg-green-100 text-green-700',
  'Check-Out': 'bg-gray-100 text-gray-600',
  'Pendiente': 'bg-yellow-100 text-yellow-700',
  'Cancelada': 'bg-red-100 text-red-700',
  'No-Show': 'bg-red-50 text-red-500',
  'Cambio Pendiente de Aprobación': 'bg-orange-100 text-orange-700 font-bold',
};

async function downloadGuestDocument(id: number, filename: string) {
  const token = localStorage.getItem('pms_token');
  const response = await fetch(`/api/v1/hotel/documentos/${id}/archivo`, {
    headers: { Authorization: `Bearer ${token || ''}` }
  });
  if (!response.ok) { alert('No se pudo descargar el documento. Verifica tu sesión.'); return; }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ReservaDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isAdmin = JSON.parse(localStorage.getItem('pms_user') || '{}')?.rol === 'admin';
  const [reserva, setReserva] = useState<any>(null);
  const [groupReservations, setGroupReservations] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [availableRooms, setAvailableRooms] = useState<any[]>([]);

  // Double approval workflow states
  const [showEditReservaModal, setShowEditReservaModal] = useState(false);
  const [justificacionReserva, setJustificacionReserva] = useState('');

  const [showEditPagoModal, setShowEditPagoModal] = useState(false);
  const [selectedPago, setSelectedPago] = useState<any>(null);
  const [newMonto, setNewMonto] = useState('');
  const [newConcepto, setNewConcepto] = useState('');
  const [newMetodoPago, setNewMetodoPago] = useState('');
  const [newReferencia, setNewReferencia] = useState('');
  const [justificacionPago, setJustificacionPago] = useState('');
  const [editPagoLoading, setEditPagoLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showPago, setShowPago] = useState(false);
  const [pago, setPago] = useState({ monto: '', concepto: 'Abono', metodo_pago: 'efectivo', referencia: '' });
  const [pagoLoading, setPagoLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [editLoading, setEditLoading] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null); // 'Cancelada' | 'No-Show'
  const [showUpload, setShowUpload] = useState(false);
  const [uploadTipo, setUploadTipo] = useState('recibo');
  const [uploadNotas, setUploadNotas] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reversalLoading, setReversalLoading] = useState<number | null>(null);

  // States for deleting reservation (Admin only)
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteMotivo, setDeleteMotivo] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  // States for notifications
  const [notificaciones, setNotificaciones] = useState<any[]>([]);
  const [loadingNotifs, setLoadingNotifs] = useState(false);
  const [selectedNotifForView, setSelectedNotifForView] = useState<any | null>(null);
  const [resendingId, setResendingId] = useState<number | null>(null);

  // Voucher upload state inside "Registrar Pago" form
  const [pagoFile, setPagoFile] = useState<File | null>(null);
  const [pagoPreviewUrl, setPagoPreviewUrl] = useState<string | null>(null);
  const [pagoDragActive, setPagoDragActive] = useState(false);
  const [paypalConfig, setPaypalConfig] = useState<any>({ paypal_enabled: false, paypal_client_id: '', paypal_mode: 'sandbox' });

  // Extra Person Charge form states
  const [showPersonaExtra, setShowPersonaExtra] = useState(false);
  const [personaExtraForm, setPersonaExtraForm] = useState({
    precioPorNoche: '25',
    noches: '1',
    monto: '25',
    concepto: 'Persona Extra - Cargo al Folio (1 noches)'
  });
  const [personaExtraLoading, setPersonaExtraLoading] = useState(false);

  const lastPrecioNoche = useRef(personaExtraForm.precioPorNoche);
  const lastNoches = useRef(personaExtraForm.noches);

  // Synchronize nights default for persona extra
  useEffect(() => {
    if (reserva) {
      const defaultNoches = reserva.noches === 0 ? 1 : (reserva.noches || 1);
      const defaultMonto = (25 * defaultNoches).toString();
      const defaultConcepto = `Persona Extra - Cargo al Folio (${defaultNoches} noches)`;
      setPersonaExtraForm({
        precioPorNoche: '25',
        noches: defaultNoches.toString(),
        monto: defaultMonto,
        concepto: defaultConcepto
      });
      lastPrecioNoche.current = '25';
      lastNoches.current = defaultNoches.toString();
    }
  }, [reserva]);

  // Sync monto and concepto when precioPorNoche or noches changes
  useEffect(() => {
    const currentPrecio = personaExtraForm.precioPorNoche;
    const currentNoches = personaExtraForm.noches;

    if (currentPrecio !== lastPrecioNoche.current || currentNoches !== lastNoches.current) {
      lastPrecioNoche.current = currentPrecio;
      lastNoches.current = currentNoches;

      const pVal = parseFloat(currentPrecio) || 0;
      const nVal = parseInt(currentNoches) || 0;
      const computedMonto = (pVal * nVal).toString();
      const computedConcepto = `Persona Extra - Cargo al Folio (${nVal} noches)`;

      setPersonaExtraForm(prev => ({
        ...prev,
        monto: computedMonto,
        concepto: computedConcepto
      }));
    }
  }, [personaExtraForm.precioPorNoche, personaExtraForm.noches]);

  useEffect(() => {
    api.get('/public/paypal-config')
      .then(r => {
        if (r.data) setPaypalConfig({ paypal_enabled: false, paypal_client_id: '', paypal_mode: 'sandbox' });
      })
      .catch(e => console.error('Error fetching paypal config:', e));
  }, []);

  useEffect(() => {
    api.get('/habitaciones')
      .then(r => {
        if (Array.isArray(r.data)) setRooms(r.data);
      })
      .catch(e => console.error('Error fetching rooms:', e));
  }, []);

  useEffect(() => {
    if (reserva?.check_in && reserva?.check_out) {
      api.get(`/hotel/disponibilidad?check_in=${reserva.check_in}&check_out=${reserva.check_out}`)
        .then(r => {
          if (Array.isArray(r.data)) setAvailableRooms(r.data);
        })
        .catch(e => console.error('Error fetching availability:', e));
    }
  }, [reserva?.check_in, reserva?.check_out]);

  useEffect(() => {
    if (!pagoFile) {
      setPagoPreviewUrl(null);
      return;
    }
    if (pagoFile.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPagoPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(pagoFile);
    } else {
      setPagoPreviewUrl(null);
    }
  }, [pagoFile]);

  const load = (silent?: boolean) => {
    if (!silent) {
      setLoading(true);
    }
    api.get(`/hotel/reservas/${id}`)
      .then(async (r) => {
        setReserva(r.data);
        if (r.data.grupo_codigo) {
          try {
            const gr = await api.get(`/hotel/reservas?grupo_codigo=${r.data.grupo_codigo}`);
            setGroupReservations(gr.data);
          } catch (e) {
            console.error('Error loading group reservations:', e);
          }
        } else {
          setGroupReservations([]);
        }
        if (!silent) {
          setLoading(false);
        }
      })
      .catch(() => {
        if (!silent) {
          setLoading(false);
        }
      });
  };
  const loadNotificaciones = () => {
    setLoadingNotifs(true);
    api.get(`/hotel/reservas/${id}/notificaciones`)
      .then(r => setNotificaciones(r.data || []))
      .catch(e => console.error('Error cargando notificaciones:', e))
      .finally(() => setLoadingNotifs(false));
  };

  const handleResendNotif = async (logId: number) => {
    setResendingId(logId);
    try {
      await api.post(`/hotel/notificaciones/${logId}/reenviar`, {});
      alert('Notificación reenviada exitosamente');
      loadNotificaciones();
    } catch (e: any) {
      alert(e?.response?.data?.error?.message || 'Error al reenviar la notificación');
    } finally {
      setResendingId(null);
    }
  };

  const formatNotifDate = (dateStr: string) => {
    if (!dateStr) return '—';
    try {
      const parts = dateStr.split(' ');
      if (parts.length > 0) {
        const d = new Date(dateStr.replace(' ', 'T'));
        return d.toLocaleString('es-PA', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      }
      return dateStr;
    } catch {
      return dateStr;
    }
  };

  const parseResultStatus = (resultadoStr: string) => {
    if (!resultadoStr) {
      return { success: false, text: 'Desconocido', details: { error: 'Sin resultado registrado' } };
    }
    try {
      const parsed = JSON.parse(resultadoStr);
      if (parsed && (parsed.status === 'success' || parsed.success === true || parsed.sent === true)) {
        return { success: true, text: 'Exitoso', details: parsed };
      }
      return { success: false, text: 'Fallido', details: parsed };
    } catch {
      if (resultadoStr.toLowerCase().includes('success') || resultadoStr.toLowerCase().includes('ok')) {
        return { success: true, text: 'Exitoso', details: { raw: resultadoStr } };
      }
      return { success: false, text: 'Fallido', details: { error: resultadoStr } };
    }
  };

  const getNotifTypeLabel = (type: string) => {
    if (!type) return <span className="text-gray-500 font-medium">—</span>;
    const cleanType = type.replace('_reenvio', '');
    const labels: Record<string, string> = {
      confirmacion: 'Confirmación',
      estado: 'Cambio de Estado',
      pago: 'Recibo de Pago',
      recordatorio: 'Recordatorio',
    };
    const isReenvio = type.endsWith('_reenvio');
    return (
      <span className="text-gray-700 font-medium flex items-center gap-1">
        {labels[cleanType] || cleanType}
        {isReenvio && <span className="text-[10px] bg-amber-50 text-amber-600 px-1 py-0.2 rounded border border-amber-100 font-semibold uppercase">Reenvío</span>}
      </span>
    );
  };

  useEffect(() => {
    load();
    loadNotificaciones();
  }, [id]);

  const handleReversal = async (folioId: number, concepto: string) => {
    if (!confirm(`¿Está seguro de que desea reversar el movimiento "${concepto}"? Esta acción creará una contrapartida y es irreversible.`)) {
      return;
    }
    setReversalLoading(folioId);
    try {
      await api.post(`/hotel/reservas/${id}/folio/${folioId}/reversar`, {});
      load();
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || 'Error al reversar el movimiento');
    } finally {
      setReversalLoading(null);
    }
  };

  const handleDeletePago = async (folioId: number, concepto: string) => {
    if (!confirm(`¿Está seguro de que desea eliminar permanentemente el movimiento "${concepto}"? Esta acción recalculará los saldos de la reserva de inmediato.`)) {
      return;
    }
    try {
      await api.delete(`/hotel/reservas/${id}/folio/${folioId}`);
      load();
      alert('Movimiento eliminado exitosamente.');
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || 'Error al eliminar el movimiento');
    }
  };

  const handleDeleteReserva = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deleteMotivo.trim()) {
      alert('Debe especificar un motivo de eliminación');
      return;
    }
    if (!confirm('¿Está seguro de que desea eliminar permanentemente esta reserva? Esta acción no se puede deshacer y borrará todos los registros asociados (pagos, cargos, documentos).')) {
      return;
    }
    setDeleteLoading(true);
    try {
      await api.delete(`/hotel/reservas/${id}`, { motivo: deleteMotivo });
      setShowDeleteModal(false);
      alert('Reserva eliminada exitosamente.');
      navigate('/reservas');
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || 'Error al eliminar la reserva');
    } finally {
      setDeleteLoading(false);
    }
  };

  const changeStatus = async (estado: string) => {
    try {
      await api.patch(`/hotel/reservas/${id}/status`, { estado });
      setConfirmCancel(null);
      load();
    } catch (err: any) { alert(err.message); }
  };

  const handleBatchStatusChange = async (targetEstado: 'Hospedado' | 'Check-Out') => {
    const sourceEstado = targetEstado === 'Hospedado' ? 'Confirmada' : 'Hospedado';
    const eligible = groupReservations.filter((r: any) => r.estado === sourceEstado);
    
    if (eligible.length === 0) {
      alert(`No hay habitaciones elegibles en estado "${sourceEstado}" para realizar esta acción.`);
      return;
    }
    
    if (!confirm(`¿Confirmar Check-${targetEstado === 'Hospedado' ? 'In' : 'Out'} masivo para ${eligible.length} habitación(es) del grupo?`)) {
      return;
    }
    
    setLoading(true);
    try {
      await Promise.all(eligible.map((res: any) => api.patch(`/hotel/reservas/${res.id}/status`, { estado: targetEstado })));
      alert(`Check-${targetEstado === 'Hospedado' ? 'In' : 'Out'} masivo completado con éxito.`);
      load();
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || err.message || 'Error durante el cambio masivo de estado');
      load();
    }
  };

  const submitPago = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pago.monto || parseFloat(pago.monto) === 0) return;
    setPagoLoading(true);
    try {
      await api.post(`/hotel/reservas/${id}/folio`, { ...pago, monto: parseFloat(pago.monto), tipo: 'credito' });
      
      // Sequential upload of voucher if present
      if (pagoFile) {
        const formData = new FormData();
        formData.append('archivo', pagoFile);
        formData.append('tipo', 'recibo');
        formData.append('notas', `Comprobante adjunto al registrar pago/abono de $${parseFloat(pago.monto).toFixed(2)}.`);
        await api.post(`/hotel/reservas/${id}/documentos`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      }

      setPago({ monto: '', concepto: 'Abono', metodo_pago: 'efectivo', referencia: '' });
      setPagoFile(null);
      setShowPago(false);
      load();
    } catch (err: any) { alert(err.message); }
    finally { setPagoLoading(false); }
  };

  const submitPersonaExtra = async (e: React.FormEvent) => {
    e.preventDefault();
    const precioVal = parseFloat(personaExtraForm.precioPorNoche);
    const nochesVal = parseInt(personaExtraForm.noches);

    if (isNaN(precioVal) || precioVal <= 0) {
      alert("El precio por noche debe ser mayor a 0.");
      return;
    }
    if (isNaN(nochesVal) || nochesVal <= 0) {
      alert("Las noches deben ser mayores a 0.");
      return;
    }

    const conceptoTrimmed = personaExtraForm.concepto.trim();
    if (!conceptoTrimmed) {
      alert("Por favor, ingrese el concepto.");
      return;
    }

    const safeRegex = /^[a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s'().-]+$/;
    if (!safeRegex.test(conceptoTrimmed)) {
      alert("El concepto contiene caracteres no válidos.");
      return;
    }

    const montoVal = parseFloat(personaExtraForm.monto);
    if (isNaN(montoVal) || montoVal <= 0) {
      alert("El monto debe ser un número mayor a 0.");
      return;
    }
    setPersonaExtraLoading(true);
    try {
      await api.post(`/hotel/reservas/${id}/folio`, {
        monto: montoVal,
        concepto: conceptoTrimmed,
        tipo: 'debito',
        metodo_pago: null,
        referencia: ''
      });
      // Reset form and close
      const defaultNoches = reserva?.noches === 0 ? 1 : (reserva?.noches || 1);
      setPersonaExtraForm({
        precioPorNoche: '25',
        noches: defaultNoches.toString(),
        monto: (25 * defaultNoches).toString(),
        concepto: `Persona Extra - Cargo al Folio (${defaultNoches} noches)`
      });
      setShowPersonaExtra(false);
      load(true);
    } catch (err: any) {
      alert(err.message || "Error al registrar persona extra");
    } finally {
      setPersonaExtraLoading(false);
    }
  };

  const startEdit = () => {
    setEditForm({
      cliente: reserva.cliente || '',
      apellido: reserva.apellido || '',
      email: reserva.email || '',
      whatsapp: reserva.whatsapp || '',
      telefono: reserva.telefono || '',
      nacionalidad: reserva.nacionalidad || '',
      notas: reserva.notas || '',
      hora_llegada: reserva.hora_llegada || '',
      habitacion_id: reserva.habitacion_id || '',
      tipo_habitacion: reserva.tipo_habitacion || '',
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!isAdmin) {
      setShowEditReservaModal(true);
      return;
    }
    setEditLoading(true);
    const cleanedForm = {
      ...editForm,
      habitacion_id: editForm.habitacion_id ? parseInt(editForm.habitacion_id) : null
    };
    try {
      await api.put(`/hotel/reservas/${id}`, cleanedForm);
      setEditing(false);
      load();
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || err.message || 'Error al guardar los cambios');
    } finally {
      setEditLoading(false);
    }
  };

  const handleRequestEditReserva = async () => {
    if (!justificacionReserva.trim()) {
      alert('La justificación es obligatoria.');
      return;
    }
    setEditLoading(true);
    const cleanedForm = {
      ...editForm,
      habitacion_id: editForm.habitacion_id ? parseInt(editForm.habitacion_id) : null
    };
    try {
      await api.post(`/hotel/reservas/${id}/solicitar-cambio`, {
        tipo_modificacion: 'editar_reserva',
        justificacion: justificacionReserva,
        snapshot_datos: cleanedForm
      });
      setShowEditReservaModal(false);
      setEditing(false);
      setJustificacionReserva('');
      load();
      alert('Solicitud de cambio de reserva enviada exitosamente.');
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || err.message || 'Error al solicitar el cambio');
    } finally {
      setEditLoading(false);
    }
  };

  const startEditPago = (pagoItem: any) => {
    setSelectedPago(pagoItem);
    setNewMonto(pagoItem.monto.toString());
    setNewConcepto(pagoItem.concepto || '');
    setNewMetodoPago(pagoItem.metodo_pago || 'efectivo');
    setNewReferencia(pagoItem.referencia || '');
    setJustificacionPago('');
    setShowEditPagoModal(true);
  };

  const handleRequestEditPago = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMonto || parseFloat(newMonto) === 0) {
      alert('Monto inválido.');
      return;
    }
    if (!isAdmin && !justificacionPago.trim()) {
      alert('La justificación es obligatoria.');
      return;
    }
    setEditPagoLoading(true);
    try {
      if (isAdmin) {
        // Admin edits directly
        await api.put(`/hotel/reservas/${id}/folio/${selectedPago.id}`, {
          monto: parseFloat(newMonto),
          concepto: newConcepto,
          metodo_pago: newMetodoPago,
          referencia: newReferencia
        });
        setShowEditPagoModal(false);
        setSelectedPago(null);
        load();
        alert('Pago modificado exitosamente.');
      } else {
        // Receptionist requests approval
        await api.post(`/hotel/reservas/${id}/solicitar-cambio`, {
          tipo_modificacion: 'editar_pago',
          transaccion_original_id: selectedPago.id,
          justificacion: justificacionPago,
          snapshot_datos: {
            monto: parseFloat(newMonto),
            concepto: newConcepto,
            metodo_pago: newMetodoPago,
            referencia: newReferencia
          }
        });
        setShowEditPagoModal(false);
        setSelectedPago(null);
        setJustificacionPago('');
        load();
        alert('Solicitud de cambio de pago enviada exitosamente.');
      }
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || err.message || 'Error al modificar el pago');
    } finally {
      setEditPagoLoading(false);
    }
  };

  if (loading) return <div className="animate-pulse text-gray-400 p-8">Cargando...</div>;
  if (!reserva) return <div className="p-8 text-red-500">Reserva no encontrada</div>;

  const reservaRoom = rooms.find(r => r.id === reserva.habitacion_id);
  const reservaCategory = reservaRoom?.categoria || (rooms.find(r => r.tipo === reserva.tipo_habitacion)?.categoria) || 'Estadía';

  const isClosed = ['Cancelada', 'No-Show'].includes(reserva.estado);
  const totalPagado = reserva.monto_pagado || 0;
  const totalReserva = reserva.monto_total || 0;
  const saldoPct = totalReserva > 0 ? (totalPagado / totalReserva) * 100 : 0;

  const isConsolidated = groupReservations.some((r: any) => r.facturacion_consolidada === 1);

  let consolidatedTotal = 0;
  let consolidatedPaid = 0;
  let consolidatedPending = 0;

  if (isConsolidated) {
    const masterRes = groupReservations.find((r: any) => r.es_maestra === 1);
    consolidatedTotal = masterRes ? (masterRes.monto_total || 0) : 0;
    consolidatedPaid = masterRes ? (masterRes.monto_pagado || 0) : 0;
    consolidatedPending = masterRes ? (masterRes.saldo_pendiente || 0) : 0;
  } else {
    consolidatedTotal = groupReservations.reduce((sum, r) => sum + (r.monto_total || 0), 0);
    consolidatedPaid = groupReservations.reduce((sum, r) => sum + (r.monto_pagado || 0), 0);
    consolidatedPending = groupReservations.reduce((sum, r) => sum + (r.saldo_pendiente || 0), 0);
  }

  return (
    <div className="max-w-5xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"><ArrowLeft size={16} /> Volver</button>

      {reserva.grupo_codigo && (
        <div className="bg-white rounded-xl p-5 shadow-sm mb-4 border border-mahana-200">
          <div className="flex flex-wrap items-center justify-between border-b border-gray-100 pb-3 mb-4 gap-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl">👥</span>
              <div>
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  Panel de Grupo: <span className="text-mahana-600 font-mono">{reserva.grupo_codigo}</span>
                </h2>
                <div className="flex gap-2 mt-1">
                  {reserva.es_maestra === 1 ? (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 flex items-center gap-1">
                      👑 Reserva Maestra
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 flex items-center gap-1">
                      🔗 Reserva Hija
                    </span>
                  )}
                  {reserva.facturacion_consolidada === 1 ? (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                      🧾 Facturación Consolidada
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
                      Cuentas Separadas
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {reserva.es_maestra !== 1 && reserva.parent_reserva_id && (
                <button
                  onClick={() => navigate(`/reservas/${reserva.parent_reserva_id}`)}
                  className="px-3 py-1.5 bg-purple-50 text-purple-700 text-xs font-bold rounded-lg border border-purple-200 hover:bg-purple-100 transition flex items-center gap-1"
                >
                  👑 Ir a Reserva Maestra
                </button>
              )}
              {/* Batch Check-In */}
              <button
                onClick={() => handleBatchStatusChange('Hospedado')}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-lg transition"
              >
                📥 Check-In Grupo
              </button>
              {/* Batch Check-Out */}
              <button
                onClick={() => handleBatchStatusChange('Check-Out')}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg transition"
              >
                📤 Check-Out Grupo
              </button>
            </div>
          </div>

          {/* Consolidated accounting metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 bg-gray-50 rounded-xl p-4">
            <div className="text-center">
              <span className="block text-xs font-medium text-gray-400 uppercase">Total Consolidado</span>
              <span className="text-lg font-extrabold text-gray-800 mt-1 block">
                ${consolidatedTotal.toFixed(2)}
              </span>
            </div>
            <div className="text-center border-t md:border-t-0 md:border-x border-gray-200 py-2 md:py-0">
              <span className="block text-xs font-medium text-gray-400 uppercase">Total Pagado</span>
              <span className="text-lg font-extrabold text-green-600 mt-1 block">
                ${consolidatedPaid.toFixed(2)}
              </span>
            </div>
            <div className="text-center">
              <span className="block text-xs font-medium text-gray-400 uppercase">Saldo Pendiente</span>
              <span className={`text-lg font-extrabold mt-1 block ${consolidatedPending > 0 ? 'text-red-650' : 'text-green-600'}`}>
                ${consolidatedPending.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Rooms List */}
          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase mb-2 tracking-wider">Habitaciones del Grupo ({groupReservations.length})</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-gray-100 text-gray-600 uppercase text-[10px]">
                  <tr>
                    <th className="py-2 px-3 rounded-l-lg">Habitación</th>
                    <th className="py-2 px-3">Cliente</th>
                    <th className="py-2 px-3">Fechas</th>
                    <th className="py-2 px-3 text-center">Huéspedes</th>
                    <th className="py-2 px-3">Estado</th>
                    <th className="py-2 px-3 text-right">Monto</th>
                    <th className="py-2 px-3 text-right rounded-r-lg">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {groupReservations.map((r: any) => {
                    const totalGuests = (r.adultos || 1) + (r.menores || 0) + (r.mascotas || 0);
                    const isSelf = r.id === reserva.id;
                    return (
                      <tr key={r.id} className={`hover:bg-gray-50/50 ${isSelf ? 'bg-mahana-50/30 font-semibold' : ''}`}>
                        <td className="py-2.5 px-3">
                          {r.habitacion_nombre || (r.habitacion && r.habitacion.nombre) || r.tipo_habitacion}
                        </td>
                        <td className="py-2.5 px-3 truncate max-w-[120px]" title={`${r.cliente} ${r.apellido || ''}`}>
                          {r.cliente} {r.apellido || ''}
                        </td>
                        <td className="py-2.5 px-3 text-gray-500">
                          {r.check_in} a {r.check_out}
                        </td>
                        <td className="py-2.5 px-3 text-center text-gray-500">
                          {r.adultos}A {r.menores > 0 ? `+ ${r.menores}M` : ''}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${estadoColor[r.estado] || 'bg-gray-100'}`}>
                            {r.estado}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {reserva.facturacion_consolidada === 1 && r.es_maestra === 0 ? (
                            <span className="text-gray-400 italic text-[10px]">Consolidado</span>
                          ) : (
                            `$${(r.monto_total || 0).toFixed(2)}`
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {isSelf ? (
                            <span className="text-gray-400 italic text-[10px] pr-2">Actual</span>
                          ) : (
                            <button
                              onClick={() => navigate(`/reservas/${r.id}`)}
                              className="px-2 py-1 bg-ocean-50 text-ocean-700 hover:bg-ocean-100 font-bold rounded transition text-[10px]"
                            >
                              Ver Ficha
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {reserva.estado === 'Cambio Pendiente de Aprobación' && (
        <div className="bg-orange-50 border-l-4 border-orange-500 p-4 mb-4 rounded-xl flex items-center gap-3 shadow-sm">
          <span className="text-orange-500 text-xl flex-shrink-0">⚠️</span>
          <div>
            <p className="font-bold text-orange-850 text-sm">Cambio Pendiente de Aprobación</p>
            <p className="text-xs text-orange-700">Esta reserva tiene una solicitud de cambio registrada. La edición y transiciones de estado están inhabilitadas hasta que un administrador autorice o rechace la solicitud.</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white rounded-xl p-5 shadow-sm mb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">
              {reserva.cliente} {reserva.apellido || ''}
              <span className="text-lg text-mahana-500 ml-2">{reserva.plan_nombre}</span>
            </h1>
            <div className="flex flex-wrap gap-4 mt-2 text-sm text-gray-500">
              <span>📅 {reserva.check_in} → {reserva.check_out}</span>
              <span>🌙 {reserva.noches} noches</span>
              <span>👥 {reserva.adultos}A {reserva.menores > 0 ? `+ ${reserva.menores}M` : ''} {reserva.mascotas > 0 ? `+ ${reserva.mascotas}🐾` : ''}</span>
              <span>📞 {reserva.fuente}</span>
              {reserva.habitacion && <span>🛏️ {reserva.habitacion.nombre} ({reserva.habitacion.tipo})</span>}
              {reserva.hora_llegada && <span>⏰ {reserva.hora_llegada}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${estadoColor[reserva.estado] || 'bg-gray-100'}`}>{reserva.estado}</span>
            {/* Status Progression: Pendiente → Confirmada → Hospedado → Check-Out (terminal) */}
            {reserva.estado === 'Pendiente' && (
              <button onClick={() => changeStatus('Confirmada')} className="px-4 py-2 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 transition">Confirmar</button>
            )}
            {reserva.estado === 'Confirmada' && (
              <>
                <button onClick={() => changeStatus('Hospedado')} className="px-4 py-2 bg-green-500 text-white text-sm rounded-lg hover:bg-green-600 transition">Check-In</button>
                <button onClick={() => changeStatus('Pendiente')} className="px-3 py-2 text-gray-400 hover:text-gray-600 text-xs rounded-lg hover:bg-gray-100 transition">↩ Pendiente</button>
              </>
            )}
            {reserva.estado === 'Hospedado' && (
              <button onClick={() => changeStatus('Check-Out')} className="px-4 py-2 bg-amber-500 text-white text-sm rounded-lg hover:bg-amber-600 transition">Check-Out</button>
            )}
            {/* Check-Out = terminal, no going back */}
            {reserva.estado === 'Check-Out' && (
              <span className="text-xs text-gray-400 italic">Estado final</span>
            )}
            {/* Cancel/No-Show — only if not already closed and not checked-out */}
            {!isClosed && reserva.estado !== 'Check-Out' && reserva.estado !== 'Cambio Pendiente de Aprobación' && (
              <div className="relative">
                <button onClick={() => setConfirmCancel(confirmCancel ? null : 'menu')}
                  className="px-3 py-2 text-gray-400 hover:text-red-500 text-sm rounded-lg hover:bg-red-50 transition">⋯</button>
                {confirmCancel && (
                  <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 w-48">
                    {confirmCancel === 'menu' ? (
                      <>
                        <button onClick={() => setConfirmCancel('Cancelada')} className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 transition">Cancelar Reserva</button>
                        <button onClick={() => setConfirmCancel('No-Show')} className="w-full px-4 py-2.5 text-left text-sm text-orange-600 hover:bg-orange-50 transition">Marcar No-Show</button>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => { setConfirmCancel(null); setShowDeleteModal(true); }}
                            className="w-full px-4 py-2.5 text-left text-sm text-red-700 font-bold hover:bg-red-100 transition border-t border-gray-100"
                          >
                            🗑️ Eliminar de Registros
                          </button>
                        )}
                      </>
                    ) : (
                      <div className="p-3">
                        <div className="text-sm font-medium text-gray-700 mb-2">¿Confirmar {confirmCancel}?</div>
                        <div className="flex gap-2">
                          <button onClick={() => changeStatus(confirmCancel)} className="px-3 py-1.5 bg-red-500 text-white text-xs rounded-lg">Sí</button>
                          <button onClick={() => setConfirmCancel(null)} className="px-3 py-1.5 bg-gray-100 text-xs rounded-lg">No</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* Cancelada/No-Show = terminal */}
            {isClosed && (
              <span className="text-xs text-red-400 italic">Estado final</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-4">
          {/* Contact */}
          <div className="bg-white rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-700">Datos del Huésped</h3>
              {!editing && !isClosed && reserva.estado !== 'Cambio Pendiente de Aprobación' && (
                <button onClick={startEdit} className="text-sm text-ocean-600 hover:text-ocean-700 flex items-center gap-1"><Edit2 size={14} /> Editar</button>
              )}
            </div>
            {editing ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs text-gray-500">Nombre</label><input value={editForm.cliente} onChange={e => setEditForm((f: any) => ({ ...f, cliente: e.target.value }))} className="input" /></div>
                  <div><label className="text-xs text-gray-500">Apellido</label><input value={editForm.apellido} onChange={e => setEditForm((f: any) => ({ ...f, apellido: e.target.value }))} className="input" /></div>
                  <div><label className="text-xs text-gray-500">Email</label><input value={editForm.email} onChange={e => setEditForm((f: any) => ({ ...f, email: e.target.value }))} className="input" /></div>
                  <div><label className="text-xs text-gray-500">WhatsApp</label><input value={editForm.whatsapp} onChange={e => setEditForm((f: any) => ({ ...f, whatsapp: e.target.value }))} className="input" /></div>
                  <div><label className="text-xs text-gray-500">Teléfono</label><input value={editForm.telefono} onChange={e => setEditForm((f: any) => ({ ...f, telefono: e.target.value }))} className="input" /></div>
                  <div><label className="text-xs text-gray-500">Nacionalidad</label><input value={editForm.nacionalidad} onChange={e => setEditForm((f: any) => ({ ...f, nacionalidad: e.target.value }))} className="input" /></div>
                  <div className="col-span-2">
                    <label className="text-xs font-semibold text-gray-500 block mb-1">Reasignar Habitación / Bohío (Categoría: {reservaCategory})</label>
                    <select
                      value={editForm.habitacion_id || ''}
                      onChange={e => {
                        const val = e.target.value;
                        const roomId = val ? parseInt(val) : null;
                        const selectedRoom = rooms.find(r => r.id === roomId);
                        setEditForm((f: any) => ({
                          ...f,
                          habitacion_id: roomId,
                          tipo_habitacion: selectedRoom ? selectedRoom.tipo : f.tipo_habitacion
                        }));
                      }}
                      className="input w-full select py-2 font-medium"
                    >
                      <option value="">Por asignar / Sin habitación</option>
                      {availableRooms
                        .filter(room => {
                          const isCurrentRoom = room.id === reserva.habitacion_id;
                          return room.activa === 1 && room.categoria === reservaCategory && (room.disponible || isCurrentRoom);
                        })
                        .map(room => (
                          <option key={room.id} value={room.id}>
                            {room.nombre} — {room.tipo} ({room.categoria})
                          </option>
                        ))
                      }
                    </select>
                  </div>
                </div>
                <div><label className="text-xs text-gray-500">Notas</label><textarea value={editForm.notas} onChange={e => setEditForm((f: any) => ({ ...f, notas: e.target.value }))} className="input min-h-[60px]" /></div>
                <div className="flex gap-2">
                  <button onClick={saveEdit} disabled={editLoading} className="px-4 py-2 bg-ocean-500 text-white text-sm rounded-lg hover:bg-ocean-600 flex items-center gap-1 disabled:opacity-50"><Check size={14} /> {editLoading ? 'Guardando...' : 'Guardar'}</button>
                  <button onClick={() => setEditing(false)} className="px-4 py-2 text-gray-500 text-sm flex items-center gap-1"><X size={14} /> Cancelar</button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-gray-400">Email:</span> {reserva.email || '-'}</div>
                  <div><span className="text-gray-400">WhatsApp:</span> {reserva.whatsapp || '-'}</div>
                  <div><span className="text-gray-400">Teléfono:</span> {reserva.telefono || '-'}</div>
                  <div><span className="text-gray-400">Nacionalidad:</span> {reserva.nacionalidad || '-'}</div>
                </div>
                {reserva.notas && <div className="mt-3 text-sm bg-gray-50 p-3 rounded-lg text-gray-600">{reserva.notas}</div>}
              </>
            )}
          </div>

          {/* Folio */}
          <div className="bg-white rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-700 font-sans">Resumen de Cuenta (Folio)</h3>
              {!isClosed && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPersonaExtra(!showPersonaExtra)}
                    className="flex items-center gap-1 text-sm text-purple-700 bg-purple-100/60 hover:bg-purple-200/60 backdrop-blur-sm px-3 py-1.5 rounded-xl border border-purple-200/50 transition font-medium shadow-sm font-sans"
                  >
                    ➕ Persona Extra
                  </button>
                  <button onClick={() => setShowPago(!showPago)} className="flex items-center gap-1 text-sm text-ocean-600 hover:text-ocean-700 font-sans font-medium">
                    <Plus size={16} /> Registrar Pago
                  </button>
                </div>
              )}
            </div>

            {showPago && (
              <form onSubmit={submitPago} className="bg-ocean-50 rounded-lg p-4 mb-4 space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-start">
                  <div>
                    <label className="text-xs text-gray-500">Monto *</label>
                    <input type="number" step="0.01" value={pago.monto} onChange={e => setPago(p => ({ ...p, monto: e.target.value }))} required className="input" placeholder="0.00" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Concepto</label>
                    <input value={pago.concepto} onChange={e => setPago(p => ({ ...p, concepto: e.target.value }))} className="input" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Método</label>
                    <select value={pago.metodo_pago} onChange={e => setPago(p => ({ ...p, metodo_pago: e.target.value }))} className="input">
                      <option value="efectivo">Efectivo</option>
                      <option value="transferencia">Transferencia</option>
                      <option value="yappy">Yappy</option>
                      <option value="tarjeta">Tarjeta (POS)</option>
                      <option value="tarjeta_credito">Tarjeta de Crédito</option>
                      <option value="paypal">PayPal</option>
                      <option value="al_cobro">Al Cobro (CXC)</option>
                      <option value="cuponera_oferta_simple">Oferta Simple (Cupón)</option>
                      <option value="cuponera_pahoy">PaHoy (Cupón)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Referencia</label>
                    <input value={pago.referencia} onChange={e => setPago(p => ({ ...p, referencia: e.target.value }))} className="input" placeholder="#" />
                  </div>

                  {/* Upload receipt container inside Registrar Pago form */}
                  {(pago.metodo_pago === 'transferencia' || pago.metodo_pago === 'yappy' || pago.metodo_pago === 'efectivo' || pago.metodo_pago.startsWith('cuponera_') || pago.metodo_pago === 'al_cobro') && parseFloat(pago.monto) !== 0 && (
                    <div className="col-span-2 md:col-span-4 mt-1">
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">📸 Adjuntar Comprobante de Pago (Opcional)</label>
                      <div
                        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setPagoDragActive(true); }}
                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setPagoDragActive(true); }}
                        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setPagoDragActive(false); }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setPagoDragActive(false);
                          if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                            const file = e.dataTransfer.files[0];
                            const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
                            if (allowed.includes(file.type)) {
                              setPagoFile(file);
                            } else {
                              alert('Solo se permiten imágenes JPG, PNG, WebP o archivos PDF.');
                            }
                          }
                        }}
                        className={`border border-dashed rounded-lg p-4 text-center transition relative overflow-hidden flex flex-col items-center justify-center min-h-[100px] bg-white/60 ${
                          pagoDragActive ? 'border-ocean-500 bg-ocean-50/20' : 'border-gray-300 hover:border-ocean-400'
                        }`}
                      >
                        <input
                          type="file"
                          id="pago-file-input"
                          accept=".jpg,.jpeg,.png,.webp,.pdf"
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              setPagoFile(e.target.files[0]);
                            }
                          }}
                        />
                        {!pagoFile ? (
                          <div className="flex flex-col items-center justify-center space-y-1 pointer-events-none">
                            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                            <div className="text-xs">
                              <span className="font-semibold text-ocean-600 hover:underline">Selecciona comprobante</span>
                              <span className="text-gray-500"> o arrastra aquí</span>
                            </div>
                            <p className="text-[10px] text-gray-400">PNG, JPG, WebP o PDF hasta 10MB</p>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center w-full space-y-2 z-20">
                            {pagoPreviewUrl ? (
                              <div className="relative w-16 h-16 rounded overflow-hidden border border-gray-200 bg-white">
                                <img src={pagoPreviewUrl} alt="Comprobante" className="w-full h-full object-cover" />
                              </div>
                            ) : (
                              <div className="w-8 h-8 rounded bg-white border border-gray-100 flex items-center justify-center text-red-500 shadow-sm font-bold text-[10px] uppercase">
                                {pagoFile.name.split('.').pop()}
                              </div>
                            )}
                            <div className="text-center">
                              <p className="text-xs font-semibold text-gray-700 truncate max-w-xs">{pagoFile.name}</p>
                              <p className="text-[10px] text-gray-400">{(pagoFile.size / 1024 / 1024).toFixed(2)} MB</p>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPagoFile(null); }}
                              className="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded text-[10px] font-semibold transition"
                            >
                              Remover
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 flex-col md:flex-row md:items-center">
                  {(pago.metodo_pago === 'paypal' || pago.metodo_pago === 'tarjeta_credito') && parseFloat(pago.monto) > 0 ? (
                    paypalConfig.paypal_enabled && paypalConfig.paypal_client_id ? (
                      <div className="max-w-xs w-full mt-2">
                        <OnlinePaymentsDisabled
                          clientId={paypalConfig.paypal_client_id}
                          mode={paypalConfig.paypal_mode}
                          monto={parseFloat(pago.monto)}
                          descripcion={`Hotel Panamá Canal - Pago folio reserva #${id}`}
                          onSuccess={async (orderId) => {
                            setPagoLoading(true);
                            try {
                              await api.post(`/hotel/reservas/${id}/folio`, {
                                monto: parseFloat(pago.monto),
                                concepto: pago.concepto || 'Abono online (PayPal)',
                                tipo: 'credito',
                                metodo_pago: pago.metodo_pago,
                                referencia: orderId
                              });
                              setPago({ monto: '', concepto: 'Abono', metodo_pago: 'efectivo', referencia: '' });
                              setPagoFile(null);
                              setShowPago(false);
                              load();
                            } catch (err: any) {
                              alert(err.message || 'Error registrando el pago');
                            } finally {
                              setPagoLoading(false);
                            }
                          }}
                          onError={(msg) => alert(msg)}
                        />
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500 bg-gray-100 p-2 rounded-lg">
                        Pagos online por configurar. No hay una pasarela conectada.
                      </div>
                    )
                  ) : (
                    <button type="submit" disabled={pagoLoading} className="px-4 py-2 bg-ocean-500 text-white rounded-lg text-sm hover:bg-ocean-600 disabled:opacity-50">
                      {pagoLoading ? 'Guardando...' : 'Guardar Pago'}
                    </button>
                  )}
                  <button type="button" onClick={() => { setShowPago(false); setPagoFile(null); }} className="px-4 py-2 text-gray-500 text-sm">Cancelar</button>
                </div>
              </form>
            )}

            {showPersonaExtra && (
              <form onSubmit={submitPersonaExtra} className="bg-purple-50 border border-purple-200 rounded-xl p-4 mb-4 space-y-3">
                <div className="flex items-center gap-2 text-purple-800 font-bold text-sm mb-1 font-sans">
                  <span>➕ Registrar Persona Extra</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="md:col-span-2">
                    <label className="text-xs text-purple-700 font-medium font-sans">Concepto *</label>
                    <input
                      type="text"
                      value={personaExtraForm.concepto}
                      onChange={e => setPersonaExtraForm(p => ({ ...p, concepto: e.target.value }))}
                      required
                      className="input bg-white border-purple-200 focus:border-purple-400 focus:ring-purple-200 w-full font-sans"
                      placeholder="Concepto de cargo"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-purple-700 font-medium font-sans">Precio por noche *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={personaExtraForm.precioPorNoche}
                      onChange={e => setPersonaExtraForm(p => ({ ...p, precioPorNoche: e.target.value }))}
                      required
                      className="input bg-white border-purple-200 focus:border-purple-400 focus:ring-purple-200 w-full"
                      placeholder="25.00"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-purple-700 font-medium font-sans">Noches *</label>
                    <input
                      type="number"
                      min="0"
                      value={personaExtraForm.noches}
                      onChange={e => setPersonaExtraForm(p => ({ ...p, noches: e.target.value }))}
                      required
                      className="input bg-white border-purple-200 focus:border-purple-400 focus:ring-purple-200 w-full"
                      placeholder="1"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs text-purple-700 font-medium font-sans">Monto Total *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={personaExtraForm.monto}
                      onChange={e => setPersonaExtraForm(p => ({ ...p, monto: e.target.value }))}
                      required
                      className="input bg-white border-purple-200 focus:border-purple-400 focus:ring-purple-200 w-full font-mono font-bold"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="flex gap-2 justify-end">
                  <button
                    type="submit"
                    disabled={personaExtraLoading}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm transition disabled:opacity-50 font-medium shadow-sm shadow-purple-100 font-sans"
                  >
                    {personaExtraLoading ? 'Cargando...' : 'Cargar Cargo'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPersonaExtra(false);
                      const defaultNoches = reserva?.noches === 0 ? 1 : (reserva?.noches || 1);
                      setPersonaExtraForm({
                        precioPorNoche: '25',
                        noches: defaultNoches.toString(),
                        monto: (25 * defaultNoches).toString(),
                        concepto: `Persona Extra - Cargo al Folio (${defaultNoches} noches)`
                      });
                    }}
                    className="px-4 py-2 text-purple-700 hover:text-purple-900 hover:bg-purple-100/50 rounded-lg text-sm transition font-sans"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}

            {(reserva.folio || []).length === 0 ? (
              <div className="text-center text-gray-400 text-sm py-4">Sin movimientos</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-gray-500 text-xs uppercase border-b">
                  <tr>
                    <th className="py-2 text-left">Fecha</th>
                    <th className="py-2 text-left">Concepto</th>
                    <th className="py-2 text-left">Método</th>
                    <th className="py-2 text-right">Débito</th>
                    <th className="py-2 text-right">Crédito</th>
                    <th className="py-2 text-center w-48">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[...(reserva.folio || [])].sort((a: any, b: any) => a.id - b.id).map((f: any) => {
                    const isReversal = f.concepto && (f.concepto.startsWith('Reversión de pago [ID ') || f.concepto.startsWith('Reversión de cargo [ID '));
                    const alreadyReversed = (reserva.folio || []).some((other: any) => other.concepto && other.concepto.includes(`[ID ${f.id}]`));
                    return (
                      <tr key={f.id} className={f.tipo === 'credito' ? 'bg-green-50/30' : ''}>
                        <td className="py-2 text-gray-400">{f.fecha}</td>
                        <td className="py-2">
                          <span className={isReversal ? 'text-gray-400 italic' : ''}>{f.concepto}</span>
                        </td>
                        <td className="py-2 text-gray-400">{f.metodo_pago || '-'}</td>
                        <td className="py-2 text-right text-red-500 font-medium">{f.tipo === 'debito' ? `$${f.monto.toFixed(2)}` : ''}</td>
                        <td className="py-2 text-right text-green-600 font-medium">{f.tipo === 'credito' ? `$${f.monto.toFixed(2)}` : ''}</td>
                        <td className="py-2 text-center">
                          {isAdmin ? (
                            <div className="flex gap-1 justify-center">
                              {!isReversal && !alreadyReversed ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => startEditPago(f)}
                                    className="px-2 py-1 text-[11px] font-bold bg-ocean-100 hover:bg-ocean-200 text-ocean-700 rounded-lg transition"
                                  >
                                    Editar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeletePago(f.id, f.concepto)}
                                    className="px-2 py-1 text-[11px] font-bold bg-red-100 hover:bg-red-200 text-red-700 rounded-lg transition"
                                  >
                                    Eliminar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleReversal(f.id, f.concepto)}
                                    disabled={reversalLoading !== null}
                                    className="px-2 py-1 text-[11px] font-bold bg-amber-100 hover:bg-amber-250 text-amber-800 rounded-lg transition disabled:opacity-50"
                                  >
                                    {reversalLoading === f.id ? '...' : 'Reversar'}
                                  </button>
                                </>
                              ) : alreadyReversed ? (
                                <span className="text-[10px] text-gray-400 font-semibold italic">Reversado</span>
                              ) : (
                                <span className="text-[10px] text-gray-400 italic">-</span>
                              )}
                            </div>
                          ) : (
                            <>
                              {f.tipo === 'credito' && !isReversal && !alreadyReversed && reserva.estado !== 'Cambio Pendiente de Aprobación' ? (
                                <button
                                  type="button"
                                  onClick={() => startEditPago(f)}
                                  className="px-2 py-1 text-[11px] font-bold bg-ocean-100 hover:bg-ocean-200 text-ocean-700 rounded-lg transition"
                                >
                                  Editar
                                </button>
                              ) : alreadyReversed ? (
                                <span className="text-[10px] text-gray-400 font-semibold italic">Reversado</span>
                              ) : (
                                <span className="text-[10px] text-gray-400 italic">-</span>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t-2 border-gray-300">
                  <tr className="font-bold">
                    <td className="py-2" colSpan={3}>TOTAL</td>
                    <td className="py-2 text-right text-red-600">
                      ${[...(reserva.folio || [])].filter((f: any) => f.tipo === 'debito').reduce((s: number, f: any) => s + f.monto, 0).toFixed(2)}
                    </td>
                    <td className="py-2 text-right text-green-600">
                      ${[...(reserva.folio || [])].filter((f: any) => f.tipo === 'credito').reduce((s: number, f: any) => s + f.monto, 0).toFixed(2)}
                    </td>
                    <td className="py-2" />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>

          {/* Documents Section */}
          <div className="bg-white rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-700">📎 Documentos</h3>
              {!isClosed && (
                <button onClick={() => setShowUpload(!showUpload)} className="text-sm text-ocean-600 hover:text-ocean-700 flex items-center gap-1">
                  <Upload size={14} /> Subir
                </button>
              )}
            </div>

            {/* Upload Form */}
            {showUpload && (
              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <div>
                    <label className="text-xs text-gray-500">Tipo de documento</label>
                    <select value={uploadTipo} onChange={e => setUploadTipo(e.target.value)} className="input">
                      <option value="cedula">Cédula / ID</option>
                      <option value="pasaporte">Pasaporte</option>
                      <option value="recibo">Recibo de pago</option>
                      <option value="otro">Otro</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Archivo (JPEG, PNG, PDF)</label>
                    <input type="file" accept="image/*,.pdf" onChange={e => setUploadFile(e.target.files?.[0] || null)}
                      className="text-sm w-full file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-ocean-50 file:text-ocean-600 file:font-medium hover:file:bg-ocean-100 file:cursor-pointer" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Notas (opcional)</label>
                    <input value={uploadNotas} onChange={e => setUploadNotas(e.target.value)} className="input" placeholder="Referencia..." />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button disabled={!uploadFile || uploading} onClick={async () => {
                    if (!uploadFile) return;
                    setUploading(true);
                    try {
                      const fd = new FormData();
                      fd.append('archivo', uploadFile);
                      fd.append('tipo', uploadTipo);
                      fd.append('notas', uploadNotas);
                      await api.post(`/hotel/reservas/${id}/documentos`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
                      setShowUpload(false); setUploadFile(null); setUploadNotas('');
                      load();
                    } catch (e: any) { alert(e?.response?.data?.error?.message || 'Error subiendo'); }
                    finally { setUploading(false); }
                  }} className="px-4 py-2 bg-ocean-500 text-white text-sm rounded-lg hover:bg-ocean-600 disabled:opacity-50 flex items-center gap-1">
                    <Upload size={14} /> {uploading ? 'Subiendo...' : 'Subir'}
                  </button>
                  <button onClick={() => { setShowUpload(false); setUploadFile(null); }} className="px-4 py-2 text-gray-500 text-sm">Cancelar</button>
                </div>
              </div>
            )}

            {/* Document Grid */}
            {(reserva.documentos || []).length === 0 && !showUpload ? (
              <div className="text-center text-gray-400 text-sm py-4">Sin documentos adjuntos</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {(reserva.documentos || []).map((doc: any) => {
                  const isImage = doc.mime_type?.startsWith('image/');
                  const tipoLabel = doc.tipo === 'cedula' ? '🪪 Cédula' : doc.tipo === 'pasaporte' ? '📘 Pasaporte' : doc.tipo === 'recibo' ? '🧾 Recibo' : '📄 Otro';
                  const docUrl = '#';
                  const downloadDoc = (e: React.MouseEvent) => { e.preventDefault(); void downloadGuestDocument(doc.id, doc.nombre_original); };
                  return (
                    <div key={doc.id} className="flex items-center gap-3 p-2 rounded-lg border border-gray-100 hover:bg-gray-50">
                      <a href={docUrl} onClick={downloadDoc}
                        className="flex-shrink-0 w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden text-gray-400 hover:text-ocean-500">
                        {isImage ? (
                          <Image size={20} />
                        ) : (
                          <FileText size={20} />
                        )}
                      </a>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-700 truncate">{tipoLabel}</div>
                        <div className="text-xs text-gray-400 truncate">{doc.nombre_original}</div>
                        {doc.notas && <div className="text-xs text-gray-400">{doc.notas}</div>}
                        <div className="text-xs text-gray-300">{doc.created_at?.split('T')[0]}</div>
                      </div>
                      <a href={docUrl} onClick={downloadDoc} className="text-ocean-400 hover:text-ocean-600 flex-shrink-0 mr-1" title="Abrir">
                        <Image size={14} />
                      </a>
                      <button onClick={async () => {
                        if (!confirm('¿Eliminar este documento?')) return;
                        await api.delete(`/hotel/documentos/${doc.id}`);
                        load();
                      }} className="text-gray-300 hover:text-red-500 flex-shrink-0" title="Eliminar">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section: Historial de Notificaciones */}
          <div className="bg-white rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="font-bold text-gray-700 flex items-center gap-2">
                <Mail size={18} className="text-ocean-600" /> Historial de Notificaciones
              </h3>
              <button
                onClick={loadNotificaciones}
                className="p-1.5 text-gray-400 hover:text-ocean-600 hover:bg-gray-50 border border-gray-100 rounded-lg transition"
                title="Refrescar notificaciones"
              >
                <RefreshCw size={14} className={loadingNotifs ? 'animate-spin' : ''} />
              </button>
            </div>

            {loadingNotifs ? (
              <div className="text-center text-gray-400 text-sm py-8 animate-pulse">Cargando historial de notificaciones...</div>
            ) : notificaciones.length === 0 ? (
              <div className="text-center text-gray-400 text-sm py-8">No se han enviado notificaciones para esta reserva</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50/50 text-gray-400 font-semibold border-b border-gray-100 text-left">
                      <th className="py-2.5 px-3">Fecha</th>
                      <th className="py-2.5 px-3">Canal</th>
                      <th className="py-2.5 px-3">Destinatario</th>
                      <th className="py-2.5 px-3">Plantilla</th>
                      <th className="py-2.5 px-3 text-center">Estado</th>
                      <th className="py-2.5 px-3 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {notificaciones.map((log: any) => {
                      const statusInfo = parseResultStatus(log.resultado);
                      return (
                        <tr key={log.id} className="hover:bg-gray-50/30 transition text-xs">
                          <td className="py-3 px-3 text-gray-500 whitespace-nowrap">
                            <span className="flex items-center gap-1">
                              <Calendar size={12} className="text-gray-400" />
                              {formatNotifDate(log.created_at)}
                            </span>
                          </td>
                          <td className="py-3 px-3">
                            {log.canal === 'email' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 font-medium">
                                <Mail size={12} /> Email
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-green-50 text-green-600 border border-green-100 font-medium">
                                <Phone size={12} /> WhatsApp
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 font-medium text-gray-700 max-w-[150px] truncate" title={log.destinatario}>
                            {log.destinatario || '—'}
                          </td>
                          <td className="py-3 px-3 text-gray-600">
                            {getNotifTypeLabel(log.tipo)}
                          </td>
                          <td className="py-3 px-3 text-center">
                            <button
                              onClick={() => {
                                if (!statusInfo.success) {
                                  alert(JSON.stringify(statusInfo.details, null, 2));
                                }
                              }}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold ${
                                statusInfo.success
                                  ? 'bg-green-50 text-green-700 border border-green-100'
                                  : 'bg-red-50 text-red-700 border border-red-100 cursor-pointer hover:bg-red-100/50'
                              }`}
                              title={!statusInfo.success ? 'Haga clic para ver detalles del error' : undefined}
                            >
                              {statusInfo.success ? (
                                <>
                                  <CheckCircle2 size={12} /> Entregado
                                </>
                              ) : (
                                <>
                                  <XCircle size={12} /> Fallido
                                </>
                              )}
                            </button>
                          </td>
                          <td className="py-3 px-3 text-right whitespace-nowrap">
                            <div className="flex justify-end gap-1.5">
                              <button
                                onClick={() => setSelectedNotifForView(log)}
                                className="p-1.5 text-gray-400 hover:text-ocean-600 hover:bg-ocean-50 rounded-lg transition"
                                title="Ver mensaje enviado"
                              >
                                <Eye size={14} />
                              </button>
                              <button
                                onClick={() => handleResendNotif(log.id)}
                                disabled={resendingId !== null || !log.contenido}
                                className={`p-1.5 rounded-lg transition ${
                                  !log.contenido
                                    ? 'text-gray-200 cursor-not-allowed bg-transparent'
                                    : 'text-gray-400 hover:text-green-600 hover:bg-green-50'
                                }`}
                                title={!log.contenido ? 'Registro histórico sin contenido guardado' : 'Reenviar esta notificación'}
                              >
                                <RefreshCw size={14} className={resendingId === log.id ? 'animate-spin' : ''} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        {/* Sidebar - Totals */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold text-gray-700 mb-4">Total</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-400">Subtotal</span><span>${reserva.subtotal?.toFixed(2)}</span></div>
              {reserva.productos_adicionales > 0 && <div className="flex justify-between"><span className="text-gray-400">Productos adicionales</span><span>${reserva.productos_adicionales?.toFixed(2)}</span></div>}
              <div className="flex justify-between"><span className="text-gray-400">Impuesto Turismo {reserva.impuesto_pct}%</span><span>${reserva.impuesto_monto?.toFixed(2)}</span></div>
              <hr />
              <div className="flex justify-between font-bold text-lg"><span>Monto Total</span><span>${reserva.monto_total?.toFixed(2)}</span></div>
              <hr />
              <div className="flex justify-between text-green-600"><span>Monto pagado</span><span>${reserva.monto_pagado?.toFixed(2)}</span></div>
              <div className={`flex justify-between font-bold text-lg ${reserva.saldo_pendiente > 0 ? 'text-red-600' : 'text-green-600'}`}>
                <span>Saldo pendiente</span><span>${reserva.saldo_pendiente?.toFixed(2)}</span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-4">
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div className={`h-3 rounded-full transition-all ${saldoPct >= 100 ? 'bg-green-500' : 'bg-gradient-to-r from-green-400 to-green-500'}`} style={{ width: `${saldoPct}%` }} />
              </div>
              <div className="text-xs text-gray-400 mt-1 text-center">
                {saldoPct >= 100 ? '✅ Pagado completo' : `${saldoPct.toFixed(0)}% pagado`}
              </div>
            </div>

            {reserva.saldo_pendiente > 0 && reserva.deposito_sugerido > 0 && (
              <div className="mt-3 text-xs text-gray-400">Depósito sugerido: ${reserva.deposito_sugerido?.toFixed(2)}</div>
            )}
          </div>

          {/* Quick Info */}
          <div className="bg-white rounded-xl p-5 shadow-sm text-sm space-y-2">
            <h3 className="font-semibold text-gray-700 mb-3">Info</h3>
            <div className="text-gray-400">Creado por: <span className="text-gray-600">{reserva.created_by}</span></div>
            <div className="text-gray-400">Fecha: <span className="text-gray-600">{reserva.created_at?.split('T')[0]}</span></div>
            <div className="text-gray-400">ID: <span className="text-gray-600">#{reserva.id}</span></div>
          </div>
        </div>
      </div>

      {/* Modal Solicitar Cambio de Reserva */}
      {showEditReservaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-55 p-4 animate-fadeIn">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 relative">
            <h3 className="text-lg font-bold text-gray-800 mb-2">Solicitar Cambio de Reserva</h3>
            <p className="text-sm text-gray-500 mb-4">
              Las modificaciones de reserva requieren justificación y aprobación de un administrador.
            </p>
            
            <div className="mb-4">
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Motivo / Justificación *</label>
              <textarea
                value={justificacionReserva}
                onChange={e => setJustificacionReserva(e.target.value)}
                className="input min-h-[100px] w-full"
                placeholder="Indique la razón de la modificación..."
                required
              />
            </div>
            
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setShowEditReservaModal(false); setJustificacionReserva(''); }}
                className="px-4 py-2 text-gray-500 text-sm font-medium hover:bg-gray-100 rounded-lg transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleRequestEditReserva}
                disabled={editLoading}
                className="px-4 py-2 bg-ocean-500 text-white text-sm font-medium rounded-lg hover:bg-ocean-600 transition disabled:opacity-50 flex items-center gap-1"
              >
                {editLoading ? 'Enviando...' : 'Enviar Solicitud'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Solicitar Cambio de Pago */}
      {showEditPagoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-55 p-4 animate-fadeIn">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 relative">
            <h3 className="text-lg font-bold text-gray-800 mb-2">
              {isAdmin ? 'Editar Movimiento de Folio' : 'Solicitar Cambio de Pago'}
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              {isAdmin ? 'Los cambios aplicados por el administrador se guardarán inmediatamente.' : 'Los cambios en folios cerrados requieren la aprobación de un administrador.'}
            </p>
            
            <form onSubmit={handleRequestEditPago} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Monto *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newMonto}
                    onChange={e => setNewMonto(e.target.value)}
                    required
                    className="input w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Concepto</label>
                  <input
                    type="text"
                    value={newConcepto}
                    onChange={e => setNewConcepto(e.target.value)}
                    className="input w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Método de Pago</label>
                  <select
                    value={newMetodoPago}
                    onChange={e => setNewMetodoPago(e.target.value)}
                    className="input w-full"
                  >
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
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Referencia</label>
                  <input
                    type="text"
                    value={newReferencia}
                    onChange={e => setNewReferencia(e.target.value)}
                    className="input w-full"
                    placeholder="#"
                  />
                </div>
              </div>
              
              {!isAdmin && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Justificación del Cambio *</label>
                  <textarea
                    value={justificacionPago}
                    onChange={e => setJustificacionPago(e.target.value)}
                    className="input min-h-[80px] w-full"
                    placeholder="Explique detalladamente la razón de este cambio..."
                    required
                  />
                </div>
              )}
              
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowEditPagoModal(false); setSelectedPago(null); }}
                  className="px-4 py-2 text-gray-500 text-sm font-medium hover:bg-gray-100 rounded-lg transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={editPagoLoading}
                  className="px-4 py-2 bg-ocean-500 text-white text-sm font-medium rounded-lg hover:bg-ocean-600 transition disabled:opacity-50 flex items-center gap-1"
                >
                  {editPagoLoading ? 'Guardando...' : (isAdmin ? 'Guardar Cambios' : 'Enviar Solicitud')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Visualizador de Mensaje de Notificación */}
      {selectedNotifForView && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-55 p-4 animate-fadeIn">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl p-6 relative flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3 mb-4">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <Mail size={20} className="text-ocean-600" /> Detalle de Notificación Enviada
              </h3>
              <button
                onClick={() => setSelectedNotifForView(null)}
                className="text-gray-400 hover:text-gray-600 transition outline-none text-xl animate-scaleIn"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm bg-gray-50 p-4 rounded-xl mb-4 shrink-0">
              <div>
                <span className="text-xs font-bold text-gray-400 uppercase">Destinatario:</span>
                <p className="font-semibold text-gray-800 break-all">{selectedNotifForView.destinatario || '—'}</p>
              </div>
              <div>
                <span className="text-xs font-bold text-gray-400 uppercase">Fecha de Envío:</span>
                <p className="font-semibold text-gray-800">{formatNotifDate(selectedNotifForView.created_at)}</p>
              </div>
              <div>
                <span className="text-xs font-bold text-gray-400 uppercase">Canal de Envío:</span>
                <div className="mt-1">
                  {selectedNotifForView.canal === 'email' ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-100 font-semibold text-xs">
                      <Mail size={12} /> Correo Electrónico
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-green-50 text-green-700 border border-green-100 font-semibold text-xs">
                      <Phone size={12} /> WhatsApp
                    </span>
                  )}
                </div>
              </div>
              <div>
                <span className="text-xs font-bold text-gray-400 uppercase">Plantilla / Tipo:</span>
                <div className="mt-1">
                  {getNotifTypeLabel(selectedNotifForView.tipo)}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto mb-4 min-h-[300px]">
              <span className="text-xs font-bold text-gray-400 uppercase block mb-1.5">Contenido del Mensaje:</span>
              
              {selectedNotifForView.canal === 'email' ? (
                selectedNotifForView.contenido ? (
                  <iframe
                    title="Previsualización de Correo"
                    srcDoc={selectedNotifForView.contenido}
                    className="w-full h-[350px] border border-gray-200 rounded-xl bg-white shadow-inner"
                    sandbox="allow-popups"
                  />
                ) : (
                  <div className="flex items-center justify-center h-48 border border-gray-100 rounded-xl bg-gray-50 text-gray-400 text-sm italic">
                    Sin contenido guardado (registro histórico previo a la actualización)
                  </div>
                )
              ) : (
                /* WhatsApp Mockup Chat bubble */
                selectedNotifForView.contenido ? (
                  <div
                    className="bg-[#efeae2] p-6 rounded-xl border border-gray-200 relative overflow-hidden"
                    style={{
                                            backgroundRepeat: 'repeat',
                    }}
                  >
                    <div className="flex flex-col space-y-2">
                      <div className="bg-[#d9fdd3] text-gray-800 p-4 rounded-lg shadow-sm max-w-[85%] self-end relative border border-[#e1f3d4]">
                        <p className="text-sm whitespace-pre-wrap font-sans leading-relaxed text-gray-700">
                          {selectedNotifForView.contenido}
                        </p>
                        <span className="text-[10px] text-gray-400 block text-right mt-2 font-medium">
                          {formatNotifDate(selectedNotifForView.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-48 border border-gray-100 rounded-xl bg-gray-50 text-gray-400 text-sm italic">
                    Sin contenido guardado (registro histórico previo a la actualización)
                  </div>
                )
              )}
            </div>

            <div className="flex justify-between items-center border-t border-gray-100 pt-4 shrink-0 font-sans">
               {!selectedNotifForView.contenido ? (
                 <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg font-medium flex items-center gap-1">
                   ⚠️ Registro histórico sin contenido guardado. No es posible reenviar.
                 </span>
               ) : (
                 <button
                   onClick={() => {
                     if (confirm('¿Está seguro de que desea reenviar este mensaje al destinatario original?')) {
                       handleResendNotif(selectedNotifForView.id);
                       setSelectedNotifForView(null);
                     }
                   }}
                   disabled={resendingId !== null}
                   className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl text-sm transition disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
                 >
                   <RefreshCw size={14} className={resendingId === selectedNotifForView.id ? 'animate-spin' : ''} />
                   {resendingId === selectedNotifForView.id ? 'Reenviando...' : 'Reenviar Notificación'}
                 </button>
               )}

               <button
                 onClick={() => setSelectedNotifForView(null)}
                 className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl text-sm transition"
               >
                 Cerrar
               </button>
             </div>
          </div>
        </div>
      )}

      {/* Modal Confirmar Eliminación de Reserva (Admin Only) */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-55 p-4 animate-fadeIn">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 relative">
            <h3 className="text-lg font-bold text-red-700 mb-2">Eliminar Reserva Permanentemente</h3>
            <p className="text-sm text-gray-500 mb-4">
              Esta acción eliminará la reserva de todos los listados, reportes y del calendario. Los saldos ya no sumarán. Se guardará un registro de auditoría de esta eliminación.
            </p>
            
            <form onSubmit={handleDeleteReserva} className="space-y-4 font-sans">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Motivo de Eliminación *</label>
                <textarea
                  value={deleteMotivo}
                  onChange={e => setDeleteMotivo(e.target.value)}
                  className="input min-h-[80px] w-full"
                  placeholder="Escriba la razón de la eliminación (ej. duplicado, error de recepción, cancelación solicitada)..."
                  required
                />
              </div>
              
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowDeleteModal(false); setDeleteMotivo(''); }}
                  className="px-4 py-2 text-gray-500 text-sm font-medium hover:bg-gray-100 rounded-lg transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={deleteLoading}
                  className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition disabled:opacity-50 flex items-center gap-1"
                >
                  {deleteLoading ? 'Eliminando...' : 'Eliminar permanentemente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
