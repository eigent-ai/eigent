# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import os
import pathlib
import sys

# Add project root to Python path to import shared utils
_project_root = pathlib.Path(__file__).parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

import logging
import subprocess
from importlib.metadata import version as pkg_version

from fastapi.staticfiles import StaticFiles
from fastapi_pagination import add_pagination
from loguru import logger as loguru_logger

from fastapi_babel import BabelMiddleware

from app import api, router
from app.core.babel import babel_configs
from app.core.environment import auto_include_routers, env
from app.shared.exception.handlers import register_exception_handlers
from app.shared.middleware import TraceIDMiddleware
from app.shared.logging import trace_filter

# Register exception handlers and i18n middleware
register_exception_handlers(api)
api.add_middleware(BabelMiddleware, babel_configs=babel_configs)

std_logger = logging.getLogger("server_main")

prefix = env("url_prefix", "")

# Routes: domain-driven architecture
auto_include_routers(router, "", "app/domains")
auto_include_routers(router, "", "app/api")
api.include_router(router, prefix=f"{prefix}/v1")

# Server version — read once at import time so it reflects the running code
try:
    SERVER_VERSION = pkg_version("Eigent")
except Exception:
    SERVER_VERSION = "unknown"

# Git hash of the last commit that touched server/ — used for stale-server detection.
# Captured once at startup; stays constant while the process lives.
try:
    SERVER_CODE_HASH = subprocess.check_output(
        ["git", "log", "-1", "--format=%H", "--", "server/"],
        cwd=str(_project_root), text=True, stderr=subprocess.DEVNULL,
    ).strip() or "unknown"
except Exception:
    SERVER_CODE_HASH = "unknown"


# Health check at root level for Docker healthcheck (GET /health)
@api.get("/health", tags=["Health"])
async def health_check():
    return {
        "status": "ok",
        "service": "eigent-server",
        "version": SERVER_VERSION,
        "server_hash": SERVER_CODE_HASH,
    }

# Backward-compatible webhook route (/api/webhook/...)
from app.domains.trigger.api.webhook_controller import router as webhook_router
api.include_router(webhook_router, prefix=prefix)

# Pagination
add_pagination(api)

# TraceID middleware
api.add_middleware(TraceIDMiddleware)

# Loguru: trace_id injection + sensitive data filtering
LOG_FORMAT = "{time:YYYY-MM-DD HH:mm:ss} | {level} | {extra[trace_id]} | {message}"
loguru_logger.configure(extra={"trace_id": "-"})
loguru_logger.remove()
loguru_logger.add(sys.stderr, level="DEBUG", filter=trace_filter, format=LOG_FORMAT)
loguru_logger.add(
    "runtime/log/app.log",
    rotation="10 MB",
    retention="10 days",
    level="DEBUG",
    enqueue=True,
    filter=trace_filter,
    format=LOG_FORMAT,
)

# Intercept stdlib logging and redirect to loguru
class _InterceptHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            level = loguru_logger.level(record.levelname).name
        except ValueError:
            level = record.levelno
        loguru_logger.opt(depth=6, exception=record.exc_info).log(level, record.getMessage())

logging.basicConfig(handlers=[_InterceptHandler()], level=logging.INFO, force=True)
for _name in ("uvicorn", "uvicorn.access", "uvicorn.error", "sqlalchemy.engine", "sqlalchemy.engine.Engine"):
    _lg = logging.getLogger(_name)
    _lg.handlers = [_InterceptHandler()]
    _lg.propagate = False

public_dir = os.environ.get("PUBLIC_DIR") or os.path.join(os.path.dirname(__file__), "app", "public")
if not os.path.isdir(public_dir):
    try:
        os.makedirs(public_dir, exist_ok=True)
        logger.warning(f"Public directory did not exist. Created: {public_dir}")
    except Exception as e:
        logger.error(f"Public directory missing and could not be created: {public_dir}. Error: {e}")
        public_dir = None

if public_dir and os.path.isdir(public_dir):
    api.mount("/public", StaticFiles(directory=public_dir), name="public")
else:
    logger.warning("Skipping /public mount because public directory is unavailable")
