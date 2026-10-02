import { useState } from 'react';

export default function Login({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try { await onLogin(email, password); }
    catch (err: any) { setError(err.message || 'Error de autenticación'); }
    finally { setLoading(false); }
  };

  return (
    <main className="relative isolate min-h-screen min-h-[100svh] overflow-hidden bg-mahana-900 flex items-center justify-center px-4 py-8 sm:p-8 md:justify-start lg:px-[8vw]">
      <img src="/hotel-panama-canal-facade.webp" alt="" aria-hidden="true"
        className="absolute inset-0 -z-30 h-full w-full object-cover object-center" />
      <img src="/hotel-panama-canal-login.webp" alt="" aria-hidden="true"
        className="absolute inset-0 -z-20 h-full w-full object-contain object-center md:object-right lg:object-[85%_center]" fetchPriority="high" />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-r from-mahana-900/35 via-transparent to-black/10" />
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md md:max-w-sm lg:max-w-md p-6 sm:p-8 ring-1 ring-white/20">
        <div className="text-center mb-8">
          <img src="/hotel-panama-canal-reference.jpg" alt="Hotel Panamá Canal" width="96" height="96" className="mx-auto mb-4 rounded-xl" />

          <h1 className="text-2xl font-bold text-gray-800">Hotel Panamá Canal</h1>
          <p className="text-gray-500 text-sm mt-1">Sistema de Gestión Hotelera</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg">{error}</div>}
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-gray-600 mb-1">Email</label>
            <input id="login-email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 focus:border-transparent outline-none transition" placeholder="admin@example.invalid" />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-gray-600 mb-1">Contraseña</label>
            <input id="login-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 focus:border-transparent outline-none transition" placeholder="••••••••" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-mahana-500 to-mahana-600 text-white font-semibold rounded-xl hover:shadow-lg transform hover:-translate-y-0.5 transition disabled:opacity-50">
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </div>
    </main>
  );
}
