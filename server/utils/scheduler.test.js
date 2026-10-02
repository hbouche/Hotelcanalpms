import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database
const database = require('../db/database');
const mockPrepare = vi.fn();
const mockDb = {
  prepare: mockPrepare
};
vi.spyOn(database, 'getDb').mockImplementation(() => mockDb);

// Mock notifications
const notifications = require('../notifications');
const mockNotifyReminder = vi.spyOn(notifications, 'notifyReminder').mockResolvedValue({
  email: { sent: true },
  whatsapp: { sent: true }
});

// Require the scheduler module after mocking
const { checkAndSendReminders, checkExpiredStays } = require('./scheduler');

describe('Modulo Scheduler - Hotel Panamá Canal PMS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('debe procesar recordatorios de reservas correctamente', async () => {
    const today = new Date();
    
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    
    const in3Days = new Date(today);
    in3Days.setDate(today.getDate() + 3);
    const in3DaysStr = in3Days.toISOString().split('T')[0];

    const mockReservationsTomorrow = [
      { id: 101, cliente: 'Juan', check_in: tomorrowStr, habitacion_id: 5, estado: 'Confirmada' }
    ];
    const mockReservationsIn3Days = [
      { id: 102, cliente: 'Maria', check_in: in3DaysStr, habitacion_id: 6, estado: 'Confirmada' }
    ];
    const mockRoom5 = { id: 5, nombre: 'FAM(1)', tipo: 'Familiar' };
    const mockRoom6 = { id: 6, nombre: 'DOB(1)', tipo: 'Doble' };

    mockPrepare.mockImplementation((sql) => {
      if (sql.includes("reservas_hotel WHERE check_in = ? AND estado = 'Confirmada'")) {
        return {
          all: vi.fn((checkInDate) => {
            if (checkInDate === tomorrowStr) {
              return mockReservationsTomorrow;
            }
            if (checkInDate === in3DaysStr) {
              return mockReservationsIn3Days;
            }
            return [];
          })
        };
      }
      if (sql.includes('habitaciones WHERE id = ?')) {
        return {
          get: vi.fn((id) => {
            if (id === 5) return mockRoom5;
            if (id === 6) return mockRoom6;
            return null;
          })
        };
      }
      return {
        all: vi.fn(() => []),
        get: vi.fn(() => null)
      };
    });

    await checkAndSendReminders();

    // Verify notifyReminder was called twice
    expect(mockNotifyReminder).toHaveBeenCalledTimes(2);
    
    // First call: 1-day reminder
    expect(mockNotifyReminder).toHaveBeenNthCalledWith(1, mockReservationsTomorrow[0], mockRoom5, 1);
    
    // Second call: 3-day reminder
    expect(mockNotifyReminder).toHaveBeenNthCalledWith(2, mockReservationsIn3Days[0], mockRoom6, 3);
  });

  it('debe detectar estancias expiradas sin checkout', async () => {
    const mockExpiredStays = [
      { id: 201, cliente: 'Carlos', check_out: '2026-05-19', estado: 'Hospedado' }
    ];

    mockPrepare.mockImplementation((sql) => {
      if (sql.includes("reservas_hotel WHERE check_out < ? AND estado = 'Hospedado'")) {
        return {
          all: vi.fn(() => mockExpiredStays)
        };
      }
      return {
        all: vi.fn(() => []),
        get: vi.fn(() => null)
      };
    });

    await checkExpiredStays();

    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("reservas_hotel WHERE check_out < ? AND estado = 'Hospedado'"));
  });
});
