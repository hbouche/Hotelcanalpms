import { useState, useEffect } from 'react';
import { Settings, Bell, RefreshCw, Mail, Phone, Calendar, Shield, ShieldAlert, CheckCircle2, XCircle, ArrowRightLeft, Eye, HelpCircle, AlertCircle, ExternalLink, Edit3, Undo, Save, ChevronLeft, Sparkles, MessageSquare, List } from 'lucide-react';
import { api } from '../api/client';

interface LogNotificacion {
  id: number;
  reserva_id: number;
  tipo: string;
  canal: string;
  destinatario: string;
  resultado: string;
  contenido?: string;
  created_at: string;
}

interface LogReversion {
  id: number;
  reserva_id: number;
  folio_id: number;
  monto: number;
  concepto_original: string;
  motivo: string;
  reversado_por: string;
  fecha: string;
}

interface User {
  id: number;
  nombre: string;
  rol: 'admin' | 'receptionist' | 'cleaning';
}

interface Plantilla {
  codigo: string;
  canal: string;
  nombre: string;
  asunto: string | null;
  contenido: string;
  variables: string[];
  updated_at: string;
}

const VAR_LABELS: Record<string, string> = {
  cliente: 'Nombre Huésped',
  apellido: 'Apellido Huésped',
  cliente_nombre_completo: 'Nombre Completo',
  email: 'Email Huésped',
  telefono: 'Teléfono Huésped',
  whatsapp: 'WhatsApp Huésped',
  check_in: 'Check-in (YYYY-MM-DD)',
  check_out: 'Check-out (YYYY-MM-DD)',
  check_in_formateado: 'F. Check-in',
  check_out_formateado: 'F. Check-out',
  noches: 'Cant. Noches',
  hora_llegada: 'Hora Llegada',
  adultos: 'Cant. Adultos',
  menores: 'Cant. Menores',
  mascotas: 'Cant. Mascotas',
  habitacion: 'Habitación Asignada',
  plan: 'Plan / Producto',
  subtotal: 'Subtotal ($)',
  impuesto_monto: 'Monto Impuestos',
  monto_total: 'Total Reserva',
  monto_pagado: 'Monto Pagado',
  saldo_pendiente: 'Saldo Pendiente',
  pago_monto: 'Monto Último Pago',
  pago_concepto: 'Concepto de Pago',
  pago_metodo: 'Método de Pago',
  pago_referencia: 'Ref. de Pago',
  pago_fecha: 'Fecha de Pago',
  dias_restantes: 'Días Restantes',
  etiqueta_dias: 'Etiqueta de Días',
  fuente: 'Canal de Reserva',
  notas: 'Comentarios del Huésped',
  hotel_nombre: 'Nombre Hotel',
  hotel_url: 'URL del Sitio Web',
  hotel_telefono: 'Teléfono Hotel',
  hotel_correo: 'Correo Hotel',
  hotel_politica_cancelacion: 'Pol. Cancelación',
  hotel_politica_reembolso: 'Pol. Reembolso',
};

const getPlantillaDesc = (codigo: string) => {
  const descs: Record<string, string> = {
    confirmacion: 'Enviada automáticamente al confirmar una nueva reserva con detalles de su estadía y formas de pago.',
    pago: 'Comprobante de abono o pago enviado al registrar movimientos en el folio de la reserva.',
    recordatorio: 'Recordatorio automático enviado unos días antes de la fecha de llegada (Check-in).',
    estado: 'Notificación enviada al huésped cuando su reserva cambia de estado (ej: Activa, Check-in, Check-out).'
  };
  return descs[codigo] || 'Notificación del sistema para comunicación con el huésped.';
};

const formatWhatsAppText = (text: string) => {
  if (!text) return '';
  let escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  escaped = escaped.replace(/\*(.*?)\*/g, '<strong>$1</strong>');
  escaped = escaped.replace(/_(.*?)_/g, '<em>$1</em>');
  escaped = escaped.replace(/~(.*?)~/g, '<del>$1</del>');
  escaped = escaped.replace(/```(.*?)```/g, '<code>$1</code>');
  
  return escaped;
};

export default function Configuracion({ user }: { user: User }) {
  const isAdmin = user?.rol === 'admin';
  const [activeTab, setActiveTab] = useState<'notificaciones' | 'logs' | 'reversiones' | 'plantillas' | 'propiedad'>('notificaciones');
  
  // Contact details and policies are local property settings.
  const [hotelTelefono, setHotelTelefono] = useState('');
  const [hotelDireccion, setHotelDireccion] = useState('');
  const [hotelPoliticaCancelacion, setHotelPoliticaCancelacion] = useState('');
  const [hotelPoliticaReembolso, setHotelPoliticaReembolso] = useState('');
  
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSuccessMsg, setConfigSuccessMsg] = useState('');
  const [configErrorMsg, setConfigErrorMsg] = useState('');

  // Hotel Property config
  const [nombrePropiedad, setNombrePropiedad] = useState('');
  const [impuestoTurismoPct, setImpuestoTurismoPct] = useState(0);
  const [depositoSugeridoPct, setDepositoSugeridoPct] = useState(0);
  const [loadingHotelConfig, setLoadingHotelConfig] = useState(false);
  const [savingHotelConfig, setSavingHotelConfig] = useState(false);
  const [hotelConfigSuccessMsg, setHotelConfigSuccessMsg] = useState('');
  const [hotelConfigErrorMsg, setHotelConfigErrorMsg] = useState('');

  const loadHotelConfig = () => {
    setLoadingHotelConfig(true);
    setHotelConfigSuccessMsg('');
    setHotelConfigErrorMsg('');
    api.get('/admin/configuracion/hotel')
      .then(r => {
        const c = r.data;
        if (c) {
          setNombrePropiedad(c.nombre_propiedad || '');
          setImpuestoTurismoPct(c.impuesto_turismo_pct ? (parseFloat(c.impuesto_turismo_pct) || 0) : 0);
          setDepositoSugeridoPct(Number(c.deposito_sugerido_pct) || 0);
        }
      })
      .catch((err) => {
        console.error('Error loading hotel config:', err);
      })
      .finally(() => setLoadingHotelConfig(false));
  };

  const handleSaveHotelConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    
    setHotelConfigSuccessMsg('');
    setHotelConfigErrorMsg('');

    // Validaciones explícitas de negocio
    if (!nombrePropiedad || !nombrePropiedad.trim()) {
      setHotelConfigErrorMsg('El nombre de la propiedad es requerido.');
      return;
    }

    const tax = Number(impuestoTurismoPct);
    if (isNaN(tax) || tax < 0 || tax > 100) {
      setHotelConfigErrorMsg('El porcentaje de impuesto de turismo debe estar entre 0% y 100%.');
      return;
    }

    const deposit = Number(depositoSugeridoPct);
    if (isNaN(deposit) || deposit < 0 || deposit > 100) {
      setHotelConfigErrorMsg('El porcentaje de depósito sugerido debe estar entre 0% y 100%.');
      return;
    }


    setSavingHotelConfig(true);
    try {
      const payload = {
        nombre_propiedad: nombrePropiedad.trim(),
        impuesto_turismo_pct: tax,
        deposito_sugerido_pct: deposit,
      };
      
      await api.put('/admin/configuracion/hotel', payload);
      setHotelConfigSuccessMsg('Configuración de la propiedad guardada exitosamente.');
      loadHotelConfig();
    } catch (err: any) {
      setHotelConfigErrorMsg(err.response?.data?.error?.message || 'Error al guardar la configuración de hotel');
    } finally {
      setSavingHotelConfig(false);
    }
  };

  // Tab 2: Logs de Notificaciones
  const [logs, setLogs] = useState<LogNotificacion[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const [filterChannel, setFilterChannel] = useState('all');
  const [logMeta, setLogMeta] = useState<any>({});
  const [logsPage, setLogsPage] = useState(1);
  const [selectedLogResult, setSelectedLogResult] = useState<any | null>(null);

  // Selected log for premium detail view
  const [selectedLogForView, setSelectedLogForView] = useState<LogNotificacion | null>(null);
  const [resendingLogId, setResendingLogId] = useState<number | null>(null);

  // Tab 3: Logs de Reversiones
  const [reversiones, setReversiones] = useState<LogReversion[]>([]);
  const [loadingReversiones, setLoadingReversiones] = useState(false);
  const [reversionesPage, setReversionesPage] = useState(1);
  const [reversionesMeta, setReversionesMeta] = useState<any>({});

  // Tab 4: Plantillas de Mensajes
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [loadingPlantillas, setLoadingPlantillas] = useState(false);
  const [selectedPlantilla, setSelectedPlantilla] = useState<Plantilla | null>(null);
  const [editAsunto, setEditAsunto] = useState('');
  const [editContenido, setEditContenido] = useState('');
  const [previewAsunto, setPreviewAsunto] = useState('');
  const [previewContenido, setPreviewContenido] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [savingPlantilla, setSavingPlantilla] = useState(false);
  const [lastFocusedInput, setLastFocusedInput] = useState<'asunto' | 'contenido'>('contenido');

  // Safe editor states
  const [editorMode, setEditorMode] = useState<'safe' | 'advanced'>('safe');
  const [safeHeader, setSafeHeader] = useState('');
  const [safeIntro, setSafeIntro] = useState('');

  // 1. Load System Config
  const loadConfig = () => {
    setLoadingConfig(true);
    api.get('/admin/configuracion/sistema')
      .then(r => {
        const c = r.data;
        if (c) {
          setHotelTelefono(c.hotel_telefono || '');
          setHotelDireccion(c.hotel_direccion || '');
          setHotelPoliticaCancelacion(c.hotel_politica_cancelacion || '');
          setHotelPoliticaReembolso(c.hotel_politica_reembolso || '');
        }
      })
      .catch(() => {})
      .finally(() => setLoadingConfig(false));
  };

  // 2. Load Notification Logs
  const loadLogs = () => {
    setLoadingLogs(true);
    const params: any = { page: logsPage, limit: 20 };
    
    // Custom filtering by channel/type if not "all"
    let searchParts: string[] = [];
    if (filterType !== 'all') searchParts.push(filterType);
    if (filterChannel !== 'all') searchParts.push(filterChannel);
    if (searchParts.length > 0) {
      params.search = searchParts.join(' ');
    }

    api.get('/admin/configuracion/logs', { params })
      .then(r => {
        setLogs(r.data || []);
        setLogMeta(r.meta || {});
      })
      .catch(() => {})
      .finally(() => setLoadingLogs(false));
  };

  // 3. Load Reversion Logs
  const loadReversiones = () => {
    if (!isAdmin) return;
    setLoadingReversiones(true);
    const params = { page: reversionesPage, limit: 20 };
    api.get('/admin/configuracion/reversiones', { params })
      .then(r => {
        setReversiones(r.data || []);
        setReversionesMeta(r.meta || {});
      })
      .catch(() => {})
      .finally(() => setLoadingReversiones(false));
  };

  // 4. Load Notification Templates
  const loadPlantillas = () => {
    setLoadingPlantillas(true);
    api.get('/admin/notificaciones/plantillas')
      .then(r => {
        setPlantillas(r.data || []);
      })
      .catch(err => {
        console.error('Error fetching templates:', err);
      })
      .finally(() => setLoadingPlantillas(false));
  };

  // Preview debouncer hook
  useEffect(() => {
    if (!selectedPlantilla) return;
    
    setLoadingPreview(true);
    const delayDebounceFn = setTimeout(() => {
      api.post(`/admin/notificaciones/plantillas/${selectedPlantilla.codigo}/${selectedPlantilla.canal}/preview`, {
        asuntoCustom: editAsunto,
        contenidoCustom: editContenido
      })
        .then(r => {
          setPreviewAsunto(r.data?.asunto || '');
          setPreviewContenido(r.data?.contenido || '');
        })
        .catch(err => {
          console.error('Error rendering preview:', err);
        })
        .finally(() => setLoadingPreview(false));
    }, 400);

    return () => clearTimeout(delayDebounceFn);
  }, [editAsunto, editContenido, selectedPlantilla]);

  const handleSavePlantilla = async () => {
    if (!selectedPlantilla || !isAdmin) return;
    setSavingPlantilla(true);
    try {
      await api.put(`/admin/notificaciones/plantillas/${selectedPlantilla.codigo}/${selectedPlantilla.canal}`, {
        asunto: selectedPlantilla.canal === 'email' ? editAsunto : null,
        contenido: editContenido
      });
      alert('Plantilla guardada exitosamente.');
      loadPlantillas();
      setSelectedPlantilla(null); // return to list
    } catch (err: any) {
      alert(err.response?.data?.error?.message || 'Error al guardar la plantilla');
    } finally {
      setSavingPlantilla(false);
    }
  };

  const handleRestaurarPlantilla = async (codigo: string, canal: string) => {
    if (!isAdmin) return;
    if (!confirm('¿Está seguro de que desea restaurar esta plantilla a sus valores predeterminados de fábrica? Perderá todos los cambios personalizados.')) {
      return;
    }
    try {
      const res = await api.post(`/admin/notificaciones/plantillas/${codigo}/${canal}/restaurar`, {});
      alert('Plantilla restaurada exitosamente.');
      loadPlantillas();
      if (selectedPlantilla && selectedPlantilla.codigo === codigo && selectedPlantilla.canal === canal) {
        setEditAsunto(res.data?.asunto || '');
        setEditContenido(res.data?.contenido || '');
      }
    } catch (err: any) {
      alert(err.response?.data?.error?.message || 'Error al restaurar la plantilla');
    }
  };

  const insertVariable = (variable: string) => {
    const placeholder = `{{${variable}}}`;
    if (lastFocusedInput === 'asunto' && selectedPlantilla?.canal === 'email') {
      const inputEl = document.getElementById('edit-asunto') as HTMLInputElement;
      if (inputEl) {
        const start = inputEl.selectionStart || 0;
        const end = inputEl.selectionEnd || 0;
        const text = editAsunto;
        const newText = text.substring(0, start) + placeholder + text.substring(end);
        setEditAsunto(newText);
        setTimeout(() => {
          inputEl.focus();
          inputEl.setSelectionRange(start + placeholder.length, start + placeholder.length);
        }, 0);
      } else {
        setEditAsunto(prev => prev + placeholder);
      }
    } else {
      const txtEl = (document.getElementById('edit-contenido-safe') || document.getElementById('edit-contenido')) as HTMLTextAreaElement;
      if (txtEl) {
        const start = txtEl.selectionStart || 0;
        const end = txtEl.selectionEnd || 0;
        const text = editorMode === 'safe' ? safeIntro : editContenido;
        const newText = text.substring(0, start) + placeholder + text.substring(end);
        
        if (editorMode === 'safe') {
          setSafeIntro(newText);
        } else {
          setEditContenido(newText);
        }
        
        setTimeout(() => {
          txtEl.focus();
          txtEl.setSelectionRange(start + placeholder.length, start + placeholder.length);
        }, 0);
      } else {
        if (editorMode === 'safe') {
          setSafeIntro(prev => prev + placeholder);
        } else {
          setEditContenido(prev => prev + placeholder);
        }
      }
    }
  };

  useEffect(() => {
    if (activeTab === 'notificaciones') {
      loadConfig();
    } else if (activeTab === 'logs') {
      loadLogs();
    } else if (activeTab === 'reversiones') {
      loadReversiones();
    } else if (activeTab === 'plantillas') {
      loadPlantillas();
    } else if (activeTab === 'propiedad') {
      loadHotelConfig();
    }
  }, [activeTab, logsPage, reversionesPage, filterType, filterChannel]);

  // Synchronize safe fields back into editContenido in Safe Mode
  useEffect(() => {
    if (!selectedPlantilla || editorMode !== 'safe') return;
    
    if (selectedPlantilla.canal === 'email') {
      let updatedHtml = editContenido;
      
      const h2Regex = /(<h2[^>]*>).*?(<\/h2>)/i;
      if (h2Regex.test(updatedHtml)) {
        updatedHtml = updatedHtml.replace(h2Regex, `$1${safeHeader}$2`);
      } else if (safeHeader) {
        // If <h2> is somehow missing but safeHeader has content, try to wrap or ignore.
        // Let's assume standard default template structure is present.
      }
      
      const pRegex = /(<p style="color:#4a5568;">).*?(<\/p>)/i;
      if (pRegex.test(updatedHtml)) {
        updatedHtml = updatedHtml.replace(pRegex, `$1${safeIntro}$2`);
      }
      
      if (updatedHtml !== editContenido) {
        setEditContenido(updatedHtml);
      }
    } else {
      if (safeIntro !== editContenido) {
        setEditContenido(safeIntro);
      }
    }
  }, [safeHeader, safeIntro, editorMode, selectedPlantilla]);

  const handleToggleEditorMode = (mode: 'safe' | 'advanced') => {
    if (mode === 'safe') {
      if (selectedPlantilla?.canal === 'email') {
        const h2Match = editContenido.match(/<h2[^>]*>(.*?)<\/h2>/i);
        setSafeHeader(h2Match ? h2Match[1] : '');
        const pMatch = editContenido.match(/<p style="color:#4a5568;">(.*?)<\/p>/i);
        setSafeIntro(pMatch ? pMatch[1] : '');
      } else {
        setSafeIntro(editContenido);
      }
    }
    setEditorMode(mode);
  };

  // Handle save configuration
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setSavingConfig(true);
    setConfigSuccessMsg('');
    setConfigErrorMsg('');
    
    try {
      const payload = {
        hotel_telefono: hotelTelefono || null,
        hotel_direccion: hotelDireccion || null,
        hotel_politica_cancelacion: hotelPoliticaCancelacion || null,
        hotel_politica_reembolso: hotelPoliticaReembolso || null
      };
      
      await api.put('/admin/configuracion/sistema', payload);
      setConfigSuccessMsg('Configuración guardada exitosamente.');
      loadConfig();
    } catch (err: any) {
      setConfigErrorMsg(err.response?.data?.error?.message || 'Error al guardar la configuración');
    } finally {
      setSavingConfig(false);
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '—';
    try {
      // Split T to prevent time offsets
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

  // Status parser helper
  const parseResultStatus = (resultadoStr: string) => {
    try {
      const parsed = JSON.parse(resultadoStr);
      if (parsed.status === 'success' || parsed.success === true || parsed.sent === true) {
        return { success: true, text: 'Exitoso', details: parsed };
      }
      return { success: false, text: 'Fallido', details: parsed };
    } catch {
      // String backup
      if (resultadoStr?.toLowerCase().includes('success') || resultadoStr?.toLowerCase().includes('ok')) {
        return { success: true, text: 'Exitoso', details: { raw: resultadoStr } };
      }
      return { success: false, text: 'Fallido', details: { error: resultadoStr } };
    }
  };

  const handleResendNotif = async (logId: number) => {
    setResendingLogId(logId);
    try {
      await api.post(`/hotel/notificaciones/${logId}/reenviar`, {});
      alert('Notificación reenviada exitosamente');
      loadLogs();
      // If the selected log is currently open, update its representation
      if (selectedLogForView?.id === logId) {
        setSelectedLogForView(prev => prev ? { ...prev, tipo: prev.tipo.endsWith('_reenvio') ? prev.tipo : prev.tipo + '_reenvio' } : null);
      }
    } catch (e: any) {
      alert(e?.response?.data?.error?.message || 'Error al reenviar la notificación');
    } finally {
      setResendingLogId(null);
    }
  };

  const getNotifTypeLabel = (type: string) => {
    const cleanType = type.replace('_reenvio', '');
    const labels: Record<string, string> = {
      confirmacion: 'Confirmación',
      estado: 'Cambio de Estado',
      pago: 'Recibo de Pago',
      recordatorio: 'Recordatorio',
    };
    const isReenvio = type.endsWith('_reenvio');
    return (
      <span className="text-gray-700 font-medium flex items-center gap-1.5">
        {labels[cleanType] || cleanType}
        {isReenvio && (
          <span className="text-[10px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded border border-amber-100 font-bold uppercase tracking-wider">
            Reenvío
          </span>
        )}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Settings size={28} className="text-mahana-600" /> Configuración de Sistema
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Ajusta las notificaciones automatizadas, visualiza el historial de mensajes y monitorea auditorías.
        </p>
      </div>

      {/* Premium Tabs */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('notificaciones')}
          className={`px-5 py-3 text-sm font-semibold border-b-2 transition flex items-center gap-2 ${activeTab === 'notificaciones' ? 'border-mahana-500 text-mahana-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
        >
          <Bell size={16} /> Configuración de Notificaciones
        </button>
        <button
          onClick={() => { setActiveTab('logs'); setLogsPage(1); }}
          className={`px-5 py-3 text-sm font-semibold border-b-2 transition flex items-center gap-2 ${activeTab === 'logs' ? 'border-mahana-500 text-mahana-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
        >
          <Mail size={16} /> Registro de Notificaciones
        </button>
        {isAdmin && (
          <button
            onClick={() => { setActiveTab('reversiones'); setReversionesPage(1); }}
            className={`px-5 py-3 text-sm font-semibold border-b-2 transition flex items-center gap-2 ${activeTab === 'reversiones' ? 'border-mahana-500 text-mahana-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
          >
            <ArrowRightLeft size={16} /> Registro de Reversiones
          </button>
        )}
        {isAdmin && (
          <button
            onClick={() => { setActiveTab('plantillas'); }}
            className={`px-5 py-3 text-sm font-semibold border-b-2 transition flex items-center gap-2 ${activeTab === 'plantillas' ? 'border-mahana-500 text-mahana-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
          >
            <Edit3 size={16} /> Plantillas de Mensajes
          </button>
        )}
        {isAdmin && (
          <button
            onClick={() => { setActiveTab('propiedad'); }}
            className={`px-5 py-3 text-sm font-semibold border-b-2 transition flex items-center gap-2 ${activeTab === 'propiedad' ? 'border-mahana-500 text-mahana-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
          >
            <Settings size={16} /> Propiedad y Pasarela
          </button>
        )}
      </div>

      {/* Tab 1 Content: Notification Configuration */}
      {activeTab === 'notificaciones' && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden p-6 space-y-6">
          {!isAdmin && (
            <div className="bg-amber-50 text-amber-800 p-4 rounded-xl border border-amber-200 flex items-start gap-3">
              <AlertCircle size={20} className="text-amber-600 mt-0.5 shrink-0" />
              <div>
                <h3 className="font-bold text-sm">Acceso de Solo Lectura</h3>
                <p className="text-xs text-amber-700 mt-0.5">
                  Como Recepcionista, puedes visualizar esta configuración pero no cuentas con permisos para modificarla.
                  Por favor, contacta a un Administrador si requieres realizar cambios.
                </p>
              </div>
            </div>
          )}

          {loadingConfig ? (
            <div className="p-12 text-center text-gray-400 animate-pulse">Cargando configuración...</div>
          ) : (
            <form onSubmit={handleSaveConfig} className="space-y-8">
              {configSuccessMsg && (
                <div className="bg-green-50 text-green-700 text-sm px-4 py-3 rounded-xl border border-green-200 flex items-center gap-2">
                  <CheckCircle2 size={18} /> {configSuccessMsg}
                </div>
              )}
              {configErrorMsg && (
                <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl border border-red-200 flex items-center gap-2">
                  <XCircle size={18} /> {configErrorMsg}
                </div>
              )}

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
                <h2 className="font-bold">Notificaciones externas deshabilitadas</h2>
                <p className="mt-1">Esta instalación no tiene SMTP, Resend ni WhatsApp conectados. Los contactos y las políticas de la propiedad están por configurar.</p>
              </div>

              {/* Property Info and Policies */}
              <div className="space-y-4 pt-4 border-t border-gray-100">
                <div className="border-b border-gray-100 pb-2">
                  <h2 className="font-bold text-gray-800 text-base flex items-center gap-2">
                    <Sparkles size={18} className="text-mahana-600" /> Información y Políticas de la Propiedad
                  </h2>
                  <p className="text-xs text-gray-400 mt-1">
                    Establezca la información de contacto y las políticas legales que se inyectarán en los correos y mensajes de WhatsApp.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 font-sans">
                      Teléfono de Atención (WhatsApp)
                    </label>
                    <input
                      type="text"
                      disabled={!isAdmin}
                      value={hotelTelefono}
                      onChange={e => setHotelTelefono(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 focus:border-transparent outline-none transition text-sm disabled:bg-gray-50 disabled:text-gray-400 font-sans"
                      placeholder="Teléfono por configurar"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">Número utilizado para el enlace rápido de atención al cliente y pie de página de correos.</p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 font-sans">
                      Dirección de la Propiedad
                    </label>
                    <input
                      type="text"
                      disabled={!isAdmin}
                      value={hotelDireccion}
                      onChange={e => setHotelDireccion(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 focus:border-transparent outline-none transition text-sm disabled:bg-gray-50 disabled:text-gray-400 font-sans"
                      placeholder="Dirección por configurar"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">Dirección física del hotel que reemplaza las variables dinámicas <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-600 font-mono text-[9px] font-semibold">{"{{hotel_direccion}}"}</code>.</p>
                  </div>
                </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 font-sans">
                        Política de Cancelación
                      </label>
                      <textarea
                        rows={4}
                        disabled={!isAdmin}
                        value={hotelPoliticaCancelacion}
                        onChange={e => setHotelPoliticaCancelacion(e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 focus:border-transparent outline-none transition text-sm disabled:bg-gray-50 disabled:text-gray-400 font-sans leading-relaxed"
                        placeholder="Describa la política de cancelación..."
                      />
                      <p className="text-[10px] text-gray-400 mt-1">Placeholder disponible: <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-600 font-mono text-[9px] font-semibold">{"{{hotel_politica_cancelacion}}"}</code></p>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 font-sans">
                        Política de Reembolso
                      </label>
                      <textarea
                        rows={4}
                        disabled={!isAdmin}
                        value={hotelPoliticaReembolso}
                        onChange={e => setHotelPoliticaReembolso(e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 focus:border-transparent outline-none transition text-sm disabled:bg-gray-50 disabled:text-gray-400 font-sans leading-relaxed"
                        placeholder="Describa la política de reembolso..."
                      />
                      <p className="text-[10px] text-gray-400 mt-1">Placeholder disponible: <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-600 font-mono text-[9px] font-semibold">{"{{hotel_politica_reembolso}}"}</code></p>
                    </div>
                  </div>
                </div>

              {/* Submit Button */}
              {isAdmin && (
                <div className="flex justify-end pt-4 border-t border-gray-100">
                  <button
                    type="submit"
                    disabled={savingConfig}
                    className="px-6 py-2.5 bg-gradient-to-r from-mahana-500 to-mahana-600 text-white font-semibold rounded-xl hover:shadow-lg transform hover:-translate-y-0.5 transition disabled:opacity-50"
                  >
                    {savingConfig ? 'Guardando...' : 'Guardar Configuración'}
                  </button>
                </div>
              )}
            </form>
          )}
        </div>
      )}

      {/* Tab 5 Content: Hotel Property settings */}
      {activeTab === 'propiedad' && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden p-6 space-y-6 animate-fadeIn">
          {!isAdmin ? (
            <div className="bg-amber-50 text-amber-800 p-4 rounded-xl border border-amber-200 flex items-start gap-3">
              <AlertCircle size={20} className="text-amber-600 mt-0.5 shrink-0" />
              <div>
                <h3 className="font-bold text-sm">Acceso de Solo Lectura</h3>
                <p className="text-xs text-amber-700 mt-0.5">
                  Como Recepcionista, puedes visualizar esta configuración pero no cuentas con permisos para modificarla.
                  Por favor, contacta a un Administrador si requieres realizar cambios.
                </p>
              </div>
            </div>
          ) : null}

          {loadingHotelConfig ? (
            <div className="p-12 text-center text-gray-400 animate-pulse font-sans">Cargando configuración de propiedad...</div>
          ) : (
            <form onSubmit={handleSaveHotelConfig} className="space-y-8">
              {hotelConfigSuccessMsg && (
                <div className="bg-green-50 text-green-700 text-sm px-4 py-3 rounded-xl border border-green-200 flex items-center gap-2 font-sans">
                  <CheckCircle2 size={18} /> {hotelConfigSuccessMsg}
                </div>
              )}
              {hotelConfigErrorMsg && (
                <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl border border-red-200 flex items-center gap-2 font-sans">
                  <XCircle size={18} /> {hotelConfigErrorMsg}
                </div>
              )}

              {/* Seccion 1: Datos de la Propiedad */}
              <div className="space-y-4">
                <div className="border-b border-gray-100 pb-2">
                  <h2 className="font-bold text-gray-800 text-base flex items-center gap-2">
                    <Settings size={18} className="text-mahana-600" /> Información Comercial de la Propiedad
                  </h2>
                  <p className="text-xs text-gray-400 mt-1">
                    Parámetros fundamentales de cobro e identidad comercial del hotel.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-1">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 font-sans">
                      Nombre de la Propiedad
                    </label>
                    <input
                      type="text"
                      disabled={!isAdmin}
                      value={nombrePropiedad}
                      onChange={e => setNombrePropiedad(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 focus:border-transparent outline-none transition text-sm disabled:bg-gray-50 disabled:text-gray-400 font-sans"
                      placeholder="Hotel Panamá Canal"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 font-sans">
                      Impuesto de Turismo (%)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      disabled={!isAdmin}
                      value={impuestoTurismoPct}
                      onChange={e => setImpuestoTurismoPct(parseFloat(e.target.value) || 0)}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 focus:border-transparent outline-none transition text-sm disabled:bg-gray-50 disabled:text-gray-400 font-sans"
                      placeholder="Por configurar"
                      min="0"
                      max="100"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">Porcentaje de impuesto turístico gubernamental aplicado a reservas.</p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 font-sans">
                      Porcentaje de Depósito Sugerido (%)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      disabled={!isAdmin}
                      value={depositoSugeridoPct}
                      onChange={e => setDepositoSugeridoPct(parseFloat(e.target.value) || 0)}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 focus:border-transparent outline-none transition text-sm disabled:bg-gray-50 disabled:text-gray-400 font-sans"
                      placeholder="Por configurar"
                      min="0"
                      max="100"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">Porcentaje del total cobrado al cliente como garantía inicial.</p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
                <h2 className="font-bold">Pagos e integraciones por configurar</h2>
                <p className="mt-1">No hay pasarela de pagos ni CRM externo conectados. Esta copia no carga PayPal ni envía datos a Kommo.</p>
              </div>

              {/* Submit Button */}
              {isAdmin && (
                <div className="flex justify-end pt-4 border-t border-gray-100">
                  <button
                    type="submit"
                    disabled={savingHotelConfig}
                    className="px-6 py-2.5 bg-gradient-to-r from-mahana-500 to-mahana-600 text-white font-semibold rounded-xl hover:shadow-lg transform hover:-translate-y-0.5 transition disabled:opacity-50"
                  >
                    {savingHotelConfig ? 'Guardando...' : 'Guardar Propiedad'}
                  </button>
                </div>
              )}
            </form>
          )}
        </div>
      )}

      {/* Tab 2 Content: Notification logs */}
      {activeTab === 'logs' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="bg-white p-4 border border-gray-200 rounded-xl flex flex-wrap gap-3 items-center">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Filtrar por:</span>
            
            <div className="w-full sm:w-48">
              <select
                value={filterType}
                onChange={e => { setFilterType(e.target.value); setLogsPage(1); }}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 outline-none bg-white"
              >
                <option value="all">Cualquier Plantilla</option>
                <option value="confirmacion">Confirmación</option>
                <option value="estado">Cambio de Estado</option>
                <option value="pago">Recibo de Pago</option>
                <option value="recordatorio">Recordatorio</option>
              </select>
            </div>

            <div className="w-full sm:w-48">
              <select
                value={filterChannel}
                onChange={e => { setFilterChannel(e.target.value); setLogsPage(1); }}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 outline-none bg-white"
              >
                <option value="all">Cualquier Canal</option>
                <option value="email">Correo Electrónico</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            </div>

            <button
              onClick={() => { setLogsPage(1); loadLogs(); }}
              className="p-2 text-gray-500 hover:text-mahana-600 hover:bg-gray-50 border border-gray-200 rounded-lg ml-auto transition"
              title="Refrescar logs"
            >
              <RefreshCw size={16} />
            </button>
          </div>

          {/* Table */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            {loadingLogs ? (
              <div className="p-12 text-center text-gray-400 animate-pulse">Cargando registros de mensajería...</div>
            ) : logs.length === 0 ? (
              <div className="p-12 text-center text-gray-400">No se encontraron logs de notificaciones</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 font-medium">
                      <th className="px-6 py-4 text-left font-medium">Fecha</th>
                      <th className="px-6 py-4 text-center font-medium w-24">Canal</th>
                      <th className="px-6 py-4 text-left font-medium">Destinatario</th>
                      <th className="px-6 py-4 text-left font-medium">Plantilla / Tipo</th>
                      <th className="px-6 py-4 text-left font-medium">Reserva</th>
                      <th className="px-6 py-4 text-center font-medium w-32">Estado</th>
                      <th className="px-6 py-4 text-center font-medium w-32">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {logs.map(log => {
                      const statusInfo = parseResultStatus(log.resultado);
                      return (
                        <tr
                          key={log.id}
                          onClick={() => setSelectedLogForView(log)}
                          className="hover:bg-gray-50/70 transition cursor-pointer"
                        >
                          <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                            <div className="flex items-center gap-2">
                              <Calendar size={14} className="text-gray-400" />
                              <span>{formatDate(log.created_at)}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex justify-center">
                              {log.canal === 'email' ? (
                                <span className="p-1.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 block" title="Email"><Mail size={16} /></span>
                              ) : (
                                <span className="p-1.5 rounded-lg bg-green-50 text-green-600 border border-green-100 block" title="WhatsApp"><Phone size={16} /></span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 font-medium text-gray-700 font-sans">
                            {log.destinatario || '—'}
                          </td>
                          <td className="px-6 py-4">
                            {getNotifTypeLabel(log.tipo)}
                          </td>
                          <td className="px-6 py-4">
                            {log.reserva_id ? (
                              <a
                                href={`/reservas/${log.reserva_id}`}
                                className="text-ocean-600 font-semibold hover:underline inline-flex items-center gap-1"
                                onClick={e => e.stopPropagation()}
                              >
                                #{log.reserva_id} <ExternalLink size={12} />
                              </a>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              {statusInfo.success ? (
                                <>
                                  <CheckCircle2 size={16} className="text-green-500" />
                                  <span className="text-xs font-semibold text-green-700">Entregado</span>
                                </>
                              ) : (
                                <>
                                  <XCircle size={16} className="text-red-500" />
                                  <span className="text-xs font-semibold text-red-700">Fallido</span>
                                </>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-center whitespace-nowrap" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => setSelectedLogForView(log)}
                                className="p-1.5 rounded-lg text-ocean-600 hover:bg-ocean-50 border border-transparent hover:border-ocean-100 transition"
                                title="Ver mensaje enviado"
                              >
                                <Eye size={16} />
                              </button>
                              <button
                                onClick={() => {
                                  if (confirm('¿Está seguro de que desea reenviar esta notificación?')) {
                                    handleResendNotif(log.id);
                                  }
                                }}
                                disabled={resendingLogId === log.id || !log.contenido}
                                className={`p-1.5 rounded-lg border border-transparent transition ${
                                  !log.contenido
                                    ? 'text-gray-200 cursor-not-allowed bg-transparent hover:border-transparent'
                                    : 'text-green-600 hover:bg-green-50 hover:border-green-100'
                                }`}
                                title={!log.contenido ? 'Registro histórico sin contenido guardado' : 'Reenviar notificación'}
                              >
                                <RefreshCw size={16} className={resendingLogId === log.id ? 'animate-spin' : ''} />
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

          {/* Pagination */}
          {logMeta.pages > 1 && (
            <div className="flex items-center justify-between text-sm text-gray-500 mt-2">
              <span>Registros {((logsPage - 1) * 20) + 1} - {Math.min(logsPage * 20, logMeta.total)} de {logMeta.total}</span>
              <div className="flex gap-2">
                <button
                  disabled={logsPage <= 1}
                  onClick={() => setLogsPage(p => p - 1)}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
                >
                  Anterior
                </button>
                <button
                  disabled={logsPage >= logMeta.pages}
                  onClick={() => setLogsPage(p => p + 1)}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 3 Content: Reversions Logs */}
      {activeTab === 'reversiones' && isAdmin && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            {loadingReversiones ? (
              <div className="p-12 text-center text-gray-400 animate-pulse">Cargando bitácora de reversiones...</div>
            ) : reversiones.length === 0 ? (
              <div className="p-12 text-center text-gray-400">No se han registrado reversiones en el folio</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 font-medium">
                      <th className="px-6 py-4 text-left font-medium">Fecha/Hora</th>
                      <th className="px-6 py-4 text-left font-medium">Autor de Reversión</th>
                      <th className="px-6 py-4 text-left font-medium">Reserva</th>
                      <th className="px-6 py-4 text-left font-medium">Folio ID</th>
                      <th className="px-6 py-4 text-right font-medium">Monto Reversado</th>
                      <th className="px-6 py-4 text-left font-medium">Concepto Original</th>
                      <th className="px-6 py-4 text-left font-medium">Motivo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {reversiones.map(rev => (
                      <tr key={rev.id} className="hover:bg-gray-50/50 transition">
                        <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                          <div className="flex items-center gap-2">
                            <Calendar size={14} className="text-gray-400" />
                            <span>{formatDate(rev.fecha)}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 font-semibold text-gray-700">
                          {rev.reversado_por}
                        </td>
                        <td className="px-6 py-4">
                          {rev.reserva_id ? (
                            <a
                              href={`/reservas/${rev.reserva_id}`}
                              className="text-ocean-600 font-semibold hover:underline flex items-center gap-1"
                            >
                              #{rev.reserva_id} <ExternalLink size={12} />
                            </a>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 font-mono text-xs font-semibold">
                            #F-{rev.folio_id}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right font-bold text-red-600 whitespace-nowrap">
                          -${Number(rev.monto).toFixed(2)}
                        </td>
                        <td className="px-6 py-4 text-gray-600">
                          {rev.concepto_original || '—'}
                        </td>
                        <td className="px-6 py-4 text-gray-600 font-medium max-w-xs truncate" title={rev.motivo}>
                          {rev.motivo || 'Sin especificar'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Pagination */}
          {reversionesMeta.pages > 1 && (
            <div className="flex items-center justify-between text-sm text-gray-500 mt-2">
              <span>Registros {((reversionesPage - 1) * 20) + 1} - {Math.min(reversionesPage * 20, reversionesMeta.total)} de {reversionesMeta.total}</span>
              <div className="flex gap-2">
                <button
                  disabled={reversionesPage <= 1}
                  onClick={() => setReversionesPage(p => p - 1)}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
                >
                  Anterior
                </button>
                <button
                  disabled={reversionesPage >= reversionesMeta.pages}
                  onClick={() => setReversionesPage(p => p + 1)}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 4 Content: Plantillas de Mensajes */}
      {activeTab === 'plantillas' && isAdmin && (
        <div className="space-y-6">
          {!selectedPlantilla ? (
            // Vista 1: Lista / Cuadrícula de Plantillas
            <div className="space-y-4">
              <div className="bg-white p-4 border border-gray-200 rounded-2xl flex flex-wrap gap-4 items-center justify-between shadow-sm">
                <div>
                  <h2 className="font-bold text-gray-800 text-lg flex items-center gap-2">
                    <List size={20} className="text-mahana-600" /> Plantillas de Mensajería
                  </h2>
                  <p className="text-xs text-gray-500 mt-1">
                    Gestione y edite el asunto, contenido y variables de los correos electrónicos y mensajes de WhatsApp.
                  </p>
                </div>
                <button
                  onClick={loadPlantillas}
                  disabled={loadingPlantillas}
                  className="px-4 py-2 text-sm font-semibold border border-gray-200 rounded-xl hover:bg-gray-50 transition flex items-center gap-2 text-gray-600 disabled:opacity-50 font-sans"
                >
                  <RefreshCw size={14} className={loadingPlantillas ? 'animate-spin' : ''} /> Refrescar
                </button>
              </div>

              {loadingPlantillas ? (
                <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center text-gray-400 animate-pulse font-sans">
                  Cargando plantillas de mensajes...
                </div>
              ) : plantillas.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center text-gray-400 font-sans">
                  No se encontraron plantillas registradas.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {plantillas.map(plantilla => {
                    const isEmail = plantilla.canal === 'email';
                    return (
                      <div
                        key={`${plantilla.codigo}-${plantilla.canal}`}
                        className="bg-white border border-gray-200 rounded-2xl shadow-sm hover:shadow-md transition duration-200 overflow-hidden flex flex-col justify-between"
                      >
                        <div className="p-6 space-y-4">
                          {/* Card Header */}
                          <div className="flex items-start justify-between">
                            <div>
                              <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider font-mono">
                                Código: {plantilla.codigo}
                              </span>
                              <h3 className="font-bold text-gray-800 text-base mt-0.5 font-sans">
                                {plantilla.nombre}
                              </h3>
                            </div>
                            
                            {isEmail ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100 font-bold text-xs font-sans">
                                <Mail size={12} /> Email
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-100 font-bold text-xs font-sans">
                                <Phone size={12} /> WhatsApp
                              </span>
                            )}
                          </div>

                          {/* Description */}
                          <p className="text-xs text-gray-600 leading-relaxed min-h-[40px] font-sans">
                            {getPlantillaDesc(plantilla.codigo)}
                          </p>

                          {/* Subject / Preview line */}
                          {isEmail && plantilla.asunto && (
                            <div className="text-xs bg-gray-50 border border-gray-150 p-2.5 rounded-lg">
                              <span className="font-bold text-gray-500 uppercase tracking-wider text-[9px] block font-sans">
                                Asunto por defecto:
                              </span>
                              <span className="text-gray-700 font-medium truncate block mt-0.5 font-sans">
                                {plantilla.asunto}
                              </span>
                            </div>
                          )}

                          {/* Variables badge summary */}
                          <div className="space-y-1.5">
                            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider font-mono block">
                              Variables Disponibles:
                            </span>
                            <div className="flex flex-wrap gap-1 max-h-[50px] overflow-hidden">
                              {plantilla.variables.map(v => (
                                <span
                                  key={v}
                                  className="text-[9px] bg-gray-100 border border-gray-200 text-gray-600 px-1.5 py-0.5 rounded font-mono"
                                  title={VAR_LABELS[v] || v}
                                >
                                  {v}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Card Actions */}
                        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
                          <span className="text-[10px] text-gray-400 font-medium font-sans">
                            Actualizado: {formatDate(plantilla.updated_at)}
                          </span>
                          
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setSelectedPlantilla(plantilla);
                                setEditAsunto(plantilla.asunto || '');
                                setEditContenido(plantilla.contenido || '');
                                setEditorMode('safe');
                                if (plantilla.canal === 'email') {
                                  const h2Match = plantilla.contenido.match(/<h2[^>]*>(.*?)<\/h2>/i);
                                  setSafeHeader(h2Match ? h2Match[1] : '');
                                  const pMatch = plantilla.contenido.match(/<p style="color:#4a5568;">(.*?)<\/p>/i);
                                  setSafeIntro(pMatch ? pMatch[1] : '');
                                } else {
                                  setSafeHeader('');
                                  setSafeIntro(plantilla.contenido || '');
                                }
                              }}
                              className="px-3.5 py-1.5 bg-white border border-gray-200 text-mahana-600 font-semibold rounded-xl text-xs hover:bg-mahana-50 hover:border-mahana-200 hover:shadow-xs transition flex items-center gap-1 font-sans"
                            >
                              <Edit3 size={12} /> Editar
                            </button>
                            <button
                              onClick={() => handleRestaurarPlantilla(plantilla.codigo, plantilla.canal)}
                              className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg border border-transparent hover:border-amber-100 transition"
                              title="Restaurar valores de fábrica"
                            >
                              <Undo size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            // Vista 2: Editor Split-Screen Completo (Doble Panel)
            <div className="space-y-4">
              {/* Editor Header Bar */}
              <div className="bg-white p-4 border border-gray-200 rounded-2xl flex flex-wrap gap-4 items-center justify-between shadow-sm">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSelectedPlantilla(null)}
                    className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition"
                    title="Volver a la lista"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-bold text-gray-800 text-lg font-sans">
                        {selectedPlantilla.nombre}
                      </h2>
                      {selectedPlantilla.canal === 'email' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100 font-bold text-xs font-sans">
                          <Mail size={10} /> Email
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-100 font-bold text-xs font-sans">
                          <Phone size={10} /> WhatsApp
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 font-sans">
                      Personalice el contenido dinámico de esta notificación para mejorar la comunicación.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleRestaurarPlantilla(selectedPlantilla.codigo, selectedPlantilla.canal)}
                    className="px-4 py-2 border border-gray-200 text-gray-600 font-semibold rounded-xl text-xs hover:bg-gray-50 transition flex items-center gap-1.5 font-sans"
                  >
                    <Undo size={14} /> Restaurar Fábrica
                  </button>
                  <button
                    onClick={handleSavePlantilla}
                    disabled={savingPlantilla}
                    className="px-4 py-2 bg-gradient-to-r from-mahana-500 to-mahana-600 text-white font-semibold rounded-xl text-xs hover:shadow-lg transform hover:-translate-y-0.5 transition flex items-center gap-1.5 disabled:opacity-50 font-sans"
                  >
                    <Save size={14} /> {savingPlantilla ? 'Guardando...' : 'Guardar Cambios'}
                  </button>
                </div>
              </div>

              {/* Split Screen Workspace */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                
                {/* Panel Izquierdo: Editor de Contenido (7 columnas) */}
                <div className="lg:col-span-7 bg-white border border-gray-200 rounded-2xl p-6 space-y-5 shadow-sm">
                  <div className="border-b border-gray-100 pb-2">
                    <h3 className="font-bold text-gray-800 text-sm flex items-center gap-1.5 font-sans">
                      <Edit3 size={16} className="text-mahana-600" /> Editor de Texto
                    </h3>
                  </div>

                  {/* Segmented Mode Selector */}
                  {selectedPlantilla.canal === 'email' && (
                    <div className="flex bg-gray-100/70 p-1.5 rounded-xl border border-gray-200">
                      <button
                        type="button"
                        onClick={() => handleToggleEditorMode('safe')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all font-sans ${
                          editorMode === 'safe'
                            ? 'bg-white text-mahana-700 shadow-xs border border-gray-150'
                            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <Shield size={14} className={editorMode === 'safe' ? 'text-mahana-600 animate-pulse' : ''} />
                        Modo Seguro (Recomendado)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleEditorMode('advanced')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all font-sans ${
                          editorMode === 'advanced'
                            ? 'bg-amber-50 text-amber-800 shadow-xs border border-amber-200'
                            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <ShieldAlert size={14} className={editorMode === 'advanced' ? 'text-amber-600' : ''} />
                        Modo Avanzado (HTML)
                      </button>
                    </div>
                  )}

                  {editorMode === 'safe' ? (
                    <div className="space-y-4">
                      {/* Asunto (Solo si es Email) */}
                      {selectedPlantilla.canal === 'email' && (
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 font-sans">
                            Asunto del Correo
                          </label>
                          <input
                            id="edit-asunto"
                            type="text"
                            value={editAsunto}
                            onChange={e => setEditAsunto(e.target.value)}
                            onFocus={() => setLastFocusedInput('asunto')}
                            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 focus:border-transparent outline-none transition text-sm font-sans"
                            placeholder="Ingrese el asunto del correo..."
                          />
                        </div>
                      )}

                      {/* Email Safe Fields */}
                      {selectedPlantilla.canal === 'email' ? (
                        <>
                          <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 font-sans">
                              Título de Cabecera (H2)
                            </label>
                            <input
                              type="text"
                              value={safeHeader}
                              onChange={e => setSafeHeader(e.target.value)}
                              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 focus:border-transparent outline-none transition text-sm font-sans font-semibold text-gray-800"
                              placeholder="Ej: ✅ ¡Reserva Confirmada!"
                            />
                            <p className="text-[10px] text-gray-400 mt-1">Este título se muestra resaltado al inicio del correo electrónico.</p>
                          </div>

                          <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 font-sans">
                              Mensaje de Introducción (Cuerpo)
                            </label>
                            <textarea
                              rows={6}
                              value={safeIntro}
                              onChange={e => setSafeIntro(e.target.value)}
                              onFocus={() => setLastFocusedInput('contenido')}
                              id="edit-contenido-safe"
                              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 focus:border-transparent outline-none transition text-sm leading-relaxed resize-y font-sans"
                              placeholder="Escriba el mensaje principal del correo..."
                            />
                            <p className="text-[10px] text-gray-400 mt-1">El texto principal que recibirá el cliente. Los botones y el formato de tabla contable se mantienen intactos automáticamente.</p>
                          </div>
                        </>
                      ) : (
                        /* WhatsApp Safe Plain Text Editor */
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 font-sans">
                            Mensaje de WhatsApp
                          </label>
                          <textarea
                            id="edit-contenido"
                            rows={10}
                            value={safeIntro}
                            onChange={e => setSafeIntro(e.target.value)}
                            onFocus={() => setLastFocusedInput('contenido')}
                            className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 focus:border-transparent outline-none transition text-sm leading-relaxed resize-y font-sans"
                            placeholder="Escriba el mensaje de WhatsApp..."
                          />
                          <p className="text-[10px] text-gray-400 mt-1">Mensaje de texto sin código HTML, seguro de editar y con variables automáticas.</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Modo Avanzado Panel */
                    <div className="space-y-4 animate-fadeIn">
                      {/* Premium Warning Banner */}
                      <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3 text-red-800 text-xs font-sans">
                        <ShieldAlert size={20} className="text-red-600 shrink-0 mt-0.5" />
                        <div>
                          <h4 className="font-bold text-red-950">⚠️ ¡Atención! Estás en Modo Avanzado (HTML)</h4>
                          <p className="mt-0.5 leading-normal text-red-700">
                            Modificar directamente el código HTML puede romper el diseño responsivo, las tablas de precios, las fuentes y los enlaces de acción rápida. Proceda con precaución.
                          </p>
                        </div>
                      </div>

                      {/* Asunto (Solo si es Email) */}
                      {selectedPlantilla.canal === 'email' && (
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 font-sans">
                            Asunto del Correo
                          </label>
                          <input
                            id="edit-asunto"
                            type="text"
                            value={editAsunto}
                            onChange={e => setEditAsunto(e.target.value)}
                            onFocus={() => setLastFocusedInput('asunto')}
                            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 focus:border-transparent outline-none transition text-sm font-sans"
                            placeholder="Ingrese el asunto del correo..."
                          />
                        </div>
                      )}

                      {/* Mensaje / Cuerpo HTML */}
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 font-sans">
                          Cuerpo del Mensaje (HTML Completo)
                        </label>
                        <textarea
                          id="edit-contenido"
                          rows={14}
                          value={editContenido}
                          onChange={e => setEditContenido(e.target.value)}
                          onFocus={() => setLastFocusedInput('contenido')}
                          className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 focus:border-transparent outline-none transition text-sm font-mono leading-relaxed resize-y"
                          placeholder="Escriba el código HTML del correo..."
                        />
                      </div>
                    </div>
                  )}

                  {/* Dynamic Variable Badges Grid */}
                  <div className="space-y-3 bg-gray-50/70 border border-gray-150 p-4 rounded-xl">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-700 flex items-center gap-1 font-sans">
                        <Sparkles size={14} className="text-amber-500" /> Etiquetas Dinámicas Clicables
                      </span>
                      <span className="text-[10px] text-gray-400 font-semibold font-sans">
                        Último foco: {lastFocusedInput === 'asunto' ? 'Asunto' : 'Cuerpo'}
                      </span>
                    </div>
                    
                    <p className="text-[11px] text-gray-500 leading-normal font-sans">
                      Posicione el cursor en el texto de arriba y haga clic en cualquiera de las siguientes etiquetas para insertarla automáticamente:
                    </p>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 max-h-[160px] overflow-y-auto pr-1">
                      {selectedPlantilla.variables.map(v => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => insertVariable(v)}
                          className="p-2 text-left text-xs bg-white border border-gray-200 rounded-xl hover:bg-mahana-50 hover:border-mahana-300 transition-all font-medium text-gray-700 flex flex-col justify-center shadow-xs"
                          title={`Insertar {{${v}}}`}
                        >
                          <span className="font-mono text-mahana-600 text-[10px] font-bold">{"{{" + v + "}}"}</span>
                          <span className="text-[9px] text-gray-400 truncate mt-0.5 font-sans">{VAR_LABELS[v] || v}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Panel Buttons */}
                  <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100 font-sans">
                    <button
                      onClick={() => setSelectedPlantilla(null)}
                      className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl text-xs transition"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleSavePlantilla}
                      disabled={savingPlantilla}
                      className="px-5 py-2 bg-gradient-to-r from-mahana-500 to-mahana-600 text-white font-semibold rounded-xl text-xs hover:shadow-lg transform hover:-translate-y-0.5 transition flex items-center gap-1 disabled:opacity-50"
                    >
                      <Save size={12} /> {savingPlantilla ? 'Guardando...' : 'Guardar Cambios'}
                    </button>
                  </div>
                </div>

                {/* Panel Derecho: Previsualización en Tiempo Real (5 columnas) */}
                <div className="lg:col-span-5 bg-white border border-gray-200 rounded-2xl p-6 space-y-4 shadow-sm flex flex-col min-h-[480px]">
                  <div className="border-b border-gray-100 pb-2 flex items-center justify-between shrink-0 font-sans">
                    <h3 className="font-bold text-gray-800 text-sm flex items-center gap-1.5">
                      <Eye size={16} className="text-ocean-600" /> Previsualización en Vivo
                    </h3>
                    
                    {loadingPreview && (
                      <span className="text-[10px] text-mahana-500 font-semibold flex items-center gap-1 animate-pulse">
                        <RefreshCw size={10} className="animate-spin" /> Renderizando...
                      </span>
                    )}
                  </div>

                  {selectedPlantilla.canal === 'email' ? (
                    // Correo electrónico: Mockup de cliente de correo
                    <div className="flex-1 flex flex-col border border-gray-200 rounded-2xl overflow-hidden shadow-inner bg-gray-50">
                      {/* Browser Chrome Header */}
                      <div className="bg-gray-150 px-4 py-3 flex items-center gap-2 border-b border-gray-200 shrink-0 select-none">
                        <div className="flex gap-1.5 shrink-0">
                          <span className="w-2.5 h-2.5 rounded-full bg-red-400 block"></span>
                          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 block"></span>
                          <span className="w-2.5 h-2.5 rounded-full bg-green-400 block"></span>
                        </div>
                        <div className="w-full bg-white/70 border border-gray-200 rounded-lg text-[10px] text-gray-400 px-3 py-1 text-center font-mono truncate">
                          https://example.invalid/email-preview
                        </div>
                      </div>

                      {/* Email Header Details */}
                      <div className="p-4 bg-white border-b border-gray-150 text-xs space-y-1.5 shrink-0 font-sans">
                        <div>
                          <span className="font-bold text-gray-400 uppercase text-[9px] w-12 inline-block">De:</span>
                          <span className="text-gray-700 font-medium">Hotel Panamá Canal &lt;correo@example.invalid&gt;</span>
                        </div>
                        <div>
                          <span className="font-bold text-gray-400 uppercase text-[9px] w-12 inline-block">Para:</span>
                          <span className="text-gray-700 font-medium">juan.perez@example.com</span>
                        </div>
                        <div className="pt-1.5 border-t border-gray-50 mt-1">
                          <span className="font-bold text-gray-400 uppercase text-[9px] w-12 inline-block">Asunto:</span>
                          <span className="text-gray-800 font-bold">{previewAsunto || '(Sin asunto)'}</span>
                        </div>
                      </div>

                      {/* Live rendered email iframe */}
                      <div className="flex-1 min-h-[300px] relative bg-white">
                        {loadingPreview && (
                          <div className="absolute inset-0 bg-white/75 flex items-center justify-center z-10 transition-opacity">
                            <RefreshCw size={24} className="text-mahana-500 animate-spin" />
                          </div>
                        )}
                        <iframe
                          title="Previsualización de Correo"
                          srcDoc={previewContenido}
                          className="w-full h-full border-none bg-white"
                          sandbox="allow-popups"
                        />
                      </div>
                    </div>
                  ) : (
                    // WhatsApp: Mockup de pantalla de chat de smartphone extremadamente premium
                    <div className="flex-1 flex items-center justify-center py-2 bg-gray-50 rounded-2xl border border-gray-150 shadow-inner">
                      {/* Teléfono Inteligente Mockup Frame */}
                      <div className="border-[8px] border-gray-800 rounded-[2.5rem] bg-gray-800 overflow-hidden shadow-xl w-full max-w-[310px] aspect-[9/18.5] flex flex-col relative">
                        {/* Notch */}
                        <div className="absolute top-0 left-1/2 transform -translate-x-1/2 h-4 w-28 bg-gray-800 rounded-b-xl z-20 flex items-center justify-center">
                          <div className="w-1.5 h-1.5 rounded-full bg-gray-900 absolute left-8"></div>
                          <div className="w-8 h-1 bg-gray-900 rounded-full"></div>
                        </div>

                        {/* WhatsApp Header Panel */}
                        <div className="bg-[#075e54] text-white px-4 pt-6 pb-2.5 flex items-center justify-between shrink-0 select-none font-sans">
                          <div className="flex items-center gap-2">
                            <span className="text-white text-xs">←</span>
                            <div className="w-7 h-7 rounded-full bg-[#128c7e] flex items-center justify-center font-bold text-xs border border-white/20">
                              CM
                            </div>
                            <div>
                              <h4 className="text-[11px] font-bold leading-tight font-sans">Hotel Panamá Canal - Recepción</h4>
                              <span className="text-[9px] text-green-300 font-medium flex items-center gap-0.5 leading-none font-sans">
                                <span className="w-1.5 h-1.5 bg-green-400 rounded-full block animate-pulse"></span>
                                en línea
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-white/80">
                            <span className="text-xs">📞</span>
                            <span className="text-xs">⋮</span>
                          </div>
                        </div>

                        {/* WhatsApp Chat Body with textured background */}
                        <div
                          className="flex-1 p-3 overflow-y-auto relative flex flex-col justify-between"
                          style={{
                            backgroundColor: '#efeae2',
                                                        backgroundRepeat: 'repeat',
                            backgroundSize: '150px'
                          }}
                        >
                          {loadingPreview && (
                            <div className="absolute inset-0 bg-white/30 flex items-center justify-center z-10">
                              <RefreshCw size={24} className="text-green-600 animate-spin" />
                            </div>
                          )}
                          
                          <div className="flex flex-col space-y-3">
                            {/* Date bubble */}
                            <div className="self-center bg-white/70 border border-gray-200/40 text-[9px] text-gray-500 font-bold uppercase px-2 py-0.5 rounded shadow-xs select-none font-sans">
                              Hoy
                            </div>

                            {/* WhatsApp Message Bubble */}
                            <div className="bg-[#d9fdd3] text-gray-800 p-3 rounded-lg shadow-xs max-w-[88%] self-start relative border border-[#e1f3d4] rounded-tl-none animate-fadeIn flex flex-col">
                              {/* Triangle Tail */}
                              <div className="absolute top-0 -left-1.5 w-0 h-0 border-t-[8px] border-t-[#d9fdd3] border-l-[8px] border-l-transparent"></div>
                              
                              {/* Rendered Text with dynamic custom HTML formatting */}
                              <div
                                className="text-[11px] whitespace-pre-wrap font-sans leading-relaxed text-gray-800 break-words"
                                dangerouslySetInnerHTML={{ __html: formatWhatsAppText(previewContenido) }}
                              />
                              
                              <div className="flex items-center justify-end gap-0.5 self-end mt-1 mt-auto shrink-0 select-none font-sans">
                                <span className="text-[8px] text-gray-400 font-medium">17:11</span>
                                <span className="text-[10px] text-blue-500 font-bold leading-none">✓✓</span>
                              </div>
                            </div>
                          </div>

                          {/* Bottom mock input bar */}
                          <div className="bg-white/90 backdrop-blur-xs p-1 rounded-full flex items-center gap-1 mt-4 border border-gray-200 shrink-0 select-none shadow-xs">
                            <span className="text-xs pl-2 text-gray-400">😊</span>
                            <span className="text-[10px] text-gray-400 flex-1 font-sans">Mensaje</span>
                            <span className="text-xs text-gray-400 pr-2">📎</span>
                            <div className="w-6 h-6 rounded-full bg-[#00a884] flex items-center justify-center text-white text-xs shadow-sm">
                              🎤
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

              </div>
            </div>
          )}
        </div>
      )}

      {/* Raw JSON Error Modal */}
      {selectedLogResult && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden transform transition-all animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-red-600 px-6 py-4 text-white flex justify-between items-center">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <ShieldAlert size={20} /> Detalle del Fallo de Envío
              </h2>
              <button
                onClick={() => setSelectedLogResult(null)}
                className="text-white/80 hover:text-white text-xl outline-none"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">
                A continuación se muestra el error devuelto por la pasarela de mensajería:
              </p>
              <div className="bg-gray-900 text-green-400 p-4 rounded-xl font-mono text-xs overflow-x-auto max-h-72 border border-gray-800 shadow-inner">
                {JSON.stringify(selectedLogResult, null, 2)}
              </div>
              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setSelectedLogResult(null)}
                  className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl text-sm transition"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Visualizador de Mensaje de Notificación (Configuración) */}
      {selectedLogForView && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-55 p-4 animate-fadeIn">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl p-6 relative flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3 mb-4">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <Mail size={20} className="text-ocean-600" /> Detalle de Notificación Enviada
              </h3>
              <button
                onClick={() => setSelectedLogForView(null)}
                className="text-gray-400 hover:text-gray-600 transition outline-none text-xl animate-scaleIn"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm bg-gray-50 p-4 rounded-xl mb-4 shrink-0">
              <div>
                <span className="text-xs font-bold text-gray-400 uppercase">Destinatario:</span>
                <p className="font-semibold text-gray-800 break-all">{selectedLogForView.destinatario || '—'}</p>
              </div>
              <div>
                <span className="text-xs font-bold text-gray-400 uppercase">Fecha de Envío:</span>
                <p className="font-semibold text-gray-800">{formatDate(selectedLogForView.created_at)}</p>
              </div>
              <div>
                <span className="text-xs font-bold text-gray-400 uppercase">Canal de Envío:</span>
                <div className="mt-1">
                  {selectedLogForView.canal === 'email' ? (
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
                  {getNotifTypeLabel(selectedLogForView.tipo)}
                </div>
              </div>
              {selectedLogForView.reserva_id && (
                <div className="md:col-span-2">
                  <span className="text-xs font-bold text-gray-400 uppercase">Reserva Relacionada:</span>
                  <p className="mt-0.5">
                    <a
                      href={`/reservas/${selectedLogForView.reserva_id}`}
                      className="text-ocean-600 font-semibold hover:underline inline-flex items-center gap-1 text-sm font-sans"
                      onClick={() => setSelectedLogForView(null)}
                    >
                      Ver Reserva #{selectedLogForView.reserva_id} <ExternalLink size={12} />
                    </a>
                  </p>
                </div>
              )}
            </div>

            {/* Error detail banner if failed */}
            {(() => {
              const statusInfo = parseResultStatus(selectedLogForView.resultado);
              if (!statusInfo.success) {
                return (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 shrink-0 text-sm">
                    <h4 className="font-bold text-red-800 flex items-center gap-1.5 mb-1">
                      <ShieldAlert size={16} /> Error de Entrega / Envío
                    </h4>
                    <p className="text-red-700 text-xs font-mono bg-white p-2.5 border border-red-100 rounded-lg overflow-x-auto max-h-24">
                      {typeof statusInfo.details === 'object' ? JSON.stringify(statusInfo.details) : String(statusInfo.details || 'Error desconocido')}
                    </p>
                  </div>
                );
              }
              return null;
            })()}

            <div className="flex-1 overflow-y-auto mb-4 min-h-[250px]">
              <span className="text-xs font-bold text-gray-400 uppercase block mb-1.5">Contenido del Mensaje:</span>
              
              {selectedLogForView.canal === 'email' ? (
                selectedLogForView.contenido ? (
                  <iframe
                    title="Previsualización de Correo"
                    srcDoc={selectedLogForView.contenido}
                    className="w-full h-[300px] border border-gray-200 rounded-xl bg-white shadow-inner"
                    sandbox="allow-popups"
                  />
                ) : (
                  <div className="flex items-center justify-center h-48 border border-gray-100 rounded-xl bg-gray-50 text-gray-400 text-sm italic">
                    Sin contenido guardado (registro histórico previo a la actualización)
                  </div>
                )
              ) : (
                /* WhatsApp Mockup Chat bubble */
                selectedLogForView.contenido ? (
                  <div
                    className="bg-[#efeae2] p-6 rounded-xl border border-gray-200 relative overflow-hidden"
                    style={{
                                            backgroundRepeat: 'repeat',
                    }}
                  >
                    <div className="flex flex-col space-y-2">
                      <div className="bg-[#d9fdd3] text-gray-800 p-4 rounded-lg shadow-sm max-w-[85%] self-end relative border border-[#e1f3d4]">
                        <p className="text-sm whitespace-pre-wrap font-sans leading-relaxed text-gray-700">
                          {selectedLogForView.contenido}
                        </p>
                        <span className="text-[10px] text-gray-400 block text-right mt-2 font-medium">
                          {formatDate(selectedLogForView.created_at)}
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
              {!selectedLogForView.contenido ? (
                <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg font-medium flex items-center gap-1">
                  ⚠️ Registro histórico sin contenido guardado. No es posible reenviar.
                </span>
              ) : (
                <button
                  onClick={() => {
                    if (confirm('¿Está seguro de que desea reenviar este mensaje al destinatario original?')) {
                      handleResendNotif(selectedLogForView.id);
                    }
                  }}
                  disabled={resendingLogId !== null}
                  className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl text-sm transition disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
                >
                  <RefreshCw size={14} className={resendingLogId === selectedLogForView.id ? 'animate-spin' : ''} />
                  {resendingLogId === selectedLogForView.id ? 'Reenviando...' : 'Reenviar Notificación'}
                </button>
              )}

              <button
                onClick={() => setSelectedLogForView(null)}
                className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl text-sm transition"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
