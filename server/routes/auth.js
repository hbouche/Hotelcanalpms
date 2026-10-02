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
    const { email, password } = req.body;
    if (!email || !password) return err(res, 'VALIDATION_ERROR', 'Email y contraseña requeridos');
    const db = getDb();
    const user = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email.toLowerCase().trim());
    if (!user) {
      return err(res, 'AUTH_FAILED', 'Credenciales inválidas', 401);
    }
    if (user.activo === 0) {
      return err(res, 'USER_DEACTIVATED', 'Usuario desactivado', 403);
    }
    if (!verifyPassword(password, user.password_hash)) {
      return err(res, 'AUTH_FAILED', 'Credenciales inválidas', 401);
    }
    ok(res, { token: generateToken(user), user: { id: user.id, email: user.email, nombre: user.nombre, rol: user.rol } });
  } catch (e) { console.error('Login error:', e); err(res, 'SERVER_ERROR', 'Error en login', 500); }
});

router.get('/me', requireAuth, (req, res) => {
  ok(res, { id: req.user.id, email: req.user.email, nombre: req.user.nombre, rol: req.user.rol });
});

module.exports = router;
