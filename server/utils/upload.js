const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ── Uploads directory ──
const { UPLOADS_DIR, ensureDirectory } = require('../data-paths');
ensureDirectory(UPLOADS_DIR);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, `${require('node:crypto').randomUUID()}-${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    cb(null, allowed.includes(file.mimetype));
  }
});

// Upload for import (separate multer config — store in memory)
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.csv', '.xlsx', '.xls', '.tsv'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// Helper: check buffer signatures
function checkSignature(buffer, signatureHex) {
  const sig = Buffer.from(signatureHex.replace(/\s+/g, ''), 'hex');
  if (buffer.length < sig.length) return false;
  return buffer.compare(sig, 0, sig.length, 0, sig.length) === 0;
}

// ── Magic Bytes Validation Middleware (Disk Uploads) ──
async function validateUploadSignature(req, res, next) {
  if (!req.file) return next();

  const filePath = req.file.path;
  let attempts = 0;
  const maxAttempts = 10;
  let fd;

  while (attempts < maxAttempts) {
    try {
      if (fs.existsSync(filePath)) {
        fd = fs.openSync(filePath, 'r');
        break;
      }
    } catch (e) {
      // ignore and retry
    }
    attempts++;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  if (!fd) {
    try {
      fd = fs.openSync(filePath, 'r');
    } catch (err) {
      console.error('Magic bytes disk check error:', err);
      try { fs.unlinkSync(filePath); } catch (e) {}
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Error validando firmas de archivo' }
      });
    }
  }

  try {
    const buffer = Buffer.alloc(12);
    const bytesRead = fs.readSync(fd, buffer, 0, 12, 0);
    fs.closeSync(fd);

    const data = buffer.subarray(0, bytesRead);

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    const isPng = checkSignature(data, '89 50 4E 47 0D 0A 1A 0A');
    // JPEG: FF D8 FF
    const isJpeg = checkSignature(data, 'FF D8 FF');
    // WebP: RIFF (52 49 46 46) at 0, and WEBP (57 45 42 50) at 8
    const isWebP = checkSignature(data, '52 49 46 46') &&
                   data.length >= 12 &&
                   data.subarray(8, 12).toString('ascii') === 'WEBP';
    // PDF: %PDF (25 50 44 46)
    const isPdf = checkSignature(data, '25 50 44 46');

    if (isPng || isJpeg || isWebP || isPdf) {
      return next();
    }

    // Invalid signature! Delete the file immediately
    fs.unlinkSync(filePath);
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_FILE_SIGNATURE',
        message: 'Firma de archivo inválida. Solo se permiten imágenes PNG/JPEG/WebP o archivos PDF reales.'
      }
    });
  } catch (err) {
    console.error('Magic bytes disk check error:', err);
    try { fs.unlinkSync(filePath); } catch (e) {}
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Error validando firmas de archivo' }
    });
  }
}


// ── Magic Bytes Validation Middleware (Memory Import Uploads) ──
function validateImportSignature(req, res, next) {
  if (!req.file || !req.file.buffer) return next();

  const buffer = req.file.buffer;
  try {
    // XLSX / ZIP: 50 4B 03 04
    const isZip = checkSignature(buffer, '50 4B 03 04');
    // XLS: D0 CF 11 E0 A1 B1 1A E1
    const isXls = checkSignature(buffer, 'D0 CF 11 E0 A1 B1 1A E1');

    if (isZip || isXls) {
      return next();
    }

    // Check for Text-based CSV/TSV
    // Check first 4 bytes for obvious binary formats:
    // MZ (4D 5A - PE Exe)
    const isExe = checkSignature(buffer, '4D 5A');
    // ELF (7F 45 4C 46)
    const isElf = checkSignature(buffer, '7F 45 4C 46');
    // Script header (23 21 - #!)
    const isScript = checkSignature(buffer, '23 21');

    if (isExe || isElf || isScript) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FILE_SIGNATURE',
          message: 'Archivo ejecutable o script no permitido.'
        }
      });
    }

    // Check for null bytes (indicators of binary executable files)
    if (buffer.includes(0)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FILE_SIGNATURE',
          message: 'Firma de archivo inválida. Los archivos CSV no deben contener caracteres binarios nulos.'
        }
      });
    }

    // Valid plain text CSV
    return next();
  } catch (err) {
    console.error('Magic bytes memory check error:', err);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Error validando firmas del archivo de importación' }
    });
  }
}

module.exports = {
  upload,
  importUpload,
  validateUploadSignature,
  validateImportSignature,
  UPLOADS_DIR
};
