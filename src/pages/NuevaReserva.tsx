import { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../api/client';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, Sun, Moon, CreditCard, Shield, Upload, Loader2, Check } from 'lucide-react';

function OnlinePaymentsDisabled(_props: {
  clientId: string; mode: string; monto: number; descripcion: string; onSuccess: (orderId: string) => void; onError: (msg: string) => void
}) {
  return <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Pagos online por configurar. No hay una pasarela conectada.</p>
}

export default function NuevaReserva() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [planes, setPlanes] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cotizacion, setCotizacion] = useState<any>(null);
  const [alternativeQuotes, setAlternativeQuotes] = useState<Record<string, number>>({});

  // Receipt upload state
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    if (!receiptFile) {
      setPreviewUrl(null);
      return;
    }
    if (receiptFile.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(receiptFile);
    } else {
      setPreviewUrl(null);
    }
  }, [receiptFile]);

  // Category selection — first step
  const [categoria, setCategoria] = useState<'Estadía' | 'Pasadía'>(
    searchParams.get('categoria') as any || 'Estadía'
  );
  const isPasadia = categoria === 'Pasadía';

  // Group Booking state
  const [isGroup, setIsGroup] = useState(false);
  const [selectedGroupRooms, setSelectedGroupRooms] = useState<number[]>([]);
  const [facturacionConsolidada, setFacturacionConsolidada] = useState(1);
  const [roomConfigs, setRoomConfigs] = useState<Record<number, {
    cliente: string;
    apellido: string;
    adultos: number;
    menores: number;
    mascotas: number;
    plan_codigo: string;
    email?: string;
    whatsapp?: string;
    nacionalidad?: string;
  }>>({});

  // Step 4: Deposit
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositMetodo, setDepositMetodo] = useState('efectivo');
  const [depositRef, setDepositRef] = useState('');
  const [isDepositDirty, setIsDepositDirty] = useState(false);
  const [isOnlineFlow, setIsOnlineFlow] = useState(false);
  const [paypalConfig, setPaypalConfig] = useState<any>({ paypal_enabled: false, paypal_client_id: '', paypal_mode: 'sandbox' });

  useEffect(() => {
    api.get('/public/paypal-config')
      .then(r => {
        if (r.data) setPaypalConfig({ paypal_enabled: false, paypal_client_id: '', paypal_mode: 'sandbox' });
      })
      .catch(e => console.error('Error fetching paypal config:', e));
  }, []);

  useEffect(() => {
    const amt = parseFloat(depositAmount);
    if ((depositMetodo === 'paypal' || depositMetodo === 'tarjeta_credito' || depositMetodo === 'tarjeta') && amt > 0) {
      setIsOnlineFlow(true);
    }
  }, [depositMetodo, depositAmount]);


  const [form, setForm] = useState({
    cliente: '', apellido: '', email: '', whatsapp: '', nacionalidad: '',
    check_in: searchParams.get('check_in') || '',
    check_out: searchParams.get('check_out') || '',
    hora_llegada: '',
    habitacion_id: searchParams.get('habitacion_id') || '',
    plan_codigo: '',
    adultos: 1, menores: 0, mascotas: 0,
    fuente: 'Teléfono', notas: ''
  });

  // Pasadía: multi-unit selection (bohíos, salón)
  const [selectedUnits, setSelectedUnits] = useState<number[]>([]);

  useEffect(() => {
    api.get('/hotel/planes').then(r => setPlanes(r.data));
  }, []);

  // Filter plans by category
  const filteredPlanes = useMemo(() => {
    return planes.filter(p => p.categoria === categoria && p.activo === 1);
  }, [planes, categoria]);

  // When category changes, reset form selections
  useEffect(() => {
    setForm(f => ({ ...f, habitacion_id: '', plan_codigo: '' }));
    setSelectedUnits([]);
    setSelectedGroupRooms([]);
    setRoomConfigs({});
    setCotizacion(null);
  }, [categoria]);

  // Pasadía: auto-set check-out = check-in + 1 day
  useEffect(() => {
    if (isPasadia && form.check_in) {
      const d = new Date(form.check_in);
      d.setDate(d.getDate() + 1);
      const nextDay = d.toISOString().split('T')[0];
      setForm(f => ({ ...f, check_out: nextDay }));
    }
  }, [isPasadia, form.check_in]);

  // Load available rooms when dates change
  useEffect(() => {
    if (form.check_in && form.check_out && form.check_out > form.check_in) {
      api.get(`/hotel/disponibilidad?check_in=${form.check_in}&check_out=${form.check_out}`)
        .then(r => {
          setRooms(r.data);
          // Clear if pre-selected room is unavailable
          if (form.habitacion_id) {
            const sel = r.data.find((rm: any) => rm.id == form.habitacion_id);
            if (sel && !sel.disponible) setForm(f => ({ ...f, habitacion_id: '' }));
          }
        });
    } else { setRooms([]); }
  }, [form.check_in, form.check_out]);

  const selectedPlan = useMemo(() => {
    return planes.find(p => p.codigo === form.plan_codigo);
  }, [planes, form.plan_codigo]);

  // Filter rooms by category and selected plan's applicable room types
  const categoryRooms = useMemo(() => {
    const catFiltered = rooms.filter(r => r.categoria === categoria);
    if (selectedPlan && selectedPlan.tipos_aplicables) {
      try {
        const applicableTypes = typeof selectedPlan.tipos_aplicables === 'string'
          ? JSON.parse(selectedPlan.tipos_aplicables)
          : selectedPlan.tipos_aplicables;
        if (Array.isArray(applicableTypes) && applicableTypes.length > 0) {
          return catFiltered.filter(r => applicableTypes.includes(r.tipo));
        }
      } catch (e) {
        console.error('Error parsing selectedPlan.tipos_aplicables:', e);
      }
    }
    return catFiltered;
  }, [rooms, categoria, selectedPlan]);

  const availableRooms = categoryRooms.filter(r => r.disponible);

  // Auto-deselect room/units if they are incompatible with the selected plan
  useEffect(() => {
    if (selectedPlan && selectedPlan.tipos_aplicables) {
      try {
        const applicableTypes = typeof selectedPlan.tipos_aplicables === 'string'
          ? JSON.parse(selectedPlan.tipos_aplicables)
          : selectedPlan.tipos_aplicables;
        if (Array.isArray(applicableTypes) && applicableTypes.length > 0) {
          if (form.habitacion_id) {
            const currentRoom = rooms.find(r => r.id == form.habitacion_id);
            if (currentRoom && !applicableTypes.includes(currentRoom.tipo)) {
              set('habitacion_id', '');
            }
          }
          if (isPasadia && selectedUnits.length > 0) {
            const validUnits = selectedUnits.filter(uid => {
              const u = rooms.find(r => r.id == uid);
              return u && applicableTypes.includes(u.tipo);
            });
            if (validUnits.length !== selectedUnits.length) {
              setSelectedUnits(validUnits);
              set('habitacion_id', validUnits[0] || '');
            }
          }
        }
      } catch (e) {
        console.error('Error in compatibility effect:', e);
      }
    }
  }, [selectedPlan, rooms]);

  // Synchronize leader room's config with the primary form when it changes
  useEffect(() => {
    if (isGroup && selectedGroupRooms.length > 0) {
      const leaderId = selectedGroupRooms[0];
      setRoomConfigs(curr => {
        if (!curr[leaderId]) return curr;
        return {
          ...curr,
          [leaderId]: {
            ...curr[leaderId],
            cliente: form.cliente,
            apellido: form.apellido,
            plan_codigo: form.plan_codigo
          }
        };
      });
    }
  }, [form.cliente, form.apellido, form.plan_codigo, isGroup, selectedGroupRooms]);

  // Auto-cotizar
  useEffect(() => {
    if (isGroup) {
      if (selectedGroupRooms.length > 0 && form.check_in && form.check_out && form.check_out > form.check_in) {
        const promises = selectedGroupRooms.map(roomId => {
          const config = roomConfigs[roomId] || {};
          const plan = config.plan_codigo || form.plan_codigo;
          const isLeader = roomId === selectedGroupRooms[0];
          const adults = config.adultos !== undefined ? config.adultos : (isLeader ? form.adultos : 0);
          const minors = config.menores !== undefined ? config.menores : (isLeader ? form.menores : 0);
          const pets = config.mascotas !== undefined ? config.mascotas : (isLeader ? form.mascotas : 0);
          if (!plan) return Promise.resolve(null);
          return api.get(`/hotel/cotizar?plan=${plan}&adultos=${adults}&menores=${minors}&mascotas=${pets}&check_in=${form.check_in}&check_out=${form.check_out}`)
            .then(res => res.data)
            .catch(() => null);
        });

        Promise.all(promises).then(results => {
          const validResults = results.filter(x => x !== null);
          if (validResults.length === 0) {
            setCotizacion(null);
            return;
          }
          const aggregate = {
            plan: { nombre: 'Cotización Grupal 👥' },
            noches: validResults[0].noches,
            subtotal: validResults.reduce((acc, curr) => acc + curr.subtotal, 0),
            impuesto_pct: validResults[0].impuesto_pct,
            impuesto_monto: validResults.reduce((acc, curr) => acc + curr.impuesto_monto, 0),
            monto_total: validResults.reduce((acc, curr) => acc + curr.monto_total, 0),
            deposito_sugerido: validResults.reduce((acc, curr) => acc + curr.deposito_sugerido, 0),
          };
          setCotizacion(aggregate);
          if (aggregate.deposito_sugerido && !isDepositDirty) {
            setDepositAmount(aggregate.deposito_sugerido.toFixed(2));
          }
        });

        // Fetch alternative quotes for other plans for group
        const otherPlanes = filteredPlanes.filter(p => p.codigo !== form.plan_codigo && p.visible_web === 1);
        const altGroupPromises = otherPlanes.map(p => {
          const subPromises = selectedGroupRooms.map(roomId => {
            const config = roomConfigs[roomId] || {};
            // If the room has a custom plan that differs from the main selected plan, keep it; otherwise use alternative plan `p.codigo`
            const plan = config.plan_codigo && config.plan_codigo !== form.plan_codigo ? config.plan_codigo : p.codigo;
            const isLeader = roomId === selectedGroupRooms[0];
            const adults = config.adultos !== undefined ? config.adultos : (isLeader ? form.adultos : 0);
            const minors = config.menores !== undefined ? config.menores : (isLeader ? form.menores : 0);
            const pets = config.mascotas !== undefined ? config.mascotas : (isLeader ? form.mascotas : 0);
            return api.get(`/hotel/cotizar?plan=${plan}&adultos=${adults}&menores=${minors}&mascotas=${pets}&check_in=${form.check_in}&check_out=${form.check_out}`)
              .then(res => res.data)
              .catch(() => null);
          });
          return Promise.all(subPromises).then(subResults => {
            const validSubResults = subResults.filter(x => x !== null);
            if (validSubResults.length === 0) return null;
            const total = validSubResults.reduce((acc, curr) => acc + curr.monto_total, 0);
            return { codigo: p.codigo, total };
          });
        });

        Promise.all(altGroupPromises).then(results => {
          const dict: Record<string, number> = {};
          results.forEach(res => {
            if (res) dict[res.codigo] = res.total;
          });
          setAlternativeQuotes(dict);
        });
      } else {
        setCotizacion(null);
        setAlternativeQuotes({});
      }
    } else {
      if (form.plan_codigo && form.check_in && form.check_out && form.check_out > form.check_in) {
        const mainHab = isPasadia ? (selectedUnits[0] || form.habitacion_id) : form.habitacion_id;
        const guests = isPasadia ? form.adultos : form.adultos;
        api.get(`/hotel/cotizar?plan=${form.plan_codigo}&adultos=${guests}&menores=${form.menores}&mascotas=${form.mascotas}&check_in=${form.check_in}&check_out=${form.check_out}`)
          .then(r => {
            if (isPasadia && selectedUnits.length > 1) {
              r.data.subtotal *= selectedUnits.length;
              r.data.impuesto_monto *= selectedUnits.length;
              r.data.monto_total *= selectedUnits.length;
              r.data.deposito_sugerido *= selectedUnits.length;
            }
            setCotizacion(r.data);
            if (r.data.deposito_sugerido && !isDepositDirty) {
              setDepositAmount(r.data.deposito_sugerido.toFixed(2));
            }
          }).catch(() => setCotizacion(null));

        // Fetch alternative quotes for other plans for single reservation
        const otherPlanes = filteredPlanes.filter(p => p.codigo !== form.plan_codigo && p.visible_web === 1);
        const altPromises = otherPlanes.map(p => {
          return api.get(`/hotel/cotizar?plan=${p.codigo}&adultos=${guests}&menores=${form.menores}&mascotas=${form.mascotas}&check_in=${form.check_in}&check_out=${form.check_out}`)
            .then(res => {
              let total = res.data.monto_total;
              if (isPasadia && selectedUnits.length > 1) {
                total *= selectedUnits.length;
              }
              return { codigo: p.codigo, total };
            })
            .catch(() => null);
        });

        Promise.all(altPromises).then(results => {
          const dict: Record<string, number> = {};
          results.forEach(res => {
            if (res) dict[res.codigo] = res.total;
          });
          setAlternativeQuotes(dict);
        });
      } else {
        setCotizacion(null);
        setAlternativeQuotes({});
      }
    }
  }, [
    isGroup,
    selectedGroupRooms,
    roomConfigs,
    form.plan_codigo,
    form.adultos,
    form.menores,
    form.mascotas,
    form.check_in,
    form.check_out,
    selectedUnits.length,
    filteredPlanes
  ]);

  const set = (field: string, value: any) => setForm(f => ({ ...f, [field]: value }));

  // Toggle unit selection for Pasadía multi-select
  const toggleUnit = (id: number) => {
    setSelectedUnits(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
    // Set first selected as habitacion_id
    if (!selectedUnits.includes(id)) {
      if (selectedUnits.length === 0) set('habitacion_id', id);
    } else {
      const remaining = selectedUnits.filter(x => x !== id);
      set('habitacion_id', remaining[0] || '');
    }
  };

  // Toggle group room selection
  const toggleGroupRoom = (id: number) => {
    setSelectedGroupRooms(prev => {
      const exists = prev.includes(id);
      if (exists) {
        const next = prev.filter(x => x !== id);
        const isLeaderBeingRemoved = prev[0] === id;
        const newLeaderId = isLeaderBeingRemoved ? next[0] : null;

        setRoomConfigs(curr => {
          const updated = { ...curr };
          delete updated[id];
          if (newLeaderId !== undefined && newLeaderId !== null) {
            const currentLeaderConfig = updated[newLeaderId];
            if (!currentLeaderConfig || currentLeaderConfig.adultos === 0) {
              updated[newLeaderId] = {
                ...currentLeaderConfig,
                cliente: form.cliente,
                apellido: form.apellido,
                adultos: form.adultos,
                menores: form.menores,
                mascotas: form.mascotas,
                plan_codigo: form.plan_codigo
              };
            }
          }
          return updated;
        });
        return next;
      } else {
        const next = [...prev, id];
        setRoomConfigs(curr => ({
          ...curr,
          [id]: {
            cliente: curr[id]?.cliente || (prev.length === 0 ? form.cliente : ''),
            apellido: curr[id]?.apellido || (prev.length === 0 ? form.apellido : ''),
            adultos: curr[id]?.adultos ?? (prev.length === 0 ? form.adultos : 0),
            menores: curr[id]?.menores ?? (prev.length === 0 ? form.menores : 0),
            mascotas: curr[id]?.mascotas ?? (prev.length === 0 ? form.mascotas : 0),
            plan_codigo: curr[id]?.plan_codigo || form.plan_codigo || ''
          }
        }));
        return next;
      }
    });
  };

  // Assigned guest calculations for Group Tracker
  const assignedAdults = useMemo(() => {
    return selectedGroupRooms.reduce((acc, rid) => acc + (roomConfigs[rid]?.adultos || 0), 0);
  }, [selectedGroupRooms, roomConfigs]);

  const assignedMinors = useMemo(() => {
    return selectedGroupRooms.reduce((acc, rid) => acc + (roomConfigs[rid]?.menores || 0), 0);
  }, [selectedGroupRooms, roomConfigs]);

  const assignedPets = useMemo(() => {
    return selectedGroupRooms.reduce((acc, rid) => acc + (roomConfigs[rid]?.mascotas || 0), 0);
  }, [selectedGroupRooms, roomConfigs]);

  const pendingAdults = form.adultos - assignedAdults;
  const pendingMinors = form.menores - assignedMinors;
  const pendingPets = form.mascotas - assignedPets;

  const allAssignedMatch = pendingAdults === 0 && pendingMinors === 0 && pendingPets === 0;

  // Auto-distribute guests based on physical room capacities
  const autoDistributeGuests = () => {
    let pendingAdultsCount = form.adultos;
    let pendingMinorsCount = form.menores;
    let pendingPetsCount = form.mascotas;

    const newConfigs = { ...roomConfigs };
    
    // Clear guests to 0 for all selected rooms
    selectedGroupRooms.forEach(roomId => {
      newConfigs[roomId] = {
        ...newConfigs[roomId],
        cliente: newConfigs[roomId]?.cliente || (roomId === selectedGroupRooms[0] ? form.cliente : ''),
        apellido: newConfigs[roomId]?.apellido || (roomId === selectedGroupRooms[0] ? form.apellido : ''),
        plan_codigo: newConfigs[roomId]?.plan_codigo || form.plan_codigo || '',
        adultos: 0,
        menores: 0,
        mascotas: 0
      };
    });

    // 1. Give 1 adult to each selected room (if we have adults available) to make it valid
    selectedGroupRooms.forEach(roomId => {
      if (pendingAdultsCount > 0) {
        newConfigs[roomId].adultos = 1;
        pendingAdultsCount--;
      }
    });

    // 2. Fill remaining capacity for each room with adults then minors
    selectedGroupRooms.forEach(roomId => {
      const room = rooms.find(rm => rm.id === roomId);
      const maxCap = room ? (room.capacidad_max || room.capacidad || 4) : 4;
      
      let currentGuests = newConfigs[roomId].adultos + newConfigs[roomId].menores;
      let availableCap = maxCap - currentGuests;

      if (pendingAdultsCount > 0 && availableCap > 0) {
        const toAdd = Math.min(pendingAdultsCount, availableCap);
        newConfigs[roomId].adultos += toAdd;
        pendingAdultsCount -= toAdd;
        availableCap -= toAdd;
      }

      if (pendingMinorsCount > 0 && availableCap > 0) {
        const toAdd = Math.min(pendingMinorsCount, availableCap);
        newConfigs[roomId].menores += toAdd;
        pendingMinorsCount -= toAdd;
        availableCap -= toAdd;
      }
    });

    // 3. Fallback: If we still have adults or minors left over (e.g. overcapacity), assign to leader room
    if (pendingAdultsCount > 0 && selectedGroupRooms.length > 0) {
      newConfigs[selectedGroupRooms[0]].adultos += pendingAdultsCount;
    }
    if (pendingMinorsCount > 0 && selectedGroupRooms.length > 0) {
      newConfigs[selectedGroupRooms[0]].menores += pendingMinorsCount;
    }

    // 4. Distribute pets: put them in rooms that have adults/guests, limit to 2 per room
    selectedGroupRooms.forEach(roomId => {
      if (pendingPetsCount > 0 && newConfigs[roomId].adultos > 0) {
        const toAdd = Math.min(pendingPetsCount, 2);
        newConfigs[roomId].mascotas += toAdd;
        pendingPetsCount -= toAdd;
      }
    });

    // 5. Fallback: put remaining pets in leader room
    if (pendingPetsCount > 0 && selectedGroupRooms.length > 0) {
      newConfigs[selectedGroupRooms[0]].mascotas += pendingPetsCount;
    }

    setRoomConfigs(newConfigs);
  };

  // State & handler for copying the quotation to clipboard
  const [copied, setCopied] = useState(false);

  const handleCopyQuote = () => {
    if (!cotizacion) return;

    const checkInStr = form.check_in;
    const checkOutStr = form.check_out;
    const nochesStr = isPasadia ? '1 día (Pasadía)' : `${cotizacion.noches}`;
    const clienteFull = `${form.cliente} ${form.apellido}`.trim() || 'Cliente';
    
    let habitacionesStr = '';
    if (isGroup) {
      habitacionesStr = selectedGroupRooms.map(roomId => {
        const rm = rooms.find(r => r.id === roomId);
        return rm ? `${rm.nombre} (${rm.tipo})` : '';
      }).filter(Boolean).join(', ');
    } else if (isPasadia) {
      habitacionesStr = selectedUnits.map(uid => {
        const rm = rooms.find(r => r.id === uid);
        return rm ? `${rm.nombre}` : '';
      }).filter(Boolean).join(', ');
    } else {
      habitacionesStr = selectedRoom ? `${selectedRoom.nombre} (${selectedRoom.tipo})` : '';
    }

    const planNombre = cotizacion.plan?.nombre || selectedPlan?.nombre || 'Plan Seleccionado';
    
    let huespedesStr = `${form.adultos} Adulto${form.adultos > 1 ? 's' : ''}`;
    if (form.menores > 0) huespedesStr += `, ${form.menores} Menor${form.menores > 1 ? 'es' : ''}`;
    if (form.mascotas > 0) huespedesStr += `, ${form.mascotas} Mascota${form.mascotas > 1 ? 's' : ''}`;

    let altRatesStr = '';
    const altPlanesList = filteredPlanes.filter(p => p.codigo !== form.plan_codigo && p.visible_web === 1);
    if (altPlanesList.length > 0) {
      altRatesStr = '\n✨ *Tarifas Alternativas:*\n' + altPlanesList.map(p => {
        const rate = alternativeQuotes[p.codigo];
        if (rate !== undefined) {
          return `- En plan *${p.nombre}*: $${rate.toFixed(2)}`;
        }
        return '';
      }).filter(Boolean).join('\n');
    }

    const text = `🌴 *COTIZACIÓN DE RESERVA - HOTEL PANAMÁ CANAL* 🌴

👤 *Cliente:* ${clienteFull}
📅 *Fechas:* ${checkInStr} al ${checkOutStr} (${nochesStr})
👥 *Huéspedes:* ${huespedesStr}
🏨 *Habitaciones:* ${habitacionesStr}
🏷️ *Plan Cotizado:* ${planNombre}

💰 *Resumen Económico:*
• Subtotal: $${cotizacion.subtotal.toFixed(2)}
• Impuestos (${cotizacion.impuesto_pct}%): $${cotizacion.impuesto_monto.toFixed(2)}
• *Monto Total:* $${cotizacion.monto_total.toFixed(2)}
• Depósito Sugerido: $${cotizacion.deposito_sugerido.toFixed(2)}
${altRatesStr}

¡Esperamos tener el gusto de hospedarle pronto en Hotel Panamá Canal! 🌊🥥`;

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Validations
  const todayStr = new Date().toISOString().split('T')[0];
  const pastDateError = form.check_in && form.check_in < todayStr ? 'No se puede reservar en el pasado' : '';
  const dateError = form.check_in && form.check_out && form.check_out <= form.check_in
    ? 'Check-out debe ser después del check-in' : '';
  const totalGuests = form.adultos + form.menores;
  const selectedRoom = rooms.find((r: any) => r.id == form.habitacion_id);
  const selectedRoomAvailable = !form.habitacion_id || selectedRoom?.disponible;
  const capacityError = selectedRoom && selectedRoom.capacidad_max
    ? (totalGuests > selectedRoom.capacidad_max
      ? `${selectedRoom.nombre} admite máximo ${selectedRoom.capacidad_max} personas. Tienes ${totalGuests}.`
      : totalGuests < (selectedRoom.capacidad_min || 1)
        ? `${selectedRoom.nombre} requiere mínimo ${selectedRoom.capacidad_min} personas.`
        : '')
    : '';

  const hasUnit = isGroup
    ? selectedGroupRooms.length > 0
    : (isPasadia ? selectedUnits.length > 0 : !!form.habitacion_id);

  const canSubmit = form.cliente && form.apellido && form.whatsapp && form.check_in && form.check_out && !dateError && !pastDateError
    && (isGroup ? selectedGroupRooms.length > 0 : (form.plan_codigo && hasUnit && selectedRoomAvailable && !capacityError));

  const handlePayPalSuccess = async (orderId: string) => {
    setError('');
    setLoading(true);
    try {
      const habId = isPasadia ? selectedUnits[0] : Number(form.habitacion_id);
      const payload = { ...form, habitacion_id: habId };
      const r = await api.post('/hotel/reservas', payload);
      await api.post(`/hotel/reservas/${r.data.id}/folio`, {
        monto: parseFloat(depositAmount) || cotizacion.deposito_sugerido,
        concepto: 'Depósito inicial (PayPal)',
        tipo: 'credito',
        metodo_pago: 'paypal',
        referencia: orderId
      });
      navigate(`/reservas/${r.data.id}`);
    } catch (err: any) {
      setError(err.message || 'Error guardando reserva después del pago');
    } finally {
      setLoading(false);
    }
  };

  const handlePayPalSuccessGroup = async (orderId: string) => {
    setError('');
    setLoading(true);
    try {
      const reservasPayload = selectedGroupRooms.map((roomId, idx) => {
        const config = roomConfigs[roomId] || {};
        const room = rooms.find(rm => rm.id === roomId);
        return {
          cliente: config.cliente || form.cliente,
          apellido: config.apellido || form.apellido,
          email: idx === 0 ? form.email : (config.email || form.email || ''),
          whatsapp: idx === 0 ? form.whatsapp : (config.whatsapp || form.whatsapp || ''),
          nacionalidad: idx === 0 ? form.nacionalidad : (config.nacionalidad || form.nacionalidad || ''),
          habitacion_id: roomId,
          tipo_habitacion: room ? room.tipo : '',
          check_in: form.check_in,
          check_out: form.check_out,
          hora_llegada: form.hora_llegada || null,
          adultos: config.adultos !== undefined ? Number(config.adultos) : (idx === 0 ? Number(form.adultos) : 0),
          menores: config.menores !== undefined ? Number(config.menores) : (idx === 0 ? Number(form.menores) : 0),
          mascotas: config.mascotas !== undefined ? Number(config.mascotas) : (idx === 0 ? Number(form.mascotas) : 0),
          plan_codigo: config.plan_codigo || form.plan_codigo,
          fuente: form.fuente || 'Teléfono',
          notes: form.notas || '',
          estado: 'Confirmada'
        };
      });

      const payload = {
        facturacion_consolidada: facturacionConsolidada,
        reservas: reservasPayload
      };

      const r = await api.post('/hotel/reservas/grupo', payload);
      const master = r.data.reservas.find((res: any) => res.es_maestra === 1) || r.data.reservas[0];
      const masterId = master.id;

      await api.post(`/hotel/reservas/${masterId}/folio`, {
        monto: parseFloat(depositAmount) || cotizacion.deposito_sugerido,
        concepto: 'Depósito inicial (PayPal - Grupo)',
        tipo: 'credito',
        metodo_pago: 'paypal',
        referencia: orderId
      });

      navigate(`/reservas/${masterId}`);
    } catch (err: any) {
      setError(err.message || 'Error guardando reserva después del pago');
    } finally {
      setLoading(false);
    }
  };

  const handlePayPalSuccessPasadia = async (orderId: string) => {
    setError('');
    setLoading(true);
    try {
      let firstId: number | null = null;
      for (const unitId of selectedUnits) {
        const payload = { ...form, habitacion_id: unitId, notas: `${form.notas}\n[Pasadía grupo: ${selectedUnits.length} unidades]`.trim() };
        const r = await api.post('/hotel/reservas', payload);
        if (!firstId) firstId = r.data.id;
        
        if (firstId === r.data.id) {
          await api.post(`/hotel/reservas/${r.data.id}/folio`, {
            monto: parseFloat(depositAmount) || cotizacion.deposito_sugerido,
            concepto: 'Depósito inicial (PayPal - Pasadía)',
            tipo: 'credito',
            metodo_pago: 'paypal',
            referencia: orderId
          });
        }
      }
      navigate(`/reservas/${firstId}`);
    } catch (err: any) {
      setError(err.message || 'Error guardando reserva después del pago');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.cliente || !form.apellido) { setError('Nombre y apellido son requeridos'); return; }
    if (!form.whatsapp) { setError('WhatsApp es requerido'); return; }
    if (!hasUnit) { setError(isGroup ? 'Debe seleccionar al menos una habitación' : (isPasadia ? 'Debe seleccionar al menos una unidad' : 'Debe seleccionar una habitación')); return; }
    if (!isGroup && !form.plan_codigo) { setError('Debe seleccionar un plan'); return; }
    if (pastDateError) { setError(pastDateError); return; }
    if (dateError) { setError(dateError); return; }
    if (!isGroup && capacityError) { setError(capacityError); return; }

    // Check deposit step
    if (!showDeposit && cotizacion) {
      setShowDeposit(true);
      return;
    }

    if (!isOnlineFlow && parseFloat(depositAmount) > 0 && !receiptFile) {
      setError('El comprobante de pago es obligatorio para registrar abonos manuales. Por favor suba un recibo válido.');
      return;
    }


    setLoading(true);
    try {
      if (isGroup) {
        // Group booking submission
        const reservasPayload = selectedGroupRooms.map((roomId, idx) => {
          const config = roomConfigs[roomId] || {};
          const room = rooms.find(rm => rm.id === roomId);
          return {
            cliente: config.cliente || form.cliente,
            apellido: config.apellido || form.apellido,
            email: idx === 0 ? form.email : (config.email || form.email || ''),
            whatsapp: idx === 0 ? form.whatsapp : (config.whatsapp || form.whatsapp || ''),
            nacionalidad: idx === 0 ? form.nacionalidad : (config.nacionalidad || form.nacionalidad || ''),
            habitacion_id: roomId,
            tipo_habitacion: room ? room.tipo : '',
            check_in: form.check_in,
            check_out: form.check_out,
            hora_llegada: form.hora_llegada || null,
            adultos: config.adultos !== undefined ? Number(config.adultos) : (idx === 0 ? Number(form.adultos) : 0),
            menores: config.menores !== undefined ? Number(config.menores) : (idx === 0 ? Number(form.menores) : 0),
            mascotas: config.mascotas !== undefined ? Number(config.mascotas) : (idx === 0 ? Number(form.mascotas) : 0),
            plan_codigo: config.plan_codigo || form.plan_codigo,
            fuente: form.fuente || 'Teléfono',
            notas: form.notas || '',
            estado: 'Confirmada'
          };
        });

        const payload = {
          facturacion_consolidada: facturacionConsolidada,
          reservas: reservasPayload
        };

        const r = await api.post('/hotel/reservas/grupo', payload);
        const master = r.data.reservas.find((res: any) => res.es_maestra === 1) || r.data.reservas[0];
        const masterId = master.id;

        if (depositAmount && parseFloat(depositAmount) > 0) {
          await api.post(`/hotel/reservas/${masterId}/folio`, {
            monto: parseFloat(depositAmount),
            concepto: 'Depósito inicial (Grupo)',
            tipo: 'credito',
            metodo_pago: depositMetodo,
            referencia: depositRef
          });
          // Sequential receipt upload
          if (receiptFile) {
            const formData = new FormData();
            formData.append('archivo', receiptFile);
            formData.append('tipo', 'recibo');
            formData.append('notas', `Comprobante de abono inicial registrado en la creación de la reserva por $${parseFloat(depositAmount).toFixed(2)}.`);
            await api.post(`/hotel/reservas/${masterId}/documentos`, formData, {
              headers: { 'Content-Type': 'multipart/form-data' }
            });
          }
        }

        navigate(`/reservas/${masterId}`);
      } else if (isPasadia && selectedUnits.length > 1) {
        // Create one reservation per selected unit
        let firstId: number | null = null;
        for (const unitId of selectedUnits) {
          const payload = { ...form, habitacion_id: unitId, notas: `${form.notas}\n[Pasadía grupo: ${selectedUnits.length} unidades]`.trim() };
          const r = await api.post('/hotel/reservas', payload);
          if (!firstId) firstId = r.data.id;
          // Deposit only on first reservation
          if (firstId === r.data.id && depositAmount && parseFloat(depositAmount) > 0) {
            await api.post(`/hotel/reservas/${r.data.id}/folio`, {
              monto: parseFloat(depositAmount),
              concepto: 'Depósito inicial (Pasadía)',
              tipo: 'credito',
              metodo_pago: depositMetodo,
              referencia: depositRef
            });
            // Sequential receipt upload
            if (receiptFile) {
              const formData = new FormData();
              formData.append('archivo', receiptFile);
              formData.append('tipo', 'recibo');
              formData.append('notas', `Comprobante de abono inicial registrado en la creación de la reserva por $${parseFloat(depositAmount).toFixed(2)}.`);
              await api.post(`/hotel/reservas/${r.data.id}/documentos`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
              });
            }
          }
        }
        navigate(`/reservas/${firstId}`);
      } else {
        // Single unit (Estadía or single Pasadía)
        const habId = isPasadia ? selectedUnits[0] : Number(form.habitacion_id);
        const payload = { ...form, habitacion_id: habId };
        const r = await api.post('/hotel/reservas', payload);
        if (depositAmount && parseFloat(depositAmount) > 0) {
          await api.post(`/hotel/reservas/${r.data.id}/folio`, {
            monto: parseFloat(depositAmount),
            concepto: 'Depósito inicial',
            tipo: 'credito',
            metodo_pago: depositMetodo,
            referencia: depositRef
          });
          // Sequential receipt upload
          if (receiptFile) {
            const formData = new FormData();
            formData.append('archivo', receiptFile);
            formData.append('tipo', 'recibo');
            formData.append('notas', `Comprobante de abono inicial registrado en la creación de la reserva por $${parseFloat(depositAmount).toFixed(2)}.`);
            await api.post(`/hotel/reservas/${r.data.id}/documentos`, formData, {
              headers: { 'Content-Type': 'multipart/form-data' }
            });
          }
        }
        navigate(`/reservas/${r.data.id}`);
      }
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft size={16} /> Volver
      </button>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Nueva Reserva</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm flex items-center gap-2"><AlertTriangle size={16} /> {error}</div>}

        {/* Category Selector */}
        <div className="flex gap-3">
          <button type="button" onClick={() => setCategoria('Estadía')}
            className={`flex-1 p-5 rounded-xl border-2 transition flex items-center justify-center gap-3 ${
              !isPasadia ? 'border-ocean-400 bg-ocean-50 ring-2 ring-ocean-200' : 'border-gray-200 bg-white hover:border-gray-300'
            }`}>
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${!isPasadia ? 'bg-ocean-500' : 'bg-gray-200'}`}>
              <Moon size={22} className={!isPasadia ? 'text-white' : 'text-gray-500'} />
            </div>
            <div className="text-left">
              <div className={`font-bold text-lg ${!isPasadia ? 'text-ocean-700' : 'text-gray-600'}`}>🏨 Estadía</div>
              <div className="text-sm text-gray-400">Hospedaje • 1+ noches</div>
            </div>
          </button>
          <button type="button" onClick={() => setCategoria('Pasadía')}
            className={`flex-1 p-5 rounded-xl border-2 transition flex items-center justify-center gap-3 ${
              isPasadia ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-200' : 'border-gray-200 bg-white hover:border-gray-300'
            }`}>
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isPasadia ? 'bg-amber-500' : 'bg-gray-200'}`}>
              <Sun size={22} className={isPasadia ? 'text-white' : 'text-gray-500'} />
            </div>
            <div className="text-left">
              <div className={`font-bold text-lg ${isPasadia ? 'text-amber-700' : 'text-gray-600'}`}>☀️ Pasadía</div>
              <div className="text-sm text-gray-400">Día de uso • 1 solo día</div>
            </div>
          </button>
        </div>

        {/* Group Booking Toggle Switch */}
        <div className="bg-white rounded-xl p-5 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">👥</span>
            <div>
              <div className="font-bold text-gray-700">¿Es una reserva de grupo? 👥</div>
              <div className="text-sm text-gray-400">Permite reservar múltiples habitaciones en la misma transacción.</div>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={isGroup}
              onChange={(e) => {
                setIsGroup(e.target.checked);
                setForm(f => ({ ...f, habitacion_id: '' }));
                setSelectedGroupRooms([]);
                setRoomConfigs({});
                setCotizacion(null);
              }}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-mahana-500"></div>
          </label>
        </div>

        {/* Step 1: Date & Availability */}
        <Section title={isPasadia ? '1. Fecha del Pasadía' : '1. Disponibilidad'} active={!showDeposit}>
          <div className={`grid grid-cols-1 ${isPasadia ? 'md:grid-cols-3' : 'md:grid-cols-4'} gap-4`}>
            <Field label="Fuente">
              <select value={form.fuente} onChange={e => set('fuente', e.target.value)} className="input">
                <option>Teléfono</option><option>Email</option><option>Sitio web</option><option>Walk-in</option><option>Manual</option>
              </select>
            </Field>
            <Field label={isPasadia ? 'Fecha *' : 'Check-in *'}>
              <input type="date" value={form.check_in} onChange={e => set('check_in', e.target.value)}
                required className={`input ${pastDateError ? 'border-red-400 ring-1 ring-red-400' : ''}`} min={todayStr} />
            </Field>
            {!isPasadia && (
              <Field label="Check-out *">
                <input type="date" value={form.check_out} onChange={e => set('check_out', e.target.value)}
                  required className={`input ${dateError ? 'border-red-400 ring-1 ring-red-400' : ''}`}
                  min={form.check_in || todayStr} />
              </Field>
            )}
            <Field label="Hora llegada">
              <input type="time" value={form.hora_llegada} onChange={e => set('hora_llegada', e.target.value)} className="input" />
            </Field>
          </div>
          {isPasadia && form.check_in && (
            <div className="text-sm text-amber-600 mt-2 bg-amber-50 px-3 py-2 rounded-lg">
              ☀️ Día de uso: <strong>{form.check_in}</strong> — solo este día
            </div>
          )}
          {dateError && <div className="text-red-500 text-xs mt-1">{dateError}</div>}
          {pastDateError && <div className="text-red-500 text-xs mt-1">{pastDateError}</div>}

          {/* Room / Unit Selection */}
          {categoryRooms.length > 0 && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-600 mb-2">
                {isGroup ? 'Habitaciones del Grupo *' : (isPasadia ? 'Unidades *' : 'Habitación *')}
                <span className="text-gray-400 font-normal ml-1">
                  ({availableRooms.length} disponibles)
                  {isGroup && selectedGroupRooms.length > 0 && <span className="text-ocean-600 ml-1">• {selectedGroupRooms.length} seleccionada{selectedGroupRooms.length > 1 ? 's' : ''}</span>}
                  {!isGroup && isPasadia && selectedUnits.length > 0 && <span className="text-amber-600 ml-1">• {selectedUnits.length} seleccionada{selectedUnits.length > 1 ? 's' : ''}</span>}
                </span>
              </label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {categoryRooms.map((r: any) => {
                  const maxCap = r.capacidad_max || r.capacidad || 4;
                  const minCap = r.capacidad_min || 1;
                  const fitsGuests = totalGuests >= minCap && totalGuests <= maxCap;
                  const isSelected = isGroup
                    ? selectedGroupRooms.includes(r.id)
                    : (isPasadia ? selectedUnits.includes(r.id) : form.habitacion_id == r.id);
                  const accentColor = isGroup ? 'ocean' : (isPasadia ? 'amber' : 'ocean');
                  return (
                    <button key={r.id} type="button"
                      onClick={() => {
                        if (!r.disponible) return;
                        if (isGroup) { toggleGroupRoom(r.id); }
                        else if (isPasadia) { toggleUnit(r.id); }
                        else { set('habitacion_id', r.id); }
                      }}
                      disabled={!r.disponible}
                      className={`p-3 rounded-lg border text-sm text-left transition ${
                        !r.disponible ? 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed opacity-50' :
                        isSelected ? (fitsGuests ? `bg-${accentColor}-50 border-${accentColor}-400 text-${accentColor}-700 ring-2 ring-${accentColor}-400` : 'bg-red-50 border-red-400 text-red-700 ring-2 ring-red-400') :
                        `bg-white border-gray-200 hover:border-${accentColor}-300 hover:bg-${accentColor}-50/30`
                      }`}>
                      <div className="font-semibold">{r.nombre}</div>
                      <div className="text-xs text-gray-400">{r.tipo} • {minCap}-{maxCap} pers.</div>
                      {r.descripcion_camas && <div className="text-xs text-gray-400">🛏️ {r.descripcion_camas}</div>}
                      {!r.disponible && <div className="text-xs text-red-300 mt-1">Ocupada</div>}
                      {r.disponible && isSelected && <div className="text-xs text-green-500 mt-1">✓ Seleccionada</div>}
                      {r.disponible && !isSelected && <div className="text-xs text-gray-300 mt-1">{(isPasadia || isGroup) ? 'Click para agregar' : '✓ Disponible'}</div>}
                    </button>
                  );
                })}
              </div>
              {isPasadia && selectedUnits.length > 1 && (
                <div className="mt-2 text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
                  📋 Se crearán <strong>{selectedUnits.length} reservas</strong> separadas (una por unidad) vinculadas a este grupo.
                </div>
              )}
              {isGroup && selectedGroupRooms.length > 0 && (
                <div className="mt-2 text-sm text-ocean-700 bg-ocean-50 px-3 py-2 rounded-lg">
                  👥 Se crearán <strong>{selectedGroupRooms.length} habitaciones</strong> bajo un mismo código de grupo.
                </div>
              )}
              {!isGroup && capacityError && (
                <div className="text-red-500 text-xs mt-2 flex items-center gap-1">
                  <AlertTriangle size={12} /> {capacityError}
                </div>
              )}
              {!hasUnit && categoryRooms.length > 0 && !capacityError && (
                <div className="text-amber-600 text-xs mt-2 flex items-center gap-1">
                  <AlertTriangle size={12} /> {isGroup ? 'Seleccione al menos una habitación' : (isPasadia ? 'Seleccione una o más unidades' : 'Seleccione una habitación para continuar')}
                </div>
              )}
            </div>
          )}

          {/* Plan & Guests (Primary details) */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
            <Field label={isGroup ? "Plan Principal *" : "Plan *"} className="md:col-span-2">
              <select value={form.plan_codigo} onChange={e => set('plan_codigo', e.target.value)} required className="input">
                <option value="">Seleccionar plan</option>
                {filteredPlanes.map((p: any) => (
                  <option key={p.codigo} value={p.codigo}>
                    {p.nombre} — ${p.precio_adulto_noche}/{isPasadia ? 'persona' : 'noche'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={isGroup ? 'Adultos Líd.' : 'Adultos'}>
              <input type="number" min={1} max={50} value={form.adultos} onChange={e => set('adultos', +e.target.value)} className="input" />
            </Field>
            <Field label={isGroup ? 'Menores Líd.' : "Menores"}>
              <input type="number" min={0} max={10} value={form.menores} onChange={e => set('menores', +e.target.value)} className="input" />
            </Field>
            <Field label={isGroup ? 'Mascotas Líd.' : "Mascotas"}>
              <input type="number" min={0} max={5} value={form.mascotas} onChange={e => set('mascotas', +e.target.value)} className="input" />
            </Field>
          </div>
        </Section>

        {/* Group Configuration Section */}
        {isGroup && selectedGroupRooms.length > 0 && (
          <Section title="Configuración de Habitaciones del Grupo 👥" active={true}>
            {/* Billing Scheme Dropdown */}
            <div className="mb-6 max-w-md">
              <Field label="Esquema de Facturación del Grupo">
                <select
                  value={facturacionConsolidada}
                  onChange={e => setFacturacionConsolidada(Number(e.target.value))}
                  className="input"
                >
                  <option value={1}>Facturación Consolidada (Cuentas a la Habitación Principal)</option>
                  <option value={0}>Cuentas Separadas (Cada habitación paga lo suyo)</option>
                </select>
              </Field>
            </div>

            {/* Glassmorphic Guest Tracker */}
            <div className="bg-white/40 backdrop-blur-md border border-white/60 rounded-2xl p-5 shadow-lg mb-6 relative overflow-hidden">
              {/* Premium abstract background glow */}
              <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-ocean-300/20 to-mahana-300/20 rounded-full blur-xl pointer-events-none" />
              
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h4 className="font-bold text-gray-800 text-base mb-1 flex items-center gap-1.5">
                    📊 Control de Huéspedes del Grupo
                  </h4>
                  <p className="text-xs text-gray-500">
                    Distribuya la cantidad de huéspedes especificada en el formulario principal entre las habitaciones asignadas.
                  </p>
                </div>
                
                <button
                  type="button"
                  onClick={autoDistributeGuests}
                  className="self-start md:self-center px-4 py-2 bg-gradient-to-r from-ocean-500 to-mahana-500 hover:from-ocean-600 hover:to-mahana-600 text-white font-semibold rounded-xl text-xs shadow-md shadow-ocean-100 hover:shadow-lg transition flex items-center gap-1.5"
                >
                  ✨ Auto-distribuir Huéspedes
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3 mt-4">
                <div className="bg-white/80 rounded-xl p-3 border border-gray-100 text-center">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-gray-400 mb-1">Adultos</div>
                  <div className="flex justify-center items-baseline gap-1">
                    <span className="text-lg font-black text-gray-800">{assignedAdults}</span>
                    <span className="text-xs text-gray-400">/ {form.adultos}</span>
                  </div>
                  <div className="mt-1">
                    {pendingAdults === 0 ? (
                      <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Completado</span>
                    ) : pendingAdults > 0 ? (
                      <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">{pendingAdults} pendientes</span>
                    ) : (
                      <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{Math.abs(pendingAdults)} sobrantes</span>
                    )}
                  </div>
                </div>

                <div className="bg-white/80 rounded-xl p-3 border border-gray-100 text-center">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-gray-400 mb-1">Menores</div>
                  <div className="flex justify-center items-baseline gap-1">
                    <span className="text-lg font-black text-gray-800">{assignedMinors}</span>
                    <span className="text-xs text-gray-400">/ {form.menores}</span>
                  </div>
                  <div className="mt-1">
                    {pendingMinors === 0 ? (
                      <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Completado</span>
                    ) : pendingMinors > 0 ? (
                      <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">{pendingMinors} pendientes</span>
                    ) : (
                      <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{Math.abs(pendingMinors)} sobrantes</span>
                    )}
                  </div>
                </div>

                <div className="bg-white/80 rounded-xl p-3 border border-gray-100 text-center">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-gray-400 mb-1">Mascotas</div>
                  <div className="flex justify-center items-baseline gap-1">
                    <span className="text-lg font-black text-gray-800">{assignedPets}</span>
                    <span className="text-xs text-gray-400">/ {form.mascotas}</span>
                  </div>
                  <div className="mt-1">
                    {pendingPets === 0 ? (
                      <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Completado</span>
                    ) : pendingPets > 0 ? (
                      <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">{pendingPets} pendientes</span>
                    ) : (
                      <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{Math.abs(pendingPets)} sobrantes</span>
                    )}
                  </div>
                </div>
              </div>

              {!allAssignedMatch && (
                <div className="mt-3 bg-amber-50/80 border border-amber-100 rounded-xl p-3 text-xs text-amber-800 flex items-center gap-2">
                  <AlertTriangle size={14} className="shrink-0 text-amber-600" />
                  <span>
                    La cantidad de huéspedes asignados en los cuartos no coincide exactamente con el formulario principal. Use <strong>"Auto-distribuir Huéspedes"</strong> o ajústelo manualmente abajo.
                  </span>
                </div>
              )}
            </div>

            {/* Room cards list */}
            <div className="space-y-4">
              {selectedGroupRooms.map((roomId, index) => {
                const room = rooms.find(rm => rm.id === roomId);
                const config = roomConfigs[roomId] || {
                  cliente: index === 0 ? form.cliente : '',
                  apellido: index === 0 ? form.apellido : '',
                  adultos: index === 0 ? (form.adultos || 1) : 0,
                  menores: index === 0 ? (form.menores || 0) : 0,
                  mascotas: index === 0 ? (form.mascotas || 0) : 0,
                  plan_codigo: form.plan_codigo || ''
                };

                const updateConfig = (field: string, val: any) => {
                  setRoomConfigs(curr => ({
                    ...curr,
                    [roomId]: {
                      ...config,
                      [field]: val
                    }
                  }));
                };

                return (
                  <div key={roomId} className="border border-gray-200 rounded-xl p-4 bg-gray-50/50 space-y-4 transition hover:shadow-sm">
                    <div className="flex justify-between items-center border-b pb-2">
                      <span className="font-bold text-gray-700 flex items-center gap-2">
                        <span className="bg-ocean-100 text-ocean-700 px-2 py-0.5 rounded text-xs font-mono">
                          Habitación #{index + 1}
                        </span>
                        {room?.nombre} <span className="font-normal text-gray-400">({room?.tipo})</span>
                      </span>
                      {index === 0 ? (
                        <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full flex items-center gap-1 border border-amber-200">
                          👑 Líder del Grupo (Maestra)
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
                          Habitación Adicional
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <Field label="Nombre del Huésped *">
                        <input
                          type="text"
                          value={config.cliente}
                          onChange={e => updateConfig('cliente', e.target.value)}
                          className="input bg-white"
                          required
                          placeholder="Nombre"
                        />
                      </Field>
                      <Field label="Apellido *">
                        <input
                          type="text"
                          value={config.apellido}
                          onChange={e => updateConfig('apellido', e.target.value)}
                          className="input bg-white"
                          required
                          placeholder="Apellido"
                        />
                      </Field>
                      <Field label="Plan de Tarifa *">
                        <select
                          value={config.plan_codigo}
                          onChange={e => updateConfig('plan_codigo', e.target.value)}
                          className="input bg-white"
                          required
                        >
                          <option value="">Seleccionar plan</option>
                          {filteredPlanes.map((p: any) => (
                            <option key={p.codigo} value={p.codigo}>
                              {p.nombre} — ${p.precio_adulto_noche}/{isPasadia ? 'persona' : 'noche'}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>

                    <div className="grid grid-cols-3 gap-4 max-w-md">
                      <Field label="Adultos">
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={config.adultos}
                          onChange={e => updateConfig('adultos', parseInt(e.target.value) || 1)}
                          className="input bg-white"
                        />
                      </Field>
                      <Field label="Menores">
                        <input
                          type="number"
                          min={0}
                          max={10}
                          value={config.menores}
                          onChange={e => updateConfig('menores', parseInt(e.target.value) || 0)}
                          className="input bg-white"
                        />
                      </Field>
                      <Field label="Mascotas">
                        <input
                          type="number"
                          min={0}
                          max={5}
                          value={config.mascotas}
                          onChange={e => updateConfig('mascotas', parseInt(e.target.value) || 0)}
                          className="input bg-white"
                        />
                      </Field>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Cotización */}
        {cotizacion && (
          <div className={`bg-gradient-to-r ${isPasadia ? 'from-amber-50 to-mahana-50 border-amber-200' : 'from-ocean-50 to-mahana-50 border-ocean-200'} rounded-xl p-5 border shadow-sm`}>
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-gray-700">Cotización {isPasadia && selectedUnits.length > 1 ? `(${selectedUnits.length} unidades)` : ''}</h3>
              <button
                type="button"
                onClick={handleCopyQuote}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                  copied
                    ? 'bg-green-500 text-white shadow-md shadow-green-100'
                    : 'bg-white text-gray-600 border border-gray-200 hover:border-mahana-400 hover:text-mahana-600 shadow-sm'
                }`}
              >
                {copied ? (
                  <>✓ ¡Copiado!</>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
                    Copiar Cotización
                  </>
                )}
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><span className="text-gray-400">Plan:</span> <span className="font-medium">{cotizacion.plan?.nombre || 'Personalizado'}</span></div>
              <div><span className="text-gray-400">{isPasadia ? 'Tipo:' : 'Noches:'}</span> <span className="font-medium">{isPasadia ? 'Pasadía (1 día)' : cotizacion.noches}</span></div>
              <div><span className="text-gray-400">{isPasadia ? 'Personas:' : 'Huéspedes:'}</span> <span className="font-medium">{form.adultos}{!isPasadia ? ` A + ${form.menores}M` : ''}</span></div>
              {isPasadia && selectedUnits.length > 1 && <div><span className="text-gray-400">Unidades:</span> <span className="font-medium">{selectedUnits.length}</span></div>}
            </div>

            {/* Per-night breakdown */}
            {cotizacion.desglose?.length > 0 && !isPasadia && (
              <div className="mt-3 mb-1">
                <div className="text-xs font-semibold text-gray-500 mb-1">Desglose por noche:</div>
                <div className="space-y-1">
                  {cotizacion.desglose.map((n: any) => (
                    <div key={n.fecha} className="flex items-center justify-between text-xs bg-white/60 rounded-lg px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 font-mono w-20">{n.fecha}</span>
                        <span className="text-gray-600 w-8">{n.dia}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          n.tipo_dia === 'festivo' ? 'bg-red-100 text-red-600' :
                          n.tipo_dia === 'fin_de_semana' ? 'bg-orange-100 text-orange-600' :
                          'bg-blue-50 text-blue-600'
                        }`}>
                          {n.tipo_dia === 'festivo' ? `🎊 ${n.festivo_nombre || 'Festivo'}` :
                           n.tipo_dia === 'fin_de_semana' ? '🎉 Fin de semana' : '📅 Entre semana'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-gray-400 text-[10px]">${n.precio_adulto}/adulto</span>
                        <span className="font-bold text-gray-700">${n.total_noche.toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <hr className="my-3 border-gray-200" />
            <div className="space-y-1 text-sm max-w-xs">
              <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span className="font-medium">${cotizacion.subtotal.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Impuesto {cotizacion.impuesto_pct}%</span><span>${cotizacion.impuesto_monto.toFixed(2)}</span></div>
              <div className="flex justify-between text-lg font-bold border-t pt-2 mt-2">
                <span>Total</span>
                <span className={isPasadia ? 'text-amber-700' : 'text-ocean-700'}>${cotizacion.monto_total.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-gray-400 text-xs"><span>Depósito sugerido</span><span>${cotizacion.deposito_sugerido.toFixed(2)}</span></div>
            </div>

            {/* Alternative pricing comparison panel */}
            {Object.keys(alternativeQuotes).length > 0 && (
              <div className="mt-4 pt-3 border-t border-gray-200/50">
                <div className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Tarifas en otros planes:</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {filteredPlanes.filter(p => p.codigo !== form.plan_codigo && p.visible_web === 1).map(p => {
                    const rate = alternativeQuotes[p.codigo];
                    if (rate === undefined) return null;
                    return (
                      <div key={p.codigo} className="bg-white/60 backdrop-blur-sm rounded-lg p-2.5 flex items-center justify-between text-xs border border-gray-100 hover:border-mahana-200 hover:bg-white transition">
                        <span className="text-gray-600 font-medium">{p.nombre}</span>
                        <span className="font-bold text-gray-800">${rate.toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Guest Info */}
        <Section title={isPasadia ? '2. Contacto' : '2. Huésped Principal'} active={!showDeposit}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Nombre *"><input value={form.cliente} onChange={e => set('cliente', e.target.value)} required className="input" placeholder="Nombre" /></Field>
            <Field label="Apellido *"><input value={form.apellido} onChange={e => set('apellido', e.target.value)} required className={`input ${!form.apellido && form.cliente ? 'border-amber-300' : ''}`} placeholder="Apellido" /></Field>
            {!isPasadia && <Field label="Nacionalidad"><input value={form.nacionalidad} onChange={e => set('nacionalidad', e.target.value)} className="input" placeholder="País" /></Field>}
            <Field label="Email"><input type="email" value={form.email} onChange={e => set('email', e.target.value)} className="input" placeholder="email@ejemplo.com" /></Field>
            <Field label="WhatsApp *"><input value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} required className={`input ${!form.whatsapp && form.cliente ? 'border-amber-300' : ''}`} placeholder="+507..." /></Field>
          </div>
        </Section>

        {/* Step 3: Notes */}
        <Section title="3. Notas" active={!showDeposit}>
          <textarea value={form.notas} onChange={e => set('notas', e.target.value)} className="input min-h-[80px]" placeholder="Notas adicionales..." />
        </Section>

        {/* Step 4: Deposit */}
        {showDeposit && cotizacion && (
          <Section title="4. Registro de Abono" active={true}>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-700 flex items-center gap-2">
              <AlertTriangle size={16} />
              <span>Depósito sugerido: <strong>${cotizacion.deposito_sugerido.toFixed(2)}</strong>. Puede registrar un abono ahora o dejarlo en $0.</span>
            </div>

            <div className="flex bg-gray-100 p-1.5 rounded-2xl border border-gray-200/50 mb-6 gap-2 max-w-md">
              <button
                type="button"
                onClick={() => {
                  setIsOnlineFlow(false);
                  setDepositMetodo('efectivo');
                }}
                className={`flex-1 py-2 text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1.5 ${
                  !isOnlineFlow
                    ? 'bg-white shadow text-gray-800 font-bold'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Registro Manual (Offline)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsOnlineFlow(true);
                  setDepositMetodo('paypal');
                }}
                className={`flex-1 py-2 text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1.5 ${
                  isOnlineFlow
                    ? 'bg-white shadow text-gray-800 font-bold'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>Pagos online (sin configurar)</span>
              </button>
            </div>

            {isOnlineFlow ? (
              <div className="space-y-4">
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800 flex items-center gap-2">
                  <Shield size={16} className="text-emerald-600 shrink-0" />
                  <span>Pagos online por configurar. Esta copia no puede procesar cobros online.</span>
                </div>
                {paypalConfig.paypal_enabled && paypalConfig.paypal_client_id ? (
                  <div className="max-w-sm mt-4">
                    <OnlinePaymentsDisabled
                      clientId={paypalConfig.paypal_client_id}
                      mode={paypalConfig.paypal_mode}
                      monto={parseFloat(depositAmount) || cotizacion.deposito_sugerido}
                      descripcion={`Hotel Panamá Canal - Abono reserva de ${form.cliente} ${form.apellido}`}
                      onSuccess={async (orderId) => {
                        if (isGroup) {
                          await handlePayPalSuccessGroup(orderId);
                        } else if (isPasadia && selectedUnits.length > 1) {
                          await handlePayPalSuccessPasadia(orderId);
                        } else {
                          await handlePayPalSuccess(orderId);
                        }
                      }}
                      onError={(msg) => setError(msg)}
                    />
                  </div>
                ) : (
                  <div className="text-sm text-gray-500 bg-gray-50 p-4 rounded-lg">
                    El pago por PayPal no está disponible en este momento. Por favor use el Registro Manual (Offline).
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-start">
                <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Field label="Monto del abono">
                    <input type="number" step="0.01" min="0" value={depositAmount}
                      onChange={e => {
                        setDepositAmount(e.target.value);
                        setIsDepositDirty(true);
                      }} className="input" placeholder="0.00" />
                    <div className="flex gap-1.5 mt-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setDepositAmount(cotizacion.deposito_sugerido.toFixed(2));
                          setIsDepositDirty(true);
                        }}
                        className="px-2 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-800 text-[10px] font-bold rounded"
                      >
                        Depósito sugerido
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDepositAmount(cotizacion.monto_total.toFixed(2));
                          setIsDepositDirty(true);
                        }}
                        className="px-2 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-800 text-[10px] font-bold rounded"
                      >
                        100% Total
                      </button>
                    </div>
                  </Field>
                  <Field label="Método de pago">
                    <select value={depositMetodo} onChange={e => setDepositMetodo(e.target.value)} className="input">
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
                  </Field>
                  <Field label="Referencia">
                    <input value={depositRef} onChange={e => setDepositRef(e.target.value)} className="input" placeholder="# recibo" />
                  </Field>
                </div>

                {/* Upload receipt container */}
                {!isOnlineFlow && parseFloat(depositAmount) > 0 && (
                  <div className="md:col-span-4 mt-2">
                    <label className="block text-sm font-medium text-gray-500 mb-2">📸 Comprobante de Pago (Yappy, Recibo o Transferencia)</label>
                    <div
                      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
                      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragActive(false);
                        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                          const file = e.dataTransfer.files[0];
                          const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
                          if (allowed.includes(file.type)) {
                            setReceiptFile(file);
                          } else {
                            alert('Solo se permiten imágenes JPG, PNG, WebP o archivos PDF.');
                          }
                        }
                      }}
                      className={`border-2 border-dashed rounded-xl p-5 text-center transition relative overflow-hidden flex flex-col items-center justify-center min-h-[140px] bg-gray-50 ${
                        dragActive ? 'border-mahana-500 bg-mahana-50/20' : 'border-gray-300 hover:border-mahana-400'
                      }`}
                    >
                      <input
                        type="file"
                        id="receipt-file-input"
                        accept=".jpg,.jpeg,.png,.webp,.pdf"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            setReceiptFile(e.target.files[0]);
                          }
                        }}
                      />
                      {!receiptFile ? (
                        <div className="flex flex-col items-center justify-center space-y-2 pointer-events-none">
                          <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm text-gray-400">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                          </div>
                          <div>
                            <span className="text-sm font-semibold text-mahana-600 hover:underline">Selecciona un archivo</span>
                            <span className="text-sm text-gray-500"> o arrástralo aquí</span>
                          </div>
                          <p className="text-xs text-gray-400">PNG, JPG, WebP o PDF hasta 10MB</p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center w-full space-y-3 z-20">
                          {previewUrl ? (
                            <div className="relative w-24 h-24 rounded-lg overflow-hidden border border-gray-200 bg-white">
                              <img src={previewUrl} alt="Comprobante" className="w-full h-full object-cover" />
                            </div>
                          ) : (
                            <div className="w-12 h-12 rounded-xl bg-white border border-gray-100 flex items-center justify-center text-red-500 shadow-sm font-bold text-xs uppercase">
                              {receiptFile.name.split('.').pop()}
                            </div>
                          )}
                          <div className="text-center">
                            <p className="text-sm font-semibold text-gray-700 truncate max-w-xs">{receiptFile.name}</p>
                            <p className="text-xs text-gray-400">{(receiptFile.size / 1024 / 1024).toFixed(2)} MB</p>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setReceiptFile(null); }}
                            className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs font-semibold transition"
                          >
                            Remover archivo
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Section>
        )}

        <div className="flex gap-3 justify-end">
          {showDeposit && (
            <button type="button" onClick={() => setShowDeposit(false)} className="px-5 py-3 text-gray-500 hover:bg-gray-100 rounded-xl transition text-sm">
              ← Volver a editar
            </button>
          )}
          <button type="button" onClick={() => navigate(-1)} className="px-6 py-3 text-gray-600 hover:bg-gray-100 rounded-xl transition">Cancelar</button>
          {!(showDeposit && isOnlineFlow) && (
            <button type="submit" disabled={loading || !canSubmit}
              className={`px-8 py-3 text-white font-semibold rounded-xl hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed ${
                isPasadia ? 'bg-gradient-to-r from-amber-500 to-amber-600' : 'bg-gradient-to-r from-mahana-500 to-mahana-600'
              }`}>
              {loading ? 'Creando...' : showDeposit
                ? `✓ Confirmar ${isPasadia ? 'Pasadía' : 'Reserva'}${isPasadia && selectedUnits.length > 1 ? ` (${selectedUnits.length})` : ''}`
                : 'Continuar →'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function Section({ title, children, active = true }: { title: string; children: React.ReactNode; active?: boolean }) {
  return (
    <div className={`bg-white rounded-xl p-5 shadow-sm transition ${!active ? 'opacity-60' : ''}`}>
      <h2 className="font-semibold text-gray-700 mb-4">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
