# Hotel Panamá Canal PMS

Independent, sanitized application copy for Hotel Panamá Canal. The source project remains unchanged. This repository starts its own Git history and contains application code and isolated test fixtures, not a copy of hotel operating records.

## Stack
React 18, TypeScript, Vite 5 and Tailwind frontend; Express 4 / Node.js backend; SQLite (`better-sqlite3`). One Node web service serves the frontend and API. The database schema has 22 tables for hotel operations, CRM, configuration and auditing.

## Clean starting state
- No reservations, guests, leads, payments, documents, API keys or webhooks are copied
- Rooms, rate plans, additional services and holidays start empty; create the hotel's actual inventory in the PMS
- Hotel name: Hotel Panamá Canal. Contact details and policies await the hotel's confirmation
- Temporary neutral brand placeholder; replace it with the hotel's approved logo before use
- No inherited bank account, Yappy destination or payment instructions
- Card/PayPal collection is disabled. Core reservation requests work after actual rooms/rates are configured; clients cannot declare online payment amounts
- Email, WhatsApp, CRM integrations and outbound webhooks remain disabled until the new hotel's accounts/credentials, recipients and tests are authorized
- No built-in production administrator password. Initial administrator credentials must be supplied by the operator through secure hosting settings
- Source-specific operational scripts, lead exports, screenshots, private work notes, database files and source Git history are excluded
- Automated tests use isolated, fictional fixtures under `NODE_ENV=test`; these fixtures are not loaded in normal operation

## Local setup
Use Node 22 LTS and npm. Run `npm ci --include=dev`, then `npm run build`. Set the environment variables below and run `npm start`. For frontend development, run `npm run dev` in a second terminal. The API defaults to port 3201 and Vite to 3200.

Production environment variables:
- `NODE_ENV=production`
- `JWT_SECRET`: a long, unique signing secret; the Render Blueprint generates it privately when the operator creates the service
- `INITIAL_ADMIN_EMAIL`: operator-chosen initial admin email; trimmed, lowercased and validated when the first administrator is created
- `INITIAL_ADMIN_PASSWORD`: operator-chosen password of at least 8 characters, used only to create the first administrator
- `ALLOWED_ORIGINS`: optional explicit origin list for custom domains; on Render the app defaults to its assigned `RENDER_EXTERNAL_URL`. Without either, production does not enable cross-origin access.
- `EXTERNAL_INTEGRATIONS_ENABLED=false`
- `CARD_PAYMENTS_ENABLED=false`
- `DATA_DIR=/var/data/hotel-panama-canal` on the configured Render disk

Initial credentials are consumed only when no users exist; changing these variables does not reset an existing user's password. Secrets must never be committed or shared in chat. If initial credentials are absent, the database has no login user. `.env.example` documents variables; environment files are not automatically loaded by this application.

## Staff access
The existing roles are enforced by the API as well as the navigation:
- `admin`: hotel operations, guest records, payments/reports and administrator configuration, user management and protected approval actions
- `receptionist`: reservations/check-in/check-out, guest records/documents, CRM, manual payment entries and operating reports; existing administrator-only changes remain restricted
- `cleaning`: current occupancy and arrivals/departures counts, an anonymous room calendar, room details relevant to cleaning, do-not-disturb flags, and individual/bulk cleaning-state updates. Guest identities/contacts, reservation notes, documents, financial data, room comments/assignees, reservation changes and general room editing are not available to this role

Every authenticated user request reloads the current account status, role and profile from the database. Role changes and deactivation apply to previously issued tokens on their next request. API keys keep their explicit read/write/admin scopes; read keys cannot modify operational or housekeeping data. Keys and external integrations remain disabled for normal setup until separately authorized.

Public booking information remains public; housekeeping access does not grant additional private booking or guest information. Select each person's actual role before creating their account. There are no pre-created hotel staff accounts.

## Render persistent deployment
`render.yaml` defines the approved scope: one Starter Node Web Service, one 1 GB persistent disk mounted at `/var/data`, and `DATA_DIR=/var/data/hotel-panama-canal`. Automatic service deployments are off; also disable automatic Blueprint synchronization in the Dashboard. The base price is USD 7.25/month plus applicable taxes and approved workspace bandwidth overages. Confirm actual checkout details before activation. The operator enters the initial admin email and password in Render and submits the Blueprint, which also creates the private signing secret. This file does not deploy or purchase anything by itself.

Build: `npm ci --include=dev && npm run build`

Start: `npm start`

Health: `/health`

SQLite, its WAL files, uploads and diagnostic logs use the same explicit `DATA_DIR`. SQLite uses WAL with `synchronous=FULL`. Without `DATA_DIR`, local development uses the repository's ignored `data/` directory; it never adopts an unrelated `/data` mount. A separate per-database SQLite lease prevents simultaneous PMS instances and full backup/restore operations and is released by the OS after a crash. Keep a single application process and a single instance on this local disk.

The mounted disk preserves data across ordinary restarts and deploys. It does not protect against deletion, corruption or account/disk loss. Only paths below the mount persist. Render disk-backed services cannot scale to multiple instances and deploy with a brief interruption; the disk is unavailable during builds, pre-deploy steps and one-off jobs. Monitor the 1 GB usage in Render. Diagnostic file logs rotate at 5 MiB (three files each for error/combined, two for notifications); database audit/history and uploads still grow and need an operator retention policy. Never expand the disk or plan automatically beyond the approved budget.

Official references: [Persistent disks and limitations](https://render.com/docs/disks), [Blueprint specification](https://render.com/docs/blueprint-spec), [Pricing](https://render.com/pricing).

This is a durable single-instance foundation, not a claim of production readiness. Before real guest use, complete operator acceptance tests, access/privacy review, an encrypted offsite backup destination and retention schedule, a successful recovery rehearsal, and hotel policy/inventory setup. This code uses SQLite; supplying `DATABASE_URL` does not add PostgreSQL support.

## Backup and recovery
Persistence is not a backup. The repository includes explicit operator-run tools, with no automatic upload, schedule, external account, credentials or additional paid resources. Backups contain private hotel records, password hashes and guest files; configuration may also contain sensitive integration values if later enabled. Keep them encrypted, restrict access, never commit them or share them in chat. Hosting environment secrets are excluded and must remain separately available in the operator's secure hosting settings.

### Online database-only copy
Run `node server/scripts/backup.js --database-only --output /tmp/hotel-canal-database-YYYYMMDD.sqlite` in the service shell. It uses SQLite's native online backup API, including committed WAL records, and checks SQLite integrity/foreign keys. It can run while the PMS is open. It excludes uploads and is clearly marked as database-only; it is not a complete hotel recovery bundle. Never copy a live `.db` file by itself with ordinary filesystem copy tools.

### Complete, consistent database and uploads
1. Schedule a short maintenance window. Stop the PMS process, or set `STORAGE_MAINTENANCE_MODE=true` in the service environment and restart/redeploy. In maintenance mode `/health` reports `maintenance`, all hotel requests return 503, and the database and background jobs stay closed. Wait for the previous process to finish. Changing this flag requires an operator action; no script changes hosting settings.
2. In the disk-owning service shell run `node server/scripts/backup.js --offline --output /tmp/hotel-canal-backup-YYYYMMDD`. The tool refuses an active PMS lease, then creates a native SQLite snapshot, copies uploads and produces a SHA-256 manifest. It verifies referenced guest documents, checksums and database integrity. Diagnostic log files are excluded; relational audit history remains in the database.
3. The result is a private directory bundle with `database.sqlite`, `uploads/` and `manifest.json`. If a single transfer file is needed, archive that completed bundle with `tar -czf /tmp/hotel-canal-backup-YYYYMMDD.tar.gz -C /tmp hotel-canal-backup-YYYYMMDD`. Extract only trusted self-created archives into an empty private directory before using the restore tool.
4. Download the bundle/archive to the operator's approved encrypted offsite destination, then verify and rehearse recovery. The script requires a new output outside both `DATA_DIR` and Git; `/tmp` is temporary staging and is lost on restart. Transfer it before leaving maintenance mode. It creates no recurring copies and deletes no older backup. An offsite copy, retention schedule and responsible operator still need to be configured.
5. Remove `STORAGE_MAINTENANCE_MODE` or set it to `false`, restart/redeploy and confirm normal health and login. Securely remove temporary backup copies after the offsite copy has been verified.

### Restore without overwriting live data
1. Keep the PMS stopped or in maintenance mode. Retain the current data directory; never delete it merely to make restore pass. Select a new directory below the persistent mount, for example `/var/data/hotel-panama-canal-recovered`. On a 1 GB disk, retaining the old data and staging/restoring another copy can require more free space than is available. Inspect usage first; do not increase paid capacity without approval.
2. Run `node server/scripts/restore.js --from /private/extracted-backup --data-dir /var/data/hotel-panama-canal-recovered --offline`. The tool verifies the manifest, hashes, database integrity and document files before publishing. It refuses an existing database, a nonempty uploads directory, active storage lease, path traversal or symlinks. There is no force/overwrite option. It never accepts or uses a raw disk snapshot as SQLite recovery input.
3. Point `DATA_DIR` at the recovered directory only after verification, preserve hosting secrets, disable maintenance, and restart. Check login, actual reservations, balances and a sample uploaded document. Keep the old directory until recovery is accepted; switching paths is an explicit operator decision.
4. A crash during restore leaves `.restore-incomplete` and prevents normal startup. Inspect/recover that destination offline or choose a fresh destination and rerun from the verified bundle; do not delete the marker and assume the restore completed.

Do not rely on Render filesystem snapshots as the database-native recovery procedure. No offsite backup or automatic restore is enabled by these local tools.

## Validation
- `npm run build`: frontend production build
- `npm test`: inherited and regression tests
- `npx tsc --noEmit`: TypeScript check
- `npm run test:clean`: clean-install and default-off integration smoke checks
- `node server/tests/persistence.smoke.js`: isolated restart, WAL backup, full recovery, corruption/no-overwrite/offline guards and maintenance checks

## Branding and setup checklist
1. Supply the official transparent PNG or SVG logo; replace the temporary asset used in login, header, booking and quotation screens
2. Review name, contacts, address and policies in Configuration
3. Enter actual room types, capacities, rooms and rate plans; review tax and deposit percentages
4. Test login, empty dashboard, room setup, a fictional reservation and manual accounting
5. Keep all external integrations disabled until the relevant account, recipient data and test plan have been explicitly authorized

Preserved module and CSS identifiers may retain historical names for compatibility. They do not connect to the previous hotel's services.


### Registro persistente de inicios de sesión

La tabla SQLite `accesos_log` conserva únicamente ID del evento, ID de cuenta
reconocida (o NULL), resultado exitoso/fallido y fecha UTC. Registra contraseñas
incorrectas, cuentas desconocidas/desactivadas y solicitudes incompletas o con
tipos inválidos. No guarda contraseña, hash, token, IP ni correo ingresado. No
registra actividad posterior de sesión, logout ni solicitudes con API key.
Un inicio exitoso se entrega solamente después de persistir su evento.

En **Personal**, exclusivamente administradores ven el último inicio exitoso
por cuenta y el historial paginado de 50 eventos. Recepción y limpieza no tienen
acceso a estas APIs ni a la página. Las API keys con permiso `admin` conservan
el acceso administrativo existente; las de lectura/escritura no lo tienen.
El correo mostrado corresponde al registro actual de la cuenta, no a una
identidad personal verificada. Un intento fallido contra una cuenta tampoco
prueba quién intentó ingresar. No se reconstruye actividad previa a la
activación: el último acceso aparece como **Sin registro** hasta el primer éxito.

La migración es aditiva e idempotente. Antes de aplicarla a una base existente,
crea `hotel-canal.db.before-access-log-<uuid>.sqlite` junto a la base en DATA_DIR
mediante `VACUUM INTO`, incluyendo datos confirmados en WAL. Si el respaldo
falla, el arranque se detiene antes de la migración. No cambia usuarios,
contraseñas, reservas ni archivos. El respaldo contiene datos privados y debe
tratarse como los demás respaldos; requiere espacio para una copia de la base.
Este respaldo local sólo contiene SQLite y no sustituye un bundle completo
con uploads ni una copia externa. Antes de publicar, usar el procedimiento de
respaldo existente y comprobar recuperación. No se borra historial de forma
automática. Los respaldos habituales de SQLite incluyen todos los eventos.

Validación específica: `npx vitest run server/routes/access-log.test.js`.
