# Deploy with Docker Compose

This is a single-host deployment for a Linux server, a virtual machine on any
cloud, or an on-premises host. It runs PostgreSQL with PostGIS and pgvector,
the FastAPI backend, and the built frontend. Caddy provides HTTPS and sends API
and frontend requests through the same public origin. No Azure services are
required, but multi-user authentication still requires Firebase.

This setup is a starting point for operators, not a managed service or a
high-availability deployment. You are responsible for updates, backups,
monitoring, access controls, and your deployment's privacy notice.

## Prepare the host

Install Docker Engine and its Compose plugin, Git, and OpenSSL. Point a public
hostname's DNS records at the server. Allow inbound TCP ports 80 and 443 so
Caddy can obtain and renew its certificates; do not expose the database or
backend directly.

Clone the repository and run the following commands from its root:

```bash
cp deployment/compose/.env.production.example .env.production
chmod 600 .env.production
```

Edit `.env.production`:

- Set `APP_DOMAIN` to the hostname without a scheme, and `CORS_ORIGINS` to its
  full HTTPS origin.
- Set a unique `POSTGRES_PASSWORD` and generate independent application secrets:
  `openssl rand -hex 32` for `TILER_TOKEN_SECRET` and
  `openssl rand -base64 32` for `APIKEY_ENCRYPTION_SECRET`.
- Configure Firebase using the [README instructions](../../README.md#firebase-authentication).
  Set the three `VITE_FIREBASE_*` values and an absolute path to the Firebase
  Admin SDK JSON key in `FIREBASE_CREDENTIALS_PATH_HOST`. Keep the key outside
  the checkout. The backend runs as a non-root user, so the file and its parent
  directories must allow that container user to read it.
- Leave `VITE_API_BASE_URL_PROD` empty. The gateway routes `/api/` to the backend.
  Firebase settings are embedded at build time, so changing them requires
  rebuilding the frontend.

The database, backend, and frontend ports bind only to loopback. Caddy is the
public entry point. The application refuses local authentication and development
secrets in production. Earth Engine credentials are optional; leave the
corresponding settings commented out unless those features are needed.

## Start the application

Use the same environment file and both Compose files for every command:

```bash
docker compose --env-file .env.production \
  -f docker-compose.prod.yml -f deployment/compose/compose.https.yml config --quiet

docker compose --env-file .env.production \
  -f docker-compose.prod.yml -f deployment/compose/compose.https.yml up -d --build

docker compose --env-file .env.production \
  -f docker-compose.prod.yml -f deployment/compose/compose.https.yml ps
```

The backend runs database migrations before starting. The gateway waits for
backend readiness. Open `https://<APP_DOMAIN>` and check
`https://<APP_DOMAIN>/readyz`. If startup fails, inspect the services with the
same Compose command followed by `logs --tail=100 backend gateway`.

### Set up the first administrator

Register through the application, verify the email if using email/password, and
choose a username. Firebase users are not automatically platform administrators.
Promote your account once through the database:

```bash
docker compose --env-file .env.production \
  -f docker-compose.prod.yml -f deployment/compose/compose.https.yml exec db \
  sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

In the SQL session, use the UID from Firebase Authentication:

```sql
UPDATE auth.users
SET is_platform_admin = true
WHERE issuer = 'firebase' AND external_uid = '<YOUR-FIREBASE-UID>'
RETURNING id, display_name;
```

Confirm that exactly your account was updated, then exit with `\q` and reload
the app. Use Platform admin to approve organizations and manage access.
Do not run the development seeding script against a production database.

## Optional imagery services

Microsoft Planetary Computer imagery with first-valid compositing works without
a hosted tiler. Other public STAC catalogs, advanced compositing and masking, and
COG overlays require [stacnotator-tiler](https://github.com/RAAPID-ORG/stacnotator-tiler).
Deploy that service separately and set `TILERS` and `DEFAULT_TILER` in
`.env.production`. Its browser-facing URL must use HTTPS and share the app's
registrable domain, for example `tiler.example.org` beside `annotate.example.org`.
Set `TILER_COOKIE_DOMAIN=.example.org` and use the same `TILER_TOKEN_SECRET`
on the backend and tiler. `internal_url` in the registry can supply a separate
address reachable from the backend container.

See the tiler's production deployment instructions and
[tile-serving documentation](../../docs/tilers.md). Azure managed-identity
storage access is specific to Azure; configure storage access for the platform
where you run the tiler. Paid imagery providers still require their own
credentials and licenses.

## Operations

Named volumes retain PostgreSQL data and Caddy's certificates across container
replacements. Do not use `down -v` on a deployment you want to keep.
Back up the database, environment configuration, credential files, and
`APIKEY_ENCRYPTION_SECRET` separately. Losing the encryption secret makes stored
provider API keys unreadable.

For a database backup, using the same Compose prefix:

```bash
docker compose --env-file .env.production \
  -f docker-compose.prod.yml -f deployment/compose/compose.https.yml exec -T db \
  sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > stacnotator.dump
```

Store backups securely off-host and test restoration before relying on them.
Take a backup before updating the checkout and repeating `up -d --build`.
Keep one backend replica: startup migrations are not coordinated across
replicas. If increasing `WORKERS`, keep
`WORKERS * (DB_POOL_SIZE + DB_MAX_OVERFLOW)` within the database's connection
budget, with room for administration and migrations.

Set log retention and disk limits on the host. Review the
[privacy policy](../../frontend/src/features/legal/privacy.md) and
[terms](../../frontend/src/features/legal/terms.md) before publishing your
instance: the shipped notices describe the project's deployment and are not
automatically correct for another operator.
