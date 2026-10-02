import { describe, it, expect, beforeAll } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'hotel-canal-habitaciones-test.db';

const { getDb, resetDb } = require('../db/database');
const habitacionesRouter = require('./habitaciones');

function findRouteHandler(router, path, method) {
  const route = router.stack.find(
    (s) => s.route && s.route.path === path && s.route.methods[method]
  );
  if (!route) throw new Error(`Route not found for path: ${path} and method: ${method}`);
  return route.route.stack[route.route.stack.length - 1].handle;
}

describe('Habitaciones Photo Upload and Management Endpoints', () => {
  let db;
  let uploadPhotoHandler;
  let getPhotosHandler;

  beforeAll(() => {
    resetDb();

    const fs = require('fs');
    const path = require('path');
    const dbDir = fs.existsSync('/data') ? '/data' : path.resolve(__dirname, '../../data');
    const dbPath = path.join(dbDir, 'hotel-canal-habitaciones-test.db');
    if (fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath);
      } catch (e) {}
    }

    db = getDb();

    uploadPhotoHandler = findRouteHandler(habitacionesRouter, '/tipo/:tipo/foto', 'post');
    getPhotosHandler = findRouteHandler(habitacionesRouter, '/tipo-fotos', 'get');
  });

  it('should successfully upload a new photo and save it in config_hotel', () => {
    const req = {
      file: { filename: 'familiar-deluxe.jpg' },
      params: { tipo: 'Familiar' }
    };

    let resStatus = 200;
    let resData = null;
    const res = {
      status: (code) => { resStatus = code; return res; },
      json: (data) => { resData = data; return res; }
    };

    uploadPhotoHandler(req, res);

    expect(resStatus).toBe(200);
    expect(resData.success).toBe(true);
    expect(resData.data.tipo).toBe('Familiar');
    expect(resData.data.imagen).toBe('/uploads/familiar-deluxe.jpg');

    // Verify config_hotel contains the key
    const configRow = db.prepare("SELECT * FROM config_hotel WHERE clave = 'foto_tipo_Familiar'").get();
    expect(configRow).toBeDefined();
    expect(configRow.valor).toBe('/uploads/familiar-deluxe.jpg');
    expect(configRow.descripcion).toBe('Foto tipo Familiar');
  });

  it('should successfully update the photo if it already exists in config_hotel', () => {
    const req = {
      file: { filename: 'familiar-deluxe-v2.jpg' },
      params: { tipo: 'Familiar' }
    };

    let resStatus = 200;
    let resData = null;
    const res = {
      status: (code) => { resStatus = code; return res; },
      json: (data) => { resData = data; return res; }
    };

    uploadPhotoHandler(req, res);

    expect(resStatus).toBe(200);
    expect(resData.success).toBe(true);
    expect(resData.data.imagen).toBe('/uploads/familiar-deluxe-v2.jpg');

    // Verify config_hotel has been updated
    const configRow = db.prepare("SELECT * FROM config_hotel WHERE clave = 'foto_tipo_Familiar'").get();
    expect(configRow.valor).toBe('/uploads/familiar-deluxe-v2.jpg');
  });

  it('should list all room type photos correctly', () => {
    // Add another photo key to test listing multiple
    db.prepare("INSERT INTO config_hotel (clave, valor, descripcion) VALUES ('foto_tipo_Doble', '/uploads/doble.jpg', 'Foto tipo Doble')").run();

    const req = {};
    let resStatus = 200;
    let resData = null;
    const res = {
      status: (code) => { resStatus = code; return res; },
      json: (data) => { resData = data; return res; }
    };

    getPhotosHandler(req, res);

    expect(resStatus).toBe(200);
    expect(resData.success).toBe(true);
    expect(resData.data.Familiar).toBe('/uploads/familiar-deluxe-v2.jpg');
    expect(resData.data.Doble).toBe('/uploads/doble.jpg');
  });
});
