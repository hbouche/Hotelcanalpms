import { useState, useRef, useEffect } from 'react';
import { Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle, RefreshCw, ArrowRight, Download, Info, X, Users, CalendarDays } from 'lucide-react';
import { api } from '../api/client';

interface PreviewRow {
  row: number;
  status: string;
  guest?: string;
  dates?: string;
  room?: string;
  total?: number;
  estado?: string;
  email?: string;
  pais?: string;
  total_reservas?: number;
  total_ingresos?: number;
  noches?: number;
  errors?: string[];
  warnings?: string[];
  existingId?: number;
}

interface ImportResult {
  type?: 'guests' | 'reservations';
  filename: string;
  total_rows?: number;
  headers?: string[];
  mapping?: Record<string, string>;
  unmapped?: string[];
  preview?: PreviewRow[];
  summary: {
    will_import?: number;
    imported?: number;
    duplicates: number;
    errors: number;
    total?: number;
  };
  details?: PreviewRow[];
}

interface ImportStats {
  total_imported: number;
  last_import: string | null;
  guests_imported: number;
  last_guest_import: string | null;
}

export default function ImportarDatos() {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<'upload' | 'preview' | 'importing' | 'done'>('upload');
  const [importType, setImportType] = useState<'auto' | 'guests' | 'reservations'>('auto');
  const [detectedType, setDetectedType] = useState<'guests' | 'reservations'>('reservations');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<ImportStats | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get('/admin/import/stats').then(r => setStats(r.data)).catch(() => {});
  }, []);

  const handleFile = (f: File) => {
    const validExts = ['.csv', '.xlsx', '.xls', '.tsv'];
    const ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase();
    if (!validExts.includes(ext)) {
      setError('Formato no soportado. Usa CSV, XLSX, XLS o TSV.');
      return;
    }
    setFile(f);
    setError('');
    setPreview(null);
    setResult(null);
    setPhase('upload');
    // Auto-detect type from filename
    const name = f.name.toLowerCase();
    if (name.includes('guest') || name.includes('huesped') || name.includes('huésped') || name.includes('cliente')) {
      setImportType('guests');
    } else if (name.includes('reserv') || name.includes('booking')) {
      setImportType('reservations');
    } else {
      setImportType('auto');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
  };

  const handlePreview = async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('archivo', file);

      // Try guests first, then reservations
      let useGuestEndpoint = importType === 'guests';
      if (importType === 'auto') {
        // Try guests endpoint first (it will fail gracefully if not a guest file)
        try {
          const r = await api.post('/admin/import/guests/preview', form, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });
          if (r.data?.type === 'guests') {
            useGuestEndpoint = true;
          }
        } catch (e) {
          useGuestEndpoint = false;
        }
      }

      if (useGuestEndpoint) {
        const form2 = new FormData();
        form2.append('archivo', file);
        const r = await api.post('/admin/import/guests/preview', form2, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        setPreview(r.data);
        setDetectedType('guests');
      } else {
        const form2 = new FormData();
        form2.append('archivo', file);
        const r = await api.post('/admin/import/preview', form2, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        setPreview(r.data);
        setDetectedType('reservations');
      }
      setPhase('preview');
    } catch (e: any) {
      setError(e.response?.data?.error?.message || 'Error procesando archivo');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setPhase('importing');
    setLoading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('archivo', file);
      const endpoint = detectedType === 'guests' ? '/admin/import/guests/execute' : '/admin/import/execute';
      const r = await api.post(endpoint, form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setResult(r.data);
      setPhase('done');
      api.get('/admin/import/stats').then(r => setStats(r.data)).catch(() => {});
    } catch (e: any) {
      setError(e.response?.data?.error?.message || 'Error importando datos');
      setPhase('preview');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError('');
    setPhase('upload');
    setImportType('auto');
    if (fileRef.current) fileRef.current.value = '';
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'preview':
      case 'imported': return <CheckCircle2 size={16} className="text-green-500" />;
      case 'duplicate': return <AlertTriangle size={16} className="text-amber-500" />;
      case 'error': return <XCircle size={16} className="text-red-500" />;
      default: return null;
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'preview': return 'Listo';
      case 'imported': return 'Importado';
      case 'duplicate': return 'Duplicado';
      case 'error': return 'Error';
      default: return status;
    }
  };

  const isGuests = detectedType === 'guests';
  const itemLabel = isGuests ? 'Huéspedes' : 'Reservas';

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Importar Datos</h1>
          <p className="text-sm text-gray-500 mt-1">Cargar historial desde Cloudbeds (CSV / Excel)</p>
        </div>
        {stats && (stats.total_imported > 0 || stats.guests_imported > 0) && (
          <div className="text-right text-sm text-gray-500 space-y-1">
            {stats.guests_imported > 0 && (
              <div className="flex items-center gap-2 justify-end">
                <Users size={14} className="text-mahana-500" />
                <span className="font-medium text-gray-700">{stats.guests_imported.toLocaleString()} huéspedes</span>
              </div>
            )}
            {stats.total_imported > 0 && (
              <div className="flex items-center gap-2 justify-end">
                <CalendarDays size={14} className="text-ocean-500" />
                <span className="font-medium text-gray-700">{stats.total_imported} reservas</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex gap-3">
          <Info size={20} className="text-blue-600 shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800 space-y-2">
            <p className="font-semibold">Archivos soportados de Cloudbeds:</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-white/60 rounded-lg p-3">
                <div className="flex items-center gap-2 font-semibold text-blue-900 mb-1">
                  <Users size={16} /> Directorio de Huéspedes
                </div>
                <p className="text-xs">Cloudbeds → Guests → Export<br />Contiene: nombre, email, país, total reservas, ingresos</p>
              </div>
              <div className="bg-white/60 rounded-lg p-3">
                <div className="flex items-center gap-2 font-semibold text-blue-900 mb-1">
                  <CalendarDays size={16} /> Reservas
                </div>
                <p className="text-xs">Cloudbeds → Reservations → Export<br />Contiene: check-in, check-out, habitación, status, total</p>
              </div>
            </div>
            <p className="text-blue-600 text-xs">El sistema detecta automáticamente el tipo de archivo 🔍</p>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <XCircle size={20} className="text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm font-medium text-red-800">{error}</p>
          <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600"><X size={18} /></button>
        </div>
      )}

      {/* Upload Zone */}
      {phase === 'upload' && (
        <div
          className={`border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer
            ${dragging ? 'border-mahana-500 bg-mahana-50' : file ? 'border-green-300 bg-green-50' : 'border-gray-300 hover:border-mahana-400 hover:bg-mahana-50/50'}`}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.tsv" className="hidden"
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          {file ? (
            <div className="space-y-3">
              <FileSpreadsheet size={48} className="mx-auto text-green-500" />
              <div>
                <p className="text-lg font-semibold text-gray-800">{file.name}</p>
                <p className="text-sm text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                {importType !== 'auto' && (
                  <p className="text-xs text-mahana-600 mt-1 font-medium">
                    Detectado: {importType === 'guests' ? '👥 Directorio de Huéspedes' : '📅 Reservas'}
                  </p>
                )}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handlePreview(); }}
                disabled={loading}
                className="px-6 py-2.5 bg-mahana-600 text-white rounded-lg hover:bg-mahana-700 disabled:opacity-50 font-medium inline-flex items-center gap-2"
              >
                {loading ? <RefreshCw size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                {loading ? 'Analizando...' : 'Analizar Archivo'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <Upload size={48} className="mx-auto text-gray-400" />
              <div>
                <p className="text-lg font-medium text-gray-600">Arrastra tu archivo aquí</p>
                <p className="text-sm text-gray-400">o haz click para seleccionar</p>
              </div>
              <p className="text-xs text-gray-400">Formatos: CSV, XLSX, XLS, TSV · Máx 50MB</p>
            </div>
          )}
        </div>
      )}

      {/* Preview Phase */}
      {phase === 'preview' && preview && (
        <div className="space-y-4">
          {/* Type Detection Banner */}
          <div className={`rounded-xl p-4 flex items-center gap-3 ${isGuests ? 'bg-purple-50 border border-purple-200' : 'bg-ocean-50 border border-ocean-200'}`}>
            {isGuests ? <Users size={24} className="text-purple-600" /> : <CalendarDays size={24} className="text-ocean-600" />}
            <div>
              <p className={`font-semibold ${isGuests ? 'text-purple-800' : 'text-ocean-800'}`}>
                {isGuests ? '👥 Directorio de Huéspedes' : '📅 Reservas de Hotel'}
              </p>
              <p className={`text-xs ${isGuests ? 'text-purple-600' : 'text-ocean-600'}`}>
                {isGuests
                  ? `${preview.total_rows?.toLocaleString()} huéspedes con datos de contacto, estadías e ingresos`
                  : `${preview.total_rows?.toLocaleString()} reservas con fechas, habitaciones y montos`
                }
              </p>
            </div>
          </div>

          {/* Mapping Info */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <FileSpreadsheet size={20} className="text-mahana-600" />
              Mapeo de Columnas Detectado
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
              {Object.entries(preview.mapping || {}).map(([pmsField, cbHeader]) => (
                <div key={pmsField} className="flex items-center gap-2 bg-green-50 rounded-lg px-3 py-1.5">
                  <CheckCircle2 size={14} className="text-green-500 shrink-0" />
                  <span className="text-gray-500 truncate">{String(cbHeader)}</span>
                  <ArrowRight size={12} className="text-gray-400 shrink-0" />
                  <span className="font-medium text-gray-700">{pmsField}</span>
                </div>
              ))}
            </div>
            {preview.unmapped && preview.unmapped.length > 0 && (
              <div className="text-sm text-gray-500">
                <span className="font-medium">No mapeadas:</span> {preview.unmapped.join(', ')}
              </div>
            )}
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-green-600">{(preview.summary.will_import || 0).toLocaleString()}</div>
              <div className="text-sm text-gray-500">Listos para importar</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-amber-500">{(preview.summary.duplicates || 0).toLocaleString()}</div>
              <div className="text-sm text-gray-500">Duplicados (se omiten)</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-red-500">{(preview.summary.errors || 0).toLocaleString()}</div>
              <div className="text-sm text-gray-500">Con errores</div>
            </div>
          </div>

          {/* Preview Table */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">Preview (primeras {preview.preview?.length || 0} de {preview.total_rows?.toLocaleString()} filas)</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-2 text-left text-gray-500 font-medium">#</th>
                    <th className="px-4 py-2 text-left text-gray-500 font-medium">Estado</th>
                    <th className="px-4 py-2 text-left text-gray-500 font-medium">Nombre</th>
                    {isGuests ? (
                      <>
                        <th className="px-4 py-2 text-left text-gray-500 font-medium">Email</th>
                        <th className="px-4 py-2 text-left text-gray-500 font-medium">País</th>
                        <th className="px-4 py-2 text-center text-gray-500 font-medium">Reservas</th>
                        <th className="px-4 py-2 text-right text-gray-500 font-medium">Ingresos</th>
                      </>
                    ) : (
                      <>
                        <th className="px-4 py-2 text-left text-gray-500 font-medium">Fechas</th>
                        <th className="px-4 py-2 text-left text-gray-500 font-medium">Habitación</th>
                        <th className="px-4 py-2 text-right text-gray-500 font-medium">Total</th>
                        <th className="px-4 py-2 text-left text-gray-500 font-medium">Status</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(preview.preview || []).map((row, i) => (
                    <tr key={i} className={row.status === 'error' ? 'bg-red-50/50' : row.status === 'duplicate' ? 'bg-amber-50/50' : ''}>
                      <td className="px-4 py-2 text-gray-400">{row.row}</td>
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center gap-1">
                          {statusIcon(row.status)}
                          <span className="text-xs">{statusLabel(row.status)}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2 font-medium text-gray-800">{row.guest || '—'}</td>
                      {isGuests ? (
                        <>
                          <td className="px-4 py-2 text-gray-600 text-xs">{(row as any).email || '—'}</td>
                          <td className="px-4 py-2 text-gray-600">{(row as any).pais || '—'}</td>
                          <td className="px-4 py-2 text-center text-gray-700">{(row as any).total_reservas || '—'}</td>
                          <td className="px-4 py-2 text-right text-gray-700 font-medium">
                            {(row as any).total_ingresos ? `$${Number((row as any).total_ingresos).toFixed(2)}` : '—'}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{row.dates || '—'}</td>
                          <td className="px-4 py-2 text-gray-600">{row.room || '—'}</td>
                          <td className="px-4 py-2 text-right text-gray-700 font-medium">{row.total ? `$${row.total.toFixed(2)}` : '—'}</td>
                          <td className="px-4 py-2">
                            {row.estado && <span className={`text-xs px-2 py-0.5 rounded-full ${
                              row.estado === 'Confirmada' ? 'bg-green-100 text-green-700' :
                              row.estado === 'Hospedado' ? 'bg-blue-100 text-blue-700' :
                              row.estado === 'Check-Out' ? 'bg-gray-100 text-gray-700' :
                              row.estado === 'Cancelada' ? 'bg-red-100 text-red-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>{row.estado}</span>}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-between items-center">
            <button onClick={reset} className="px-4 py-2 text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
              ← Empezar de nuevo
            </button>
            {(preview.summary.will_import || 0) > 0 && (
              <button onClick={handleImport} disabled={loading}
                className={`px-6 py-2.5 text-white rounded-lg font-medium inline-flex items-center gap-2 shadow-lg
                  ${isGuests ? 'bg-purple-600 hover:bg-purple-700 shadow-purple-600/20' : 'bg-green-600 hover:bg-green-700 shadow-green-600/20'}
                  disabled:opacity-50`}>
                {loading ? <RefreshCw size={18} className="animate-spin" /> : <Download size={18} />}
                Importar {(preview.summary.will_import || 0).toLocaleString()} {itemLabel}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Importing Phase */}
      {phase === 'importing' && (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <RefreshCw size={48} className="mx-auto text-mahana-500 animate-spin mb-4" />
          <p className="text-lg font-semibold text-gray-800">Importando {itemLabel.toLowerCase()}...</p>
          <p className="text-sm text-gray-500 mt-2">Esto puede tomar unos segundos. No cierres esta página.</p>
        </div>
      )}

      {/* Done Phase */}
      {phase === 'done' && result && (
        <div className="space-y-4">
          <div className={`rounded-xl p-6 text-center ${isGuests ? 'bg-purple-50 border border-purple-200' : 'bg-green-50 border border-green-200'}`}>
            <CheckCircle2 size={48} className={`mx-auto mb-3 ${isGuests ? 'text-purple-500' : 'text-green-500'}`} />
            <h2 className={`text-xl font-bold ${isGuests ? 'text-purple-800' : 'text-green-800'}`}>¡Importación Completada!</h2>
            <p className={`text-sm mt-1 ${isGuests ? 'text-purple-600' : 'text-green-600'}`}>{result.filename}</p>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-gray-800">{(result.summary.total || 0).toLocaleString()}</div>
              <div className="text-sm text-gray-500">Total en archivo</div>
            </div>
            <div className={`bg-white rounded-xl p-4 text-center ${isGuests ? 'border border-purple-200' : 'border border-green-200'}`}>
              <div className={`text-3xl font-bold ${isGuests ? 'text-purple-600' : 'text-green-600'}`}>{(result.summary.imported || 0).toLocaleString()}</div>
              <div className="text-sm text-gray-500">Importados ✓</div>
            </div>
            <div className="bg-white border border-amber-200 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-amber-500">{(result.summary.duplicates || 0).toLocaleString()}</div>
              <div className="text-sm text-gray-500">Duplicados</div>
            </div>
            <div className="bg-white border border-red-200 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-red-500">{(result.summary.errors || 0).toLocaleString()}</div>
              <div className="text-sm text-gray-500">Errores</div>
            </div>
          </div>

          {result.details && result.details.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">Detalle (primeros {result.details.length})</h3>
              </div>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0">
                    <tr className="bg-gray-50">
                      <th className="px-4 py-2 text-left text-gray-500 font-medium">#</th>
                      <th className="px-4 py-2 text-left text-gray-500 font-medium">Resultado</th>
                      <th className="px-4 py-2 text-left text-gray-500 font-medium">Nombre</th>
                      {isGuests ? (
                        <>
                          <th className="px-4 py-2 text-left text-gray-500 font-medium">Email</th>
                          <th className="px-4 py-2 text-left text-gray-500 font-medium">País</th>
                          <th className="px-4 py-2 text-right text-gray-500 font-medium">Ingresos</th>
                        </>
                      ) : (
                        <>
                          <th className="px-4 py-2 text-left text-gray-500 font-medium">Fechas</th>
                          <th className="px-4 py-2 text-right text-gray-500 font-medium">Total</th>
                          <th className="px-4 py-2 text-left text-gray-500 font-medium">ID</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {result.details.map((row, i) => (
                      <tr key={i} className={row.status === 'error' ? 'bg-red-50/50' : row.status === 'duplicate' ? 'bg-amber-50/50' : ''}>
                        <td className="px-4 py-2 text-gray-400">{row.row}</td>
                        <td className="px-4 py-2">
                          <span className="inline-flex items-center gap-1">
                            {statusIcon(row.status)}
                            <span className="text-xs font-medium">{statusLabel(row.status)}</span>
                          </span>
                        </td>
                        <td className="px-4 py-2 font-medium text-gray-800">{row.guest || '—'}</td>
                        {isGuests ? (
                          <>
                            <td className="px-4 py-2 text-gray-600 text-xs">{(row as any).email || '—'}</td>
                            <td className="px-4 py-2 text-gray-600">{(row as any).pais || '—'}</td>
                            <td className="px-4 py-2 text-right text-gray-700">{(row as any).total_ingresos ? `$${Number((row as any).total_ingresos).toFixed(2)}` : '—'}</td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{row.dates || '—'}</td>
                            <td className="px-4 py-2 text-right text-gray-700">{row.total ? `$${row.total.toFixed(2)}` : '—'}</td>
                            <td className="px-4 py-2 text-gray-500">{(row as any).reservaId || '—'}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-between items-center">
            <button onClick={reset} className="px-4 py-2 text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
              ← Importar otro archivo
            </button>
            <a href={isGuests ? '/' : '/reservas'}
              className="px-6 py-2.5 bg-mahana-600 text-white rounded-lg hover:bg-mahana-700 font-medium inline-flex items-center gap-2">
              {isGuests ? 'Ir al Dashboard' : 'Ver Reservas'} →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
