import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Add project root to path for shared utils
sys.path.insert(0, str(Path(__file__).parent.parent))


# Initialize TraceRoot before other imports
from utils import traceroot_wrapper as traceroot

if traceroot.is_enabled():
    import traceroot as tr
    tr.init()
    from traceroot.integrations.fastapi import connect_fastapi

from app import api
from app.component.environment import auto_include_routers, env
from fastapi.staticfiles import StaticFiles

# Connect FastAPI to TraceRoot if enabled
if traceroot.is_enabled():
    connect_fastapi(api)

logger = traceroot.get_logger("server_main")

prefix = env("url_prefix", "")
auto_include_routers(api, prefix, "app/controller")
public_dir = os.environ.get("PUBLIC_DIR") or os.path.join(os.path.dirname(__file__), "app", "public")
# Ensure static directory exists or gracefully skip mounting
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
