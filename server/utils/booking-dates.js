// A day-pass occupies inclusive dates; an overnight stay releases on checkout.
function isDayPass(room) { return room?.categoria === 'Pasadía'; }
function validBookingDates(room, checkIn, checkOut) {
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  return validDate(checkIn) && validDate(checkOut)
    && (isDayPass(room) ? checkOut >= checkIn : checkOut > checkIn);
}
function overlapSql(room) {
  return isDayPass(room) ? 'check_in <= ? AND check_out >= ?' : 'check_in < ? AND check_out > ?';
}
module.exports = { isDayPass, validBookingDates, overlapSql };
