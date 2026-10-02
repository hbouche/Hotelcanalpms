import React, { memo } from 'react';
import { Link } from 'react-router-dom';

const ROOM_COL_W = 'w-36 min-w-[144px]';

const estadoColors: Record<string, string> = {
  'Confirmada': 'bg-blue-400',
  'Hospedado': 'bg-green-500',
  'Check-Out': 'bg-gray-400',
  'Pendiente': 'bg-yellow-400',
  'Cancelada': 'bg-red-400',
  'No-Show': 'bg-red-300',
};

function getPastelColor(str: string) {
  if (!str) return null;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash % 360);
  return {
    bg: `hsl(${h}, 75%, 90%)`,
    border: `hsl(${h}, 70%, 45%)`,
    text: `hsl(${h}, 85%, 22%)`
  };
}

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

const isToday = (d: Date) => formatDate(d) === formatDate(new Date());
const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

function getBarStyle(reserva: any, dates: Date[]) {
  const resStart = new Date(reserva.check_in + 'T12:00:00');
  const resEnd = new Date(reserva.check_out + 'T12:00:00');
  const viewStart = dates[0];
  const viewEnd = addDays(dates[dates.length - 1], 1);
  const barStart = resStart < viewStart ? viewStart : resStart;
  const barEnd = resEnd > viewEnd ? viewEnd : resEnd;
  const totalViewDays = dates.length;
  const startOffset = daysBetween(formatDate(viewStart), formatDate(barStart));
  let barDays = daysBetween(formatDate(barStart), formatDate(barEnd));
  
  // Same-day reservations (e.g. Pasadía) occupy exactly 1 day
  if (barDays === 0) {
    barDays = 1;
  }
  
  const left = (startOffset / totalViewDays) * 100;
  const width = (barDays / totalViewDays) * 100;
  return { left: `${left}%`, width: `${Math.min(width, 100 - left)}%` };
}

function getCheckoutIndicator(reserva: any, dates: Date[]) {
  // Same-day reservations do not have a separate check-out day indicator
  if (reserva.check_in === reserva.check_out) {
    return null;
  }
  const coDate = new Date(reserva.check_out + 'T12:00:00');
  const viewStart = dates[0];
  const viewEnd = addDays(dates[dates.length - 1], 1);
  if (coDate < viewStart || coDate >= viewEnd) return null;
  const offset = daysBetween(formatDate(viewStart), reserva.check_out);
  const left = (offset / dates.length) * 100;
  const w = (1 / dates.length) * 100 * 0.4;
  return { left: `${left}%`, width: `${w}%` };
}

interface Room {
  id: number;
  nombre: string;
  estado_limpieza: 'Limpia' | 'Sucia' | 'Inspeccionada';
  estado_habitacion?: string;
  categoria?: string;
  tipo: string;
}

interface RoomRowProps {
  room: Room;
  dates: Date[];
  reservations: any[];
  onCellClick: (roomId: number, dateStr: string) => void;
  onCellContextMenu: (e: React.MouseEvent, room: Room, date: string) => void;
  onReservaMouseEnter: (e: React.MouseEvent, res: any) => void;
  onReservaMouseLeave: () => void;
  onReservaContextMenu: (e: React.MouseEvent, res: any) => void;
  activeGroupCode?: string | null;
  onReassignRoom?: (reservaId: number, roomId: number) => void;
}

const RoomRow = memo(({
  room,
  dates,
  reservations,
  onCellClick,
  onCellContextMenu,
  onReservaMouseEnter,
  onReservaMouseLeave,
  onReservaContextMenu,
  activeGroupCode = null,
  onReassignRoom,
}: RoomRowProps) => {
  return (
    <div className="flex border-b border-gray-100 hover:bg-gray-50/50 group/row" style={{ minHeight: '40px' }}>
      {/* Room Name */}
      <div
        className={`${ROOM_COL_W} flex-shrink-0 border-r border-gray-200 px-3 py-1.5 flex items-center gap-2 cursor-context-menu`}
        onContextMenu={(e) => onCellContextMenu(e, room, formatDate(dates[0]))}
      >
        <span className="text-sm font-medium text-gray-700">{room.nombre}</span>
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            room.estado_limpieza === 'Limpia'
              ? 'bg-green-400'
              : room.estado_limpieza === 'Inspeccionada'
              ? 'bg-blue-400'
              : 'bg-red-400'
          }`}
          title={room.estado_limpieza}
        />
        {room.estado_habitacion === 'Ocupada' && <span className="text-[10px] text-orange-500">●</span>}
      </div>

      {/* Grid cells + Reservation bars */}
      <div className="flex-1 relative">
        <div className="flex absolute inset-0">
          {dates.map((d, i) => {
            const dateStr = formatDate(d);
            return (
              <div
                key={i}
                className={`flex-1 min-w-[50px] border-r border-gray-50 cursor-pointer hover:bg-ocean-50/30 transition ${
                  isToday(d) ? 'bg-ocean-50/20' : isWeekend(d) ? 'bg-gray-50/50' : ''
                }`}
                onClick={() => onCellClick(room.id, dateStr)}
                title={`Nueva reserva: ${room.nombre} — ${dateStr}`}
                onContextMenu={(e) => onCellContextMenu(e, room, dateStr)}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  try {
                    const dragDataStr = e.dataTransfer.getData('text/plain');
                    if (!dragDataStr) return;
                    const dragData = JSON.parse(dragDataStr);
                    if (dragData.id && onReassignRoom) {
                      if (dragData.room_id !== room.id) {
                        onReassignRoom(dragData.id, room.id);
                      }
                    }
                  } catch (err) {
                    console.error('Error onDrop:', err);
                  }
                }}
              />
            );
          })}
        </div>
        
        {reservations.map((res: any) => {
          const style = getBarStyle(res, dates);
          const coStyle = getCheckoutIndicator(res, dates);
          const isPending = res.estado === 'Pendiente';
          const isGroupRes = !!res.grupo_codigo;
          const pastelColors = isGroupRes ? getPastelColor(res.grupo_codigo) : null;
          const isHoveredGroup = isGroupRes && activeGroupCode === res.grupo_codigo;

          const colorClass = isPending
            ? 'bg-amber-500/20 border border-dashed border-amber-500 text-amber-900 font-semibold backdrop-blur-sm'
            : `${estadoColors[res.estado] || 'bg-gray-400'} text-white`;

          const combinedStyle = {
            ...style,
            ...(isGroupRes && pastelColors ? {
              backgroundColor: pastelColors.bg,
              color: pastelColors.text,
              borderColor: isHoveredGroup ? '#ec4899' : pastelColors.border,
              borderWidth: isHoveredGroup ? '3px' : '1px',
              borderStyle: 'solid',
              boxShadow: isHoveredGroup ? '0 0 12px rgba(236, 72, 153, 0.4)' : 'none',
              zIndex: isHoveredGroup ? 30 : 10
            } : {})
          };

          return (
            <div key={res.id}>
              <Link
                to={`/reservas/${res.id}`}
                className={`absolute top-1 bottom-1 ${isGroupRes ? '' : colorClass} rounded-md flex items-center px-2 text-xs font-medium shadow-sm hover:shadow-md hover:brightness-110 transition cursor-pointer overflow-hidden whitespace-nowrap z-10`}
                style={combinedStyle}
                draggable={true}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', JSON.stringify({ id: res.id, room_id: res.habitacion_id }));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onMouseEnter={(e) => onReservaMouseEnter(e, res)}
                onMouseLeave={onReservaMouseLeave}
                onContextMenu={(e) => {
                  onReservaContextMenu(e, res);
                }}
              >
                <span className="truncate flex items-center gap-1">
                  {isGroupRes && <span className="flex-shrink-0" title={`Grupo: ${res.grupo_codigo}`}>👥</span>}
                  <span>{res.cliente} {res.plan_nombre ? `• ${res.plan_nombre}` : ''}</span>
                </span>
              </Link>
              {coStyle && (
                <div
                  className={`absolute top-1 bottom-1 ${isPending ? 'bg-amber-500/20 border border-dashed border-amber-500' : (isGroupRes ? '' : colorClass)} opacity-40 rounded-r-md z-[9]`}
                  style={{
                    ...coStyle,
                    ...(isGroupRes && pastelColors ? {
                      backgroundColor: pastelColors.bg,
                      borderColor: isHoveredGroup ? '#ec4899' : pastelColors.border,
                      borderWidth: '1px',
                      borderStyle: 'solid',
                    } : {})
                  }}
                  title={`Check-out: ${res.check_out}`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Compare activeGroupCode
  if (prevProps.activeGroupCode !== nextProps.activeGroupCode) return false;

  // 1. Compare rooms
  if (
    prevProps.room.id !== nextProps.room.id ||
    prevProps.room.nombre !== nextProps.room.nombre ||
    prevProps.room.estado_limpieza !== nextProps.room.estado_limpieza ||
    prevProps.room.estado_habitacion !== nextProps.room.estado_habitacion
  ) {
    return false;
  }
  
  // 2. Compare dates
  if (prevProps.dates.length !== nextProps.dates.length) return false;
  for (let i = 0; i < prevProps.dates.length; i++) {
    if (prevProps.dates[i].getTime() !== nextProps.dates[i].getTime()) {
      return false;
    }
  }

  // 3. Compare reservations
  if (prevProps.reservations.length !== nextProps.reservations.length) return false;
  for (let i = 0; i < prevProps.reservations.length; i++) {
    const pRes = prevProps.reservations[i];
    const nRes = nextProps.reservations[i];
    if (
      pRes.id !== nRes.id ||
      pRes.estado !== nRes.estado ||
      pRes.cliente !== nRes.cliente ||
      pRes.check_in !== nRes.check_in ||
      pRes.check_out !== nRes.check_out ||
      pRes.plan_nombre !== nRes.plan_nombre ||
      pRes.grupo_codigo !== nRes.grupo_codigo
    ) {
      return false;
    }
  }

  // 4. Compare callbacks
  return (
    prevProps.onCellClick === nextProps.onCellClick &&
    prevProps.onCellContextMenu === nextProps.onCellContextMenu &&
    prevProps.onReservaMouseEnter === nextProps.onReservaMouseEnter &&
    prevProps.onReservaMouseLeave === nextProps.onReservaMouseLeave &&
    prevProps.onReservaContextMenu === nextProps.onReservaContextMenu &&
    prevProps.onReassignRoom === nextProps.onReassignRoom
  );
});

RoomRow.displayName = 'RoomRow';

export default RoomRow;
