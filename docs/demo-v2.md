> HISTORICAL / SUPERSEDED: HB now requests the normal `/reservar` engine. See normal-web-preload.md. The isolated design below is retained only as prior implementation history.

# Catálogo y reservas DEMO aisladas

La petición de HB del 6 octubre 2026 sustituye el paquete previo de tres categorías: dos productos de habitación a USD 100 por habitación/noche y un pasadía a USD 38.50 por persona/día. Son ejemplos ficticios sin vigencia comercial, impuestos e inclusiones por confirmar. Las cuatro imágenes conceptuales aprobadas se integran como WebP verificados contra los blobs del repositorio, con avisos de concepto IA. Se conservan composición y precios DEMO; ambas habitaciones son vistas de una misma referencia histórica, no evidencia de dos tipologías actuales. La retirada usa una única lista de seis assets y sustituye todos por cero bytes.

## Aislamiento

Mismo PMS/repo/servicio existente, sin nuevas cuentas, servicios ni credenciales. Archivo independiente `DATA_DIR/demo/hotel-canal-demo-v2.db`. Tablas exclusivamente `demo_*`; nunca se usa `getDb()` del hotel ni sus tablas, scheduler, notificaciones, contabilidad, huéspedes, pagos o webhooks. La base operativa no cambia de ruta, esquema ni datos. Archivo con permisos privados y fuera de los archivos estáticos públicos.

Precarga aditiva determinista en transacción: 20 unidades ficticias (10 A, 10 B), tres productos (dos alojamiento y pasadía), seis reservas y tres créditos ficticios reconciliados con los nuevos precios. Reiniciar no duplica ni reemplaza filas. La versión del catálogo impide migraciones implícitas futuras. Capacidades de ensayo A=2, B=4, pasadía=6; no son aforos comerciales.

Rutas nuevas `/api/v1/demo/catalog`, POST `/api/v1/demo/reservations`, GET/DELETE `/api/v1/demo/reservations/:id`. Solo producto, fechas, personas e identificador de idempotencia. Se rechazan campos personales/adicionales. UUIDs de referencias ficticias; no se crean usuarios ni tokens de acceso al hotel. No hay listados de reservas ajenas ni de las semillas. Máximo 500 reservas adicionales para limitar almacenamiento; límites de capacidad, fechas dentro de un año y estadías de hasta 30 noches. La cancelación persiste y libera solamente inventario DEMO.

`/reservar?demo=1` carga estos productos, guarda una reserva DEMO en el servidor, la recupera al recargar y permite cancelarla. Conserva solamente su referencia ficticia en el navegador. No se presenta una simulación en memoria como reserva persistente. Las rutas normales conservan su comportamiento.

## Validación y despliegue

Pruebas Node22: `node --test server/tests/demo-isolation.test.js`. Cubren backup SQLite nativo/restauración sobre la copia, reapertura, semilla idempotente, reintentos, cambios de payload, disponibilidad, límites, rechazo de datos personales, cancelación repetida e independencia del archivo operativo sintético. `npm run build` y validación de las cinco páginas estáticas. QA de navegador a 1440, 768, 390 y 320 px, reserva/recarga/cancelación persistentes contra la API DEMO aislada local. No se leen datos de huéspedes ni accesos reales.

Antes del despliegue del PMS, actualizar el backup operativo DB-only usando el Shell Render existente: `node server/scripts/backup.js --database-only --output /var/data/hotel-backups/pre-demo-v2-<UTC-NUEVO>.sqlite`; conservar su SHA256 e integridad. No incluye uploads. No restaurar una copia antigua sobre datos operativos posteriores.

Desplegar primero el PMS existente con autoDeploy desactivado; consultar catálogo para materializar la base DEMO y comprobar una reserva ficticia, GET, reintento y cancelación. Después desplegar el mismo Static Site para mostrar los productos/precios y enlaces DEMO. Ningún archivo de foto cambia.

Reversión: rollback al commit anterior elimina las rutas/UI DEMO y deja el archivo independiente intacto para recuperación; no restaura ni modifica la base del hotel. Si se necesita borrar la prueba, respaldar primero su archivo propio y verificar el destino exacto; no borrar por prefijos, no tocar `hotel-canal.db`, uploads ni backups operativos. El paquete anterior bajo `proposal/demo` queda como referencia histórica, no se importa.
