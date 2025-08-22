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
echo -e "${YELLOW}[1/5] Checking if uv is installed...${NC}"
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
echo -e "${YELLOW}[2/5] Installing project dependencies...${NC}"
if uv sync; then
    echo -e "${GREEN}Dependencies installed successfully${NC}"
else
    echo -e "${RED}Dependency installation failed${NC}"
    read -p "Press Enter to exit"
    exit 1
fi

# Execute babel internationalization
echo -e "${YELLOW}[3/5] Executing babel internationalization...${NC}"
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
echo -e "${YELLOW}[4/5] Executing alembic database migration...${NC}"
if uv run alembic upgrade head; then
    echo -e "${GREEN}alembic migration completed${NC}"
else
    echo -e "${RED}alembic migration failed${NC}"
    echo -e "${YELLOW}Please check database connection configuration${NC}"
    read -p "Press Enter to exit"
    exit 1
fi

# Start service
echo -e "${YELLOW}[5/5] Starting FastAPI service...${NC}"
echo -e "${CYAN}Service will start at http://localhost:3001${NC}"
echo -e "${CYAN}Press Ctrl+C to stop the service${NC}"
echo -e "${GREEN}========================================${NC}"

if ! uv run uvicorn main:api --reload --port 3001 --host 0.0.0.0; then
    echo -e "${RED}Service startup failed${NC}"
    read -p "Press Enter to exit"
    exit 1
fi 