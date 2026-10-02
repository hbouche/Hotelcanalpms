import { useState } from 'react';
import { Hotel } from 'lucide-react';

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
    <div className="min-h-screen bg-gradient-to-br from-mahana-400 via-mahana-500 to-ocean-600 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <img src="/hotel-panama-canal-reference.jpg" alt="Hotel Panamá Canal" width="96" height="96" className="mx-auto mb-4 rounded-xl" />

          <h1 className="text-2xl font-bold text-gray-800">Hotel Panamá Canal</h1>
          <p className="text-gray-400 text-sm mt-1">Sistema de Gestión Hotelera</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 focus:border-transparent outline-none transition" placeholder="admin@example.invalid" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Contraseña</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 focus:border-transparent outline-none transition" placeholder="••••••••" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-mahana-500 to-mahana-600 text-white font-semibold rounded-xl hover:shadow-lg transform hover:-translate-y-0.5 transition disabled:opacity-50">
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
