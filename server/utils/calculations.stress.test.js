import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const database = require('../db/database');

// Reuse similar mock structure to calculations.test.js
const mockPrepare = vi.fn((sql) => {
  return {
    get: vi.fn((...args) => {
      // 1. Holiday queries
      if (sql.includes('dias_festivos')) {
        const dateStr = args[0];
        if (dateStr === '2026-11-03') {
          return { id: 1, nombre: 'Separación de Colombia' };
        }
        return null;
      }
      // 2. Tariff rules queries
      if (sql.includes('reglas_tarifa')) {
        const planId = args[0];
        const tipoDia = args[1];
        if (planId === 2) {
          // Pasadía rates
          if (tipoDia === 'fin_de_semana') {
            return { precio_adulto: 12, precio_menor: 6, precio_mascota: 3, activo: 1 };
          }
          if (tipoDia === 'festivo') {
            return { precio_adulto: 15, precio_menor: 8, precio_mascota: 4, activo: 1 };
          }
          return { precio_adulto: 10, precio_menor: 5, precio_mascota: 2, activo: 1 };
        }
        // Estadía rates
        if (tipoDia === 'fin_de_semana') {
          return { precio_adulto: 120, precio_menor: 60, precio_mascota: 25, activo: 1 };
        }
        if (tipoDia === 'festivo') {
          return { precio_adulto: 150, precio_menor: 75, precio_mascota: 30, activo: 1 };
        }
        return { precio_adulto: 100, precio_menor: 50, precio_mascota: 20, activo: 1 };
      }
      // 3. Configuration queries
      if (sql.includes('config_hotel')) {
        const key = args[0];
        if (key === 'impuesto_turismo_pct') return { valor: '10' };
        if (key === 'deposito_sugerido_pct') return { valor: '50' };
        return null;
      }
      // 4. Plan queries
      if (sql.includes('planes_tarifa')) {
        const code = args[0];
        if (code === 'pasadia_entrada') {
          return {
            id: 2,
            codigo: 'pasadia_entrada',
            nombre: 'Pasadía Entrada',
            categoria: 'Pasadía',
            precio_adulto_noche: 10,
            precio_menor_noche: 5,
            precio_mascota_noche: 2
          };
        }
        return {
          id: 1,
          codigo: 'todo_incluido',
          nombre: 'Todo Incluido',
          categoria: 'Estadía',
          precio_adulto_noche: 100,
          precio_menor_noche: 50,
          precio_mascota_noche: 20
        };
      }
      return null;
    }),
    all: vi.fn(() => [])
  };
});

const mockDb = {
  prepare: mockPrepare
};

vi.spyOn(database, 'getDb').mockImplementation(() => mockDb);
vi.spyOn(database, 'findById').mockImplementation((table, id) => {
  if (table === 'planes_tarifa') {
    if (id === 2 || id === 'pasadia_entrada') {
      return {
        id: 2,
        codigo: 'pasadia_entrada',
        nombre: 'Pasadía Entrada',
        categoria: 'Pasadía',
        precio_adulto_noche: 10,
        precio_menor_noche: 5,
        precio_mascota_noche: 2
      };
    }
    return {
      id: 1,
      codigo: 'todo_incluido',
      nombre: 'Todo Incluido',
      categoria: 'Estadía',
      precio_adulto_noche: 100,
      precio_menor_noche: 50,
      precio_mascota_noche: 20
    };
  }
  return null;
});

const { calcNoches, calcReservation, getDayType, getRateForDay, calcReservationWithRates, parseDateToUTC } = require('./calculations');

describe('Stress Test Suite for calculations.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Edge Case: 0 adults', () => {
    it('calcReservation defaults to 1 adult when 0 adults is passed', () => {
      const data = {
        adultos: 0,
        menores: 2,
        mascotas: 0,
        noches: 2,
        precio_adulto_noche: 100,
        precio_menor_noche: 50,
        precio_mascota_noche: 20,
        impuesto_pct: 10,
      };
      const res = calcReservation(data);
      // If adultos is forced to 1, the subtotal is: ((1 * 100) + (2 * 50) + 0) * 2 = 400
      expect(res.subtotal).toBe(400); // Confirms forcing 0 adults to 1
    });

    it('calcReservationWithRates defaults to 1 adult when 0 adults is passed due to clamping', () => {
      // 1 night: entre_semana (Sunday 2026-05-24 to Monday 2026-05-25)
      // Rate: adult = 100, minor = 50, pet = 20
      const res = calcReservationWithRates(1, '2026-05-24', '2026-05-25', 0, 2, 0);
      
      // If adultos is forced to 1, subtotal is: (1 * 100) + (2 * 50) = 200
      expect(res.subtotal).toBe(200); // Clamped adults >= 1
    });
  });

  describe('Edge Case: Very high adult counts', () => {
    it('should handle very large numbers of adults without overflow or precision loss', () => {
      const data = {
        adultos: 10000000, // 10 million
        menores: 0,
        mascotas: 0,
        noches: 1,
        precio_adulto_noche: 100.55,
        impuesto_pct: 10
      };
      const res = calcReservation(data);
      // Subtotal: 10,000,000 * 100.55 = 1,005,500,000
      // Impuesto: 1,005,500,000 * 0.10 = 100,550,000
      // Total: 1,106,050,000
      expect(res.subtotal).toBe(1005500000);
      expect(res.monto_total).toBe(1106050000);
    });
  });

  describe('Edge Case: Stay with 0 nights and negative nights', () => {
    it('calcNoches treats equal check-in and check-out as 1 night', () => {
      expect(calcNoches('2026-05-22', '2026-05-22')).toBe(1);
    });

    it('calcNoches treats check-out before check-in as 1 night', () => {
      expect(calcNoches('2026-05-22', '2026-05-20')).toBe(1);
    });

    it('calcReservation behaves when nights are set to 0 directly', () => {
      const data = {
        adultos: 1,
        noches: 0,
        precio_adulto_noche: 100,
        impuesto_pct: 10
      };
      const res = calcReservation(data);
      // noches is clamped to Math.max(1, 0) = 1.
      expect(res.subtotal).toBe(100);
    });
  });

  describe('Edge Case: Stay with 100 nights', () => {
    it('calcReservationWithRates accurately calculates a 100-night stay', () => {
      // 100-night stay starting 2026-05-01 to 2026-08-09
      const nights = calcNoches('2026-05-01', '2026-08-09');
      expect(nights).toBe(100);

      const res = calcReservationWithRates(1, '2026-05-01', '2026-08-09', 1, 0, 0);
      expect(res.desglose.length).toBe(100);
      
      // Let's manually verify the subtotal matches sum of night breakdown
      let expectedSubtotal = 0;
      res.desglose.forEach(n => {
        expectedSubtotal += n.total_noche;
      });
      expect(res.subtotal).toBe(Math.round(expectedSubtotal * 100) / 100);
    });
  });

  describe('Edge Case: Negative and Invalid inputs', () => {
    it('calcReservation clamps negative numbers of guests, nights, and prices to 0/1, yielding 0 total', () => {
      const data = {
        adultos: -2,       // Negative adults
        menores: -1,       // Negative minors
        mascotas: -1,      // Negative pets
        noches: -3,        // Negative nights
        precio_adulto_noche: -100, // Negative price
        precio_menor_noche: -50,
        precio_mascota_noche: -20,
        productos_adicionales: -50, // Negative extras
        impuesto_pct: 10
      };
      
      const res = calcReservation(data);
      
      // adultos clamped to Math.max(1, -2) = 1
      // menores clamped to 0
      // mascotas clamped to 0
      // noches clamped to Math.max(1, -3) = 1
      // precio_adulto clamped to 0
      // Subtotal should be 0
      expect(res.subtotal).toBe(0);
      expect(res.monto_total).toBe(0);
    });

    it('calcReservationWithRates clamps negative guest counts and produces positive totals', () => {
      const res = calcReservationWithRates(1, '2026-05-24', '2026-05-25', -2, -1, 0);
      
      // 1 night entre_semana: adult = 100, minor = 50
      // -2 adults clamped to 1 adult
      // -1 minor clamped to 0 minor
      // Total: (1 * 100) + (0 * 50) = 100
      expect(res.subtotal).toBe(100);
      expect(res.monto_total).toBe(110); // 100 + 10
    });

    it('calcReservationWithRates clamps undefined or non-numeric guest counts to default values', () => {
      const res = calcReservationWithRates(1, '2026-05-24', '2026-05-25', undefined, 'invalid', null);
      // undefined adults -> clamped to 1
      // 'invalid' minors -> clamped to 0
      // null mascotas -> clamped to 0
      expect(res.subtotal).toBe(100);
      expect(res.monto_total).toBe(110);
    });
  });

  describe('Edge Case: Timezone/Day-Shifting & Date formats', () => {
    it('parseDateToUTC causes day shifting if local Date object is used in a positive offset timezone', () => {
      const d = new Date(Date.UTC(2026, 4, 21, 14, 0, 0)); // represents May 21st 14:00 UTC
      const timestamp = parseDateToUTC(d);
      expect(new Date(timestamp).getUTCDate()).toBe(21);
    });

    it('parseDateToUTC parses slash-separated dates safely due to hyphen conversion', () => {
      const timestamp = parseDateToUTC('2026/05/22');
      const d = new Date(timestamp);
      // Conversing to hyphen enables direct UTC parse in parts.length === 3 block, returning exact UTC midnight
      expect(d.getUTCDate()).toBe(22);
      expect(d.getUTCMonth()).toBe(4); // May
    });

    it('parseDateToUTC with invalid date string returns NaN', () => {
      const timestamp = parseDateToUTC('invalid-date-string');
      expect(timestamp).toBeNaN();
    });

    it('parseDateToUTC is timezone-safe for slash-separated dates and yields same timestamp as hyphen-separated', () => {
      const slashTimestamp = parseDateToUTC('2026/05/22');
      const hyphenTimestamp = parseDateToUTC('2026-05-22');
      expect(slashTimestamp).toBe(hyphenTimestamp);
    });
  });
});
