import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom';
import { api, setToken, clearToken, isLoggedIn } from './api/client';
import { Hotel, CalendarDays, BedDouble, DollarSign, LogOut, Menu, X, LayoutGrid, Settings, Package, ExternalLink, BarChart3, Upload, Users, Bell, ShieldCheck, Wrench, Calculator } from 'lucide-react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Reservas from './pages/Reservas';
import NuevaReserva from './pages/NuevaReserva';
import ReservaDetalle from './pages/ReservaDetalle';
import Habitaciones from './pages/Habitaciones';
import AdminHabitaciones from './pages/AdminHabitaciones';
import Calendario from './pages/Calendario';
import Saldos from './pages/Saldos';
import Productos from './pages/Productos';
import Reportes from './pages/Reportes';
import BookingWidget from './pages/BookingWidget';
import ImportarDatos from './pages/ImportarDatos';
import Huespedes from './pages/Huespedes';
import Aprobaciones from './pages/Aprobaciones';
import Usuarios from './pages/Usuarios';
import Configuracion from './pages/Configuracion';
import CotizadorCRM from './pages/CotizadorCRM';


function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (isLoggedIn()) {
      api.get('/auth/me').then(r => {
        localStorage.setItem('pms_user', JSON.stringify(r.data));
        setUser(r.data);
        setLoading(false);
      })
        .catch(() => {
          clearToken();
          localStorage.removeItem('pms_user');
          setLoading(false);
        });
    } else { setLoading(false); }
  }, []);

  // Fetch pending count periodically
  useEffect(() => {
    if (user && ['admin', 'receptionist'].includes(user.rol)) {
      const fetchPending = () => {
        api.get('/hotel/reservas?estado=Pendiente')
          .then(r => {
            if (Array.isArray(r.data)) {
              setPendingCount(r.data.length);
            }
          })
          .catch(() => {});
      };
      fetchPending();
      const interval = setInterval(fetchPending, 30000);
      return () => clearInterval(interval);
    }
  }, [user]);

  const handleLogin = async (email: string, password: string) => {
    const r = await api.post('/auth/login', { email, password });
    setToken(r.data.token);
    localStorage.setItem('pms_user', JSON.stringify(r.data.user));
    setUser(r.data.user);
  };

  const handleLogout = () => {
    clearToken();
    localStorage.removeItem('pms_user');
    setUser(null);
    navigate('/login');
  };

  // Public route: /reservar (no auth needed)
  if (location.pathname === '/reservar') return <BookingWidget />;

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="animate-pulse text-xl text-gray-400">Cargando...</div></div>;
  if (!user) return <Login onLogin={handleLogin} />;

  if (!['admin', 'receptionist', 'cleaning'].includes(user.rol)) {
    return <div className="p-8 text-gray-600" role="alert">No se pudo verificar el rol de esta cuenta. <button onClick={handleLogout} className="underline">Cerrar sesión</button></div>;
  }

  const isCleaning = user.rol === 'cleaning';
  const isAdmin = user?.rol === 'admin';

  const fullNav = [
    { path: '/', label: 'Dashboard', icon: Hotel },
    { path: '/calendario', label: 'Calendario', icon: LayoutGrid },
    { path: '/aprobaciones', label: 'Aprobaciones', icon: Bell, badge: pendingCount > 0 ? pendingCount : undefined },
    { path: '/reservas', label: 'Reservas', icon: CalendarDays },
    { path: '/crm', label: 'Cotizador / CRM', icon: Calculator },
    { path: '/habitaciones', label: 'Habitaciones', icon: BedDouble },
    { path: '/productos', label: 'Productos', icon: Package },
    { path: '/admin/habitaciones', label: 'Config Rooms', icon: Settings },
    { path: '/saldos', label: 'CxC', icon: DollarSign },
    { path: '/huespedes', label: 'Huéspedes', icon: Users },
    { path: '/reportes', label: 'Reportes', icon: BarChart3 },
    { path: '/admin/importar', label: 'Importar', icon: Upload },
  ];

  const adminNav = [
    { path: '/usuarios', label: 'Personal', icon: ShieldCheck },
    { path: '/configuracion', label: 'Configuración', icon: Wrench },
  ];

  const nav = isCleaning
    ? fullNav.filter(n => ['/', '/calendario', '/habitaciones'].includes(n.path))
    : fullNav;

  const isActive = (path: string) => location.pathname === path || (path !== '/' && location.pathname.startsWith(path));

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Bar */}
      <header className="bg-white border-b border-gray-200 h-14 flex items-center px-4 sticky top-0 z-40">
        <button className="lg:hidden mr-3 text-gray-500 hover:text-gray-700" onClick={() => setSidebarOpen(!sidebarOpen)}>
          {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
        <div className="flex items-center gap-2">
          <img src="/hotel-panama-canal-reference.jpg" alt="" width="36" height="36" className="rounded-lg" />
          <span className="font-semibold text-gray-800 text-lg">Hotel Panamá Canal</span>
          <span className="text-xs text-gray-400 hidden sm:block">PMS</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-gray-500 hidden sm:block">{user.nombre}</span>
          <button onClick={handleLogout} className="text-gray-400 hover:text-red-500 transition" title="Cerrar sesión">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className={`fixed lg:static inset-y-0 left-0 z-30 w-56 bg-white border-r border-gray-200 pt-16 lg:pt-2 transform transition-transform duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
          <nav className="p-3 space-y-1">
            {nav.map(n => (
              <Link key={n.path} to={n.path} onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${isActive(n.path) ? 'bg-mahana-50 text-mahana-700' : 'text-gray-600 hover:bg-gray-50'}`}>
                <n.icon size={18} />
                <span className="flex-1">{n.label}</span>
                {n.badge !== undefined && (
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-500 text-white rounded-full animate-pulse leading-none flex items-center justify-center">
                    {n.badge}
                  </span>
                )}
              </Link>
            ))}
            {/* Admin-only section */}
            {isAdmin && (
              <div className="border-t border-gray-100 mt-3 pt-3">
                <span className="px-3 text-[10px] font-bold text-gray-300 uppercase tracking-widest">Administración</span>
                <div className="mt-1.5 space-y-1">
                  {adminNav.map(n => (
                    <Link key={n.path} to={n.path} onClick={() => setSidebarOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${isActive(n.path) ? 'bg-mahana-50 text-mahana-700' : 'text-gray-600 hover:bg-gray-50'}`}>
                      <n.icon size={18} />
                      <span>{n.label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {/* Vista Cliente separator + link */}
            {!isCleaning && <div className="border-t border-gray-100 mt-3 pt-3">
              <a href="/reservar" target="_blank" rel="noopener"
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 transition border border-amber-200">
                <ExternalLink size={18} />
                Vista Cliente
              </a>
            </div>}
          </nav>
        </aside>

        {/* Backdrop */}
        {sidebarOpen && <div className="fixed inset-0 bg-black/20 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />}

        {/* Main Content */}
        <main className="flex-1 p-4 lg:p-6 min-h-[calc(100vh-3.5rem)]">
          <Routes>
            <Route path="/" element={<Dashboard userRole={user.rol} />} />
            <Route path="/calendario" element={<Calendario userRole={user.rol} />} />
            <Route path="/habitaciones" element={<Habitaciones userRole={user.rol} />} />

            {!isCleaning && (
              <>
                <Route path="/aprobaciones" element={<Aprobaciones />} />
                <Route path="/reservas" element={<Reservas />} />
                <Route path="/reservas/nueva" element={<NuevaReserva />} />
                <Route path="/reservas/:id" element={<ReservaDetalle />} />
                <Route path="/crm" element={<CotizadorCRM />} />
                <Route path="/admin/habitaciones" element={<AdminHabitaciones />} />
                <Route path="/productos" element={<Productos />} />
                <Route path="/saldos" element={<Saldos />} />
                <Route path="/reportes" element={<Reportes />} />
                <Route path="/huespedes" element={<Huespedes />} />
                <Route path="/admin/importar" element={<ImportarDatos />} />
                {isAdmin && (
                  <>
                    <Route path="/usuarios" element={<Usuarios />} />
                    <Route path="/configuracion" element={<Configuracion user={user} />} />
                  </>
                )}
              </>
            )}

            <Route path="/login" element={<Navigate to="/" />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default App;
