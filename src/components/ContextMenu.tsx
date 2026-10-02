import React, { useRef, useEffect, useState } from 'react';
import { Eye, DollarSign, CheckSquare, LogOut, CalendarPlus, ShieldAlert, Sparkles, AlertCircle, Ban } from 'lucide-react';

interface ContextMenuProps {
  x: number;
  y: number;
  data: {
    type: 'reserva' | 'empty_cell';
    reserva?: any;
    room?: any;
    date?: string;
  };
  onAction: (actionType: string, payload: any) => void;
  onClose: () => void;
  userRole?: string;
}

export default function ContextMenu({
  x,
  y,
  data,
  onAction,
  onClose,
  userRole = 'admin',
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ left: 0, top: 0, opacity: 0 });

  const isRestrictedRole = userRole === 'cleaning';

  useEffect(() => {
    if (!menuRef.current) return;

    const el = menuRef.current;
    const width = el.offsetWidth || 180;
    const height = el.offsetHeight || 160;
    const padding = 10;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let finalLeft = x;
    let finalTop = y;

    // Boundary checking (Right side)
    if (finalLeft + width > viewportWidth - padding) {
      finalLeft = x - width;
    }

    // Boundary checking (Bottom side)
    if (finalTop + height > viewportHeight - padding) {
      finalTop = y - height;
    }

    // Double check bounds
    if (finalLeft < padding) finalLeft = padding;
    if (finalTop < padding) finalTop = padding;

    setCoords({
      left: finalLeft,
      top: finalTop,
      opacity: 1,
    });
  }, [x, y]);

  const handleItemClick = (action: string) => {
    onAction(action, data);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] w-52 rounded-xl border border-white/20 bg-white/80 backdrop-blur-md p-1.5 shadow-2xl transition-all duration-150 ease-out"
      style={{
        left: `${coords.left}px`,
        top: `${coords.top}px`,
        opacity: coords.opacity,
        transform: coords.opacity ? 'scale(1)' : 'scale(0.95)',
        transformOrigin: 'top left',
      }}
    >
      {data.type === 'reserva' && (
        <div className="space-y-0.5">
          <div className="px-2 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 mb-1 truncate">
            👤 {data.reserva?.cliente}
          </div>

          <button
            onClick={() => handleItemClick('view_details')}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-semibold text-gray-700 hover:bg-mahana-50 hover:text-mahana-700 rounded-lg transition text-left"
          >
            <Eye size={14} className="text-gray-400" />
            <span>Ver Ficha Completa</span>
          </button>

          {!isRestrictedRole && data.reserva?.saldo_pendiente > 0 && data.reserva?.estado !== 'Pendiente' && (
            <button
              onClick={() => handleItemClick('register_payment')}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-semibold text-gray-700 hover:bg-green-50 hover:text-green-700 rounded-lg transition text-left"
            >
              <DollarSign size={14} className="text-green-500" />
              <span>Registrar Abono</span>
            </button>
          )}

          {!isRestrictedRole && data.reserva?.estado === 'Pendiente' && (
            <>
              <button
                onClick={() => handleItemClick('approve_reserva')}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-semibold text-gray-700 hover:bg-green-50 hover:text-green-700 rounded-lg transition text-left"
              >
                <CheckSquare size={14} className="text-green-500" />
                <span>Aprobar Reserva</span>
              </button>
              <button
                onClick={() => handleItemClick('reject_reserva')}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-semibold text-gray-700 hover:bg-red-50 hover:text-red-700 rounded-lg transition text-left"
              >
                <Ban size={14} className="text-red-500" />
                <span>Rechazar / Cancelar</span>
              </button>
            </>
          )}

          {data.reserva?.estado === 'Confirmada' && (
            <button
              onClick={() => handleItemClick('check_in')}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-semibold text-gray-700 hover:bg-blue-50 hover:text-blue-700 rounded-lg transition text-left"
            >
              <CheckSquare size={14} className="text-blue-500" />
              <span>Ejecutar Check-In</span>
            </button>
          )}

          {data.reserva?.estado === 'Hospedado' && (
            <button
              onClick={() => handleItemClick('check_out')}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-semibold text-gray-700 hover:bg-amber-50 hover:text-amber-700 rounded-lg transition text-left"
            >
              <LogOut size={14} className="text-amber-500" />
              <span>Ejecutar Check-Out</span>
            </button>
          )}

          {!isRestrictedRole && !['Cancelada', 'No-Show', 'Pendiente'].includes(data.reserva?.estado) && (
            <div className="border-t border-gray-100 my-1 pt-1">
              <button
                onClick={() => handleItemClick('cancel_reserva')}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 hover:text-red-700 rounded-lg transition text-left"
              >
                <Ban size={14} className="text-red-400" />
                <span>Cancelar Reserva</span>
              </button>
            </div>
          )}
        </div>
      )}

      {data.type === 'empty_cell' && (
        <div className="space-y-0.5">
          <div className="px-2 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 mb-1 truncate">
            🛏️ {data.room?.nombre} • {data.date}
          </div>

          <button
            onClick={() => handleItemClick('create_booking')}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-semibold text-gray-700 hover:bg-mahana-50 hover:text-mahana-700 rounded-lg transition text-left"
          >
            <CalendarPlus size={14} className="text-mahana-600" />
            <span>Crear Nueva Reserva</span>
          </button>

          {/* Quick Housekeeping actions */}
          <div className="border-t border-gray-100 my-1 pt-1 space-y-0.5">
            <div className="px-2 py-1 text-[9px] font-bold text-gray-400 uppercase tracking-widest">
              Limpieza
            </div>
            
            <button
              onClick={() => handleItemClick('set_clean')}
              className="w-full flex items-center gap-2 px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-green-50 hover:text-green-700 rounded-lg transition text-left"
            >
              <span className="text-[10px]">🟢</span> Marcar como Limpia
            </button>

            <button
              onClick={() => handleItemClick('set_inspected')}
              className="w-full flex items-center gap-2 px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-blue-50 hover:text-blue-700 rounded-lg transition text-left"
            >
              <span className="text-[10px]">🔵</span> Marcar como Inspeccionada
            </button>

            <button
              onClick={() => handleItemClick('set_dirty')}
              className="w-full flex items-center gap-2 px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-red-50 hover:text-red-700 rounded-lg transition text-left"
            >
              <span className="text-[10px]">🔴</span> Marcar como Sucia
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
