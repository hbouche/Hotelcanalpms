import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../api/client';
import { 
  Users, Plus, Calculator, FileText, ClipboardList, Trash2, Edit2, 
  Check, Phone, Mail, FileDown, Calendar, MessageSquare, ArrowLeft, 
  AlertCircle, DollarSign, Award 
} from 'lucide-react';

type Lead = {
  id: number;
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  notas: string;
  estado: string; // 'Borrador' | 'Enviada' | 'En Negociación' | 'Aceptada' | 'Rechazada'
  atendido: number;
  fecha_seguimiento: string;
  oferta_mejora: number;
  fecha_evento?: string;
  created_at: string;
  updated_at: string;
  total_cotizaciones: number;
  ultima_cotizacion_fecha: string;
  valor_total: number;
};

type QuoteItem = {
  nombre: string;
  precio: number;
  tipo_precio: 'global' | 'por_persona';
  precio_unitario: number;
  cantidad: number;
};

type PreloadedService = {
  id: number;
  nombre: string;
  descripcion: string;
  precio_base: number;
  tipo_precio: 'global' | 'por_persona';
  activo?: number | boolean;
};

type Plan = {
  id: number;
  codigo: string;
  nombre: string;
  precio_adulto_noche: number;
};

export default function CotizadorCRM() {
  const [propertyRates, setPropertyRates] = useState({ impuesto_turismo_pct: 0, deposito_sugerido_pct: 0 });
  useEffect(() => {
    api.get('/public/hotel-config').then(r => {
      if (r.data) setPropertyRates({
        impuesto_turismo_pct: Number(r.data.impuesto_turismo_pct) || 0,
        deposito_sugerido_pct: Number(r.data.deposito_sugerido_pct) || 0,
      });
    }).catch(() => setError('No se pudo cargar la configuración fiscal de la propiedad.'));
  }, []);

  // Navigation & UI state
  const [activeTab, setActiveTab] = useState<'leads' | 'builder'>('leads');
  const [subTab, setSubTab] = useState<'dashboard' | 'leads' | 'catalog'>('dashboard');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leadQuotes, setLeadQuotes] = useState<any[]>([]);
  
  // Dashboard Filters & Sorting state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [atendidoFilter, setAtendidoFilter] = useState('all');
  const [sortField, setSortField] = useState<string>('updated_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'nombre' || field === 'fecha_evento' || field === 'fecha_seguimiento' || field === 'estado' ? 'asc' : 'desc');
    }
  };

  const dropdownValue = useMemo(() => {
    if (sortField === 'updated_at' && sortDirection === 'desc') return 'recent';
    if (sortField === 'created_at' && sortDirection === 'asc') return 'oldest';
    if (sortField === 'valor_total' && sortDirection === 'desc') return 'value_desc';
    if (sortField === 'valor_total' && sortDirection === 'asc') return 'value_asc';
    return 'custom';
  }, [sortField, sortDirection]);
  
  // Preloaded data
  const [preloadedServices, setPreloadedServices] = useState<PreloadedService[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  
  // Loading & error status
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Lead form modal / drawer
  const [showLeadModal, setShowLeadModal] = useState(false);
  const [editingLeadId, setEditingLeadId] = useState<number | null>(null);
  const [leadForm, setLeadForm] = useState({
    nombre: '',
    apellido: '',
    email: '',
    telefono: '',
    notas: '',
    estado: 'Borrador',
    atendido: false,
    fecha_seguimiento: '',
    oferta_mejora: false
  });

  // KPI calculations
  const kpis = useMemo(() => {
    const totalLeads = leads.length;
    const totalValue = leads.reduce((sum, l) => sum + Number(l.valor_total || 0), 0);
    const converted = leads.filter(l => l.estado === 'Aceptada').length;
    const pending = leads.filter(l => l.estado === 'En Negociación').length;
    const conversionRate = totalLeads ? ((converted / totalLeads) * 100).toFixed(1) : '0';
    const activeFollowups = leads.filter(l => l.fecha_seguimiento && new Date(l.fecha_seguimiento) >= new Date()).length;
    
    return [
      { label: 'Total Prospectos', value: totalLeads, icon: Users, color: 'text-blue-600' },
      { label: 'Valor Total', value: `$${totalValue.toLocaleString()}`, icon: DollarSign, color: 'text-green-600' },
      { label: 'Tasa Conversión', value: `${conversionRate}%`, icon: Award, color: 'text-purple-600' },
      { label: 'En Negociación', value: pending, icon: MessageSquare, color: 'text-orange-600' },
      { label: 'Seguimientos Activos', value: activeFollowups, icon: Calendar, color: 'text-cyan-600' },
      { label: 'Cotizaciones Aceptadas', value: converted, icon: Check, color: 'text-emerald-600' }
    ];
  }, [leads]);

  // Services Catalog form state
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [editingServiceId, setEditingServiceId] = useState<number | null>(null);
  const [serviceForm, setServiceForm] = useState({
    nombre: '',
    descripcion: '',
    precio_base: 0,
    tipo_precio: 'global' as 'global' | 'por_persona',
    activo: true
  });


  // Quotation Builder Form State
  const [quoteForm, setQuoteForm] = useState({
    check_in: '',
    check_out: '',
    noches: 1,
    adultos: 1,
    menores: 0,
    mascotas: 0,
    plan_codigo: '',
    base_price: 0,
    descuento: 0,
    descuento_tipo: 'fijo' as 'fijo' | 'porcentaje',
    notas: '',
    habitaciones_seleccionadas: [] as string[]
  });
  
  // Custom items added to this quote
  const [selectedServices, setSelectedServices] = useState<QuoteItem[]>([]);
  const [selectedPreloadedId, setSelectedPreloadedId] = useState('');
  const [manualItem, setManualItem] = useState({ nombre: '', precio: '', tipo_precio: 'global' as 'global' | 'por_persona' });
  
  // Selected Quote for preview / printing
  const [activePreviewQuote, setActivePreviewQuote] = useState<any | null>(null);

  const getPlanNombre = (codigo?: string) => {
    if (!codigo) return 'Tarifa Estándar';
    const plan = plans.find(p => p.codigo === codigo);
    return plan ? plan.nombre : codigo;
  };

  // Fetch initial CRM data
  useEffect(() => {
    fetchLeads();
    fetchPreloadedData();
  }, []);

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const res = await api.get('/crm/leads');
      setLeads(res.data || []);
    } catch (e: any) {
      setError('Error al obtener prospectos.');
    } finally {
      setLoading(false);
    }
  };

  const fetchPreloadedData = async () => {
    try {
      const [resServices, resPlans] = await Promise.all([
        api.get('/crm/servicios'),
        api.get('/hotel/planes')
      ]);
      setPreloadedServices(resServices.data || []);
      setPlans(resPlans.data || []);
    } catch (e) {
      console.error('Error fetching services/plans', e);
    }
  };

  const fetchServicesCatalog = async () => {
    try {
      const res = await api.get('/crm/servicios', { params: { include_inactive: 'true' } });
      setPreloadedServices(res.data || []);
    } catch (e) {
      setError('Error al cargar catálogo de servicios.');
    }
  };

  const handleServiceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceForm.nombre || serviceForm.precio_base < 0) {
      setError('Nombre y precio base válidos son requeridos.');
      return;
    }
    setError('');
    try {
      if (editingServiceId) {
        await api.put(`/crm/servicios/${editingServiceId}`, serviceForm);
        setSuccess('Servicio actualizado con éxito.');
      } else {
        await api.post('/crm/servicios', serviceForm);
        setSuccess('Servicio creado con éxito.');
      }
      setShowServiceModal(false);
      setServiceForm({ nombre: '', descripcion: '', precio_base: 0, tipo_precio: 'global', activo: true });
      setEditingServiceId(null);
      fetchServicesCatalog();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Error al guardar el servicio.');
    }
  };

  const handleDeactivateService = async (id: number) => {
    if (!window.confirm('¿Estás seguro de desactivar este servicio?')) return;
    try {
      await api.delete(`/crm/servicios/${id}`);
      setSuccess('Servicio desactivado.');
      fetchServicesCatalog();
      setTimeout(() => setSuccess(''), 3000);
    } catch (e) {
      setError('Error al desactivar el servicio.');
    }
  };

  const selectLeadDetails = async (lead: Lead) => {

    setSelectedLead(lead);
    setLoading(true);
    try {
      const res = await api.get(`/crm/leads/${lead.id}`);
      setLeadQuotes(res.data.cotizaciones || []);
      if (res.data.cotizaciones && res.data.cotizaciones.length > 0) {
        setActivePreviewQuote(res.data.cotizaciones[0]);
      } else {
        setActivePreviewQuote(null);
      }
    } catch (e) {
      setError('Error al obtener cotizaciones del prospecto.');
    } finally {
      setLoading(false);
    }
  };

  // Lead CRUD
  const handleLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadForm.nombre) {
      setError('El nombre es obligatorio.');
      return;
    }
    setError('');
    try {
      const payload = {
        ...leadForm,
        atendido: leadForm.atendido ? 1 : 0,
        oferta_mejora: leadForm.oferta_mejora ? 1 : 0
      };
      
      if (editingLeadId) {
        await api.put(`/crm/leads/${editingLeadId}`, payload);
        setSuccess('Prospecto actualizado con éxito.');
      } else {
        await api.post('/crm/leads', payload);
        setSuccess('Prospecto creado con éxito.');
      }
      setShowLeadModal(false);
      setLeadForm({
        nombre: '',
        apellido: '',
        email: '',
        telefono: '',
        notas: '',
        estado: 'Borrador',
        atendido: false,
        fecha_seguimiento: '',
        oferta_mejora: false
      });
      setEditingLeadId(null);
      fetchLeads();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Error al guardar el prospecto.');
    }
  };

  const handleCreateLeadClick = () => {
    setEditingLeadId(null);
    setLeadForm({
      nombre: '',
      apellido: '',
      email: '',
      telefono: '',
      notas: '',
      estado: 'Borrador',
      atendido: false,
      fecha_seguimiento: '',
      oferta_mejora: false
    });
    setShowLeadModal(true);
  };

  const handleEditLead = (lead: Lead) => {
    setEditingLeadId(lead.id);
    setLeadForm({
      nombre: lead.nombre,
      apellido: lead.apellido || '',
      email: lead.email || '',
      telefono: lead.telefono || '',
      notas: lead.notas || '',
      estado: lead.estado || 'Borrador',
      atendido: lead.atendido === 1,
      fecha_seguimiento: lead.fecha_seguimiento || '',
      oferta_mejora: lead.oferta_mejora === 1
    });
    setShowLeadModal(true);
  };

  const handleDeleteLead = async (leadId: number) => {
    if (!window.confirm('¿Estás seguro de eliminar este prospecto? Se eliminarán todas sus cotizaciones asociadas de forma permanente.')) return;
    try {
      await api.delete(`/crm/leads/${leadId}`);
      setSuccess('Prospecto eliminado.');
      setSelectedLead(null);
      setLeadQuotes([]);
      setActivePreviewQuote(null);
      fetchLeads();
      setTimeout(() => setSuccess(''), 3000);
    } catch (e) {
      setError('Error al eliminar el prospecto.');
    }
  };

  const handleToggleAtendido = async (lead: Lead) => {
    try {
      const newAtendido = lead.atendido === 1 ? 0 : 1;
      await api.put(`/crm/leads/${lead.id}`, {
        nombre: lead.nombre,
        apellido: lead.apellido || '',
        email: lead.email || '',
        telefono: lead.telefono || '',
        notas: lead.notas || '',
        estado: lead.estado || 'Borrador',
        atendido: newAtendido,
        fecha_seguimiento: lead.fecha_seguimiento || '',
        oferta_mejora: lead.oferta_mejora || 0
      });
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, atendido: newAtendido } : l));
      if (selectedLead && selectedLead.id === lead.id) {
        setSelectedLead(prev => prev ? { ...prev, atendido: newAtendido } : null);
      }
      setSuccess('Estado de atención actualizado.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e) {
      setError('Error al actualizar el estado de atención.');
    }
  };

  const handleToggleOfertaMejora = async (lead: Lead) => {
    try {
      const newOferta = lead.oferta_mejora === 1 ? 0 : 1;
      await api.put(`/crm/leads/${lead.id}`, {
        nombre: lead.nombre,
        apellido: lead.apellido || '',
        email: lead.email || '',
        telefono: lead.telefono || '',
        notas: lead.notas || '',
        estado: lead.estado || 'Borrador',
        atendido: lead.atendido || 0,
        fecha_seguimiento: lead.fecha_seguimiento || '',
        oferta_mejora: newOferta
      });
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, oferta_mejora: newOferta } : l));
      if (selectedLead && selectedLead.id === lead.id) {
        setSelectedLead(prev => prev ? { ...prev, oferta_mejora: newOferta } : null);
      }
      setSuccess('Estado de oferta de mejora actualizado.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e) {
      setError('Error al actualizar oferta de mejora.');
    }
  };

  const handleLoadQuoteForEdit = (quote: any) => {
    const parsedItems = Array.isArray(quote.items_adicionales) 
      ? quote.items_adicionales 
      : JSON.parse(quote.items_adicionales || '[]');

    const parsedHabs = Array.isArray(quote.habitaciones_seleccionadas)
      ? quote.habitaciones_seleccionadas
      : JSON.parse(quote.habitaciones_seleccionadas || '[]');

    setQuoteForm({
      check_in: quote.check_in || '',
      check_out: quote.check_out || '',
      noches: quote.noches || 1,
      adultos: quote.adultos || 1,
      menores: quote.menores || 0,
      mascotas: quote.mascotas || 0,
      plan_codigo: quote.plan_codigo || '',
      base_price: quote.subtotal - parsedItems.reduce((sum: number, i: any) => sum + i.precio, 0),
      descuento: quote.descuento || 0,
      descuento_tipo: quote.descuento_tipo || 'fijo',
      notas: quote.notas || '',
      habitaciones_seleccionadas: parsedHabs
    });
    setSelectedServices(parsedItems);
    setActiveTab('builder');
  };

  const handleStatusChange = async (leadId: number, newStatus: string) => {
    try {
      await api.patch(`/crm/leads/${leadId}/status`, { estado: newStatus });
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, estado: newStatus } : l));
      if (selectedLead && selectedLead.id === leadId) {
        setSelectedLead(prev => prev ? { ...prev, estado: newStatus } : null);
      }
      setSuccess('Estado del prospecto actualizado.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e) {
      setError('Error al actualizar el estado.');
    }
  };

  // Auto calculate nights
  useEffect(() => {
    if (quoteForm.check_in && quoteForm.check_out && quoteForm.check_out > quoteForm.check_in) {
      const start = new Date(quoteForm.check_in);
      const end = new Date(quoteForm.check_out);
      const diffTime = Math.abs(end.getTime() - start.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      setQuoteForm(f => ({ ...f, noches: diffDays }));
    }
  }, [quoteForm.check_in, quoteForm.check_out]);

  // Fetch / estimate base rate using active plan rates
  useEffect(() => {
    if (
      quoteForm.plan_codigo && 
      quoteForm.check_in && 
      quoteForm.check_out && 
      quoteForm.check_out > quoteForm.check_in
    ) {
      api.get(`/hotel/cotizar`, {
        params: {
          plan: quoteForm.plan_codigo,
          adultos: quoteForm.adultos,
          menores: quoteForm.menores,
          mascotas: quoteForm.mascotas,
          check_in: quoteForm.check_in,
          check_out: quoteForm.check_out
        }
      }).then(res => {
        if (res.success && res.data) {
          // pre-populate base price with estimated room rate
          setQuoteForm(f => ({ ...f, base_price: res.data.monto_total }));
        }
      }).catch(e => {
        console.error('Error calculating estimate base rate', e);
      });
    }
  }, [quoteForm.plan_codigo, quoteForm.check_in, quoteForm.check_out, quoteForm.adultos, quoteForm.menores, quoteForm.mascotas]);

  // Calculations
  const calculatedTotals = useMemo(() => {
    const base = Number(quoteForm.base_price) || 0;
    const totalGuests = (quoteForm.adultos || 0) + (quoteForm.menores || 0);

    const resolvedServices = selectedServices.map(item => {
      const isPerPerson = item.tipo_precio === 'por_persona';
      const cantidad = isPerPerson ? totalGuests : 1;
      const precio = item.precio_unitario * cantidad;
      return {
        ...item,
        cantidad,
        precio
      };
    });

    const additional = resolvedServices.reduce((sum, item) => sum + item.precio, 0);
    const subtotal = base + additional;
    
    let discountAmount = 0;
    if (quoteForm.descuento_tipo === 'porcentaje') {
      discountAmount = subtotal * (Number(quoteForm.descuento) || 0) / 100;
    } else {
      discountAmount = Number(quoteForm.descuento) || 0;
    }
    
    const taxable = Math.max(0, subtotal - discountAmount);
    const tax = taxable * propertyRates.impuesto_turismo_pct / 100;
    const total = taxable + tax;
    const deposit = total * propertyRates.deposito_sugerido_pct / 100;

    return {
      resolvedServices,
      subtotal,
      discountAmount,
      taxable,
      tax,
      total,
      deposit
    };
  }, [quoteForm.base_price, selectedServices, quoteForm.descuento, quoteForm.descuento_tipo, quoteForm.adultos, quoteForm.menores, propertyRates]);

  // Preloaded services picker handler
  const handleAddPreloadedService = () => {
    if (!selectedPreloadedId) return;
    const service = preloadedServices.find(s => s.id === Number(selectedPreloadedId));
    if (service) {
      const isPerPerson = service.tipo_precio === 'por_persona';
      const totalGuests = (quoteForm.adultos || 0) + (quoteForm.menores || 0);
      const quantity = isPerPerson ? totalGuests : 1;
      setSelectedServices(prev => [
        ...prev, 
        { 
          nombre: service.nombre, 
          precio_unitario: service.precio_base,
          tipo_precio: service.tipo_precio || 'global',
          cantidad: quantity,
          precio: service.precio_base * quantity
        }
      ]);
      setSelectedPreloadedId('');
    }
  };

  // Manual items handler
  const handleAddManualItem = () => {
    if (!manualItem.nombre || !manualItem.precio) return;
    const priceVal = parseFloat(manualItem.precio) || 0;
    const isPerPerson = manualItem.tipo_precio === 'por_persona';
    const totalGuests = (quoteForm.adultos || 0) + (quoteForm.menores || 0);
    const quantity = isPerPerson ? totalGuests : 1;
    setSelectedServices(prev => [
      ...prev, 
      { 
        nombre: manualItem.nombre, 
        precio_unitario: priceVal,
        tipo_precio: manualItem.tipo_precio,
        cantidad: quantity,
        precio: priceVal * quantity
      }
    ]);
    setManualItem({ nombre: '', precio: '', tipo_precio: 'global' });
  };

  const handleRemoveService = (index: number) => {
    setSelectedServices(prev => prev.filter((_, i) => i !== index));
  };

  const handleSaveQuote = async () => {
    if (!selectedLead) return;
    setLoading(true);
    setError('');
    
    const payload = {
      check_in: quoteForm.check_in,
      check_out: quoteForm.check_out,
      noches: quoteForm.noches,
      adultos: quoteForm.adultos,
      menores: quoteForm.menores,
      mascotas: quoteForm.mascotas,
      plan_codigo: quoteForm.plan_codigo,
      habitaciones_seleccionadas: quoteForm.habitaciones_seleccionadas,
      items_adicionales: calculatedTotals.resolvedServices,
      subtotal: calculatedTotals.subtotal,
      descuento: quoteForm.descuento,
      descuento_tipo: quoteForm.descuento_tipo,
      impuesto_pct: propertyRates.impuesto_turismo_pct,
      impuesto_monto: calculatedTotals.tax,
      monto_total: calculatedTotals.total,
      deposito_sugerido: calculatedTotals.deposit,
      notas: quoteForm.notas
    };

    try {
      const res = await api.post(`/crm/leads/${selectedLead.id}/cotizaciones`, payload);
      setSuccess('Cotización guardada exitosamente.');
      
      // Reload lead details
      selectLeadDetails(selectedLead);
      
      // Reset form & go back
      setActiveTab('leads');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: any) {
      setError(e.response?.data?.error || 'Error al guardar la cotización.');
    } finally {
      setLoading(false);
    }
  };

  // Format whatsapp message
  const handleCopyQuoteToClipboard = (quote: any) => {
    if (!quote || !selectedLead) return;

    const checkInStr = quote.check_in || 'Por definir';
    const checkOutStr = quote.check_out || 'Por definir';
    const nochesStr = `${quote.noches} noche(s)`;
    const clienteFull = `${selectedLead.nombre} ${selectedLead.apellido}`.trim();
    
    const selectedPlan = plans.find(p => p.codigo === quote.plan_codigo);
    const planNombre = selectedPlan?.nombre || 'Tarifa Estándar';
    const isPasadia = quote.plan_codigo?.includes('pasadia') || quote.noches === 0;
    
    let huespedesStr = `${quote.adultos} Adulto${quote.adultos > 1 ? 's' : ''}`;
    if (quote.menores > 0) huespedesStr += `, ${quote.menores} Menor${quote.menores > 1 ? 'es' : ''}`;
    if (quote.mascotas > 0) huespedesStr += `, ${quote.mascotas} Mascota${quote.mascotas > 1 ? 's' : ''}`;

    let itemsStr = '';
    const parsedItems = Array.isArray(quote.items_adicionales) 
      ? quote.items_adicionales 
      : JSON.parse(quote.items_adicionales || '[]');
      
    if (parsedItems.length > 0) {
      itemsStr = '\n➕ *Servicios Adicionales Incluidos:*\n' + parsedItems.map((item: any) => {
        if (item.tipo_precio === 'por_persona' && item.precio_unitario && item.cantidad) {
          return `- ${item.nombre}: $${Number(item.precio_unitario).toFixed(2)} x ${item.cantidad} pers. = $${item.precio.toFixed(2)}`;
        }
        return `- ${item.nombre}: $${item.precio.toFixed(2)}`;
      }).join('\n') + '\n';
    }

    let discountStr = '';
    if (quote.descuento > 0) {
      discountStr = `• Descuento (${quote.descuento_tipo === 'porcentaje' ? `${quote.descuento}%` : `$${quote.descuento}`}): -$${(quote.subtotal - (quote.monto_total / 1.10)).toFixed(2)}\n`;
    }

    const text = `🌴 *COTIZACIÓN PERSONALIZADA - HOTEL PANAMÁ CANAL* 🌴

👤 *Cliente:* ${clienteFull}
📅 *Fechas:* ${checkInStr} al ${checkOutStr} (${nochesStr})
👥 *Huéspedes:* ${huespedesStr}
🏷️ *Plan:* ${planNombre}

💰 *Resumen Económico:*
• ${isPasadia ? `Pasadía Base (${planNombre})` : `Estadía Base (Plan: ${planNombre}, ${nochesStr})`}: $${(quote.subtotal - parsedItems.reduce((sum: number, i: any) => sum + i.precio, 0)).toFixed(2)}
${itemsStr}• Subtotal: $${quote.subtotal.toFixed(2)}
${discountStr}• Impuestos (${quote.impuesto_pct}%): $${quote.impuesto_monto.toFixed(2)}
• *Monto Total:* $${quote.monto_total.toFixed(2)}
• Depósito Sugerido: $${quote.deposito_sugerido.toFixed(2)}

¡Esperamos tener el gusto de hospedarle pronto en Hotel Panamá Canal! 🌊🥥`;

    navigator.clipboard.writeText(text).then(() => {
      setSuccess('Cotización copiada al portapapeles.');
      setTimeout(() => setSuccess(''), 3000);
    });
  };

  // Open native print dialog
  const handlePrintQuote = () => {
    window.print();
  };

  const metrics = useMemo(() => {
    const activeLeads = leads.filter(l => ['Borrador', 'Enviada', 'En Negociación'].includes(l.estado));
    const activeVal = activeLeads.reduce((sum, l) => sum + (l.valor_total || 0), 0);
    const wonLeads = leads.filter(l => l.estado === 'Aceptada');
    const wonVal = wonLeads.reduce((sum, l) => sum + (l.valor_total || 0), 0);
    const conversionRate = leads.length > 0 ? (wonLeads.length / leads.length) * 100 : 0;
    
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const thirtyDaysLater = new Date(now);
    thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);

    const closeEventsCount = activeLeads.filter(l => {
      if (!l.fecha_evento) return false;
      const evDate = new Date(l.fecha_evento + 'T12:00:00');
      return evDate >= now && evDate <= thirtyDaysLater;
    }).length;

    const upgradeOffersCount = activeLeads.filter(l => l.oferta_mejora === 1).length;
    
    return {
      activeCount: activeLeads.length,
      pipelineValue: activeVal,
      wonValue: wonVal,
      conversionRate,
      closeEventsCount,
      upgradeOffersCount
    };
  }, [leads]);

  const filteredLeads = useMemo(() => {
    return leads
      .filter(lead => {
        const fullName = `${lead.nombre} ${lead.apellido}`.toLowerCase();
        const email = (lead.email || '').toLowerCase();
        const phone = (lead.telefono || '').toLowerCase();
        const query = searchQuery.toLowerCase();
        
        const matchesQuery = fullName.includes(query) || email.includes(query) || phone.includes(query);
        const matchesStatus = statusFilter === '' ? true : lead.estado === statusFilter;
        
        let matchesAtendido = true;
        if (atendidoFilter === 'atendido') matchesAtendido = lead.atendido === 1;
        else if (atendidoFilter === 'pendiente') matchesAtendido = lead.atendido === 0;
        
        return matchesQuery && matchesStatus && matchesAtendido;
      })
      .sort((a, b) => {
        let valA = a[sortField as keyof Lead];
        let valB = b[sortField as keyof Lead];

        if (sortField === 'nombre') {
          const nameA = `${a.nombre} ${a.apellido}`.toLowerCase();
          const nameB = `${b.nombre} ${b.apellido}`.toLowerCase();
          return sortDirection === 'asc' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
        }

        if (sortField === 'fecha_evento' || sortField === 'fecha_seguimiento') {
          const dateA = valA ? new Date(valA as string).getTime() : 0;
          const dateB = valB ? new Date(valB as string).getTime() : 0;
          if (dateA === 0 && dateB !== 0) return 1;
          if (dateB === 0 && dateA !== 0) return -1;
          if (dateA === 0 && dateB === 0) return 0;
          return sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
        }

        if (sortField === 'updated_at' || sortField === 'created_at') {
          const dateA = new Date(valA as string).getTime();
          const dateB = new Date(valB as string).getTime();
          return sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
        }

        if (sortField === 'valor_total') {
          const numA = Number(valA || 0);
          const numB = Number(valB || 0);
          return sortDirection === 'asc' ? numA - numB : numB - numA;
        }

        // Default sorting
        if (valA === undefined || valA === null) valA = '';
        if (valB === undefined || valB === null) valB = '';

        if (typeof valA === 'string' && typeof valB === 'string') {
          return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }

        return sortDirection === 'asc'
          ? (valA > valB ? 1 : valA < valB ? -1 : 0)
          : (valB > valA ? 1 : valB < valA ? -1 : 0);
      });
  }, [leads, searchQuery, statusFilter, atendidoFilter, sortField, sortDirection]);

  return (
    <div className="space-y-6">
      {/* Dynamic Status / Alerts */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-3">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}
      
      {success && (
        <div className="p-4 bg-green-50 border border-green-200 text-green-700 rounded-xl flex items-center gap-3">
          <Check size={20} />
          <span>{success}</span>
        </div>
      )}

      {/* Sub-tabs to toggle between dashboard, leads and catalog management */}
      {activeTab === 'leads' && (
        <div className="flex border-b border-gray-200 mb-4">
          <button
            onClick={() => {
              setSubTab('dashboard');
              fetchLeads();
              fetchPreloadedData();
            }}
            className={`py-3 px-6 font-bold text-sm border-b-2 transition ${subTab === 'dashboard' ? 'border-mahana-600 text-mahana-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            📊 CRM Dashboard
          </button>
          <button
            onClick={() => {
              setSubTab('leads');
              fetchLeads();
              fetchPreloadedData();
            }}
            className={`py-3 px-6 font-bold text-sm border-b-2 transition ${subTab === 'leads' ? 'border-mahana-600 text-mahana-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            📋 Ficha de Prospectos
          </button>
          <button
            onClick={() => {
              setSubTab('catalog');
              fetchServicesCatalog();
            }}
            className={`py-3 px-6 font-bold text-sm border-b-2 transition ${subTab === 'catalog' ? 'border-mahana-600 text-mahana-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            ⚙️ Catálogo de Servicios
          </button>
        </div>
      )}

      {/* Main Tab Switch */}
      {activeTab === 'leads' && subTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Metrics upper dashboard */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
              <div className="p-3 bg-amber-50 rounded-xl text-amber-600">
                <Users size={24} />
              </div>
              <div>
                <span className="text-xs font-bold text-gray-400 uppercase block">Leads Activos</span>
                <span className="text-2xl font-black text-gray-800">{metrics.activeCount}</span>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
              <div className="p-3 bg-blue-50 rounded-xl text-blue-600">
                <DollarSign size={24} />
              </div>
              <div>
                <span className="text-xs font-bold text-gray-400 uppercase block">Valor Pipeline</span>
                <span className="text-2xl font-black text-gray-800">${Math.round(metrics.pipelineValue).toLocaleString('en-US')}</span>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
              <div className="p-3 bg-emerald-50 rounded-xl text-emerald-600">
                <Award size={24} />
              </div>
              <div>
                <span className="text-xs font-bold text-gray-400 uppercase block">Tasa de Conversión</span>
                <span className="text-2xl font-black text-gray-800">{metrics.conversionRate.toFixed(1)}%</span>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
              <div className="p-3 bg-green-50 rounded-xl text-green-600">
                <Check size={24} />
              </div>
              <div>
                <span className="text-xs font-bold text-gray-400 uppercase block">Ingresos Ganados</span>
                <span className="text-2xl font-black text-gray-800">${Math.round(metrics.wonValue).toLocaleString('en-US')}</span>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
              <div className="p-3 bg-red-50 rounded-xl text-red-650">
                <Calendar size={24} />
              </div>
              <div>
                <span className="text-xs font-bold text-gray-400 uppercase block">Cierres Próx.</span>
                <span className="text-2xl font-black text-gray-800">{metrics.closeEventsCount}</span>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
              <div className="p-3 bg-purple-50 rounded-xl text-purple-650">
                <ClipboardList size={24} />
              </div>
              <div>
                <span className="text-xs font-bold text-gray-400 uppercase block">Ofertas Mejora</span>
                <span className="text-2xl font-black text-gray-800">{metrics.upgradeOffersCount}</span>
              </div>
            </div>
          </div>

          {/* Filters & Search */}
          <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-4 mb-6">
            <div className="flex flex-col lg:flex-row gap-3 justify-between items-center">
              <div className="flex flex-wrap gap-2 w-full lg:w-auto">
                <input 
                  type="text" 
                  placeholder="Buscar prospecto..." 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="p-2 px-3 text-sm border rounded-xl w-full sm:w-64 bg-gray-55 focus:bg-white transition outline-none focus:ring-1 focus:ring-mahana-400 text-gray-800"
                />
                
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className="p-2 text-xs border rounded-xl bg-white font-semibold text-gray-700 outline-none"
                >
                  <option value="">Todos los Estados</option>
                  <option value="Borrador">Borrador</option>
                  <option value="Enviada">Enviada</option>
                  <option value="En Negociación">En Negociación</option>
                  <option value="Aceptada">Aceptada</option>
                  <option value="Rechazada">Rechazada</option>
                </select>

                <select
                  value={atendidoFilter}
                  onChange={e => setAtendidoFilter(e.target.value)}
                  className="p-2 text-xs border rounded-xl bg-white font-semibold text-gray-700 outline-none"
                >
                  <option value="all">Todas las Atenciones</option>
                  <option value="atendido">Atendidos</option>
                  <option value="pendiente">Pendientes</option>
                </select>

                <select
                  value={dropdownValue}
                  onChange={e => {
                    const val = e.target.value;
                    if (val === 'recent') { setSortField('updated_at'); setSortDirection('desc'); }
                    else if (val === 'oldest') { setSortField('created_at'); setSortDirection('asc'); }
                    else if (val === 'value_desc') { setSortField('valor_total'); setSortDirection('desc'); }
                    else if (val === 'value_asc') { setSortField('valor_total'); setSortDirection('asc'); }
                  }}
                  className="p-2 text-xs border rounded-xl bg-white font-semibold text-gray-700 outline-none"
                >
                  <option value="recent">Última Actividad</option>
                  <option value="oldest">Más Antiguos</option>
                  <option value="value_desc">Mayor Valor Cotizado</option>
                  <option value="value_asc">Menor Valor Cotizado</option>
                  {dropdownValue === 'custom' && <option value="custom">Orden Personalizado</option>}
                </select>
              </div>
              
              <button
                onClick={() => {
                  setSubTab('leads');
                  handleCreateLeadClick();
                }}
                className="px-4 py-2 bg-mahana-600 text-white rounded-xl hover:bg-mahana-700 transition flex items-center gap-1.5 text-sm font-bold w-full lg:w-auto justify-center"
              >
                <Plus size={16} />
                Nuevo Prospecto
              </button>
            </div>
          </div>

          {/* Interactive Leads Table */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/50 text-gray-400 font-bold uppercase tracking-wider text-xs select-none">
                    <th className="py-3.5 px-6 cursor-pointer hover:bg-gray-100/50 hover:text-gray-700 transition" onClick={() => handleSort('nombre')}>
                      <div className="flex items-center gap-1">
                        Cliente
                        {sortField === 'nombre' && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                      </div>
                    </th>
                    <th className="py-3.5 px-4 cursor-pointer hover:bg-gray-100/50 hover:text-gray-700 transition" onClick={() => handleSort('fecha_evento')}>
                      <div className="flex items-center gap-1">
                        Fecha Evento
                        {sortField === 'fecha_evento' && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                      </div>
                    </th>
                    <th className="py-3.5 px-4 cursor-pointer hover:bg-gray-100/50 hover:text-gray-700 transition" onClick={() => handleSort('fecha_seguimiento')}>
                      <div className="flex items-center gap-1">
                        Próximo Seguimiento
                        {sortField === 'fecha_seguimiento' && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                      </div>
                    </th>
                    <th className="py-3.5 px-4 cursor-pointer hover:bg-gray-100/50 hover:text-gray-700 transition" onClick={() => handleSort('updated_at')}>
                      <div className="flex items-center gap-1">
                        Última Actividad
                        {sortField === 'updated_at' && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                      </div>
                    </th>
                    <th className="py-3.5 px-4 cursor-pointer hover:bg-gray-100/50 hover:text-gray-700 transition" onClick={() => handleSort('atendido')}>
                      <div className="flex items-center gap-1">
                        Atendido
                        {sortField === 'atendido' && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                      </div>
                    </th>
                    <th className="py-3.5 px-4 cursor-pointer hover:bg-gray-100/50 hover:text-gray-700 transition" onClick={() => handleSort('oferta_mejora')}>
                      <div className="flex items-center gap-1">
                        Oferta Mejora
                        {sortField === 'oferta_mejora' && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                      </div>
                    </th>
                    <th className="py-3.5 px-4 cursor-pointer hover:bg-gray-100/50 hover:text-gray-700 transition" onClick={() => handleSort('estado')}>
                      <div className="flex items-center gap-1">
                        Estado
                        {sortField === 'estado' && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                      </div>
                    </th>
                    <th className="py-3.5 px-4 cursor-pointer hover:bg-gray-100/50 hover:text-gray-700 transition" onClick={() => handleSort('valor_total')}>
                      <div className="flex items-center gap-1">
                        Total Cotizado
                        {sortField === 'valor_total' && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                      </div>
                    </th>
                    <th className="py-3.5 px-6 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLeads.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-gray-400 text-sm">No se encontraron prospectos con los filtros actuales.</td>
                    </tr>
                  ) : (
                    filteredLeads.map(lead => {
                      const statusColors: Record<string, string> = {
                        'Borrador': 'bg-gray-100 text-gray-700 border-gray-200',
                        'Enviada': 'bg-blue-50 text-blue-700 border-blue-200',
                        'En Negociación': 'bg-amber-50 text-amber-700 border-amber-200',
                        'Aceptada': 'bg-green-50 text-green-700 border-green-200',
                        'Rechazada': 'bg-red-50 text-red-700 border-red-200'
                      };
                      
                      return (
                        <tr key={lead.id} className="border-b border-gray-100 hover:bg-gray-50/50 transition">
                          <td className="py-3.5 px-6">
                            <button
                              onClick={() => {
                                selectLeadDetails(lead);
                                setSubTab('leads');
                              }}
                              className="font-bold text-gray-800 hover:text-mahana-700 text-left transition outline-none block"
                            >
                              {lead.nombre} {lead.apellido}
                            </button>
                            <span className="text-xs text-gray-400 block mt-0.5">{lead.telefono || lead.email || 'Sin datos de contacto'}</span>
                          </td>
                          <td className="py-3.5 px-4 text-xs font-semibold text-gray-700">
                            {lead.fecha_evento ? (
                              <span className="flex items-center gap-1 text-mahana-800">
                                <Calendar size={12} className="inline text-mahana-600" />
                                {new Date(lead.fecha_evento + 'T12:00:00').toLocaleDateString()}
                              </span>
                            ) : (
                              <span className="text-gray-400 font-normal">Sin fecha</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-xs font-semibold text-gray-700">
                            {lead.fecha_seguimiento ? (
                              <span className="flex items-center gap-1 text-purple-800">
                                <Calendar size={12} className="inline text-purple-500" />
                                {new Date(lead.fecha_seguimiento + 'T12:00:00').toLocaleDateString()}
                              </span>
                            ) : (
                              <span className="text-gray-400 font-normal">No programado</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-xs text-gray-500">
                            {new Date(lead.updated_at).toLocaleDateString()}
                          </td>
                          <td className="py-3.5 px-4">
                            <label className="inline-flex items-center cursor-pointer">
                              <input 
                                type="checkbox"
                                checked={lead.atendido === 1}
                                onChange={() => handleToggleAtendido(lead)}
                                className="rounded text-mahana-600 focus:ring-mahana-500 w-4 h-4 cursor-pointer"
                              />
                              <span className="text-xs ml-1.5 text-gray-500 font-medium">
                                {lead.atendido === 1 ? 'Sí' : 'No'}
                              </span>
                            </label>
                          </td>
                          <td className="py-3.5 px-4">
                            <label className="inline-flex items-center cursor-pointer">
                              <input 
                                type="checkbox"
                                checked={lead.oferta_mejora === 1}
                                onChange={() => handleToggleOfertaMejora(lead)}
                                className="rounded text-purple-650 focus:ring-purple-500 w-4 h-4 cursor-pointer"
                              />
                              <span className="text-xs ml-1.5 text-gray-500 font-medium">
                                {lead.oferta_mejora === 1 ? 'Sí' : 'No'}
                              </span>
                            </label>
                          </td>
                          <td className="py-3.5 px-4">
                            <select
                              value={lead.estado}
                              onChange={e => handleStatusChange(lead.id, e.target.value)}
                              className={`p-1 px-1.5 text-xs border rounded-lg font-bold text-gray-700 bg-white ${statusColors[lead.estado]}`}
                            >
                              <option value="Borrador">Borrador</option>
                              <option value="Enviada">Enviada</option>
                              <option value="En Negociación">En Negociación</option>
                              <option value="Aceptada">Aceptada</option>
                              <option value="Rechazada">Rechazada</option>
                            </select>
                          </td>
                          <td className="py-3.5 px-4 font-bold text-gray-700">
                            ${(lead.valor_total || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-3.5 px-6 text-right space-x-2">
                            <button
                              onClick={() => {
                                selectLeadDetails(lead);
                                setSubTab('leads');
                              }}
                              className="px-2.5 py-1 text-xs bg-mahana-50 text-mahana-800 hover:bg-mahana-100 rounded-lg font-bold transition inline-flex items-center gap-1 border border-mahana-150"
                              title="Ver Ficha / Cotizaciones"
                            >
                              <FileText size={12} />
                              Ficha
                            </button>
                            <button
                              onClick={() => {
                                setSubTab('leads');
                                handleEditLead(lead);
                              }}
                              className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition"
                              title="Editar Cliente"
                            >
                              <Edit2 size={14} className="inline" />
                            </button>
                            <button
                              onClick={() => handleDeleteLead(lead.id)}
                              className="p-1 text-red-650 hover:text-red-800 hover:bg-red-50 rounded transition"
                              title="Eliminar Cliente"
                            >
                              <Trash2 size={14} className="inline" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Main Tab Switch */}
      {activeTab === 'leads' && subTab === 'leads' && (
        <div className="flex flex-col lg:flex-row gap-6">

          {/* Left Column: Leads List & Actions */}
          <div className="w-full lg:w-1/3 space-y-4">
            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <Users className="text-mahana-600" />
                  Prospectos (Leads)
                </h2>
                <button 
                  onClick={() => setShowLeadModal(true)}
                  className="p-2 bg-mahana-600 text-white rounded-lg hover:bg-mahana-700 transition"
                  title="Nuevo Prospecto"
                >
                  <Plus size={18} />
                </button>
              </div>

              {/* Lead Creation Form/Modal */}
              {showLeadModal && (
                <form onSubmit={handleLeadSubmit} className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
                  <h3 className="font-bold text-sm text-gray-700">{editingLeadId ? 'Editar Prospecto' : 'Nuevo Prospecto'}</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <input 
                      type="text" placeholder="Nombre" required
                      className="p-2 text-sm border rounded-lg w-full bg-white"
                      value={leadForm.nombre}
                      onChange={e => setLeadForm({...leadForm, nombre: e.target.value})}
                    />
                    <input 
                      type="text" placeholder="Apellido"
                      className="p-2 text-sm border rounded-lg w-full bg-white"
                      value={leadForm.apellido}
                      onChange={e => setLeadForm({...leadForm, apellido: e.target.value})}
                    />
                  </div>
                  <input 
                    type="email" placeholder="Correo Electrónico"
                    className="p-2 text-sm border rounded-lg w-full bg-white"
                    value={leadForm.email}
                    onChange={e => setLeadForm({...leadForm, email: e.target.value})}
                  />
                  <input 
                    type="text" placeholder="WhatsApp / Teléfono"
                    className="p-2 text-sm border rounded-lg w-full bg-white"
                    value={leadForm.telefono}
                    onChange={e => setLeadForm({...leadForm, telefono: e.target.value})}
                  />
                  <textarea 
                    placeholder="Notas o Requerimiento" rows={2}
                    className="p-2 text-sm border rounded-lg w-full bg-white"
                    value={leadForm.notas}
                    onChange={e => setLeadForm({...leadForm, notas: e.target.value})}
                  />
                  <div className="space-y-1">
                    <label htmlFor="lead-fecha-seguimiento" className="text-[11px] font-bold text-gray-400 uppercase block">Próximo Seguimiento</label>
                    <input 
                      type="date"
                      id="lead-fecha-seguimiento"
                      className="p-1.5 text-xs border rounded-lg w-full bg-white text-gray-800 outline-none focus:ring-1 focus:ring-mahana-400"
                      value={leadForm.fecha_seguimiento}
                      onChange={e => setLeadForm({...leadForm, fecha_seguimiento: e.target.value})}
                    />
                  </div>
                  <div className="flex flex-col gap-2 pt-1">
                    <div className="flex items-center gap-2">
                      <input 
                        type="checkbox"
                        id="lead-atendido"
                        checked={leadForm.atendido}
                        onChange={e => setLeadForm({...leadForm, atendido: e.target.checked})}
                        className="rounded text-mahana-600 focus:ring-mahana-500 w-4 h-4 cursor-pointer"
                      />
                      <label htmlFor="lead-atendido" className="text-xs font-bold text-gray-650 cursor-pointer">Marcar como Atendido</label>
                    </div>
                    <div className="flex items-center gap-2">
                      <input 
                        type="checkbox"
                        id="lead-oferta-mejora"
                        checked={leadForm.oferta_mejora}
                        onChange={e => setLeadForm({...leadForm, oferta_mejora: e.target.checked})}
                        className="rounded text-purple-650 focus:ring-purple-500 w-4 h-4 cursor-pointer"
                      />
                      <label htmlFor="lead-oferta-mejora" className="text-xs font-bold text-purple-750 cursor-pointer">Oferta de Mejora Activa</label>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button 
                      type="button" onClick={() => setShowLeadModal(false)}
                      className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-150 rounded-lg"
                    >
                      Cancelar
                    </button>
                    <button 
                      type="submit"
                      className="px-3 py-1.5 text-xs bg-mahana-600 text-white font-medium rounded-lg hover:bg-mahana-700"
                    >
                      Guardar
                    </button>
                  </div>
                </form>
              )}

              {/* Leads Listing */}
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                {leads.length === 0 ? (
                  <p className="text-gray-400 text-center py-6 text-sm">No hay prospectos registrados</p>
                ) : (
                  leads.map(lead => {
                    const statusColors: Record<string, string> = {
                      'Borrador': 'bg-gray-100 text-gray-700',
                      'Enviada': 'bg-blue-50 text-blue-700 border-blue-200',
                      'En Negociación': 'bg-amber-50 text-amber-700 border-amber-200',
                      'Aceptada': 'bg-green-50 text-green-700 border-green-200',
                      'Rechazada': 'bg-red-50 text-red-700 border-red-200'
                    };
                    
                    const isSelected = selectedLead?.id === lead.id;

                    return (
                      <div 
                        key={lead.id}
                        onClick={() => selectLeadDetails(lead)}
                        className={`p-3 rounded-xl border transition cursor-pointer flex flex-col gap-1.5 ${isSelected ? 'bg-mahana-50/50 border-mahana-300 ring-1 ring-mahana-300' : 'bg-white hover:bg-gray-50 border-gray-200'}`}
                      >
                        <div className="flex justify-between items-start">
                          <span className="font-bold text-gray-800 text-sm">
                            {lead.nombre} {lead.apellido}
                          </span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${statusColors[lead.estado]}`}>
                            {lead.estado}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-gray-400">
                          {lead.telefono && <span className="flex items-center gap-0.5"><Phone size={10} />{lead.telefono}</span>}
                          {lead.email && <span className="flex items-center gap-0.5"><Mail size={10} />{lead.email}</span>}
                        </div>
                        {lead.valor_total > 0 && (
                          <div className="text-xs font-semibold text-mahana-700 mt-0.5">
                            Valor total cotizado: ${lead.valor_total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Selected Lead Detail and Quote History */}
          <div className="w-full lg:w-2/3 space-y-6">
            {selectedLead ? (
              <>
                {/* Lead Header card */}
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
                  <div className="flex flex-wrap justify-between items-start gap-4">
                    <div>
                      <h1 className="text-2xl font-bold text-gray-800">
                        {selectedLead.nombre} {selectedLead.apellido}
                      </h1>
                      <p className="text-sm text-gray-400 mt-1">Registrado el {new Date(selectedLead.created_at).toLocaleDateString()}</p>
                    </div>

                    {/* Status switcher drop-down & Action buttons */}
                    <div className="flex flex-wrap items-center gap-3">
                      <button 
                        onClick={() => handleEditLead(selectedLead)}
                        className="px-2.5 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 rounded-xl font-bold text-xs flex items-center gap-1.5 transition outline-none"
                        title="Editar datos de contacto"
                      >
                        <Edit2 size={12} />
                        Editar Cliente
                      </button>
                      <button 
                        onClick={() => handleDeleteLead(selectedLead.id)}
                        className="px-2.5 py-1.5 bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 rounded-xl font-bold text-xs flex items-center gap-1.5 transition outline-none"
                        title="Eliminar cliente permanentemente"
                      >
                        <Trash2 size={12} />
                        Eliminar
                      </button>
                      <div className="flex items-center gap-1.5 border-l pl-3">
                        <label className="text-xs font-bold text-gray-400 uppercase">Estado:</label>
                        <select 
                          value={selectedLead.estado}
                          onChange={e => handleStatusChange(selectedLead.id, e.target.value)}
                          className="p-1.5 text-xs border rounded-lg font-bold text-gray-700 bg-white"
                        >
                        <option value="Borrador">Borrador</option>
                        <option value="Enviada">Enviada</option>
                        <option value="En Negociación">En Negociación</option>
                        <option value="Aceptada">Aceptada</option>
                        <option value="Rechazada">Rechazada</option>
                      </select>
                    </div>
                  </div>
                </div>

                  {/* Lead tracking metadata highlights */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3 bg-mahana-50/30 rounded-xl border border-mahana-100/50 text-xs">
                      <span className="text-gray-400 font-bold block mb-1 uppercase tracking-wider text-[10px]">Fecha del Evento</span>
                      {selectedLead.fecha_evento ? (
                        <span className="font-bold text-mahana-900 flex items-center gap-1.5">
                          <Calendar size={13} className="text-mahana-600" />
                          {new Date(selectedLead.fecha_evento + 'T12:00:00').toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="text-gray-400">Sin cotización/evento</span>
                      )}
                    </div>
                    
                    <div className="p-3 bg-purple-50/30 rounded-xl border border-purple-100/50 text-xs">
                      <span className="text-gray-400 font-bold block mb-1 uppercase tracking-wider text-[10px]">Próximo Seguimiento</span>
                      {selectedLead.fecha_seguimiento ? (
                        <span className="font-bold text-purple-900 flex items-center gap-1.5">
                          <Calendar size={13} className="text-purple-600" />
                          {new Date(selectedLead.fecha_seguimiento + 'T12:00:00').toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="text-gray-400 font-normal text-xs">Sin fecha programada</span>
                      )}
                    </div>

                    <div className="p-3 bg-amber-50/30 rounded-xl border border-amber-100/50 text-xs">
                      <span className="text-gray-400 font-bold block mb-1 uppercase tracking-wider text-[10px]">Oferta de Mejora</span>
                      {selectedLead.oferta_mejora === 1 ? (
                        <span className="font-bold text-amber-900 flex items-center gap-1.5">
                          <Award size={13} className="text-amber-600 animate-pulse" />
                          Oferta de Mejora Activa
                        </span>
                      ) : (
                        <span className="text-gray-400 font-normal text-xs">Sin oferta activa</span>
                      )}
                    </div>
                  </div>

                  {selectedLead.notas && (
                    <div className="p-3 bg-gray-50 rounded-xl text-sm text-gray-600 border border-gray-150">
                      <strong>Requerimientos iniciales:</strong> {selectedLead.notas}
                    </div>
                  )}

                  <div className="flex justify-between items-center pt-2 border-t">
                    <h3 className="font-bold text-gray-700 flex items-center gap-1.5 text-sm">
                      <ClipboardList size={16} />
                      Versiones de Cotización ({leadQuotes.length})
                    </h3>
                    <button
                      onClick={() => {
                        // Prefill builder form with default check dates
                        const today = new Date().toISOString().split('T')[0];
                        const tomorrow = new Date();
                        tomorrow.setDate(tomorrow.getDate() + 1);
                        const tomStr = tomorrow.toISOString().split('T')[0];
                        
                        setQuoteForm({
                          check_in: today,
                          check_out: tomStr,
                          noches: 1,
                          adultos: 2,
                          menores: 0,
                          mascotas: 0,
                          plan_codigo: plans[0]?.codigo || '',
                          base_price: 0,
                          descuento: 0,
                          descuento_tipo: 'fijo',
                          notas: '',
                          habitaciones_seleccionadas: []
                        });
                        setSelectedServices([]);
                        setActiveTab('builder');
                      }}
                      className="px-3 py-1.5 bg-mahana-600 text-white rounded-lg hover:bg-mahana-700 transition flex items-center gap-1 text-xs font-bold"
                    >
                      <Plus size={14} />
                      Crear Cotización
                    </button>
                  </div>

                  {/* Quotes History Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {leadQuotes.length === 0 ? (
                      <div className="col-span-2 text-center py-8 text-gray-400 text-sm">
                        No hay cotizaciones creadas para este prospecto.
                      </div>
                    ) : (
                      leadQuotes.map((quote, idx) => {
                        const isCurrentlySelected = activePreviewQuote?.id === quote.id;
                        return (
                          <div 
                            key={quote.id}
                            onClick={() => setActivePreviewQuote(quote)}
                            className={`p-4 rounded-xl border transition cursor-pointer flex flex-col gap-2 relative ${isCurrentlySelected ? 'border-mahana-500 bg-mahana-50/20' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                          >
                            <div className="flex justify-between items-center">
                              <span className="font-bold text-gray-700 text-xs uppercase">Cotización #{quote.id} (v{leadQuotes.length - idx})</span>
                              <span className="text-[10px] text-gray-400">{new Date(quote.created_at).toLocaleDateString()}</span>
                            </div>
                            <div className="text-xl font-black text-gray-800">
                              ${quote.monto_total.toFixed(2)}
                            </div>
                            <div className="text-xs text-gray-500 flex flex-col gap-0.5">
                              <span>Check-in: {quote.check_in || 'N/A'} (Noches: {quote.noches})</span>
                              <span>Huéspedes: {quote.adultos} A / {quote.menores} M / {quote.mascotas} Masc</span>
                            </div>
                            <div className="flex gap-2 mt-2 pt-2 border-t">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCopyQuoteToClipboard(quote);
                                }}
                                className="p-1 px-2 text-[10px] bg-mahana-100 text-mahana-800 hover:bg-mahana-200 rounded font-bold transition flex items-center gap-1"
                              >
                                <MessageSquare size={10} />
                                Copiar WhatsApp
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleLoadQuoteForEdit(quote);
                                }}
                                className="p-1 px-2 text-[10px] bg-blue-100 text-blue-800 hover:bg-blue-200 rounded font-bold transition flex items-center gap-1"
                              >
                                <Edit2 size={10} />
                                Editar (Nueva Versión)
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Selected Quote Detail & Print Layout Preview */}
                {activePreviewQuote && (
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="font-bold text-gray-700 flex items-center gap-1.5 text-sm">
                        <FileText size={16} />
                        Vista Previa de la Cotización #{activePreviewQuote.id}
                      </h3>
                      <button 
                        onClick={handlePrintQuote}
                        className="px-3 py-1.5 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition flex items-center gap-1 text-xs font-bold"
                      >
                        <FileDown size={14} />
                        Imprimir / PDF
                      </button>
                    </div>

                    {/* Rich Invoice View Container */}
                    <div id="print-area" className="p-6 border border-gray-200 rounded-xl space-y-6 bg-white max-w-2xl mx-auto shadow-sm">
                      {/* Logo and Hotel Info */}
                      <div className="flex justify-between items-start border-b pb-4">
                        <div className="flex items-center gap-3">

                          <div>
                            <h2 className="text-xl font-black text-gray-800 uppercase tracking-wide">Hotel Panamá Canal</h2>
                            <p className="text-[10px] text-gray-400">Información comercial por configurar</p>
                          </div>
                        </div>
                        <div className="text-right text-xs text-gray-500">
                          <p>Teléfono: por configurar</p>
                          <p>Dirección: por configurar</p>
                          <p>Correo: por configurar</p>
                          <p>Sitio web: por configurar</p>
                        </div>
                      </div>

                      {/* Client info and Dates */}
                      {(() => {
                        const isPasadia = activePreviewQuote.plan_codigo?.includes('pasadia') || activePreviewQuote.noches === 0;
                        return (
                          <div className="grid grid-cols-2 gap-4 text-xs">
                            <div>
                              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">Cotizado A</span>
                              <p className="font-bold text-gray-800 text-sm">{selectedLead.nombre} {selectedLead.apellido}</p>
                              {selectedLead.telefono && <p className="text-gray-500">Cel: {selectedLead.telefono}</p>}
                              {selectedLead.email && <p className="text-gray-500">Email: {selectedLead.email}</p>}
                            </div>
                            <div className="text-right">
                              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">
                                {isPasadia ? 'Detalles de Pasadía' : 'Detalles de Estadía'}
                              </span>
                              {isPasadia ? (
                                <>
                                  <p className="text-gray-800"><strong>Fecha Pasadía:</strong> {activePreviewQuote.check_in || 'N/A'}</p>
                                  <p className="text-gray-800"><strong>Tipo:</strong> Pasadía / Día de Uso</p>
                                  <p className="text-gray-500">Huéspedes: {activePreviewQuote.adultos} Personas</p>
                                </>
                              ) : (
                                <>
                                  <p className="text-gray-800"><strong>Check-In:</strong> {activePreviewQuote.check_in || 'N/A'}</p>
                                  <p className="text-gray-800"><strong>Check-Out:</strong> {activePreviewQuote.check_out || 'N/A'}</p>
                                  <p className="text-gray-500">Noches: {activePreviewQuote.noches} | Huéspedes: {activePreviewQuote.adultos}A, {activePreviewQuote.menores}M</p>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Items table breakdown */}
                      {(() => {
                        const additionalItems = Array.isArray(activePreviewQuote.items_adicionales)
                          ? activePreviewQuote.items_adicionales
                          : JSON.parse(activePreviewQuote.items_adicionales || '[]');
                        const additionalItemsSum = additionalItems.reduce((sum: number, i: any) => sum + i.precio, 0);
                        const baseStaySubtotal = activePreviewQuote.subtotal - additionalItemsSum;
                        
                        const isPasadia = activePreviewQuote.plan_codigo?.includes('pasadia') || activePreviewQuote.noches === 0;
                        const qty = isPasadia 
                          ? `${activePreviewQuote.adultos} Pax`
                          : `${activePreviewQuote.noches} Noche${activePreviewQuote.noches > 1 ? 's' : ''} x ${activePreviewQuote.adultos} Pax`;
                        
                        const unitPriceVal = isPasadia
                          ? (activePreviewQuote.adultos > 0 ? baseStaySubtotal / activePreviewQuote.adultos : baseStaySubtotal)
                          : (activePreviewQuote.noches > 0 && activePreviewQuote.adultos > 0 ? baseStaySubtotal / (activePreviewQuote.noches * activePreviewQuote.adultos) : baseStaySubtotal);
                        
                        return (
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="border-b border-gray-200 text-gray-400 font-bold uppercase tracking-wider text-[10px]">
                                <th className="py-2 w-2/5">Descripción</th>
                                <th className="py-2 w-1/5 text-center">Cantidad</th>
                                <th className="py-2 w-1/5 text-right">Tarifa/Precio Unit.</th>
                                <th className="py-2 w-1/5 text-right">Monto</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr className="border-b border-gray-100">
                                <td className="py-2.5 text-gray-800">
                                  {isPasadia ? (
                                    <>
                                      Pasadía Base ({getPlanNombre(activePreviewQuote.plan_codigo)})
                                    </>
                                  ) : (
                                    <>
                                      Estadía Base — {getPlanNombre(activePreviewQuote.plan_codigo)}
                                    </>
                                  )}
                                  <div className="text-[10px] text-gray-400">Tarifa cotizada para {activePreviewQuote.adultos} adultos</div>
                                </td>
                                <td className="py-2.5 text-center text-gray-800">{qty}</td>
                                <td className="py-2.5 text-right text-gray-800">${unitPriceVal.toFixed(2)}</td>
                                <td className="py-2.5 text-right text-gray-800 font-semibold">${baseStaySubtotal.toFixed(2)}</td>
                              </tr>
                              
                              {additionalItems.map((item: any, idx: number) => {
                                const itemQty = item.cantidad || 1;
                                const itemUnitPrice = item.precio_unitario || item.precio;
                                return (
                                  <tr key={idx} className="border-b border-gray-100">
                                    <td className="py-2.5 text-gray-800">
                                      {item.nombre}
                                    </td>
                                    <td className="py-2.5 text-center text-gray-800">
                                      {item.tipo_precio === 'por_persona' ? `${itemQty} Pax` : `${itemQty} Serv.`}
                                    </td>
                                    <td className="py-2.5 text-right text-gray-800">
                                      ${Number(itemUnitPrice).toFixed(2)}
                                    </td>
                                    <td className="py-2.5 text-right text-gray-800 font-semibold">
                                      ${item.precio.toFixed(2)}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        );
                      })()}

                      {/* Financial breakdown */}
                      <div className="flex justify-end pt-2 print-no-break">
                        <div className="w-1/2 space-y-1.5 text-xs">
                          <div className="flex justify-between text-gray-500">
                            <span>Subtotal</span>
                            <span className="font-semibold text-gray-800">${activePreviewQuote.subtotal.toFixed(2)}</span>
                          </div>
                          
                          {activePreviewQuote.descuento > 0 && (
                            <div className="flex justify-between text-green-600">
                              <span>Descuento ({activePreviewQuote.descuento_tipo === 'porcentaje' ? `${activePreviewQuote.descuento}%` : `$${activePreviewQuote.descuento}`})</span>
                              <span className="font-semibold">-${(activePreviewQuote.subtotal - (activePreviewQuote.monto_total / 1.10)).toFixed(2)}</span>
                            </div>
                          )}
                          
                          <div className="flex justify-between text-gray-500">
                            <span>Impuesto ({activePreviewQuote.impuesto_pct}%)</span>
                            <span className="font-semibold text-gray-800">${activePreviewQuote.impuesto_monto.toFixed(2)}</span>
                          </div>
                          
                          <div className="flex justify-between text-sm font-black border-t pt-2 text-mahana-800">
                            <span>Total Estimado</span>
                            <span>${activePreviewQuote.monto_total.toFixed(2)}</span>
                          </div>

                          <div className="flex justify-between text-[11px] font-bold text-amber-700 bg-amber-50 p-2 rounded-lg border border-amber-250 mt-1">
                            <span>Abono Sugerido</span>
                            <span>${activePreviewQuote.deposito_sugerido.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>

                      {activePreviewQuote.notas && (
                        <div className="text-[10px] text-gray-500 border-t pt-3 space-y-1 print-no-break">
                          <p className="font-bold text-gray-700">📝 Observaciones y Detalles de la Estadía:</p>
                          <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg whitespace-pre-wrap leading-relaxed text-gray-600">
                            {activePreviewQuote.notas}
                          </div>
                        </div>
                      )}

                      {/* Hotel policies */}
                      <div className="text-[9px] text-gray-400 border-t pt-4 space-y-1">
                        <p className="font-bold text-gray-500">Políticas Generales:</p>
                        <p>Políticas de depósito, vigencia, cancelación y reembolso: por configurar.</p>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="bg-white p-12 rounded-2xl border border-gray-200 shadow-sm text-center text-gray-400 space-y-3">
                <ClipboardList size={48} className="mx-auto text-gray-300" />
                <p className="font-medium text-gray-500">Selecciona un prospecto en la lista de la izquierda para ver su historial o cotizar.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Services Catalog management Tab */}
      {activeTab === 'leads' && subTab === 'catalog' && (
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
          <div className="flex justify-between items-center pb-2 border-b">
            <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <ClipboardList className="text-mahana-600" />
              Catálogo de Servicios Adicionales Precargados
            </h2>
            <button
              onClick={() => {
                setEditingServiceId(null);
                setServiceForm({ nombre: '', descripcion: '', precio_base: 0, tipo_precio: 'global', activo: true });
                setShowServiceModal(true);
              }}
              className="px-3 py-1.5 bg-mahana-600 text-white rounded-lg hover:bg-mahana-700 transition flex items-center gap-1 text-xs font-bold"
            >
              <Plus size={14} />
              Nuevo Servicio
            </button>
          </div>

          {/* Service form modal inside page */}
          {showServiceModal && (
            <form onSubmit={handleServiceSubmit} className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3 max-w-lg">
              <h3 className="font-bold text-sm text-gray-700">{editingServiceId ? 'Editar Servicio' : 'Nuevo Servicio'}</h3>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500">Nombre del Servicio</label>
                <input 
                  type="text" required placeholder="Ej. Servicio de DJ, Desayuno de Grupo"
                  className="p-2 text-sm border rounded-lg w-full bg-white"
                  value={serviceForm.nombre}
                  onChange={e => setServiceForm({...serviceForm, nombre: e.target.value})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500">Descripción / Detalles</label>
                <textarea 
                  placeholder="Describe lo que incluye este servicio..." rows={2}
                  className="p-2 text-sm border rounded-lg w-full bg-white"
                  value={serviceForm.descripcion}
                  onChange={e => setServiceForm({...serviceForm, descripcion: e.target.value})}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500">Precio Sugerido Base ($)</label>
                  <input 
                    type="number" required min={0} step="0.01"
                    className="p-2 text-sm border rounded-lg w-full bg-white"
                    value={serviceForm.precio_base || ''}
                    onChange={e => setServiceForm({...serviceForm, precio_base: parseFloat(e.target.value) || 0})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500">Tipo de Precio</label>
                  <select
                    className="p-2 text-sm border rounded-lg w-full bg-white font-semibold"
                    value={serviceForm.tipo_precio}
                    onChange={e => setServiceForm({...serviceForm, tipo_precio: e.target.value as any})}
                  >
                    <option value="global">Fijo / Global</option>
                    <option value="por_persona">Por Persona</option>
                  </select>
                </div>
                <div className="space-y-1 flex flex-col justify-end pb-3">
                  <label className="flex items-center gap-2 text-xs font-bold text-gray-600 cursor-pointer">
                    <input 
                      type="checkbox"
                      checked={serviceForm.activo}
                      onChange={e => setServiceForm({...serviceForm, activo: e.target.checked})}
                      className="rounded text-mahana-600 focus:ring-mahana-500"
                    />
                    Servicio Activo
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button 
                  type="button" onClick={() => setShowServiceModal(false)}
                  className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-150 rounded-lg"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="px-3 py-1.5 text-xs bg-mahana-600 text-white font-medium rounded-lg hover:bg-mahana-700"
                >
                  Guardar Servicio
                </button>
              </div>
            </form>
          )}

          {/* Services list table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-gray-400 font-bold uppercase tracking-wider text-xs">
                  <th className="py-3 px-4">Servicio</th>
                  <th className="py-3 px-4">Descripción</th>
                  <th className="py-3 px-4">Tipo</th>
                  <th className="py-3 px-4">Precio Sugerido</th>
                  <th className="py-3 px-4">Estado</th>
                  <th className="py-3 px-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {preloadedServices.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-400 text-sm">No hay servicios en el catálogo.</td>
                  </tr>
                ) : (
                  preloadedServices.map(service => (
                    <tr key={service.id} className="border-b border-gray-100 hover:bg-gray-50/50 transition">
                      <td className="py-3 px-4 font-bold text-gray-800">{service.nombre}</td>
                      <td className="py-3 px-4 text-xs text-gray-500 max-w-xs truncate" title={service.descripcion}>{service.descripcion || 'Sin descripción'}</td>
                      <td className="py-3 px-4 text-xs font-semibold text-gray-600">
                        {service.tipo_precio === 'por_persona' ? 'Por Persona' : 'Global / Fijo'}
                      </td>
                      <td className="py-3 px-4 font-semibold text-gray-700">
                        ${service.precio_base.toFixed(2)}
                        {service.tipo_precio === 'por_persona' && <span className="text-[10px] text-gray-400 font-normal"> / pers.</span>}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${service.activo ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                          {service.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right space-x-2">
                        <button
                          onClick={() => {
                            setEditingServiceId(service.id);
                            setServiceForm({
                              nombre: service.nombre,
                              descripcion: service.descripcion || '',
                              precio_base: service.precio_base,
                              tipo_precio: (service.tipo_precio as any) || 'global',
                              activo: !!service.activo
                            });
                            setShowServiceModal(true);
                          }}
                          className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition"
                          title="Editar"
                        >
                          <Edit2 size={14} className="inline" />
                        </button>
                        {!!service.activo && (
                          <button
                            onClick={() => handleDeactivateService(service.id)}
                            className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition"
                            title="Desactivar"
                          >
                            <Trash2 size={14} className="inline" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quotation Builder View */}

      {activeTab === 'builder' && selectedLead && (
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-6">
          <div className="flex justify-between items-center pb-4 border-b">
            <button 
              onClick={() => setActiveTab('leads')}
              className="flex items-center gap-1.5 text-gray-500 hover:text-gray-700 font-bold text-sm"
            >
              <ArrowLeft size={16} />
              Volver
            </button>
            <h2 className="text-xl font-bold text-gray-800">
              Crear Cotización Custom para {selectedLead.nombre} {selectedLead.apellido}
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Form Fields: Criteria & Rates */}
            <div className="space-y-4">
              <h3 className="font-bold text-gray-700 text-sm uppercase tracking-wide">1. Parámetros de Reserva</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500">Check-In</label>
                  <input 
                    type="date" required
                    className="p-2 border rounded-lg w-full bg-white text-sm"
                    value={quoteForm.check_in}
                    onChange={e => setQuoteForm({...quoteForm, check_in: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500">Check-Out</label>
                  <input 
                    type="date" required
                    className="p-2 border rounded-lg w-full bg-white text-sm"
                    value={quoteForm.check_out}
                    onChange={e => setQuoteForm({...quoteForm, check_out: e.target.value})}
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500">Noches</label>
                  <input 
                    type="number" disabled
                    className="p-2 border rounded-lg w-full bg-gray-55 text-sm text-center"
                    value={quoteForm.noches}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500">Adultos</label>
                  <input 
                    type="number" min={1}
                    className="p-2 border rounded-lg w-full bg-white text-sm text-center"
                    value={quoteForm.adultos}
                    onChange={e => setQuoteForm({...quoteForm, adultos: Math.max(1, parseInt(e.target.value) || 1)})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500">Menores</label>
                  <input 
                    type="number" min={0}
                    className="p-2 border rounded-lg w-full bg-white text-sm text-center"
                    value={quoteForm.menores}
                    onChange={e => setQuoteForm({...quoteForm, menores: Math.max(0, parseInt(e.target.value) || 0)})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500">Mascotas</label>
                  <input 
                    type="number" min={0}
                    className="p-2 border rounded-lg w-full bg-white text-sm text-center"
                    value={quoteForm.mascotas}
                    onChange={e => setQuoteForm({...quoteForm, mascotas: Math.max(0, parseInt(e.target.value) || 0)})}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500">Plan Tarifario Base (Opcional)</label>
                  <select 
                    value={quoteForm.plan_codigo}
                    onChange={e => setQuoteForm({...quoteForm, plan_codigo: e.target.value})}
                    className="p-2 border rounded-lg w-full bg-white text-sm"
                  >
                    <option value="">Seleccionar plan sugerido...</option>
                    {plans.map(p => (
                      <option key={p.codigo} value={p.codigo}>{p.nombre}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500">Precio Base de Estadía ($)</label>
                  <input 
                    type="number" min={0} step="0.01"
                    className="p-2 border rounded-lg w-full bg-white text-sm font-semibold"
                    value={quoteForm.base_price}
                    onChange={e => setQuoteForm({...quoteForm, base_price: parseFloat(e.target.value) || 0})}
                  />
                </div>
              </div>

              {/* Preloaded services selector */}
              <h3 className="font-bold text-gray-700 text-sm uppercase tracking-wide pt-4 border-t">2. Servicios Adicionales</h3>
              
              <div className="flex gap-2">
                <select
                  value={selectedPreloadedId}
                  onChange={e => setSelectedPreloadedId(e.target.value)}
                  className="p-2 border rounded-lg flex-1 bg-white text-sm"
                >
                  <option value="">Buscar servicio precargado...</option>
                  {preloadedServices.map(s => (
                    <option key={s.id} value={s.id}>{s.nombre} - ${s.precio_base.toFixed(2)}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAddPreloadedService}
                  className="p-2 px-4 bg-mahana-600 text-white font-bold rounded-lg hover:bg-mahana-700 transition text-sm"
                >
                  Agregar
                </button>
              </div>

              <div className="p-3 bg-gray-50 rounded-xl space-y-2 border">
                <span className="text-[11px] font-bold text-gray-400 block">Agregar Ítem Personalizado Manual</span>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input 
                    type="text" placeholder="Descripción (Ej. Animador, DJ, Bebidas)"
                    className="p-2 border rounded-lg flex-1 bg-white text-xs"
                    value={manualItem.nombre}
                    onChange={e => setManualItem({...manualItem, nombre: e.target.value})}
                  />
                  <div className="flex gap-2">
                    <input 
                      type="number" placeholder="Precio ($)"
                      className="p-2 border rounded-lg w-20 bg-white text-xs font-semibold"
                      value={manualItem.precio}
                      onChange={e => setManualItem({...manualItem, precio: e.target.value})}
                    />
                    <select
                      className="p-2 border rounded-lg w-28 bg-white text-xs font-semibold"
                      value={manualItem.tipo_precio}
                      onChange={e => setManualItem({...manualItem, tipo_precio: e.target.value as any})}
                    >
                      <option value="global">Global</option>
                      <option value="por_persona">Por Persona</option>
                    </select>
                    <button
                      type="button" onClick={handleAddManualItem}
                      className="p-2 px-3 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition text-xs font-bold whitespace-nowrap"
                    >
                      Añadir
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Quote Calculations & Summary */}
            <div className="space-y-6">
              <h3 className="font-bold text-gray-700 text-sm uppercase tracking-wide">3. Resumen y Cálculo</h3>
              
              <div className="border border-gray-200 rounded-2xl p-5 bg-gray-50 space-y-4">
                <div className="space-y-2 max-h-[30vh] overflow-y-auto">
                  <div className="flex justify-between text-xs font-medium border-b pb-2">
                    <span className="text-gray-550">
                      {(quoteForm.plan_codigo?.includes('pasadia') || quoteForm.noches === 0) 
                        ? `Pasadía Base (${getPlanNombre(quoteForm.plan_codigo)})` 
                        : `Estadía Base — ${getPlanNombre(quoteForm.plan_codigo)} (${quoteForm.noches} Noche${quoteForm.noches > 1 ? 's' : ''})`}
                    </span>
                    <span className="font-semibold text-gray-800">${quoteForm.base_price.toFixed(2)}</span>
                  </div>

                  {calculatedTotals.resolvedServices.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center text-xs font-medium border-b pb-2">
                      <span className="text-gray-600 flex items-center gap-1">
                        <button 
                          onClick={() => handleRemoveService(idx)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 size={12} />
                        </button>
                        {item.nombre}
                        {item.tipo_precio === 'por_persona' && (
                          <span className="text-[10px] text-gray-400 font-normal">
                            (${item.precio_unitario.toFixed(2)} x {item.cantidad} pers.)
                          </span>
                        )}
                      </span>
                      <span className="font-semibold text-gray-800">${item.precio.toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                {/* Discount controls */}
                <div className="grid grid-cols-3 gap-2 pt-2 border-t">
                  <div className="col-span-2 space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">Descuento</label>
                    <input 
                      type="number" min={0} step="0.01"
                      className="p-2 border rounded-lg w-full bg-white text-sm"
                      value={quoteForm.descuento}
                      onChange={e => setQuoteForm({...quoteForm, descuento: parseFloat(e.target.value) || 0})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">Tipo</label>
                    <select
                      className="p-2 border rounded-lg w-full bg-white text-sm font-semibold"
                      value={quoteForm.descuento_tipo}
                      onChange={e => setQuoteForm({...quoteForm, descuento_tipo: e.target.value as any})}
                    >
                      <option value="fijo">$ Fijo</option>
                      <option value="porcentaje">% Pct</option>
                    </select>
                  </div>
                </div>

                {/* Subtotals & Taxes */}
                <div className="space-y-2 pt-2 border-t text-xs">
                  <div className="flex justify-between text-gray-500">
                    <span>Subtotal</span>
                    <span>${calculatedTotals.subtotal.toFixed(2)}</span>
                  </div>
                  
                  {calculatedTotals.discountAmount > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span>Descuento</span>
                      <span>-${calculatedTotals.discountAmount.toFixed(2)}</span>
                    </div>
                  )}

                  <div className="flex justify-between text-gray-500">
                    <span>Impuestos configurados</span>
                    <span>${calculatedTotals.tax.toFixed(2)}</span>
                  </div>

                  <div className="flex justify-between text-base font-black text-mahana-800 border-t pt-2">
                    <span>Monto Total</span>
                    <span>${calculatedTotals.total.toFixed(2)}</span>
                  </div>

                  <div className="flex justify-between text-xs font-bold text-amber-700 bg-amber-50 p-2 rounded-lg border border-amber-250 mt-1">
                    <span>Abono Sugerido</span>
                    <span>${calculatedTotals.deposit.toFixed(2)}</span>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500">Observaciones y Detalles de la Estadía (Sin Costo)</label>
                  <textarea 
                    rows={3} placeholder="Ej. Distribución de habitaciones, detalles del menú de almuerzo, check-in temprano, etc. (No afecta los cálculos contables)"
                    className="p-2 border rounded-lg w-full bg-white text-xs"
                    value={quoteForm.notas}
                    onChange={e => setQuoteForm({...quoteForm, notas: e.target.value})}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button 
                  onClick={() => setActiveTab('leads')}
                  className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50 font-bold"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleSaveQuote}
                  disabled={loading}
                  className="px-4 py-2 bg-mahana-600 text-white font-bold rounded-lg hover:bg-mahana-700 transition text-sm flex items-center gap-1.5"
                >
                  <Calculator size={16} />
                  {loading ? 'Guardando...' : 'Guardar Cotización'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Global CSS Style block for printing */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #print-area, #print-area * {
            visibility: visible;
          }
          #print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            border: none;
            padding: 0;
            box-shadow: none;
            background: white;
            color: black;
          }
          @page {
            size: letter;
            margin: 15mm 10mm 15mm 10mm;
          }
          tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .print-no-break {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>
    </div>
  );
}
