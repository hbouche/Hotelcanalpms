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
- PayPal, email, WhatsApp, CRM integrations and outbound webhooks are disabled by default at server level
- No built-in production administrator password. Initial administrator credentials must be supplied by the operator through secure hosting settings
- Source-specific operational scripts, lead exports, screenshots, private work notes, database files and source Git history are excluded
- Automated tests use isolated, fictional fixtures under `NODE_ENV=test`; these fixtures are not loaded in normal operation

## Local setup
Use Node 22 LTS and npm. Run `npm ci --include=dev`, then `npm run build`. Set the environment variables below and run `npm start`. For frontend development, run `npm run dev` in a second terminal. The API defaults to port 3201 and Vite to 3200.

Required production environment variables:
- `NODE_ENV=production`
- `JWT_SECRET`: a long, unique secret entered by the operator
- `INITIAL_ADMIN_EMAIL`: operator-chosen initial admin email
- `INITIAL_ADMIN_PASSWORD`: operator-chosen password of at least 16 characters
- `ALLOWED_ORIGINS`: the exact application origin
- `EXTERNAL_INTEGRATIONS_ENABLED=false`

Initial credentials are consumed only when no users exist; changing these variables does not reset an existing user's password. Secrets must never be committed or shared in chat. If initial credentials are absent, the database has no login user. `.env.example` documents variables; environment files are not automatically loaded by this application.

## Render Free demo
`render.yaml` proposes a single explicit Free Node Web Service with no disk or other paid resource and automatic deployments disabled. It does not deploy anything on its own.

Build: `npm ci --include=dev && npm run build`

Start: `npm start`

Health: `/health`

This is a disposable demo. Render Free sleeps after 15 minutes without inbound traffic, takes about one minute to wake, and does not support persistent disks. SQLite, users, configuration and uploads can disappear on sleep, restart or redeploy. Never enter real guest data or rely on this setup for hotel operations. Check shared workspace usage and overage settings before deployment; Free instance selection alone does not guarantee the entire account has no charges.

Official references: [Free limits](https://render.com/docs/free), [Blueprint specification](https://render.com/docs/blueprint-spec), [Pricing](https://render.com/pricing).

For durable use, evaluate a separately approved persistent-storage plan or an explicit database migration. This code uses SQLite and does not support PostgreSQL merely by supplying a `DATABASE_URL`.

## Validation
- `npm run build`: frontend production build
- `npm test`: inherited and regression tests
- `npx tsc --noEmit`: TypeScript check
- `npm run test:clean`: clean-install and default-off integration smoke checks

## Branding and setup checklist
1. Supply the official transparent PNG or SVG logo; replace the temporary asset used in login, header, booking and quotation screens
2. Review name, contacts, address and policies in Configuration
3. Enter actual room types, capacities, rooms and rate plans; review tax and deposit percentages
4. Test login, empty dashboard, room setup, a fictional reservation and manual accounting
5. Keep all external integrations disabled until the relevant account, recipient data and test plan have been explicitly authorized

Preserved module and CSS identifiers may retain historical names for compatibility. They do not connect to the previous hotel's services.
