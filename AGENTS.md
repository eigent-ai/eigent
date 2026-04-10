## Cursor Cloud specific instructions

### Architecture Overview

Eigent is an Electron desktop app (React + Vite frontend) with two Python backends:
- **Backend** (`/workspace/backend/`): Python 3.11, agent runtime spawned by Electron, uses `uv` for deps
- **Server** (`/workspace/server/`): Python 3.12, FastAPI + PostgreSQL + Redis, uses `uv` for deps

### Running Services

**Quick commands** — see `package.json` scripts and `server/README_EN.md` for full docs.

1. **PostgreSQL + Redis** (required for local server mode):
   ```
   cd server && sudo docker compose -f docker-compose.dev.yml up -d
   ```

2. **Server API** (local mode):
   ```
   cd server && uv run uvicorn main:api --reload --port 3001 --host 0.0.0.0
   ```
   Requires `server/.env` with uncommented `database_url` and `redis_url` lines (copy from `.env.example` and uncomment the "not running in docker" config block).

3. **Frontend + Electron** (with local proxy):
   ```
   VITE_USE_LOCAL_PROXY=true VITE_PROXY_URL=http://localhost:3001 npm run dev
   ```
   Without those env vars, the app connects to `dev.eigent.ai` cloud backend.

### Key Gotchas

- **Python versions differ**: backend requires Python 3.11 (`>=3.11,<3.12`), server requires Python 3.12 (`>=3.12,<3.13`). Install both via deadsnakes PPA.
- **Server `.env`**: Copy `.env.example` to `.env` and uncomment `database_url`, `redis_url`, `celery_broker_url`, `celery_result_url`, and `SESSION_REDIS_URL` for local development (non-Docker API mode).
- **DB migrations**: Run `cd server && uv run alembic upgrade head` after first starting PostgreSQL or when schema changes.
- **Electron singleton lock**: If the Electron app fails to start, remove `~/.config/eigent/SingletonLock`.
- **Electron GPU rendering**: In headless/cloud VMs, the Electron window may show a yellow screen due to GPU limitations. The app renders correctly with `--disable-gpu` or when accessed through a proper display.
- **Backend spawned by Electron**: When running `npm run dev`, Electron spawns the Python backend automatically. For the server, you must start it separately.
- **`ruff` is not a project dependency**: Use `uvx ruff check .` (not `uv run ruff check .`) for linting backend/server Python code.

### Testing

- **Frontend**: `npx vitest run test/unit/` — some electron-specific tests (`test/unit/electron/install-deps.test.ts`) may timeout in CI/cloud environments. Exclude with `--exclude`.
- **Backend**: `cd backend && uv run pytest tests/ -v` — 403+ tests, all passing.
- **Server**: `cd server && uv run --extra dev pytest tests/ -v --ignore=tests/app/component/test_time_friendly.py` — 33+ passing, 2 pre-existing failures in `test_auth.py`.
- **Lint (frontend)**: `npx eslint . --no-warn-ignored`
- **Lint (backend/server)**: `uvx ruff check .` from respective directories
