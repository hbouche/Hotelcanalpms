import React, { useRef, useEffect, useState } from 'react';
import { Calendar, Users, DollarSign, ArrowRight, ShieldCheck, HeartHandshake } from 'lucide-react';

interface Reserva {
  id: number;
  cliente: string;
  apellido?: string;
  check_in: string;
  check_out: string;
  noches: number;
  adultos: number;
  menores: number;
  mascotas?: number;
  plan_nombre?: string;
  monto_total: number;
  monto_pagado?: number;
  saldo_pendiente: number;
  estado: string;
  fuente?: string;
}

interface InteractivePopoverProps {
  reserva: Reserva;
  x: number;
  y: number;
  onClose: () => void;
  onAction?: (actionType: string, reservaId: number) => void;
  userRole?: string;
}

export default function InteractivePopover({
  reserva,
  x,
  y,
  onClose,
  onAction,
  userRole = 'admin',
}: InteractivePopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ left: 0, top: 0, opacity: 0 });

  // Calculate payment percentage
  const total = reserva.monto_total || 0;
  const pending = reserva.saldo_pendiente || 0;
  const paid = reserva.monto_pagado !== undefined ? reserva.monto_pagado : (total - pending);
  const pct = total > 0 ? Math.min(100, Math.max(0, (paid / total) * 100)) : 0;

  const isRestrictedRole = userRole === 'cleaning';

  useEffect(() => {
    if (!popoverRef.current) return;

    const el = popoverRef.current;
    const width = el.offsetWidth || 320;
    const height = el.offsetHeight || 220;
    const padding = 15;

    // Viewport dimensions
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let finalLeft = x + 16;
    let finalTop = y - 20;

    // Boundary checking (Right side)
    if (finalLeft + width > viewportWidth - padding) {
      finalLeft = x - width - 16;
    }

    // Boundary checking (Left side backup)
    if (finalLeft < padding) {
      finalLeft = padding;
    }

    // Boundary checking (Bottom side)
    if (finalTop + height > viewportHeight - padding) {
      finalTop = viewportHeight - height - padding;
    }

    // Boundary checking (Top side backup)
    if (finalTop < padding) {
      finalTop = padding;
    }

    setCoords({
      left: finalLeft,
      top: finalTop,
      opacity: 1,
    });
  }, [x, y, reserva]);

  // Color mapping based on reservation status
  const statusColors: Record<string, string> = {
    'Confirmada': 'bg-blue-500/10 text-blue-600 border-blue-200/50',
    'Hospedado': 'bg-green-500/10 text-green-600 border-green-200/50',
    'Check-Out': 'bg-gray-500/10 text-gray-600 border-gray-200/50',
    'Pendiente': 'bg-yellow-500/10 text-yellow-600 border-yellow-200/50',
    'Cancelada': 'bg-red-500/10 text-red-600 border-red-200/50',
    'No-Show': 'bg-red-500/10 text-red-500 border-red-200/50',
  };

  return (
    <div
      ref={popoverRef}
      className="fixed z-50 w-80 rounded-2xl border border-white/20 bg-white/90 backdrop-blur-md p-4 shadow-2xl transition-all duration-200 ease-out"
      style={{
        left: `${coords.left}px`,
        top: `${coords.top}px`,
        opacity: coords.opacity,
        transform: coords.opacity ? 'scale(1)' : 'scale(0.95)',
        transformOrigin: 'top left',
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-gray-100 pb-2.5">
        <div>
          <h4 className="font-bold text-gray-800 text-sm leading-tight truncate max-w-[180px]">
            {reserva.cliente} {reserva.apellido || ''}
          </h4>
          <span className="text-[10px] text-gray-400 font-medium">Reserva #{reserva.id}</span>
        </div>
        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${statusColors[reserva.estado] || 'bg-gray-100'}`}>
          {reserva.estado}
        </span>
      </div>

      {/* Details */}
      <div className="py-2.5 space-y-2 text-xs text-gray-600">
        {/* Dates */}
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-gray-400 flex-shrink-0" />
          <div className="flex items-center gap-1">
            <span className="font-medium text-gray-700">{reserva.check_in}</span>
            <ArrowRight size={10} className="text-gray-300" />
            <span className="font-medium text-gray-700">{reserva.check_out}</span>
            <span className="text-gray-400 font-light ml-1">({reserva.noches} noches)</span>
          </div>
        </div>

        {/* Guests */}
        <div className="flex items-center gap-2">
          <Users size={14} className="text-gray-400 flex-shrink-0" />
          <span>
            {reserva.adultos} Adulto{reserva.adultos !== 1 ? 's' : ''}
            {reserva.menores > 0 && ` + ${reserva.menores} Menor${reserva.menores !== 1 ? 'es' : ''}`}
            {reserva.mascotas && reserva.mascotas > 0 ? ` + ${reserva.mascotas} 🐾` : ''}
          </span>
        </div>

        {/* Plan / Room details */}
        {reserva.plan_nombre && (
          <div className="flex items-center gap-2 pl-5">
            <span className="bg-mahana-50 text-mahana-700 px-2 py-0.5 rounded text-[10px] font-semibold">
              🎁 {reserva.plan_nombre}
            </span>
            {reserva.fuente && (
              <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded text-[10px] font-medium">
                🔌 {reserva.fuente}
              </span>
            )}
          </div>
        )}

        {/* Finance details (Only visible if user role is not restricted) */}
        {!isRestrictedRole ? (
          <div className="bg-gray-50/50 rounded-xl p-2 border border-gray-100 mt-1">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] text-gray-400 font-medium">Estado de Pago:</span>
              <span className={`text-[10px] font-bold ${pct >= 100 ? 'text-green-600' : 'text-amber-600'}`}>
                {pct >= 100 ? 'Pagado' : `${pct.toFixed(0)}% cobrado`}
              </span>
            </div>
            
            {/* Payment Progress Bar */}
            <div className="w-full bg-gray-200 h-2 rounded-full mb-1.5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${pct >= 100 ? 'bg-green-500' : 'bg-gradient-to-r from-amber-400 to-amber-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>

            <div className="flex justify-between items-center text-[11px]">
              <div className="flex items-center text-gray-500">
                <DollarSign size={10} className="-mr-0.5" />
                <span>Total: <strong className="text-gray-700">${total.toFixed(2)}</strong></span>
              </div>
              <div className="flex items-center">
                <span className={pending > 0 ? 'text-red-500 font-medium' : 'text-green-600 font-bold'}>
                  {pending > 0 ? `Debe: $${pending.toFixed(2)}` : 'Saldo al día'}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 bg-gray-50/50 p-2 rounded-xl text-[10px] text-gray-400 border border-gray-100">
            <ShieldCheck size={12} className="text-gray-300" />
            <span>Datos de facturación restringidos por rol.</span>
          </div>
        )}
      </div>

      {/* Quick Actions (Interactive area) */}
      <div className="flex gap-1.5 border-t border-gray-100 pt-2.5 mt-1">
        {onAction && (
          <>
            <button
              onClick={() => onAction('view_details', reserva.id)}
              className="flex-1 py-1.5 bg-mahana-50 hover:bg-mahana-100 text-mahana-700 rounded-lg font-semibold text-[11px] transition text-center"
            >
              Ver Ficha
            </button>
            {!isRestrictedRole && reserva.estado === 'Pendiente' && (
              <>
                <button
                  onClick={() => onAction('approve_reserva', reserva.id)}
                  className="flex-1 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded-lg font-semibold text-[11px] transition text-center shadow-sm"
                >
                  Aprobar
                </button>
                <button
                  onClick={() => onAction('reject_reserva', reserva.id)}
                  className="flex-1 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-lg font-semibold text-[11px] transition text-center"
                >
                  Rechazar
                </button>
              </>
            )}
            {!isRestrictedRole && reserva.estado !== 'Pendiente' && pending > 0 && (
              <button
                onClick={() => onAction('register_payment', reserva.id)}
                className="flex-1 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded-lg font-semibold text-[11px] transition text-center shadow-sm"
              >
                Registrar Pago
              </button>
            )}
            {reserva.estado === 'Confirmada' && (
              <button
                onClick={() => onAction('check_in', reserva.id)}
                className="flex-1 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-semibold text-[11px] transition text-center shadow-sm"
              >
                Check-In
              </button>
            )}
            {reserva.estado === 'Hospedado' && (
              <button
                onClick={() => onAction('check_out', reserva.id)}
                className="flex-1 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-semibold text-[11px] transition text-center shadow-sm"
              >
                Check-Out
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
