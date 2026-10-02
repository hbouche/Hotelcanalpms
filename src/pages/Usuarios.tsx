import { useState, useEffect } from 'react';
import { Plus, Search, Edit, UserCheck, UserX, Shield, Trash2, Mail, Users } from 'lucide-react';
import { api } from '../api/client';

interface User {
  id: number;
  email: string;
  nombre: string;
  rol: 'admin' | 'receptionist' | 'cleaning';
  activo: number;
  created_at: string;
}

export default function Usuarios() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  
  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  
  // Form fields
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState<'admin' | 'receptionist' | 'cleaning'>('cleaning');
  const [activo, setActivo] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const loadUsers = () => {
    setLoading(true);
    const params: any = {};
    if (search) params.search = search;
    
    api.get('/admin/usuarios', { params })
      .then(r => {
        setUsers(r.data || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      loadUsers();
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Open modal for adding
  const handleOpenAdd = () => {
    setEditingUser(null);
    setNombre('');
    setEmail('');
    setPassword('');
    setRol('cleaning');
    setActivo(true);
    setErrorMsg('');
    setIsModalOpen(true);
  };

  // Open modal for editing
  const handleOpenEdit = (u: User) => {
    setEditingUser(u);
    setNombre(u.nombre);
    setEmail(u.email);
    setPassword(''); // blank initially
    setRol(u.rol);
    setActivo(u.activo === 1);
    setErrorMsg('');
    setIsModalOpen(true);
  };

  // Toggle status switch
  const handleToggleActive = async (u: User) => {
    const newStatus = u.activo === 1 ? 0 : 1;
    
    // Optimistic update
    setUsers(prev => prev.map(item => item.id === u.id ? { ...item, activo: newStatus } : item));
    
    try {
      await api.put(`/admin/usuarios/${u.id}`, { activo: newStatus });
    } catch (err: any) {
      // Revert if failed
      setUsers(prev => prev.map(item => item.id === u.id ? { ...item, activo: u.activo } : item));
      alert(err.response?.data?.error?.message || 'Error al cambiar estado del usuario');
    }
  };

  // Handle submit form
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSaving(true);
    
    try {
      const payload: any = {
        nombre,
        email,
        rol,
        activo: activo ? 1 : 0
      };
      
      if (editingUser) {
        if (password) {
          payload.password = password;
        }
        await api.put(`/admin/usuarios/${editingUser.id}`, payload);
      } else {
        if (!password) {
          setErrorMsg('La contraseña es requerida para nuevos usuarios');
          setSaving(false);
          return;
        }
        payload.password = password;
        await api.post('/admin/usuarios', payload);
      }
      
      setIsModalOpen(false);
      loadUsers();
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || 'Error al guardar el usuario';
      if (msg.includes('duplicate') || msg.toLowerCase().includes('ya existe')) {
        setErrorMsg('El correo electrónico ingresado ya se encuentra registrado');
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  // Filter users in frontend by selected role
  const filteredUsers = users.filter(u => {
    if (roleFilter === 'all') return true;
    return u.rol === roleFilter;
  });

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'admin':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-red-50 text-red-700 border border-red-100 flex items-center gap-1 w-fit"><Shield size={12} /> Administrador</span>;
      case 'receptionist':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-50 text-blue-700 border border-blue-100 flex items-center gap-1 w-fit"><Users size={12} /> Recepcionista</span>;
      case 'cleaning':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-green-50 text-green-700 border border-green-100 flex items-center gap-1 w-fit"><UserCheck size={12} /> Limpieza</span>;
      default:
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-gray-50 text-gray-700 border border-gray-100 w-fit">{role}</span>;
    }
  };

  const getInitials = (name: string) => {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length > 1) {
      return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    }
    return parts[0].substring(0, 2).toUpperCase();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Users size={28} className="text-mahana-600" /> Gestión de Personal
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Administra los usuarios del sistema, sus roles de acceso y su estado de actividad.
          </p>
        </div>
        <button
          onClick={handleOpenAdd}
          className="px-4 py-2.5 bg-gradient-to-r from-mahana-500 to-mahana-600 text-white font-semibold rounded-xl hover:shadow-lg transform hover:-translate-y-0.5 transition flex items-center gap-2 justify-center w-full sm:w-auto"
        >
          <Plus size={18} /> Agregar Usuario
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 border border-gray-200 rounded-xl flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar usuario por nombre o correo..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-mahana-200 focus:border-mahana-400 outline-none"
          />
        </div>
        <div className="w-full md:w-64">
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-mahana-200 focus:border-mahana-400 outline-none bg-white"
          >
            <option value="all">Todos los roles</option>
            <option value="admin">Administrador</option>
            <option value="receptionist">Recepcionista</option>
            <option value="cleaning">Limpieza</option>
          </select>
        </div>
      </div>

      {/* Table grid */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-12 text-center text-gray-400 animate-pulse">Cargando personal...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-12 text-center text-gray-400 flex flex-col items-center justify-center gap-2">
            <UserX size={48} className="text-gray-300" />
            <span>No se encontraron usuarios</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 font-medium">
                  <th className="px-6 py-4 text-left font-medium">Nombre</th>
                  <th className="px-6 py-4 text-left font-medium">Correo Electrónico</th>
                  <th className="px-6 py-4 text-left font-medium">Rol</th>
                  <th className="px-6 py-4 text-center font-medium w-32">Estado</th>
                  <th className="px-6 py-4 text-right font-medium w-32">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredUsers.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50/50 transition">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-mahana-500 to-ocean-500 flex items-center justify-center text-white text-sm font-bold shadow-sm">
                          {getInitials(u.nombre)}
                        </div>
                        <div>
                          <div className="font-semibold text-gray-800">{u.nombre}</div>
                          <div className="text-xs text-gray-400">ID: #{u.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-gray-600">
                        <Mail size={14} className="text-gray-400" />
                        <span>{u.email}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {getRoleBadge(u.rol)}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center">
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={u.activo === 1}
                            onChange={() => handleToggleActive(u)}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                          <span className="ml-2 text-xs font-medium text-gray-600 hidden sm:inline">
                            {u.activo === 1 ? 'Activo' : 'Inactivo'}
                          </span>
                        </label>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleOpenEdit(u)}
                        className="p-2 text-gray-400 hover:text-mahana-600 hover:bg-mahana-50 rounded-lg transition"
                        title="Editar usuario"
                      >
                        <Edit size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden transform transition-all animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-gradient-to-r from-mahana-500 to-mahana-600 px-6 py-4 text-white flex justify-between items-center">
              <h2 className="font-bold text-lg flex items-center gap-2">
                {editingUser ? <Edit size={20} /> : <Plus size={20} />}
                {editingUser ? 'Editar Colaborador' : 'Agregar Colaborador'}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-white/80 hover:text-white text-xl outline-none"
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {errorMsg && (
                <div className="bg-red-50 text-red-600 text-xs px-4 py-3 rounded-lg border border-red-100">
                  {errorMsg}
                </div>
              )}
              
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Nombre Completo
                </label>
                <input
                  type="text"
                  required
                  value={nombre}
                  onChange={e => setNombre(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 focus:border-transparent outline-none transition text-sm"
                  placeholder="Ej. Juan Pérez"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Correo Electrónico
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 focus:border-transparent outline-none transition text-sm"
                  placeholder="ejemplo@example.invalid"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Contraseña
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required={!editingUser}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 focus:border-transparent outline-none transition text-sm"
                  placeholder={editingUser ? 'Dejar en blanco para conservar actual' : '••••••••'}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Rol de Acceso
                </label>
                <select
                  value={rol}
                  onChange={e => setRol(e.target.value as any)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mahana-400 focus:border-transparent outline-none transition text-sm bg-white"
                >
                  <option value="admin">Administrador</option>
                  <option value="receptionist">Recepcionista</option>
                  <option value="cleaning">Limpieza</option>
                </select>
              </div>

              <div className="flex items-center pt-2">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={activo}
                    onChange={e => setActivo(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                  <span className="ml-3 text-sm font-semibold text-gray-600">
                    Estado Inicial: {activo ? 'Activo' : 'Inactivo'}
                  </span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-sm font-semibold text-gray-500 hover:text-gray-700 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 bg-gradient-to-r from-mahana-500 to-mahana-600 text-white text-sm font-semibold rounded-xl hover:shadow-lg transform hover:-translate-y-0.5 transition disabled:opacity-50"
                >
                  {saving ? 'Guardando...' : editingUser ? 'Guardar Cambios' : 'Crear Colaborador'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
