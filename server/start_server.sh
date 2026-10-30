#!/bin/bash

# Set text colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================"
echo -e "Auto Start Server Service"
echo -e "========================================${NC}"

# Check if running in correct directory
if [ ! -f "pyproject.toml" ]; then
    echo -e "${RED}Error: Please run this script in the server directory${NC}"
    read -p "Press Enter to exit"
    exit 1
fi

# Check if uv is installed
echo -e "${YELLOW}[1/8] Checking if uv is installed...${NC}"
if ! command -v uv &> /dev/null; then
    echo -e "${YELLOW}uv is not installed, attempting to install...${NC}"
    echo -e "${YELLOW}Downloading and installing uv...${NC}"

    # Try to install uv
    if curl -LsSf https://astral.sh/uv/install.sh | sh; then
        echo -e "${GREEN}uv installation completed${NC}"
        # Refresh shell environment
        export PATH="$HOME/.cargo/bin:$PATH"
        source ~/.bashrc 2>/dev/null || source ~/.zshrc 2>/dev/null || true
    else
        echo -e "${RED}Auto installation failed, please install uv manually:${NC}"
        echo -e "${CYAN}1. Visit https://docs.astral.sh/uv/getting-started/installation/${NC}"
        echo -e "${CYAN}2. Or run: curl -LsSf https://astral.sh/uv/install.sh | sh${NC}"
        read -p "Press Enter to exit"
        exit 1
    fi
else
    echo -e "${GREEN}uv is already installed${NC}"
fi

# Install project dependencies
echo -e "${YELLOW}[2/8] Installing project dependencies...${NC}"
if uv sync; then
    echo -e "${GREEN}Dependencies installed successfully${NC}"
else
    echo -e "${RED}Dependency installation failed${NC}"
    read -p "Press Enter to exit"
    exit 1
fi

# Validate the environment before running migrations or starting background
# processes. The desktop .env.development file is intentionally not loaded by
# the standalone server; server processes load server/.env (or exported vars).
echo -e "${YELLOW}[3/8] Validating server environment...${NC}"
if ! MISSING_ENV_VARS="$(uv run python -c 'import os; from dotenv import load_dotenv; load_dotenv(".env"); required = ("database_url", "redis_url", "celery_broker_url", "celery_result_url", "secret_key"); print(", ".join(name for name in required if not os.getenv(name)))')"; then
    echo -e "${RED}Unable to validate the server environment${NC}"
    exit 1
fi
if [ -n "$MISSING_ENV_VARS" ]; then
    echo -e "${RED}Missing required server environment variables: $MISSING_ENV_VARS${NC}"
    echo -e "${YELLOW}Create server/.env from server/.env.example or export these variables before starting.${NC}"
    echo -e "${YELLOW}The repository-root .env.development file configures Vite/Electron and is not read by this server.${NC}"
    exit 1
fi
echo -e "${GREEN}Server environment is ready${NC}"

# Execute babel internationalization
echo -e "${YELLOW}[4/8] Executing babel internationalization...${NC}"
if ! uv run pybabel extract -F babel.cfg -o messages.pot .; then
    echo -e "${RED}babel extract failed${NC}"
    read -p "Press Enter to exit"
    exit 1
fi

# Check if Chinese translation files exist
if [ ! -f "lang/zh_CN/LC_MESSAGES/messages.po" ]; then
    echo -e "${YELLOW}Initializing Chinese translation files...${NC}"
    if ! uv run pybabel init -i messages.pot -d lang -l zh_CN; then
        echo -e "${RED}babel init failed${NC}"
        read -p "Press Enter to exit"
        exit 1
    fi
else
    echo -e "${YELLOW}Updating Chinese translation files...${NC}"
    if ! uv run pybabel update -i messages.pot -d lang -l zh_CN; then
        echo -e "${RED}babel update failed${NC}"
        read -p "Press Enter to exit"
        exit 1
    fi
fi

# Compile translation files
if ! uv run pybabel compile -d lang -l zh_CN; then
    echo -e "${RED}babel compile failed${NC}"
    read -p "Press Enter to exit"
    exit 1
fi

echo -e "${GREEN}babel processing completed${NC}"

# Execute alembic database migration
echo -e "${YELLOW}[5/8] Executing alembic database migration...${NC}"
if uv run alembic upgrade head; then
    echo -e "${GREEN}alembic migration completed${NC}"
else
    echo -e "${RED}alembic migration failed${NC}"
    echo -e "${YELLOW}Please check database connection configuration${NC}"
    read -p "Press Enter to exit"
    exit 1
fi

# Cleanup function to stop background processes on exit
CELERY_WORKER_PID=""
CELERY_BEAT_PID=""
cleanup() {
    local exit_status="${1:-0}"
    echo -e "\n${YELLOW}Shutting down services...${NC}"
    if [ -n "$CELERY_WORKER_PID" ] && kill -0 "$CELERY_WORKER_PID" 2>/dev/null; then
        kill "$CELERY_WORKER_PID" 2>/dev/null
        echo -e "${GREEN}Celery worker stopped${NC}"
    fi
    if [ -n "$CELERY_BEAT_PID" ] && kill -0 "$CELERY_BEAT_PID" 2>/dev/null; then
        kill "$CELERY_BEAT_PID" 2>/dev/null
        echo -e "${GREEN}Celery beat stopped${NC}"
    fi
    exit "$exit_status"
}
trap cleanup SIGINT SIGTERM

# Start services
echo -e "${YELLOW}[6/8] Starting Celery worker...${NC}"
uv run celery -A app.core.celery worker --loglevel=info --queues=celery,poll_trigger_schedules,check_execution_timeouts &
CELERY_WORKER_PID=$!
echo -e "${GREEN}Celery worker started (PID: $CELERY_WORKER_PID)${NC}"

echo -e "${YELLOW}[7/8] Starting Celery beat...${NC}"
uv run celery -A app.core.celery beat --loglevel=info &
CELERY_BEAT_PID=$!
echo -e "${GREEN}Celery beat started (PID: $CELERY_BEAT_PID)${NC}"

# Celery starts asynchronously. Catch immediate configuration/import failures
# before claiming that the API service is ready.
sleep 1
if ! kill -0 "$CELERY_WORKER_PID" 2>/dev/null; then
    echo -e "${RED}Celery worker exited during startup${NC}"
    cleanup 1
fi
if ! kill -0 "$CELERY_BEAT_PID" 2>/dev/null; then
    echo -e "${RED}Celery beat exited during startup${NC}"
    cleanup 1
fi

echo -e "${YELLOW}[8/8] Starting FastAPI service...${NC}"
echo -e "${CYAN}Service will start at http://localhost:3001${NC}"
echo -e "${CYAN}Press Ctrl+C to stop all services${NC}"
echo -e "${GREEN}========================================${NC}"

if ! uv run uvicorn main:api --reload --port 3001 --host 0.0.0.0; then
    echo -e "${RED}Service startup failed${NC}"
    cleanup 1
fi
