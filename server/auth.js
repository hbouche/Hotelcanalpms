const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET)) {
  console.error('❌ FATAL: JWT_SECRET is required in production and cannot match the default insecure value!');
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRES = '7d';

function hashPassword(plain) { return bcrypt.hashSync(plain, 10); }
function verifyPassword(plain, hash) { return bcrypt.compareSync(plain, hash); }

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, rol: user.rol, nombre: user.nombre },
    JWT_SECRET, { expiresIn: JWT_EXPIRES }
  );
}

function decodeToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

// ── API Key helpers ──
function generateApiKey() {
  return 'cmk_' + crypto.randomBytes(24).toString('hex'); // cmk_... (52 chars)
}

function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Rate limit tracking (in-memory, resets on restart)
const rateLimits = new Map(); // key_hash -> { count, windowStart }

function checkRateLimit(keyHash, limit = 100) {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  let entry = rateLimits.get(keyHash);
  
  if (!entry || (now - entry.windowStart) > windowMs) {
    entry = { count: 0, windowStart: now };
    rateLimits.set(keyHash, entry);
  }
  
  entry.count++;
  const remaining = Math.max(0, limit - entry.count);
  const resetAt = Math.ceil((entry.windowStart + windowMs) / 1000);
  
  return {
    allowed: entry.count <= limit,
    remaining,
    resetAt,
    limit
  };
}

// ── Middleware: Auth (JWT or API Key) ──
function requireAuth(req, res, next) {
  // 1. Try API Key first
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    let getDb;
    try { getDb = require('./db/database').getDb; } catch { }
    if (getDb) {
      const db = getDb();
      const keyHash = hashApiKey(apiKey);
      const keyRow = db.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND activo = 1').get(keyHash);
      if (keyRow) {
        // Rate limit check
        const rl = checkRateLimit(keyHash, keyRow.rate_limit || 100);
        res.set('X-RateLimit-Limit', String(rl.limit));
        res.set('X-RateLimit-Remaining', String(rl.remaining));
        res.set('X-RateLimit-Reset', String(rl.resetAt));
        
        if (!rl.allowed) {
          return res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: `Rate limit exceeded. Limit: ${rl.limit}/min. Retry after reset.` } });
        }
        
        // Update last_used
        db.prepare("UPDATE api_keys SET last_used = datetime('now'), request_count = request_count + 1 WHERE id = ?").run(keyRow.id);
        
        req.user = {
          id: 0,
          email: `apikey:${keyRow.nombre}`,
          rol: keyRow.permisos === 'admin' ? 'admin' : keyRow.permisos === 'write' ? 'staff' : 'reader',
          nombre: keyRow.nombre,
          isApiKey: true,
          apiKeyId: keyRow.id,
          permisos: keyRow.permisos
        };
        return next();
      }
    }
    return res.status(401).json({ success: false, error: { code: 'INVALID_API_KEY', message: 'API key inválida o desactivada' } });
  }
  
  // 2. Try JWT
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Token o API key requerido' } });
  }
  const decoded = decodeToken(auth.slice(7));
  if (!decoded) {
    return res.status(401).json({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'Token inválido o expirado' } });
  }
  // Verify user is still active in DB
  let getDb;
  try { getDb = require('./db/database').getDb; } catch { }
  if (getDb) {
    const db = getDb();
    const userRow = db.prepare('SELECT activo FROM usuarios WHERE id = ?').get(decoded.id);
    if (!userRow) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Usuario inexistente' } });
    }
    if (userRow.activo !== 1) {
      return res.status(403).json({ success: false, error: { code: 'USER_DEACTIVATED', message: 'Usuario desactivado' } });
    }
  }
  req.user = decoded;
  next();
}

// ── Middleware: Read permission (API key read/write/admin or JWT) ──
function requireWrite(req, res, next) {
  if (req.user?.isApiKey && req.user.permisos === 'read') {
    return res.status(403).json({ success: false, error: { code: 'READ_ONLY', message: 'API key solo tiene permisos de lectura' } });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No autenticado' } });
    if (!roles.includes(req.user.rol)) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Sin permisos' } });
    next();
  };
}

module.exports = { hashPassword, verifyPassword, generateToken, decodeToken, requireAuth, requireRole, requireWrite, generateApiKey, hashApiKey };
