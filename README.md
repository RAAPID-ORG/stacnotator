# STAC Notator

A tool for annotating imagery from STAC Catalogs.

## Quick Start

### For Development (with hot reloading)

```bash
# 1. Configure environment
cp .env.dev .env
nano .env  # Add your Firebase credentials

# 2. Initialize and start
make dev-init

# 3. Start coding!
# Frontend: http://localhost:5173 (auto-reloads)
# Backend: http://localhost:8000 (auto-reloads)
# API Docs: http://localhost:8000/docs
```

### For Production

```bash
# 1. Configure environment
cp .env.example .env
nano .env  # Configure production settings

# 2. Add Firebase credentials
cp /path/to/firebase-credentials.json backend/config/

# 3. Initialize and start
make init

# 4. Access application
# Frontend: http://localhost:8080
# API Docs: http://localhost:8000/docs
```

## Project Structure

```
stacnotator/
├── docker-compose.dev.yml       # Development configuration (standalone)
├── docker-compose.prod.yml      # Production configuration (standalone)
├── .env.example                 # Production configuration template
├── .env.dev                     # Development configuration template
├── Makefile                     # Common commands (dev-* for development)
├── DEVELOPMENT.md               # Development workflow guide
├── backend/         # FastAPI application
│   ├── Dockerfile               # Production build
│   ├── Dockerfile.dev           # Development (with reload)
│   ├── src/                     # Application code
│   └── config/                  # Credentials (gitignored)
├── frontend/        # React + Vite application
│   ├── Dockerfile               # Production build
│   ├── Dockerfile.dev           # Development server (HMR)
│   └── app/                     # Application code
└── nginx/                       # Reverse proxy (production only)
    ├── nginx.conf
    └── conf.d/
```

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- 4GB+ RAM (If using AI modules GPU required!)
- Firebase credentials file

## Architecture

**Services:**
- **Frontend**: React app served by nginx
- **Backend**: FastAPI application with Gunicorn workers
- **Database**: PostgreSQL 16 with PostGIS extension
- **Nginx**: Reverse proxy for production (Not used when deployed on Azure!)

## Development



```bash
# Build images for development, setup db and run migrations
make dev-init

# Start with hot-reloading
make dev-up

# Common commands - Check the Makefile for more
make logs                  # View all logs
make dev-logs-backend      # Backend logs only
make dev-shell-backend     # Backend shell
make dev-migrate           # Run database migrations
make dev-down              # Stop all services
```

## Production Deployment

STAC Notator supports multiple deployment options:

- **Docker Compose** - For local VPS or bare metal deployment (instructions below)
- **Manual Deployment of Components** - Deploy frontend, backend and db manually by setting their specific env vars and deploying as standalone modules.
- **Deploy on Azure** - Cloud hosted version to be deployed in Azure via App Service. Check out `azure_deploy/README.md`.

### Docker Compose Deployment (Local/VPS)

### 1. Configure Workers

Set in `.env` based on your CPU cores:

```bash
# Formula: WORKERS = (2 × CPU_cores) + 1
WORKERS=4          # Good for 2 CPU cores
TIMEOUT=60
MAX_REQUESTS=1000
```

**Worker Recommendations:**
- 1 CPU: `WORKERS=3` (dev/small)
- 2 CPU: `WORKERS=5` (small production)
- 4 CPU: `WORKERS=9` (medium production)
- 8+ CPU: `WORKERS=17` (large production)

### 2. Set Strong Passwords

```bash
# Generate secure password
openssl rand -base64 32

# Set in .env
POSTGRES_PASSWORD=your_generated_password
```

### 3. Configure SSL (Production)

**Option A: Let's Encrypt (Recommended for production)**

Automatic free SSL certificates with auto-renewal:

```bash
# 1. Install certbot
sudo apt update
sudo apt install certbot python3-certbot-nginx

# 2. Get certificate for your domain
sudo certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com

# 3. Copy certificates to nginx directory
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/ssl/cert.pem
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem nginx/ssl/key.pem
sudo chown $USER:$USER nginx/ssl/*.pem

# 4. Set up auto-renewal (certbot usually does this automatically)
sudo certbot renew --dry-run

# 5. Update .env with your domain
echo "DOMAIN_NAME=yourdomain.com" >> .env
```

**Auto-renewal setup (if needed):**
```bash
# Add cron job to copy renewed certs
sudo crontab -e

# Add this line to run daily at 2 AM:
0 2 * * * certbot renew --quiet --deploy-hook "cp /etc/letsencrypt/live/yourdomain.com/*.pem /path/to/stacnotator/nginx/ssl/ && docker-compose restart nginx"
```

**Option B: Self-signed (Testing only)**

For local testing or development:

```bash
# Generate self-signed certificate
make ssl-setup
```

**Option C: Manual certificates**

If you have certificates from another provider:

```bash
# Copy your certificates
cp /path/to/fullchain.pem nginx/ssl/cert.pem
cp /path/to/privkey.pem nginx/ssl/key.pem
chmod 600 nginx/ssl/*.pem
```

### 4. Deploy

```bash
# Start with nginx reverse proxy
make up
```

## Environment Configuration

**Required variables in `.env`:**

```bash
# Database (required)
POSTGRES_PASSWORD=your_secure_password

# Backend (Currently only firebase supported)
AUTH_PROVIDER=firebase
FIREBASE_CREDENTIALS_PATH=/app/config/firebase-credentials.json

#Frontend
FRONTEND_PORT=8080
VITE_API_BASE_URL=http://localhost:8000
VITE_FIREBASE_API_KEY=firebase_api_key_here
VITE_FIREBASE_AUTH_DOMAIN=app-name.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=project-id-here

# Workers (production tuning)
WORKERS=4
TIMEOUT=60

# CORS (add your domain in production)
CORS_ORIGINS=http://localhost:3000,https://yourdomain.com
```

**Optional:**
- Earth Engine credentials (for GEE integration)
- Custom ports and domain configuration
- Additional security settings

See `.env.example` for all available options.

### Production Checklist

- [ ] Strong `POSTGRES_PASSWORD` set (32+ characters)
- [ ] Firebase credentials secured (permissions 600)
- [ ] **SSL certificates configured** (Let's Encrypt recommended)
- [ ] SSL auto-renewal enabled (certbot cron job)
- [ ] CORS origins restricted to your domain
- [ ] `.env` file excluded from git
- [ ] **You are the first user to sign up** (for admin access)
- [ ] Workers tuned for your CPU count (see Worker Configuration)
- [ ] Database not exposed publicly (remove `ports:` in docker-compose.prod.yml)
- [ ] Domain DNS pointed to your server
- [ ] Firewall configured (allow ports 80, 443)

## Common Tasks

```bash
# Check the Makefile more more quick commands

# Create database migration
make migrate-create MSG="add new table"

# Check service health
make health

# View running containers
make ps

# Restart a service
make restart-backend

# Clean up everything
make clean
```