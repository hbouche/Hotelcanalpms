import { useState, useEffect, useRef } from 'react'
import { Calendar, Users, ChevronRight, Check, CreditCard, Loader2, MapPin, Star, Shield, ArrowLeft, Bed, Coffee, Sun, Waves, Clock, Mail, Phone, Globe, Upload } from 'lucide-react'

const API = '/api/v1/public'

type RoomType = { tipo: string; categoria: string; capacidad_min: number; capacidad_max: number; total: number; disponibles: number }
type Plan = { id: number; codigo: string; nombre: string; descripcion: string; precio_adulto_noche: number; precio_menor_noche: number; precio_mascota_noche?: number; incluye: string[]; horario: string; extras_disponibles: string[]; imagen: string | null }
type Cotizacion = { plan: { codigo: string; nombre: string }; noches: number; subtotal: number; impuesto_pct: number; impuesto_monto: number; monto_total: number; deposito_minimo: number; deposito_pct: number; desglose: { fecha: string; dia: string; tipo_dia: string; precio_adulto: number; total_noche: number }[] }
type RoomAllocation = { tipo: string; adultos: number; menores: number; mascotas: number }

// Room type icon mapping
const roomIcons: Record<string, typeof Bed> = { 'Familiar': Bed, 'Doble': Bed, 'Estándar': Bed, 'Camping': Sun }
const defaultRoomImages: Record<string, string> = {}
type CartItem = {
  id: string;
  tipo: string;
  plan: Plan;
  adultos: number;
  menores: number;
  mascotas: number;
  subtotal: number;
  impuesto_monto: number;
  monto_total: number;
  deposito_minimo: number;
}

export default function BookingWidget() {
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<any>(null)
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [categoria, setCategoria] = useState<'Estadía' | 'Pasadía'>('Estadía')
  const [adultos, setAdultos] = useState(1)
  const [menores, setMenores] = useState(0)
  const [mascotas, setMascotas] = useState(0)
  const [adultosBuscados, setAdultosBuscados] = useState(1)
  const [menoresBuscados, setMenoresBuscados] = useState(0)
  const [mascotasBuscadas, setMascotasBuscadas] = useState(0)
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [selectedType, setSelectedType] = useState('')
  const [plans, setPlans] = useState<Plan[]>([])
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [cotizacion, setCotizacion] = useState<Cotizacion | null>(null)
  const [pagoTipo, setPagoTipo] = useState<'deposito' | 'total'>('deposito')
  const [guest, setGuest] = useState({ nombre: '', apellido: '', email: '', whatsapp: '', nacionalidad: '' })
  const [tipoFotos, setTipoFotos] = useState<Record<string, string>>({})

  // Multi-room Shopping Cart states
  const [cart, setCart] = useState<CartItem[]>([])
  const [cartItemAdults, setCartItemAdults] = useState(1)
  const [cartItemMinors, setCartItemMinors] = useState(0)
  const [cartItemPets, setCartItemPets] = useState(0)

  // Plan fetching per room type
  const [allRoomPlans, setAllRoomPlans] = useState<Record<string, Plan[]>>({})
  const [selectedPlans, setSelectedPlans] = useState<Record<string, Plan>>({})

  useEffect(() => {
    fetch(`${API}/tipo-fotos`).then(r => r.json()).then(d => { if (d.success) setTipoFotos(d.data) })
  }, [])

  // Reset cart when search criteria changes (Cart State Cleanup)
  useEffect(() => {
    setCart([])
  }, [checkIn, checkOut, adultos, menores, mascotas, categoria])

  const parseUTCDate = (dateStr: string) => {
    if (!dateStr) return null
    const [year, month, day] = dateStr.split('-').map(Number)
    return new Date(Date.UTC(year, month - 1, day))
  }

  const formatUTCDate = (date: Date) => {
    return date.toISOString().split('T')[0]
  }

  const today = new Date().toISOString().split('T')[0]
  
  const minCheckOut = (() => {
    if (!checkIn) return today
    if (categoria === 'Pasadía') return checkIn
    const d = parseUTCDate(checkIn)
    if (!d) return today
    d.setUTCDate(d.getUTCDate() + 1)
    return formatUTCDate(d)
  })()

  const calcNoches = (cIn: string, cOut: string) => {
    if (!cIn || !cOut) return 0
    const d1 = parseUTCDate(cIn)
    const d2 = parseUTCDate(cOut)
    if (!d1 || !d2) return 0
    const diff = Math.ceil((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24))
    return diff >= 0 ? diff : 0
  }

  const noches = calcNoches(checkIn, checkOut)

  const handleCheckInChange = (val: string) => {
    setCheckIn(val)
    if (categoria === 'Pasadía') {
      setCheckOut(val)
    } else {
      if (checkOut && val >= checkOut) {
        setCheckOut('')
      }
    }
  }

  const checkAvailability = async () => {
    setLoading(true); setError('')
    try {
      const resp = await fetch(`${API}/disponibilidad?check_in=${checkIn}&check_out=${checkOut}&categoria=${categoria}`)
      const data = await resp.json()
      if (!data.success) { setError(data.error?.message || 'Error'); return }
      if (data.data.tipos_disponibles.length === 0) { setError('No hay habitaciones disponibles o configuradas. La administración debe completar habitaciones y tarifas antes de abrir reservas.'); return }
      
      setRoomTypes(data.data.tipos_disponibles)
      
      // Save searched values
      setAdultosBuscados(adultos)
      setMenoresBuscados(menores)
      setMascotasBuscadas(mascotas)

      // Fetch plans for all available room types in parallel
      const plansMap: Record<string, Plan[]> = {}
      const defaultPlansMap: Record<string, Plan> = {}
      await Promise.all(data.data.tipos_disponibles.map(async (rt: RoomType) => {
        const pResp = await fetch(`${API}/planes?tipo=${rt.tipo}`)
        const pData = await pResp.json()
        if (pData.success && pData.data.length > 0) {
          plansMap[rt.tipo] = pData.data
          defaultPlansMap[rt.tipo] = pData.data[0]
        }
      }))
      setAllRoomPlans(plansMap)
      setSelectedPlans(defaultPlansMap)
      setStep(2)
    } catch { setError('Error de conexión') } finally { setLoading(false) }
  }

  // Backtracking suggested room distribution engine ("El Sugerido")
  const findElSugerido = (
    adults: number,
    minors: number,
    pets: number,
    availableTypes: RoomType[]
  ) => {
    const ROOM_CAPACITIES: Record<string, { min: number; max: number }> = {}
    availableTypes.forEach(rt => {
      ROOM_CAPACITIES[rt.tipo] = { min: rt.capacidad_min, max: rt.capacidad_max }
    })

    function solveDistribution(
      rooms: string[],
      remAdults: number,
      remMinors: number,
      remPets: number
    ): RoomAllocation[] | null {
      const result: RoomAllocation[] = []

      function backtrack(
        idx: number,
        rAdults: number,
        rMinors: number,
        rPets: number
      ): boolean {
        if (idx === rooms.length) {
          return rAdults === 0 && rMinors === 0 && rPets === 0
        }

        const tipo = rooms[idx]
        const cap = ROOM_CAPACITIES[tipo] || { min: 1, max: 4 }

        const minAdults = 1
        const maxAdults = Math.min(rAdults, cap.max)

        for (let a = minAdults; a <= maxAdults; a++) {
          const minMinors = Math.max(0, cap.min - a)
          const maxMinors = Math.min(rMinors, cap.max - a)

          for (let m = minMinors; m <= maxMinors; m++) {
            const maxPets = Math.min(rPets, 2)
            for (let p = 0; p <= maxPets; p++) {
              result.push({ tipo, adultos: a, menores: m, mascotas: p })
              if (backtrack(idx + 1, rAdults - a, rMinors - m, rPets - p)) {
                return true
              }
              result.pop()
            }
          }
        }
        return false
      }

      if (backtrack(0, remAdults, remMinors, remPets)) {
        return result
      }
      return null
    }

    // Sort available room types by max capacity to establish priority weights
    const sortedTypes = [...availableTypes].sort((a, b) => a.capacidad_max - b.capacidad_max)
    const weights: Record<string, number> = {}
    sortedTypes.forEach((rt, index) => {
      weights[rt.tipo] = Math.pow(10, index)
    })

    const typeOrder = sortedTypes.map(rt => rt.tipo)
    const availableMap: Record<string, number> = {}
    
    availableTypes.forEach(rt => {
      availableMap[rt.tipo] = rt.disponibles
    })

    const results: string[][] = []

    function generateCombos(typeIdx: number, currentCombo: string[]) {
      if (typeIdx === typeOrder.length) {
        if (currentCombo.length > 0) results.push([...currentCombo])
        return
      }

      const type = typeOrder[typeIdx]
      const maxQty = Math.min(availableMap[type] || 0, adults)

      for (let qty = 0; qty <= maxQty; qty++) {
        const added = Array(qty).fill(type)
        generateCombos(typeIdx + 1, [...currentCombo, ...added])
      }
    }

    generateCombos(0, [])

    results.sort((a, b) => {
      if (a.length !== b.length) return a.length - b.length
      const wA = a.reduce((sum, r) => sum + (weights[r] || 0), 0)
      const wB = b.reduce((sum, r) => sum + (weights[r] || 0), 0)
      return wA - wB // Ascending order: prioritize smaller capacity rooms first
    })

    for (const combo of results) {
      const allocation = solveDistribution(combo, adults, minors, pets)
      if (allocation) return allocation
    }

    return null
  }

  const aplicarElSugerido = async (sugerencia: RoomAllocation[]) => {
    setLoading(true); setError('')
    try {
      const newCartItems: CartItem[] = []
      
      for (const alloc of sugerencia) {
        const plan = selectedPlans[alloc.tipo] || allRoomPlans[alloc.tipo]?.[0]
        if (!plan) {
          throw new Error(`No se encontró un plan de tarifa para el tipo ${alloc.tipo}`)
        }
        
        const resp = await fetch(`${API}/cotizar?plan=${plan.codigo}&adultos=${alloc.adultos}&menores=${alloc.menores}&mascotas=${alloc.mascotas}&check_in=${checkIn}&check_out=${checkOut}`)
        const data = await resp.json()
        if (!data.success) {
          throw new Error(data.error?.message || `Error cotizando habitación sugerida de tipo ${alloc.tipo}`)
        }
        
        newCartItems.push({
          id: `${Date.now()}-${Math.random()}-${alloc.tipo}`,
          tipo: alloc.tipo,
          plan,
          adultos: alloc.adultos,
          menores: alloc.menores,
          mascotas: alloc.mascotas,
          subtotal: data.data.subtotal,
          impuesto_monto: data.data.impuesto_monto,
          monto_total: data.data.monto_total,
          deposito_minimo: data.data.deposito_minimo
        })
      }
      
      setCart(newCartItems)
      setStep(3)
    } catch (e: any) {
      setError(e.message || 'Error aplicando la sugerencia')
    } finally {
      setLoading(false)
    }
  }

  const handleIncrement = async (rt: RoomType) => {
    const currentQty = cart.filter(x => x.tipo === rt.tipo).length
    if (currentQty >= rt.disponibles) return
    
    const plan = selectedPlans[rt.tipo]
    if (!plan) return

    setLoading(true); setError('')
    try {
      const isFirstItem = cart.length === 0
      const initAdultos = isFirstItem ? Math.max(rt.capacidad_min, Math.min(adultosBuscados, rt.capacidad_max)) : rt.capacidad_min
      const maxRemainingGuests = isFirstItem ? Math.max(0, rt.capacidad_max - initAdultos) : 0
      const initMenores = isFirstItem ? Math.min(menoresBuscados, maxRemainingGuests) : 0
      const initMascotas = isFirstItem ? Math.min(mascotasBuscadas, 2) : 0

      // Fetch or compute the cotizacion for the room using selected plan and dynamic initial guest counts based on Step 1 criteria
      const resp = await fetch(`${API}/cotizar?plan=${plan.codigo}&adultos=${initAdultos}&menores=${initMenores}&mascotas=${initMascotas}&check_in=${checkIn}&check_out=${checkOut}`)
      const data = await resp.json()
      if (!data.success) { setError(data.error?.message || 'Error cotizando'); return }
      
      const newItem: CartItem = {
        id: `${Date.now()}-${Math.random()}`,
        tipo: rt.tipo,
        plan,
        adultos: initAdultos,
        menores: initMenores,
        mascotas: initMascotas,
        subtotal: data.data.subtotal,
        impuesto_monto: data.data.impuesto_monto,
        monto_total: data.data.monto_total,
        deposito_minimo: data.data.deposito_minimo
      }
      setCart(prev => [...prev, newItem])
    } catch {
      setError('Error cotizando habitación')
    } finally {
      setLoading(false)
    }
  }

  const handleDecrement = (rt: RoomType) => {
    const idx = [...cart].reverse().findIndex(x => x.tipo === rt.tipo)
    if (idx === -1) return
    const actualIdx = cart.length - 1 - idx
    setCart(prev => prev.filter((_, i) => i !== actualIdx))
  }

  const updateCartItemGuests = async (itemId: string, adults: number, minors: number, pets: number) => {
    // Update local state immediately so UI remains highly responsive
    setCart(prev => prev.map(item => {
      if (item.id === itemId) {
        return { ...item, adultos: adults, menores: minors, mascotas: pets }
      }
      return item
    }))

    // Fetch exact updated price
    const item = cart.find(x => x.id === itemId)
    if (!item) return
    
    try {
      const resp = await fetch(`${API}/cotizar?plan=${item.plan.codigo}&adultos=${adults}&menores=${minors}&mascotas=${pets}&check_in=${checkIn}&check_out=${checkOut}`)
      const data = await resp.json()
      if (data.success) {
        setCart(prev => prev.map(x => {
          if (x.id === itemId) {
            return {
              ...x,
              subtotal: data.data.subtotal,
              impuesto_monto: data.data.impuesto_monto,
              monto_total: data.data.monto_total,
              deposito_minimo: data.data.deposito_minimo
            }
          }
          return x
        }))
      }
    } catch (err) {
      console.error("Error updating cotizacion dynamically", err)
    }
  }

  const selectRoomType = async (tipo: string) => {
    setSelectedType(tipo); setLoading(true); setError('')
    // Reset guest counts for this specific room to defaults/top-level preferences
    setCartItemAdults(adultos)
    setCartItemMinors(menores)
    setCartItemPets(0)
    try {
      const resp = await fetch(`${API}/planes?tipo=${tipo}`)
      const data = await resp.json()
      if (!data.success) { setError(data.error?.message || 'Error'); return }
      setPlans(data.data); setStep(3)
    } catch { setError('Error de conexión') } finally { setLoading(false) }
  }

  const selectPlan = async (plan: Plan) => {
    setSelectedPlan(plan);
  }

  const addToCart = async (roomType: string, plan: Plan, adults: number, minors: number, pets: number) => {
    setLoading(true); setError('')
    try {
      const resp = await fetch(`${API}/cotizar?plan=${plan.codigo}&adultos=${adults}&menores=${minors}&mascotas=${pets}&check_in=${checkIn}&check_out=${checkOut}`)
      const data = await resp.json()
      if (!data.success) { setError(data.error?.message || 'Error cotizando'); return }
      
      const newItem: CartItem = {
        id: `${Date.now()}-${Math.random()}`,
        tipo: roomType,
        plan,
        adultos: adults,
        menores: minors,
        mascotas: pets,
        subtotal: data.data.subtotal,
        impuesto_monto: data.data.impuesto_monto,
        monto_total: data.data.monto_total,
        deposito_minimo: data.data.deposito_minimo
      }
      
      setCart(prev => [...prev, newItem])
      setSelectedType('')
      setSelectedPlan(null)
      setStep(2) // return to available room types list to choose more!
    } catch {
      setError('Error cotizando habitación')
    } finally {
      setLoading(false)
    }
  }

  const totalSubtotal = cart.reduce((acc, item) => acc + item.subtotal, 0)
  const totalImpuesto = cart.reduce((acc, item) => acc + item.impuesto_monto, 0)
  const totalMontoTotal = cart.reduce((acc, item) => acc + item.monto_total, 0)
  const totalDepositoMinimo = cart.reduce((acc, item) => acc + item.deposito_minimo, 0)

  // Calculations for Step 3 (Guest Allocation Console)
  const assignedAdults = cart.reduce((acc, x) => acc + x.adultos, 0)
  const assignedMinors = cart.reduce((acc, x) => acc + x.menores, 0)
  const assignedPets = cart.reduce((acc, x) => acc + x.mascotas, 0)

  const adultsMatch = assignedAdults === adultosBuscados
  const minorsMatch = assignedMinors === menoresBuscados
  const petsMatch = assignedPets === mascotasBuscadas

  // Check physical capacities for all rooms in cart
  const capacityViolations = cart.map(item => {
    const rt = roomTypes.find(r => r.tipo === item.tipo)
    const capMin = rt ? rt.capacidad_min : 1
    const capMax = rt ? rt.capacidad_max : 4
    const totalGuests = item.adultos + item.menores
    const isTooLow = totalGuests < capMin
    const isTooHigh = totalGuests > capMax
    const isAdultInvalid = item.adultos < 1
    return {
      itemId: item.id,
      tipo: item.tipo,
      isTooLow,
      isTooHigh,
      isAdultInvalid,
      capMin,
      capMax,
      totalGuests
    }
  })

  const hasCapacityViolation = capacityViolations.some(v => v.isTooLow || v.isTooHigh || v.isAdultInvalid)
  const allMatch = adultsMatch && minorsMatch && petsMatch && !hasCapacityViolation

  const isGuestValid = !!(guest.nombre && guest.apellido && guest.email && guest.whatsapp)
  const montoPagar = pagoTipo === 'total' ? totalMontoTotal : totalDepositoMinimo
  const planImage = cart[0]?.plan.imagen || (cart[0]?.tipo ? (tipoFotos[cart[0].tipo] || defaultRoomImages[cart[0].tipo]) : '') || defaultRoomImages['Familiar']

  const requestUnpaidReservation = async () => {
    if (loading || !isGuestValid || !allMatch) return;
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API}/reservas/multi`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente: guest.nombre, apellido: guest.apellido, email: guest.email,
          whatsapp: guest.whatsapp, nacionalidad: guest.nacionalidad,
          check_in: checkIn, check_out: checkOut, monto_pagado: 0, metodo_pago: 'al_cobro',
          rooms: cart.map(item => ({ tipo_habitacion: item.tipo, plan_codigo: item.plan.codigo,
            adultos: item.adultos, menores: item.menores, mascotas: item.mascotas,
            check_in: checkIn, check_out: checkOut }))
        })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error?.message || 'No se pudo guardar la solicitud');
      setResult(data.data); setStep(6);
    } catch (error: any) { setError(error.message || 'Error de conexión'); }
    finally { setLoading(false); }
  };
  const stepLabels = ['Fechas', 'Habitaciones', 'Distribución', 'Resumen', 'Solicitud']

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #fefbf3 0%, #fdf4e3 30%, #fef9ef 60%, #fffcf5 100%)' }}>
      {/* Header */}
      <header style={{ background: 'linear-gradient(135deg, #78350f 0%, #92400e 40%, #a16207 100%)' }} className="text-white shadow-xl">
        <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8 flex items-center gap-4">

          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" style={{ fontFamily: "'Georgia', serif" }}>Hotel Panamá Canal</h1>
            <p className="text-amber-200/80 text-sm mt-0.5 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" /> Ubicación por configurar
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 pt-6">
        <div className="rounded-2xl border border-amber-200 bg-white p-4 text-sm text-amber-900" role="status">
          <strong>Hotel en configuración</strong>
          <p className="mt-1">La disponibilidad depende de las habitaciones y tarifas configuradas por Hotel Panamá Canal. Los cobros con tarjeta y PayPal están desactivados.</p>
        </div>
      </div>

      {/* Progress */}
      <div className="max-w-3xl mx-auto px-4 pt-6">
        <div className="flex items-center justify-between text-xs font-medium mb-2">
          {stepLabels.map((label, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                step > i + 1 ? 'bg-emerald-500 text-white shadow-md' : step === i + 1 ? 'bg-amber-700 text-white shadow-lg ring-4 ring-amber-200' : 'bg-gray-200 text-gray-400'
              }`}>{step > i + 1 ? <Check className="w-4 h-4" /> : i + 1}</div>
              <span className={`hidden sm:block ${step === i + 1 ? 'text-amber-800 font-bold' : 'text-gray-400'}`}>{label}</span>
            </div>
          ))}
        </div>
        <div className="h-2 bg-gray-200/60 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${(step / 6) * 100}%`, background: 'linear-gradient(90deg, #92400e, #d97706, #f59e0b)' }} />
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8">
        {error && (
          <div className="mb-5 p-4 rounded-2xl border border-red-200 text-red-700 text-sm flex items-start gap-3" style={{ background: 'linear-gradient(135deg, #fef2f2, #fff5f5)' }}>
            <span className="text-red-400 text-lg mt-0.5">!</span>
            <span>{error}</span>
          </div>
        )}

        {/* STEP 1: Dates */}
        {step === 1 && (
          <div className="bg-white rounded-3xl shadow-xl p-6 sm:p-8 border border-amber-100/50">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center"><Calendar className="w-5 h-5 text-amber-700" /></div>
              <div><h2 className="text-xl font-bold text-gray-800">Selecciona tu experiencia</h2><p className="text-sm text-gray-400">Planifica tu estadía perfecta o un día de relajación</p></div>
            </div>

            {/* Category Toggle Tabs */}
            <div className="flex flex-col sm:flex-row bg-amber-50/50 p-1.5 rounded-2xl border border-amber-200/50 mb-6 gap-2">
              <button
                type="button"
                onClick={() => setCategoria('Estadía')}
                className={`flex-1 py-3 text-sm font-semibold rounded-xl transition flex items-center justify-center gap-2 ${
                  categoria === 'Estadía'
                    ? 'bg-amber-700 text-white shadow-md'
                    : 'text-amber-800 hover:bg-amber-100/30'
                }`}
              >
                <Bed className="w-4 h-4" />
                <span>Estadía (Hospedaje)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCategoria('Pasadía');
                  if (checkIn) setCheckOut(checkIn);
                }}
                className={`flex-1 py-3 text-sm font-semibold rounded-xl transition flex items-center justify-center gap-2 ${
                  categoria === 'Pasadía'
                    ? 'bg-amber-700 text-white shadow-md'
                    : 'text-amber-800 hover:bg-amber-100/30'
                }`}
              >
                <Sun className="w-4 h-4" />
                <span>Pasadía (Por el día)</span>
              </button>
            </div>

            <div className={`grid grid-cols-1 ${categoria === 'Pasadía' ? '' : 'sm:grid-cols-2'} gap-4 mb-5`}>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{categoria === 'Pasadía' ? 'Fecha de Visita' : 'Check-in'}</label>
                <input type="date" min={today} value={checkIn} onChange={e => handleCheckInChange(e.target.value)}
                  className="w-full px-4 py-3.5 rounded-xl border border-gray-200 bg-gray-50/50 focus:ring-2 focus:ring-amber-400 focus:border-transparent focus:bg-white transition text-gray-700" />
              </div>
              {categoria !== 'Pasadía' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Check-out</label>
                  <input type="date" min={minCheckOut} value={checkOut} onChange={e => setCheckOut(e.target.value)}
                    className="w-full px-4 py-3.5 rounded-xl border border-gray-200 bg-gray-50/50 focus:ring-2 focus:ring-amber-400 focus:border-transparent focus:bg-white transition text-gray-700" />
                </div>
              )}
            </div>
            {categoria === 'Pasadía' && checkIn && (
              <p className="text-sm text-amber-700 font-medium mb-4 flex items-center gap-1.5">
                <Sun className="w-4 h-4 text-amber-600" /> Pasadía (horario por configurar)
              </p>
            )}
            {categoria !== 'Pasadía' && noches > 0 && (
              <p className="text-sm text-amber-700 font-medium mb-4 flex items-center gap-1.5">
                <Clock className="w-4 h-4" /> {noches} noche{noches > 1 ? 's' : ''}
              </p>
            )}
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5"><Users className="w-3.5 h-3.5 inline mr-1" />Adultos</label>
                <select value={adultos} onChange={e => setAdultos(+e.target.value)} className="w-full px-4 py-3.5 rounded-xl border border-gray-200 bg-gray-50/50 focus:ring-2 focus:ring-amber-400 text-gray-700">
                  {Array.from({ length: 30 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n} adulto{n > 1 ? 's' : ''}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Menores</label>
                <select value={menores} onChange={e => setMenores(+e.target.value)} className="w-full px-4 py-3.5 rounded-xl border border-gray-200 bg-gray-50/50 focus:ring-2 focus:ring-amber-400 text-gray-700">
                  {Array.from({ length: 16 }, (_, i) => i).map(n => <option key={n} value={n}>{n} menor{n !== 1 ? 'es' : ''}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Mascotas</label>
                <select value={mascotas} onChange={e => setMascotas(+e.target.value)} className="w-full px-4 py-3.5 rounded-xl border border-gray-200 bg-gray-50/50 focus:ring-2 focus:ring-amber-400 text-gray-700">
                  {Array.from({ length: 11 }, (_, i) => i).map(n => <option key={n} value={n}>{n} mascota{n !== 1 ? 's' : ''}</option>)}
                </select>
              </div>
            </div>
            <button disabled={!checkIn || !checkOut || loading} onClick={checkAvailability}
              className="w-full py-4 text-white font-bold rounded-2xl hover:shadow-2xl transition-all duration-300 disabled:opacity-40 flex items-center justify-center gap-2 text-lg"
              style={{ background: 'linear-gradient(135deg, #78350f, #92400e, #a16207)' }}>
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><span>Ver Disponibilidad</span><ChevronRight className="w-5 h-5" /></>}
            </button>
            <p className="mt-6 text-center text-xs text-gray-400">Solicitudes sin cobro con tarjeta; sujetas a revisión del hotel</p>
          </div>
        )}

        {/* STEP 2: Room Type */}
        {step === 2 && (() => {
          const sugerencia = findElSugerido(adultosBuscados, menoresBuscados, mascotasBuscadas, roomTypes)
          return (
            <div className="space-y-6 animate-fadeIn">
              {cart.length > 0 && (
                <div className="bg-gradient-to-br from-amber-50 to-amber-100/40 border border-amber-200 rounded-3xl p-6 shadow-sm">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-2">
                    <h3 className="font-bold text-amber-900 text-base flex items-center gap-2">
                      <span>Tu Carrito de Habitaciones</span>
                      <span className="bg-amber-200 text-amber-900 text-xs px-2 py-0.5 rounded-full font-bold">{cart.length}</span>
                    </h3>
                    <button
                      onClick={() => setCart([])}
                      className="text-xs text-red-600 hover:text-red-800 font-semibold transition"
                    >
                      Vaciar carrito
                    </button>
                  </div>
                  <div className="space-y-3">
                    {cart.map((item) => (
                      <div key={item.id} className="flex flex-col sm:flex-row sm:justify-between sm:items-center bg-white p-4 rounded-2xl border border-gray-100 text-sm shadow-xs gap-3">
                        <div>
                          <p className="font-bold text-gray-800 flex items-center gap-1.5">
                            <Bed className="w-4 h-4 text-amber-600" />
                            <span>{item.tipo}</span>
                          </p>
                          <p className="text-xs text-gray-500 mt-1">{item.plan.nombre} · {item.adultos} Ad{item.menores > 0 ? ` · ${item.menores} Mn` : ''}{item.mascotas > 0 ? ` · ${item.mascotas} Mc` : ''}</p>
                        </div>
                        <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                          <span className="font-bold text-amber-800">${item.monto_total.toFixed(2)}</span>
                          <button
                            onClick={() => setCart(prev => prev.filter(x => x.id !== item.id))}
                            className="w-7 h-7 rounded-full bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-100 transition"
                            title="Eliminar de mi carrito"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-col sm:flex-row items-center sm:justify-between mt-5 pt-4 border-t border-amber-200/50 gap-4 w-full">
                    <div className="text-center sm:text-left w-full sm:w-auto">
                      <span className="text-xs text-gray-500 block">
                        {categoria === 'Pasadía' ? 'Total de tu pasadía' : `Total de tu estadía (${noches} noche${noches > 1 ? 's' : ''})`}
                      </span>
                      <p className="text-2xl font-bold text-amber-900">${totalMontoTotal.toFixed(2)}</p>
                    </div>
                    <button
                      onClick={() => setStep(3)}
                      className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-amber-700 to-amber-800 text-white font-bold rounded-xl text-sm hover:shadow-lg transition flex items-center justify-center gap-2"
                    >
                      <span>Siguiente: Distribuir Huéspedes</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* ✨ El Sugerido Optimization Recommendation Banner */}
              {sugerencia && (
                <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-3xl p-6 shadow-md mb-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-amber-100/30 rounded-full -mr-8 -mt-8 pointer-events-none" />
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wider mb-2">
                        El Sugerido
                      </span>
                      <h3 className="font-extrabold text-amber-900 text-lg sm:text-xl">
                        Recomendación de Habitación Optimizada
                      </h3>
                      <p className="text-sm text-amber-800/80 mt-1 leading-relaxed">
                        Hemos encontrado la combinación perfecta de habitaciones que minimiza tus costos and se adapta a tus huéspedes y mascotas:
                      </p>
                      <div className="flex flex-wrap gap-2 mt-3">
                        {sugerencia.map((s, idx) => (
                          <span key={idx} className="bg-white border border-amber-200 text-amber-900 text-xs font-semibold px-3 py-1.5 rounded-xl shadow-xs">
                            <b>{s.tipo}</b> ({s.adultos} Ad{s.menores > 0 ? `, ${s.menores} Mn` : ''}{s.mascotas > 0 ? `, ${s.mascotas} Mc` : ''})
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => aplicarElSugerido(sugerencia)}
                      disabled={loading}
                      className="bg-amber-700 hover:bg-amber-800 text-white font-bold px-5 py-3 rounded-2xl transition shadow-md hover:shadow-lg text-sm shrink-0 flex items-center justify-center gap-2 self-start sm:self-center"
                    >
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Aceptar Sugerido</span>}
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-3xl shadow-xl p-6 sm:p-8 border border-amber-100/50">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center"><Bed className="w-5 h-5 text-amber-700" /></div>
                  <div><h2 className="text-xl font-bold text-gray-800">Elige una habitación para agregar</h2></div>
                </div>
                <p className="text-sm text-gray-400 mb-6 ml-[52px]">
                  {categoria === 'Pasadía' ? 'Pasadía por el día' : `${noches} noche${noches > 1 ? 's' : ''}`} · {adultosBuscados} adulto{adultosBuscados > 1 ? 's' : ''}{menoresBuscados > 0 ? ` · ${menoresBuscados} menor${menoresBuscados > 1 ? 'es' : ''}` : ''}{mascotasBuscadas > 0 ? ` · ${mascotasBuscadas} mascota${mascotasBuscadas > 1 ? 's' : ''}` : ''}
                </p>
                <div className="space-y-4">
                  {roomTypes.map(rt => {
                    const Icon = roomIcons[rt.tipo] || Bed
                    const img = tipoFotos[rt.tipo] || defaultRoomImages[rt.tipo] || defaultRoomImages['Familiar']
                    const currentQty = cart.filter(x => x.tipo === rt.tipo).length

                    return (
                      <div key={rt.tipo}
                        className="w-full rounded-2xl border border-gray-100 hover:border-amber-300 hover:shadow-md transition-all duration-200 text-left overflow-hidden bg-white">
                        <div className="flex flex-col sm:flex-row">
                          <div className="sm:w-44 h-32 sm:h-auto overflow-hidden shrink-0">
                            <img src={img} alt={rt.tipo} className="w-full h-full object-cover" />
                          </div>
                          <div className="flex-1 p-4 sm:p-5 flex flex-col justify-between">
                            <div>
                              <h3 className="font-bold text-gray-800 text-lg flex items-center gap-2"><Icon className="w-5 h-5 text-amber-600" /> {rt.tipo}</h3>
                              <p className="text-sm text-gray-500 mt-1">{rt.capacidad_min}–{rt.capacidad_max} huéspedes</p>
                              <p className="text-xs text-emerald-600 mt-1 font-medium">{rt.disponibles} disponible{rt.disponibles > 1 ? 's' : ''}</p>
                            </div>

                            {/* Plan select for this room type */}
                            <div className="mt-3">
                              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Plan de Tarifa</label>
                              <select
                                value={selectedPlans[rt.tipo]?.codigo || ''}
                                onChange={(e) => {
                                  const plan = allRoomPlans[rt.tipo]?.find(p => p.codigo === e.target.value)
                                  if (plan) {
                                    setSelectedPlans(prev => ({ ...prev, [rt.tipo]: plan }))
                                  }
                                }}
                                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl bg-white text-gray-700 focus:ring-2 focus:ring-amber-400"
                              >
                                {allRoomPlans[rt.tipo]?.map(p => (
                                  <option key={p.codigo} value={p.codigo}>
                                    {p.nombre} (${p.precio_adulto_noche}/{categoria === 'Pasadía' ? 'persona' : 'noche'})
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Sleek quantity selector */}
                            <div className="flex items-center gap-3 mt-4 pt-3 border-t border-gray-100">
                              <span className="text-xs font-bold text-amber-900 bg-amber-50 px-2 py-1 rounded-lg border border-amber-200/50">
                                Habitaciones a reservar:
                              </span>
                              <button
                                onClick={() => handleDecrement(rt)}
                                disabled={currentQty === 0 || loading}
                                className="w-8 h-8 rounded-full border border-gray-200 hover:border-amber-500 flex items-center justify-center font-bold text-gray-500 hover:text-amber-700 disabled:opacity-30 transition"
                              >
                                -
                              </button>
                              <span className="font-bold text-gray-800 text-sm w-6 text-center">
                                {currentQty}
                              </span>
                              <button
                                onClick={() => handleIncrement(rt)}
                                disabled={currentQty >= rt.disponibles || loading}
                                className="w-8 h-8 rounded-full border border-gray-200 hover:border-amber-500 flex items-center justify-center font-bold text-gray-500 hover:text-amber-700 disabled:opacity-30 transition"
                              >
                                +
                              </button>
                              <span className="text-xs text-gray-400 ml-auto">
                                ({rt.disponibles} disponibles)
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                
                {/* Bottom cart summary in Step 2 so users don't have to scroll back up! */}
                {cart.length > 0 && (
                  <div className="mt-6 p-5 bg-gradient-to-br from-amber-50 to-amber-100/40 border border-amber-200 rounded-3xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm animate-fadeIn">
                    <div>
                      <span className="text-xs text-gray-500 block">
                        Subtotal de tu selección ({cart.length} {cart.length === 1 ? 'habitación' : 'habitaciones'})
                      </span>
                      <p className="text-2xl font-bold text-amber-950">${totalMontoTotal.toFixed(2)}</p>
                    </div>
                    <button
                      onClick={() => setStep(3)}
                      className="w-full sm:w-auto px-6 py-3.5 bg-gradient-to-r from-amber-700 to-amber-800 text-white font-bold rounded-2xl text-sm hover:shadow-lg transition flex items-center justify-center gap-2"
                    >
                      <span>Siguiente: Distribuir Huéspedes</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
                
                <button onClick={() => setStep(1)} className="mt-5 text-sm text-amber-700 hover:text-amber-900 font-medium flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Cambiar fechas</button>
              </div>
            </div>
          )
        })()}

        {/* STEP 3: Guest Room Allocation Console */}
        {step === 3 && (
          <div className="space-y-6 animate-fadeIn pb-36 sm:pb-32">
            <div className="bg-white rounded-3xl shadow-xl p-6 sm:p-8 border border-amber-100/50">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center"><Users className="w-5 h-5 text-amber-700" /></div>
                <div>
                  <h2 className="text-xl font-bold text-gray-800">Distribución de Huéspedes</h2>
                  <p className="text-sm text-gray-400">Distribuye tus huéspedes y mascotas en las habitaciones seleccionadas</p>
                </div>
              </div>
              
              <div className="space-y-4 mt-6">
                {cart.map((item, idx) => {
                  const rt = roomTypes.find(r => r.tipo === item.tipo)
                  const capMin = rt ? rt.capacidad_min : 1
                  const capMax = rt ? rt.capacidad_max : 4
                  const totalGuests = item.adultos + item.menores
                  const isTooLow = totalGuests < capMin
                  const isTooHigh = totalGuests > capMax
                  const isAdultInvalid = item.adultos < 1
                  const hasWarn = isTooLow || isTooHigh || isAdultInvalid

                  return (
                    <div key={item.id} className="p-5 rounded-2xl border border-gray-100 bg-gray-50/30 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-gray-800 text-sm">Habitación {idx + 1}: {item.tipo}</span>
                          <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full">
                            {item.plan.nombre}
                          </span>
                          {hasWarn && (
                            <span className="text-[10px] bg-red-100 text-red-700 font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                              ⚠️ Advertencia de capacidad
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400">
                          Capacidad física: {capMin} - {capMax} huéspedes.
                        </p>
                        {isAdultInvalid && <p className="text-[11px] text-red-500 font-medium">Debe haber al menos 1 adulto en cada habitación.</p>}
                        {isTooLow && <p className="text-[11px] text-red-500 font-medium">Faltan huéspedes para cumplir el mínimo de {capMin}.</p>}
                        {isTooHigh && <p className="text-[11px] text-red-500 font-medium">Se supera la capacidad máxima de {capMax} huéspedes.</p>}
                      </div>

                      {/* Guest Adjusters */}
                      <div className="flex items-center gap-4 flex-wrap bg-white p-3 rounded-xl border border-gray-100">
                        {/* Adults */}
                        <div className="flex flex-col items-center">
                          <span className="text-[9px] font-bold text-gray-400 uppercase mb-1">Adultos</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => updateCartItemGuests(item.id, Math.max(0, item.adultos - 1), item.menores, item.mascotas)}
                              className="w-6 h-6 rounded-full border border-gray-200 hover:border-amber-500 flex items-center justify-center text-xs font-bold text-gray-500"
                            >
                              -
                            </button>
                            <span className="text-xs font-bold text-gray-700 w-4 text-center">{item.adultos}</span>
                            <button
                              onClick={() => updateCartItemGuests(item.id, Math.min(30, item.adultos + 1), item.menores, item.mascotas)}
                              className="w-6 h-6 rounded-full border border-gray-200 hover:border-amber-500 flex items-center justify-center text-xs font-bold text-gray-500"
                            >
                              +
                            </button>
                          </div>
                        </div>

                        {/* Minors */}
                        <div className="flex flex-col items-center">
                          <span className="text-[9px] font-bold text-gray-400 uppercase mb-1">Menores</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => updateCartItemGuests(item.id, item.adultos, Math.max(0, item.menores - 1), item.mascotas)}
                              className="w-6 h-6 rounded-full border border-gray-200 hover:border-amber-500 flex items-center justify-center text-xs font-bold text-gray-500"
                            >
                              -
                            </button>
                            <span className="text-xs font-bold text-gray-700 w-4 text-center">{item.menores}</span>
                            <button
                              onClick={() => updateCartItemGuests(item.id, item.adultos, Math.min(15, item.menores + 1), item.mascotas)}
                              className="w-6 h-6 rounded-full border border-gray-200 hover:border-amber-500 flex items-center justify-center text-xs font-bold text-gray-500"
                            >
                              +
                            </button>
                          </div>
                        </div>

                        {/* Pets */}
                        <div className="flex flex-col items-center">
                          <span className="text-[9px] font-bold text-gray-400 uppercase mb-1">Mascotas</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => updateCartItemGuests(item.id, item.adultos, item.menores, Math.max(0, item.mascotas - 1))}
                              className="w-6 h-6 rounded-full border border-gray-200 hover:border-amber-500 flex items-center justify-center text-xs font-bold text-gray-500"
                            >
                              -
                            </button>
                            <span className="text-xs font-bold text-gray-700 w-4 text-center">{item.mascotas}</span>
                            <button
                              onClick={() => updateCartItemGuests(item.id, item.adultos, item.menores, Math.min(10, item.mascotas + 1))}
                              className="w-6 h-6 rounded-full border border-gray-200 hover:border-amber-500 flex items-center justify-center text-xs font-bold text-gray-500"
                            >
                              +
                            </button>
                          </div>
                        </div>

                        {/* Room Price */}
                        <div className="text-right pl-2 border-l border-gray-100 flex flex-col justify-center">
                          <span className="text-[10px] text-gray-400 block font-semibold">Hab. Total</span>
                          <span className="font-bold text-amber-800 text-sm">${item.monto_total.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="mt-8 flex justify-between items-center">
                <button onClick={() => setStep(2)} className="text-sm text-amber-700 hover:text-amber-900 font-medium flex items-center gap-1">
                  <ArrowLeft className="w-4 h-4" /> Volver a habitaciones
                </button>
              </div>
            </div>

            {/* Floating Glassmorphic Validation Panel at the bottom */}
            <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-xl border-t border-amber-200/50 shadow-2xl py-5 px-6">
              <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-5">
                <div className="flex-1 w-full space-y-3">
                  {/* Status Stats */}
                  <div className="grid grid-cols-4 gap-4 text-center md:text-left">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-gray-400 block">Adultos</span>
                      <p className={`text-base font-bold ${adultsMatch ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {assignedAdults} / {adultosBuscados}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-gray-400 block">Menores</span>
                      <p className={`text-base font-bold ${minorsMatch ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {assignedMinors} / {menoresBuscados}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-gray-400 block">Mascotas</span>
                      <p className={`text-base font-bold ${petsMatch ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {assignedPets} / {mascotasBuscadas}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-gray-400 block">Cap. Máxima</span>
                      <p className="text-base font-bold text-amber-900">
                        {cart.reduce((acc, item) => {
                          const rt = roomTypes.find(r => r.tipo === item.tipo)
                          return acc + (rt ? rt.capacidad_max : 0)
                        }, 0)}
                      </p>
                    </div>
                  </div>

                  {/* Clean status banner */}
                  <div className={`p-3 rounded-2xl text-xs font-semibold ${allMatch ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                    {allMatch ? (
                      <p>¡Perfecto! Todos los huéspedes y mascotas han sido asignados correctamente.</p>
                    ) : (
                      <div className="space-y-1">
                        <p className="font-bold">⚠️ Falta completar la distribución correcta:</p>
                        <ul className="list-disc pl-4 space-y-0.5">
                          {assignedAdults < adultosBuscados && <li>Faltan asignar {adultosBuscados - assignedAdults} adulto(s) de tu búsqueda.</li>}
                          {assignedAdults > adultosBuscados && <li>Sobran {assignedAdults - adultosBuscados} adulto(s) asignado(s).</li>}
                          {assignedMinors < menoresBuscados && <li>Faltan asignar {menoresBuscados - assignedMinors} menor(es) de tu búsqueda.</li>}
                          {assignedMinors > menoresBuscados && <li>Sobran {assignedMinors - menoresBuscados} menor(es) asignado(s).</li>}
                          {assignedPets < mascotasBuscadas && <li>Faltan asignar {mascotasBuscadas - assignedPets} mascota(s) de tu búsqueda.</li>}
                          {assignedPets > mascotasBuscadas && <li>Sobran {assignedPets - mascotasBuscadas} mascota(s) asignada(s).</li>}
                          {hasCapacityViolation && <li>Revisa las advertencias de capacidad física en cada habitación.</li>}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                <div className="w-full sm:w-auto flex flex-col items-center sm:items-end gap-1">
                  <span className="text-[10px] text-gray-400 block">Total a Pagar</span>
                  <p className="text-2xl font-black text-amber-900 mb-2">${totalMontoTotal.toFixed(2)}</p>
                  <button
                    disabled={!allMatch}
                    onClick={() => setStep(4)}
                    className="w-full sm:w-auto px-6 py-4 bg-gradient-to-r from-amber-700 to-amber-800 text-white font-bold rounded-2xl text-base hover:shadow-xl disabled:opacity-40 disabled:pointer-events-none transition flex items-center justify-center gap-2"
                  >
                    <span>Siguiente: Datos de Huésped</span>
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: Summary + Guest Info */}
        {step === 4 && cart.length > 0 && (
          <div className="space-y-5 animate-fadeIn">
            {/* Photo + Summary Card */}
            <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-amber-100/50">
            {planImage && (
                <div className="h-48 sm:h-56 overflow-hidden relative">
                  <img src={planImage} alt="Hotel Panamá Canal" className="w-full h-full object-cover" />
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent 60%)' }} />
                  <div className="absolute bottom-4 left-5 text-white">
                    <h3 className="text-xl font-bold">Resumen de tu reserva</h3>
                    <p className="text-white/70 text-sm">
                      {cart.length} {categoria === 'Pasadía' ? 'unidad/es' : 'habitación/es'} · {categoria === 'Pasadía' ? 'Pasadía por el día' : `${noches} noche${noches > 1 ? 's' : ''}`}
                    </p>
                  </div>
                </div>
              )}
              <div className="p-6">
                <h2 className="text-lg font-bold text-gray-800 mb-4">{categoria === 'Pasadía' ? 'Unidades Seleccionadas' : 'Habitaciones Seleccionadas'}</h2>
                <div className="space-y-4 mb-6">
                  {cart.map((item) => (
                    <div key={item.id} className="bg-gradient-to-br from-white to-amber-50/10 p-5 rounded-2xl border border-amber-100/50 shadow-sm text-xs">
                      {/* Card Header */}
                      <div className="flex justify-between items-start mb-3 pb-3 border-b border-gray-100/80">
                        <div>
                          <p className="font-extrabold text-gray-800 text-sm flex items-center gap-2">
                            <Bed className="w-4 h-4 text-amber-700" />
                            <span>{item.tipo}</span>
                          </p>
                          <p className="text-[10px] font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200/30 mt-1.5 inline-block">
                            Plan: {item.plan.nombre}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="font-black text-amber-900 text-base block">${item.monto_total.toFixed(2)}</span>
                          <span className="text-[10px] font-semibold text-amber-750/60 uppercase tracking-wide">
                            {categoria === 'Pasadía' ? 'Total Unidad' : 'Total Habitación'}
                          </span>
                        </div>
                      </div>

                      {/* Detailed Breakdown */}
                      <div className="space-y-2 text-gray-600 bg-gray-50/50 p-3.5 rounded-xl border border-gray-100/80">
                        {/* Adults Breakdown Row */}
                        <div className="flex justify-between items-center py-0.5">
                          <span className="flex items-center gap-1.5 text-gray-700 font-medium">
                            <span>{item.adultos} {item.adultos === 1 ? 'Adulto' : 'Adultos'}</span>
                            <span className="text-gray-400 font-normal">×</span>
                            <span>{categoria === 'Pasadía' ? '1 día' : `${noches} ${noches === 1 ? 'noche' : 'noches'}`}</span>
                            <span className="text-gray-400 font-normal">×</span>
                            <span>${item.plan.precio_adulto_noche.toFixed(2)}</span>
                          </span>
                          <span className="font-bold text-gray-800">${(item.adultos * item.plan.precio_adulto_noche * (categoria === 'Pasadía' ? 1 : noches)).toFixed(2)}</span>
                        </div>

                        {/* Minors Breakdown Row */}
                        {item.menores > 0 && (
                          <div className="flex justify-between items-center py-0.5">
                            <span className="flex items-center gap-1.5 text-gray-700 font-medium">
                              <span>{item.menores} {item.menores === 1 ? 'Menor' : 'Menores'}</span>
                              <span className="text-gray-400 font-normal">×</span>
                              <span>{categoria === 'Pasadía' ? '1 día' : `${noches} ${noches === 1 ? 'noche' : 'noches'}`}</span>
                              <span className="text-gray-400 font-normal">×</span>
                              <span>${item.plan.precio_menor_noche.toFixed(2)}</span>
                            </span>
                            <span className="font-bold text-gray-800">${(item.menores * item.plan.precio_menor_noche * (categoria === 'Pasadía' ? 1 : noches)).toFixed(2)}</span>
                          </div>
                        )}

                        {/* Pets Breakdown Row */}
                        {item.mascotas > 0 && (() => {
                          const petRate = item.plan.precio_mascota_noche || 0;
                          const petTotal = item.mascotas * petRate * (categoria === 'Pasadía' ? 1 : noches);
                          return (
                            <div className="flex justify-between items-center py-0.5">
                              <span className="flex items-center gap-1.5 text-gray-700 font-medium">
                                <span>{item.mascotas} {item.mascotas === 1 ? 'Mascota' : 'Mascotas'}</span>
                                <span className="text-gray-400 font-normal">×</span>
                                <span>{categoria === 'Pasadía' ? '1 día' : `${noches} ${noches === 1 ? 'noche' : 'noches'}`}</span>
                                <span className="text-gray-400 font-normal">×</span>
                                <span>${petRate.toFixed(2)}</span>
                              </span>
                              <span className="font-bold text-gray-800">${petTotal.toFixed(2)}</span>
                            </div>
                          );
                        })()}

                        {/* Suplemento / Ajuste por Fin de Semana o Feriado */}
                        {(() => {
                          const baseSubtotal = (
                            (item.adultos * item.plan.precio_adulto_noche) +
                            (item.menores * item.plan.precio_menor_noche) +
                            (item.mascotas * (item.plan.precio_mascota_noche || 0))
                          ) * (categoria === 'Pasadía' ? 1 : noches);
                          
                          const diff = item.subtotal - baseSubtotal;
                          if (diff > 0.05) {
                            return (
                              <div className="flex justify-between items-center py-0.5 text-amber-800 bg-amber-50/50 px-2 py-1 rounded-md border border-amber-200/30">
                                <span className="flex items-center gap-1.5 font-medium">
                                  <span>Suplemento (fin de semana/feriado)</span>
                                </span>
                                <span className="font-bold">${diff.toFixed(2)}</span>
                              </div>
                            );
                          }
                          return null;
                        })()}

                        {/* Subtotal & Taxes Section */}
                        <div className="mt-2 pt-2 border-t border-gray-200/60 space-y-1 text-gray-500 font-medium">
                          <div className="flex justify-between text-[11px]">
                            <span>Subtotal Habitación</span>
                            <span>${item.subtotal.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-[11px]">
                            <span>Impuesto configurado</span>
                            <span>${item.impuesto_monto.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <h2 className="text-lg font-bold text-gray-800 mb-4">Resumen financiero</h2>
                <div className="rounded-2xl p-4 space-y-2.5 text-sm" style={{ background: 'linear-gradient(135deg, #fffbeb, #fef3c7)' }}>
                  <div className="flex justify-between">
                    <span className="text-gray-500 flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> {categoria === 'Pasadía' ? 'Fecha de Visita' : 'Fechas'}</span>
                    <span className="font-semibold text-gray-700">{categoria === 'Pasadía' ? checkIn : `${checkIn} — ${checkOut}`}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> {categoria === 'Pasadía' ? 'Unidades' : 'Habitaciones'}</span>
                    <span className="font-semibold text-gray-700">{cart.length}</span>
                  </div>
                  <hr className="border-amber-200/50" />
                  <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span className="font-semibold text-gray-700">${totalSubtotal.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Impuesto configurado</span><span className="font-semibold text-gray-700">${totalImpuesto.toFixed(2)}</span></div>
                  <div className="flex justify-between text-lg font-bold text-amber-900 pt-1 border-t border-amber-200/50"><span>Total</span><span>${totalMontoTotal.toFixed(2)}</span></div>
                </div>

                <div className="mt-5">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Modalidad de pago</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => setPagoTipo('deposito')}
                      className={`p-4 rounded-2xl border-2 text-center transition-all ${pagoTipo === 'deposito' ? 'border-amber-500 bg-amber-50 shadow-md' : 'border-gray-200 hover:border-amber-300'}`}>
                      <p className="text-xl font-bold text-amber-800">${totalDepositoMinimo.toFixed(2)}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Depósito Mínimo</p>
                    </button>
                    <button onClick={() => setPagoTipo('total')}
                      className={`p-4 rounded-2xl border-2 text-center transition-all ${pagoTipo === 'total' ? 'border-amber-500 bg-amber-50 shadow-md' : 'border-gray-200 hover:border-amber-300'}`}>
                      <p className="text-xl font-bold text-amber-800">${totalMontoTotal.toFixed(2)}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Pago completo</p>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Guest Info */}
            <div className="bg-white rounded-3xl shadow-xl p-6 sm:p-8 border border-amber-100/50">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center"><Users className="w-5 h-5 text-amber-700" /></div>
                <h2 className="text-lg font-bold text-gray-800">Datos del huésped principal</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Nombre *</label>
                  <input type="text" value={guest.nombre} onChange={e => setGuest({ ...guest, nombre: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50/50 focus:ring-2 focus:ring-amber-400 focus:bg-white transition" placeholder="Juan" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Apellido *</label>
                  <input type="text" value={guest.apellido} onChange={e => setGuest({ ...guest, apellido: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50/50 focus:ring-2 focus:ring-amber-400 focus:bg-white transition" placeholder="Pérez" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5"><Mail className="w-3 h-3 inline mr-1" />Email *</label>
                  <input type="email" value={guest.email} onChange={e => setGuest({ ...guest, email: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50/50 focus:ring-2 focus:ring-amber-400 focus:bg-white transition" placeholder="juan@email.com" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5"><Phone className="w-3 h-3 inline mr-1" />WhatsApp *</label>
                  <input type="tel" value={guest.whatsapp} onChange={e => setGuest({ ...guest, whatsapp: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50/50 focus:ring-2 focus:ring-amber-400 focus:bg-white transition" placeholder="+507 6XXX-XXXX" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5"><Globe className="w-3 h-3 inline mr-1" />Nacionalidad</label>
                  <input type="text" value={guest.nacionalidad} onChange={e => setGuest({ ...guest, nacionalidad: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50/50 focus:ring-2 focus:ring-amber-400 focus:bg-white transition" placeholder="Panameño" />
                </div>
              </div>
              <button disabled={!isGuestValid} onClick={() => setStep(5)}
                className="w-full mt-6 py-4 text-white font-bold rounded-2xl hover:shadow-2xl transition-all duration-300 disabled:opacity-40 flex items-center justify-center gap-2 text-lg"
                style={{ background: 'linear-gradient(135deg, #78350f, #92400e, #a16207)' }}>
                <CreditCard className="w-5 h-5" /> Continuar al pago
              </button>
            </div>
            <button onClick={() => setStep(3)} className="text-sm text-amber-700 hover:text-amber-900 font-medium flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Volver a distribución</button>
          </div>
        )}

        {step === 6 && result && (
          <div className="bg-white rounded-3xl p-8 border border-mahana-200 text-center" role="status">
            <h2 className="text-2xl font-bold text-mahana-800">Solicitud guardada</h2>
            <p className="mt-3">Pendiente de revisión por el hotel. No se ha realizado ningún cobro.</p>
            <p className="mt-2 font-semibold">Referencia: {result.grupo_codigo || result.id || 'Consulta con recepción'}</p>
            <button onClick={() => { setCart([]); setResult(null); setStep(1); }} className="mt-5 text-mahana-700 underline">Volver al inicio</button>
          </div>
        )}
        {/* STEP 5: Solicitud sin cobro */}
        {step === 5 && cart.length > 0 && (
          <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-amber-100/50 animate-fadeIn">
            {planImage && (
              <div className="h-32 overflow-hidden relative">
                <img src={planImage} alt="Hotel Panamá Canal" className="w-full h-full object-cover" style={{ filter: 'brightness(0.7)' }} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center text-white">
                    <p className="text-sm opacity-80">{pagoTipo === 'total' ? 'Pago completo' : 'Depósito Mínimo'}</p>
                    <p className="text-4xl font-bold">${montoPagar.toFixed(2)} <span className="text-base font-normal opacity-70">USD</span></p>
                  </div>
                </div>
              </div>
            )}
            <div className="p-6 sm:p-8">
              {pagoTipo === 'deposito' && (
                <p className="text-center text-xs text-gray-400 mb-5">Saldo restante de <b>${(totalMontoTotal - montoPagar).toFixed(2)}</b> se cancela en check-in</p>
              )}

              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-center" role="status">
                <h3 className="font-bold text-amber-900">Solicitar reserva sin pago online</h3>
                <p className="text-sm text-amber-800 mt-2">El hotel revisará esta solicitud. No se realizará ningún cobro con tarjeta ni PayPal y no se registrará dinero recibido. Coordina cualquier pago directamente con recepción.</p>
              </div>

              <button type="button" disabled={loading || !isGuestValid || !allMatch} onClick={requestUnpaidReservation}
                className="w-full mt-4 py-3 rounded-xl bg-mahana-700 text-white font-semibold disabled:opacity-50">
                {loading ? 'Guardando solicitud...' : 'Enviar solicitud de reserva'}
              </button>
              {/* Collapsible Detailed Reservation Summary */}
              <div className="mt-8 border-t border-gray-100 pt-6">
                <details className="group bg-gray-50/50 rounded-2xl border border-gray-100 overflow-hidden">
                  <summary className="flex items-center justify-between p-4 cursor-pointer font-bold text-gray-700 hover:bg-amber-50/20 select-none text-xs">
                    <span className="flex items-center gap-2">
                      <span>Ver resumen detallado de tu reserva</span>
                    </span>
                    <span className="text-[10px] text-amber-800 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200/50 group-open:hidden">
                      Mostrar
                    </span>
                    <span className="text-[10px] text-amber-800 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200/50 hidden group-open:inline">
                      Ocultar
                    </span>
                  </summary>
                  <div className="p-4 border-t border-gray-100 space-y-4 bg-white">
                    {cart.map((item) => (
                      <div key={item.id} className="bg-gradient-to-br from-white to-amber-50/10 p-5 rounded-2xl border border-amber-100/50 shadow-sm text-xs text-left">
                        {/* Card Header */}
                        <div className="flex justify-between items-start mb-3 pb-3 border-b border-gray-100/80">
                          <div>
                            <p className="font-extrabold text-gray-800 text-sm flex items-center gap-2">
                              <Bed className="w-4 h-4 text-amber-700" />
                              <span>{item.tipo}</span>
                            </p>
                            <p className="text-[10px] font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200/30 mt-1.5 inline-block">
                              Plan: {item.plan.nombre}
                            </p>
                          </div>
                          <div className="text-right">
                            <span className="font-black text-amber-900 text-base block">${item.monto_total.toFixed(2)}</span>
                            <span className="text-[10px] font-semibold text-amber-750/60 uppercase tracking-wide">
                              {categoria === 'Pasadía' ? 'Total Unidad' : 'Total Habitación'}
                            </span>
                          </div>
                        </div>

                        {/* Detailed Breakdown */}
                        <div className="space-y-2 text-gray-600 bg-gray-50/50 p-3.5 rounded-xl border border-gray-100/80">
                          {/* Adults Breakdown Row */}
                          <div className="flex justify-between items-center py-0.5">
                            <span className="flex items-center gap-1.5 text-gray-700 font-medium">
                              <span>{item.adultos} {item.adultos === 1 ? 'Adulto' : 'Adultos'}</span>
                              <span className="text-gray-400 font-normal">×</span>
                              <span>{categoria === 'Pasadía' ? '1 día' : `${noches} ${noches === 1 ? 'noche' : 'noches'}`}</span>
                              <span className="text-gray-400 font-normal">×</span>
                              <span>${item.plan.precio_adulto_noche.toFixed(2)}</span>
                            </span>
                            <span className="font-bold text-gray-800">${(item.adultos * item.plan.precio_adulto_noche * (categoria === 'Pasadía' ? 1 : noches)).toFixed(2)}</span>
                          </div>

                          {/* Minors Breakdown Row */}
                          {item.menores > 0 && (
                            <div className="flex justify-between items-center py-0.5">
                              <span className="flex items-center gap-1.5 text-gray-700 font-medium">
                                <span>{item.menores} {item.menores === 1 ? 'Menor' : 'Menores'}</span>
                                <span className="text-gray-400 font-normal">×</span>
                                <span>{categoria === 'Pasadía' ? '1 día' : `${noches} ${noches === 1 ? 'noche' : 'noches'}`}</span>
                                <span className="text-gray-400 font-normal">×</span>
                                <span>${item.plan.precio_menor_noche.toFixed(2)}</span>
                              </span>
                              <span className="font-bold text-gray-800">${(item.menores * item.plan.precio_menor_noche * (categoria === 'Pasadía' ? 1 : noches)).toFixed(2)}</span>
                            </div>
                          )}

                          {/* Pets Breakdown Row */}
                          {item.mascotas > 0 && (() => {
                            const petRate = item.plan.precio_mascota_noche || 0;
                            const petTotal = item.mascotas * petRate * (categoria === 'Pasadía' ? 1 : noches);
                            return (
                              <div className="flex justify-between items-center py-0.5">
                                <span className="flex items-center gap-1.5 text-gray-700 font-medium">
                                  <span>{item.mascotas} {item.mascotas === 1 ? 'Mascota' : 'Mascotas'}</span>
                                  <span className="text-gray-400 font-normal">×</span>
                                  <span>{categoria === 'Pasadía' ? '1 día' : `${noches} ${noches === 1 ? 'noche' : 'noches'}`}</span>
                                  <span className="text-gray-400 font-normal">×</span>
                                  <span>${petRate.toFixed(2)}</span>
                                </span>
                                <span className="font-bold text-gray-800">${petTotal.toFixed(2)}</span>
                              </div>
                            );
                          })()}

                          {/* Suplemento / Ajuste por Fin de Semana o Feriado */}
                          {(() => {
                            const baseSubtotal = (
                              (item.adultos * item.plan.precio_adulto_noche) +
                              (item.menores * item.plan.precio_menor_noche) +
                              (item.mascotas * (item.plan.precio_mascota_noche || 0))
                            ) * (categoria === 'Pasadía' ? 1 : noches);
                            
                            const diff = item.subtotal - baseSubtotal;
                            if (diff > 0.05) {
                              return (
                                <div className="flex justify-between items-center py-0.5 text-amber-800 bg-amber-50/50 px-2 py-1 rounded-md border border-amber-200/30">
                                  <span className="flex items-center gap-1.5 font-medium">
                                    <span>Suplemento (fin de semana/feriado)</span>
                                  </span>
                                  <span className="font-bold">${diff.toFixed(2)}</span>
                                </div>
                              );
                            }
                            return null;
                          })()}

                          {/* Subtotal & Taxes Section */}
                          <div className="mt-2 pt-2 border-t border-gray-200/60 space-y-1 text-gray-500 font-medium">
                            <div className="flex justify-between text-[11px]">
                              <span>Subtotal Habitación</span>
                              <span>${item.subtotal.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-[11px]">
                              <span>Impuesto configurado</span>
                              <span>${item.impuesto_monto.toFixed(2)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              </div>

              <button onClick={() => setStep(4)} className="mt-5 text-sm text-amber-700 hover:text-amber-900 font-medium flex items-center gap-1 mx-auto"><ArrowLeft className="w-4 h-4" /> Volver al resumen</button>
            </div>
          </div>
        )}


      </div>

      {/* Footer */}
      <footer className="text-center py-8 text-xs text-gray-400 space-y-1">
        <p>&copy; {new Date().getFullYear()} Hotel Panamá Canal · Ubicación por configurar</p>
        <div className="flex items-center justify-center gap-4">
          <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> Reservas del hotel</span>
          <span className="flex items-center gap-1"><Waves className="w-3 h-3" /> Información del hotel por configurar</span>
        </div>
      </footer>
    </div>
  )
}
