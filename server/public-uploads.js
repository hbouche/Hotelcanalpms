const path = require('path');
const { getDb } = require('./db/database');
// Only explicitly registered hotel/product photos are public. Guest files are never public.
module.exports = function publicUploadGuard(req, res, next) {
  let filename;
  try { filename = decodeURIComponent(req.path.replace(/^\//, '')); } catch { return res.sendStatus(404); }
  if (!filename || filename !== path.basename(filename)) return res.sendStatus(404);
  const db = getDb();
  if (db.prepare('SELECT 1 FROM documentos_reserva WHERE nombre_archivo = ? LIMIT 1').get(filename)) return res.sendStatus(404);
  const url = `/uploads/${filename}`;
  const photo = db.prepare('SELECT 1 FROM planes_tarifa WHERE imagen = ? LIMIT 1').get(url)
    || db.prepare("SELECT 1 FROM config_hotel WHERE clave LIKE 'foto_tipo_%' AND valor = ? LIMIT 1").get(url);
  if (!photo) return res.sendStatus(404);
  next();
};
