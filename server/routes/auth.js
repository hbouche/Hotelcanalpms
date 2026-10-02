const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { verifyPassword, generateToken, requireAuth } = require('../auth');

function ok(res, data, meta, status = 200) {
  const response = { success: true, data };
  if (meta) response.meta = meta;
  return res.status(status).json(response);
}

function err(res, code, message, status = 400) {
  return res.status(status).json({ success: false, error: { code, message } });
}

router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body || {};
    const db = getDb();
    const record = (id, result) => db.prepare('INSERT INTO accesos_log (usuario_id, resultado) VALUES (?, ?)').run(id, result);
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      record(null, 'fallido');
      return err(res, 'VALIDATION_ERROR', 'Email y contraseña requeridos');
    }
    const user = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email.toLowerCase().trim());
    if (!user) {
      record(null, 'fallido');
      return err(res, 'AUTH_FAILED', 'Credenciales inválidas', 401);
    }
    if (user.activo === 0) {
      record(user.id, 'fallido');
      return err(res, 'USER_DEACTIVATED', 'Usuario desactivado', 403);
    }
    if (!verifyPassword(password, user.password_hash)) {
      record(user.id, 'fallido');
      return err(res, 'AUTH_FAILED', 'Credenciales inválidas', 401);
    }
    const token = generateToken(user);
    record(user.id, 'exitoso');
    ok(res, { token, user: { id: user.id, email: user.email, nombre: user.nombre, rol: user.rol } });
  } catch (e) { console.error('Login failed internally'); err(res, 'SERVER_ERROR', 'Error en login', 500); }
});

router.get('/me', requireAuth, (req, res) => {
  ok(res, { id: req.user.id, email: req.user.email, nombre: req.user.nombre, rol: req.user.rol });
});

module.exports = router;
