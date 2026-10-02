import { describe, it, expect, vi, beforeEach } from 'vitest';

// Require the database and authentication modules first
const database = require('../db/database');
const auth = require('../auth');
const notifications = require('../notifications');

// Spy on database and auth methods before loading hotel router
const mockFindById = vi.fn();
const mockUpdate = vi.fn();
vi.spyOn(database, 'findById').mockImplementation((table, id) => mockFindById(table, id));
vi.spyOn(database, 'update').mockImplementation((table, id, data) => mockUpdate(table, id, data));

// Spy on notifications functions
vi.spyOn(notifications, 'notifyStatusChange').mockImplementation(() => Promise.resolve({ email: true, whatsapp: true }));

// Load the hotel router and extract the PATCH route handler for /hotel/reservas/:id/status
const hotelRouter = require('./hotel');
const route = hotelRouter.stack.find(
  (s) => s.route && s.route.path === '/hotel/reservas/:id/status' && s.route.methods.patch
);
const patchStatusHandler = route.route.stack[route.route.stack.length - 1].handle;

describe('PATCH /hotel/reservas/:id/status - State Machine and Reversion Logic', () => {
  let req, res, responseStatus, responseData;

  beforeEach(() => {
    vi.clearAllMocks();
    responseData = null;
    responseStatus = null;

    res = {
      status: vi.fn().mockImplementation((code) => {
        responseStatus = code;
        return res;
      }),
      json: vi.fn().mockImplementation((data) => {
        responseData = data;
        return res;
      })
    };

    req = {
      params: { id: '42' },
      body: {},
      user: { rol: 'receptionist', nombre: 'Test Staff' }
    };
  });

  it('debe rechazar estados no válidos con VALIDATION_ERROR', () => {
    req.body.estado = 'Invalido';

    patchStatusHandler(req, res);

    expect(responseStatus).toBe(400);
    expect(responseData.success).toBe(false);
    expect(responseData.error.code).toBe('VALIDATION_ERROR');
  });

  it('debe rechazar una reserva no encontrada con NOT_FOUND', () => {
    req.body.estado = 'Confirmada';
    mockFindById.mockReturnValueOnce(null); // reservation not found

    patchStatusHandler(req, res);

    expect(responseStatus).toBe(404);
    expect(responseData.success).toBe(false);
    expect(responseData.error.code).toBe('NOT_FOUND');
  });

  describe('Permisos y Transiciones de Rol Staff (Receptionist)', () => {
    it('debe permitir transición válida de Pendiente a Confirmada', () => {
      req.body.estado = 'Confirmada';
      mockFindById.mockImplementation((table, id) => {
        if (table === 'reservas_hotel') {
          return { id: 42, estado: 'Pendiente', habitacion_id: 10 };
        }
        return null;
      });
      mockUpdate.mockReturnValue({ id: 42, estado: 'Confirmada' });

      patchStatusHandler(req, res);

      expect(mockUpdate).toHaveBeenCalledWith('reservas_hotel', '42', { estado: 'Confirmada' });
      expect(responseStatus).toBe(200); // ok() helper sets 200 status
      expect(responseData.success).toBe(true);
      expect(responseData.data.estado).toBe('Confirmada');
    });

    it('debe permitir transición válida de Hospedado a Confirmada y vaciar la habitación', () => {
      req.body.estado = 'Confirmada';
      mockFindById.mockImplementation((table, id) => {
        if (table === 'reservas_hotel') {
          return { id: 42, estado: 'Hospedado', habitacion_id: 10 };
        }
        if (table === 'habitaciones') {
          return { id: 10, nombre: 'HAB101', tipo: 'Doble' };
        }
        return null;
      });
      mockUpdate.mockReturnValue({ id: 42, estado: 'Confirmada' });

      patchStatusHandler(req, res);

      expect(mockUpdate).toHaveBeenCalledWith('reservas_hotel', '42', { estado: 'Confirmada' });
      // Reversion logic to vacar room
      expect(mockUpdate).toHaveBeenCalledWith('habitaciones', 10, { estado_habitacion: 'Vacía' });
      expect(responseData.success).toBe(true);
    });

    it('debe rechazar una transición inválida (e.g. Pendiente a Hospedado) con INVALID_TRANSITION', () => {
      req.body.estado = 'Hospedado';
      mockFindById.mockReturnValueOnce({ id: 42, estado: 'Pendiente', habitacion_id: 10 });

      patchStatusHandler(req, res);

      expect(responseStatus).toBe(400);
      expect(responseData.success).toBe(false);
      expect(responseData.error.code).toBe('INVALID_TRANSITION');
    });

    it('debe rechazar cualquier transición fuera de un estado terminal como Check-Out', () => {
      req.body.estado = 'Confirmada';
      mockFindById.mockReturnValueOnce({ id: 42, estado: 'Check-Out', habitacion_id: 10 });

      patchStatusHandler(req, res);

      expect(responseStatus).toBe(400);
      expect(responseData.success).toBe(false);
      expect(responseData.error.code).toBe('INVALID_TRANSITION');
    });
  });

  describe('Permisos y Transiciones de Rol Admin', () => {
    it('debe permitir a un administrador saltarse las restricciones de transición (e.g. Check-Out a Confirmada)', () => {
      req.user.rol = 'admin';
      req.body.estado = 'Confirmada';
      mockFindById.mockImplementation((table, id) => {
        if (table === 'reservas_hotel') {
          return { id: 42, estado: 'Check-Out', habitacion_id: 10 };
        }
        if (table === 'habitaciones') {
          return { id: 10, nombre: 'HAB101', tipo: 'Doble' };
        }
        return null;
      });
      mockUpdate.mockReturnValue({ id: 42, estado: 'Confirmada' });

      patchStatusHandler(req, res);

      expect(mockUpdate).toHaveBeenCalledWith('reservas_hotel', '42', { estado: 'Confirmada' });
      expect(mockUpdate).toHaveBeenCalledWith('habitaciones', 10, { estado_habitacion: 'Vacía' });
      expect(responseData.success).toBe(true);
    });
  });
});
