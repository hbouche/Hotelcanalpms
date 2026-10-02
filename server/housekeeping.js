// Only room-operating facts are exposed to housekeeping. Free text such as
// comentarios/asignado_a may contain guest information and must stay private.
const ROOM_FIELDS = [
  'id', 'nombre', 'tipo', 'categoria', 'capacidad', 'capacidad_min', 'capacidad_max',
  'descripcion_camas', 'piso', 'estado_limpieza', 'estado_habitacion', 'no_molestar', 'activa',
];

function housekeepingRoom(room) {
  if (!room) return room;
  return Object.fromEntries(ROOM_FIELDS.filter(field => Object.hasOwn(room, field)).map(field => [field, room[field]]));
}

module.exports = { housekeepingRoom };
