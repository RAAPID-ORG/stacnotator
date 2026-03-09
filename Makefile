.PHONY: help build up down logs clean test migrate dev-openapi \
	lint lint-backend lint-frontend \
	format-check format-check-backend format-check-frontend \
	typecheck typecheck-backend typecheck-frontend \
	ci-check pre-commit-install pre-commit-run

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-20s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# Development Commands (standalone dev compose file)
COMPOSE_DEV = docker-compose -f docker-compose.dev.yml

# Production Commands (standalone prod compose file)
COMPOSE_PROD = docker-compose -f docker-compose.prod.yml

###################################################
# Dev Commands
###################################################

dev-build: ## Build development Docker images with hot reload support
	$(COMPOSE_DEV) build

dev-up: ## Start development services with hot reload
	$(COMPOSE_DEV) up

dev-up-d: ## Start development services in detached mode
	$(COMPOSE_DEV) up -d

dev-down: ## Stop development services
	$(COMPOSE_DEV) down

dev-logs: ## Show logs from development services
	$(COMPOSE_DEV) logs -f

dev-logs-backend: ## Show backend development logs
	$(COMPOSE_DEV) logs -f backend

dev-logs-frontend: ## Show frontend development logs
	$(COMPOSE_DEV) logs -f frontend

dev-restart: ## Restart development services
	$(COMPOSE_DEV) restart

dev-restart-backend: ## Restart backend development service
	$(COMPOSE_DEV) restart backend

dev-restart-frontend: ## Restart frontend development service
	$(COMPOSE_DEV) restart frontend

dev-shell-backend: ## Open shell in backend development container
	$(COMPOSE_DEV) exec backend /bin/bash

dev-shell-frontend: ## Open shell in frontend development container
	$(COMPOSE_DEV) exec frontend /bin/sh

dev-clean: ## Remove development containers and volumes
	$(COMPOSE_DEV) down -v --remove-orphans

dev-migrate: ## Run database migrations in development
	$(COMPOSE_DEV) exec backend alembic upgrade head

dev-migrate-create: ## Create new migration in development (use MSG="description")
	$(COMPOSE_DEV) exec backend alembic revision --autogenerate -m "$(MSG)"

dev-seed: ## Seed development database with sample data (use FIREBASE_UID="your-uid" to specify user)
	@if [ -n "$(FIREBASE_UID)" ]; then \
		$(COMPOSE_DEV) exec backend python seed_dev_data.py $(FIREBASE_UID); \
	else \
		$(COMPOSE_DEV) exec backend python seed_dev_data.py; \
	fi

dev-seed-clear: ## Clear development seed data
	$(COMPOSE_DEV) exec backend python seed_dev_data.py clear

dev-openapi: ## Regenerate frontend API client from backend OpenAPI schema (backend must be running)
	cd frontend && npm run openapi-ts

dev-rebuild-frontend: ## Rebuild frontend with fresh node_modules (clears cached volume)
	$(COMPOSE_DEV) stop frontend
	docker volume rm -f stacnotator_frontend_node_modules_dev
	$(COMPOSE_DEV) build frontend --no-cache
	$(COMPOSE_DEV) up -d frontend

dev-reset: ## Reset development database (clear, migrate, seed; use FIREBASE_UID="your-uid" to specify user)
	@echo "Resetting development database..."
	$(COMPOSE_DEV) down -v
	$(COMPOSE_DEV) up -d
	@echo "Waiting for database..."
	@sleep 10
	@$(MAKE) dev-migrate
	@if [ -n "$(FIREBASE_UID)" ]; then \
		$(MAKE) dev-seed FIREBASE_UID=$(FIREBASE_UID); \
	else \
		$(MAKE) dev-seed; \
	fi
	@echo "Database reset complete!"

dev-init: ## Initialize the application for development (first time setup; use FIREBASE_UID="your-uid" to specify user)
	@echo "Setting up STAC Notator (Development Mode with Hot Reload)..."
	@if [ ! -f .env ]; then cp .env.dev .env; echo "Created .env file from .env.dev"; fi
	@echo "Building development images..."
	@$(MAKE) dev-build
	@echo "Starting development services..."
	@$(MAKE) dev-up-d
	@echo "Waiting for database..."
	@sleep 10
	@echo "Running migrations..."
	@$(MAKE) dev-migrate
	@echo "Seeding development data..."
	@if [ -n "$(FIREBASE_UID)" ]; then \
		$(MAKE) dev-seed FIREBASE_UID=$(FIREBASE_UID); \
	else \
		$(MAKE) dev-seed; \
	fi
	@echo ""
	@echo "=========================================="
	@echo "Development setup complete!"
	@echo "=========================================="

###################################################
# Production Commands
###################################################

build: ## Build all Docker images (production)
	$(COMPOSE_PROD) build

up: ## Start all services (production)
	$(COMPOSE_PROD) up -d

down: ## Stop all services (production)
	$(COMPOSE_PROD) down

logs: ## Show logs from all services (production)
	$(COMPOSE_PROD) logs -f

logs-backend: ## Show backend logs (production)
	$(COMPOSE_PROD) logs -f backend

logs-frontend: ## Show frontend logs (production)
	$(COMPOSE_PROD) logs -f frontend

logs-db: ## Show database logs (production)
	$(COMPOSE_PROD) logs -f db

clean: ## Remove all containers, volumes, and networks (production)
	$(COMPOSE_PROD) down -v --remove-orphans

restart: ## Restart all services (production)
	$(COMPOSE_PROD) restart

restart-backend: ## Restart backend service (production)
	$(COMPOSE_PROD) restart backend

restart-frontend: ## Restart frontend service (production)
	$(COMPOSE_PROD) restart frontend

ps: ## Show running containers (all)
	@echo "Production containers:"
	@$(COMPOSE_PROD) ps
	@echo ""
	@echo "Development containers:"
	@$(COMPOSE_DEV) ps

shell-backend: ## Open shell in backend container (production)
	$(COMPOSE_PROD) exec backend /bin/bash

shell-frontend: ## Open shell in frontend container (production)
	$(COMPOSE_PROD) exec frontend /bin/sh

shell-db: ## Open PostgreSQL shell (production)
	@set -a; [ -f .env ] && . ./.env; set +a; \
	$(COMPOSE_PROD) exec db psql -U $${POSTGRES_USER:-stacnotator} -d $${POSTGRES_DB:-stacnotator}

dev-shell-db: ## Open PostgreSQL shell (development)
	@set -a; [ -f .env ] && . ./.env; set +a; \
	$(COMPOSE_DEV) exec db psql -U $${POSTGRES_USER:-stacnotator} -d $${POSTGRES_DB:-stacnotator}

migrate: ## Run database migrations (production)
	$(COMPOSE_PROD) exec backend alembic upgrade head

migrate-create: ## Create new migration (production) (use MSG="description")
	$(COMPOSE_PROD) exec backend alembic revision --autogenerate -m "$(MSG)"

init: ## Initialize the application (first time setup - production mode)
	@echo "Setting up STAC Notator (Production Mode)..."
	@if [ ! -f .env ]; then cp .env.example .env; echo "Created .env file - please edit it with your settings"; exit 1; fi
	@echo "Building images..."
	@$(MAKE) build
	@echo "Starting services..."
	@$(MAKE) up
	@echo "Waiting for database..."
	@sleep 10
	@echo "Running migrations..."
	@$(MAKE) migrate
	@echo ""
	@echo "=========================================="
	@echo "Production setup complete!"
	@echo "=========================================="

ssl-setup: ## Generate self-signed SSL certificates (for testing)
	@mkdir -p nginx/ssl
	openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
		-keyout nginx/ssl/key.pem \
		-out nginx/ssl/cert.pem \
		-subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
	@echo "Self-signed SSL certificates created in nginx/ssl/"

###################################################
# Code Quality
###################################################

lint-backend: ## Run ruff linter on backend
	cd backend && uv run ruff check src/

lint-frontend: ## Run eslint on frontend
	cd frontend && npx eslint src/

lint: lint-backend lint-frontend ## Run all linters

format-check-backend: ## Check backend formatting
	cd backend && uv run ruff format --check src/

format-check-frontend: ## Check frontend formatting
	cd frontend && npx prettier --check "src/**/*.{ts,tsx,css}"

format-check: format-check-backend format-check-frontend ## Check all formatting

typecheck-backend: ## Run mypy on backend
	cd backend && uv run mypy src/ --config-file pyproject.toml

typecheck-frontend: ## Run tsc --noEmit on frontend
	cd frontend && npx tsc --noEmit

typecheck: typecheck-backend typecheck-frontend ## Run all type checkers

ci-check: lint format-check typecheck ## Run all CI checks locally

###################################################
# Pre-commit
###################################################

pre-commit-install: ## Install pre-commit hooks
	cd backend && uv run pre-commit install

pre-commit-run: ## Run pre-commit on all files
	cd backend && uv run pre-commit run --all-files

###################################################
# Azure Deployment
###################################################

az-deploy: # Deploy to Azure. Requires to be on either the UMD (+TunnelAll) or Unistra VPN
	./azure_deploy/deploy-app.sh
