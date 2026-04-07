# Server Refactor v1 - Upgrade Guide

> Applies to: v0.0.89+
> PR: #1509

## What Changed

The server codebase has been restructured from a flat layout to a **domain-driven architecture**. No API endpoints or database schemas were changed — this is a code organization refactor only.

### Directory Mapping

| Before | After | Description |
|---|---|---|
| `app/component/` | `app/core/` | Infrastructure utilities (database, encryption, celery, etc.) |
| `app/controller/` | `app/domains/*/api/` | API controllers, grouped by domain |
| `app/service/` | `app/domains/*/service/` | Business logic, grouped by domain |
| `app/exception/` | `app/shared/exception/` | Exception handling |
| `app/type/` | `app/shared/types/` | Shared type definitions |
| _(new)_ | `app/shared/auth/` | Authentication & authorization |
| _(new)_ | `app/shared/middleware/` | CORS, rate limiting, trace ID |
| _(new)_ | `app/shared/http/` | HTTP client utilities |
| _(new)_ | `app/shared/logging/` | Logging & sensitive data filtering |

### Domain Structure

Each domain (`chat`, `config`, `mcp`, `model_provider`, `oauth`, `trigger`, `user`) follows the same layout:

```
app/domains/<domain>/
  api/            # Controllers (route handlers)
  service/        # Business logic
  schema/         # Request/response schemas
```

## Upgrade Action Required

**This is a breaking change for local deployments.** The old server code will fail to start due to changed import paths.

### Docker Users

```bash
cd server
docker-compose up --build -d
```

You **must** include `--build` to rebuild the image. Running `docker-compose up -d` without `--build` will use the stale old image and fail.

### Non-Docker Users (Local Development)

If you are running the server directly (via `start_server.sh` or `uv run uvicorn`):

1. Stop the running server process
2. Pull the latest code
3. Restart the server

```bash
# If using start_server.sh
cd server
./start_server.sh

# If running uvicorn directly
cd server
uv run uvicorn main:api --reload --port 3001 --host 0.0.0.0
```

### Electron App Users

If you are running Eigent as a desktop app, simply restart the application. The server will be restarted automatically.

## FAQ

**Q: Will I lose my data?**
A: No. Database volumes and schemas are not affected. Only the Python source code layout changed.

**Q: Do I need to re-run database migrations?**
A: No. There are no new migrations in this change.

**Q: I see import errors like `ModuleNotFoundError: No module named 'app.component'`**
A: This means you are running an old server binary/image. Follow the upgrade steps above.
