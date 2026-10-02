import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import Dashboard from './Dashboard';
import Calendario from './Calendario';
import Habitaciones from './Habitaciones';
import ContextMenu from '../components/ContextMenu';
import InteractivePopover from '../components/InteractivePopover';
import { HousekeepingCalendarGrid, HousekeepingDashboardView, HousekeepingRoom, HousekeepingSummary } from './Housekeeping';

const noop = () => {};
const room: HousekeepingRoom = { id: 1, nombre: 'Habitación 101', tipo: 'Doble', categoria: 'Estadía', estado_limpieza: 'Sucia', no_molestar: 1 };
const reservation = {
  id: 5, habitacion_id: 1, check_in: '2026-10-02', check_out: '2026-10-04', estado: 'Hospedado',
  cliente: 'Guest should stay private', apellido: 'Private surname', email: 'guest@example.com',
  monto_total: 98765, saldo_pendiente: 87654, plan_nombre: 'Private plan', noches: 2, adultos: 2, menores: 0,
};
const summary: HousekeepingSummary = {
  housekeeping: true,
  ocupacion: { total: 3, ocupadas: 1, porcentaje: 33 },
  hoy: { llegadas: 1, salidas: 2, hospedados: 1 },
  limpieza: [{ estado_limpieza: 'Sucia', c: 1 }, { estado_limpieza: 'Limpia', c: 2 }],
  limpieza_estadia: [{ estado_limpieza: 'Sucia', c: 1 }],
  limpieza_pasadia: [{ estado_limpieza: 'Limpia', c: 2 }],
};

describe('Housekeeping page boundaries', () => {
  it.each([Dashboard, Calendario, Habitaciones])('does not mount page content until a supported role is known', Page => {
    for (const userRole of [undefined, '', 'reader']) {
      const html = renderToStaticMarkup(<Page userRole={userRole} />);
      expect(html).toContain('Verificando permisos');
      expect(html).not.toContain('<a');
      expect(html).not.toContain('<button');
      expect(html).not.toContain('<input');
    }
  });

  it('renders the aggregate dashboard without operational or personal details', () => {
    const fixture = { ...summary, financiero: { ingresos_periodo: 98765 }, recientes: [reservation] };
    const html = renderToStaticMarkup(<StaticRouter location="/"><HousekeepingDashboardView data={fixture} /></StaticRouter>);
    expect(html).toContain('Dashboard de limpieza');
    expect(html).toContain('33%');
    expect(html).toContain('href="/habitaciones"');
    expect(html).toContain('href="/calendario"');
    for (const forbidden of ['Guest should stay private', '98765', 'Finanzas', 'reservas/nueva', '/admin/', 'Ingresos', 'Cloudbeds']) {
      expect(html).not.toContain(forbidden);
    }
  });

  it('shows anonymous occupancy and cleaning controls without reservation interactions', () => {
    const html = renderToStaticMarkup(<HousekeepingCalendarGrid rooms={[room]} reservations={[reservation]} dates={[
      new Date('2026-10-02T12:00:00'), new Date('2026-10-03T12:00:00'), new Date('2026-10-04T12:00:00'),
    ]} saving={false} onCleaningChange={noop} />);
    for (const expected of ['Habitación 101', 'Llegada', 'Ocupada', 'Salida', 'No molestar', 'Limpieza de Habitación 101', 'Inspeccionada']) {
      expect(html).toContain(expected);
    }
    for (const forbidden of ['Guest should stay private', 'Private surname', 'guest@example.com', '98765', '87654', 'Private plan', 'href=', 'draggable=', 'Nueva reserva', 'Registrar Pago']) {
      expect(html).not.toContain(forbidden);
    }
    expect(html).toContain('<select');
  });

  it('handles same-day stays in their arrival cell without a separate departure cell', () => {
    const sameDay = { ...reservation, check_out: reservation.check_in };
    const html = renderToStaticMarkup(<HousekeepingCalendarGrid rooms={[room]} reservations={[sameDay]} dates={[new Date('2026-10-02T12:00:00')]} saving={false} onCleaningChange={noop} />);
    expect(html).toContain('>Llegada</div>');
    expect(html).not.toContain('>Salida</div>');
  });

  it('keeps reservation context menus and popovers unavailable to cleaning and unknown roles', () => {
    for (const userRole of [undefined, 'cleaning', 'reader']) {
      expect(renderToStaticMarkup(<ContextMenu x={0} y={0} data={{ type: 'reserva', reserva: reservation }} onAction={noop} onClose={noop} userRole={userRole} />)).toBe('');
      expect(renderToStaticMarkup(<InteractivePopover x={0} y={0} reserva={reservation} onClose={noop} onAction={noop} userRole={userRole} />)).toBe('');
    }
  });

  it('exposes only cleaning actions in a housekeeping room context menu', () => {
    const html = renderToStaticMarkup(<ContextMenu x={0} y={0} data={{ type: 'empty_cell', room, date: '2026-10-02' }} onAction={noop} onClose={noop} userRole="cleaning" />);
    expect(html).toContain('Marcar como Limpia');
    expect(html).toContain('Marcar como Sucia');
    expect(html).toContain('Marcar como Inspeccionada');
    expect(html).not.toContain('Crear Nueva Reserva');
    expect(renderToStaticMarkup(<ContextMenu x={0} y={0} data={{ type: 'empty_cell', room }} onAction={noop} onClose={noop} />)).toBe('');
  });

  it.each(['admin', 'receptionist'])('preserves reservation context actions for %s', userRole => {
    const html = renderToStaticMarkup(<ContextMenu x={0} y={0} data={{ type: 'reserva', reserva: reservation }} onAction={noop} onClose={noop} userRole={userRole} />);
    expect(html).toContain('Ver Ficha Completa');
    expect(html).toContain('Registrar Abono');
    expect(html).toContain('Ejecutar Check-Out');
  });
});
