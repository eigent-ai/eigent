@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo Auto Start Server Service
echo ========================================

:: Check if running in correct directory
if not exist "pyproject.toml" (
    echo Error: Please run this script in the server directory
    pause
    exit /b 1
)

:: Check if uv is installed
echo [1/5] Checking if uv is installed...
uv --version >nul 2>&1
if %errorlevel% neq 0 (
    echo uv is not installed, attempting to install...
    echo Downloading and installing uv...

    :: Try to install uv using PowerShell
    powershell -Command "irm https://astral.sh/uv/install.ps1 | iex" 2>nul
    if %errorlevel% neq 0 (
        echo Auto installation failed, please install uv manually:
        echo 1. Visit https://docs.astral.sh/uv/getting-started/installation/
        echo 2. Or run: curl -LsSf https://astral.sh/uv/install.sh | sh
        pause
        exit /b 1
    )

    :: Refresh environment variables
    call refreshenv 2>nul
    if %errorlevel% neq 0 (
        echo Please reopen command prompt or manually refresh environment variables
        echo Then run this script again
        pause
        exit /b 1
    )

    echo uv installation completed
) else (
    echo uv is already installed
)

:: Install project dependencies
echo [2/5] Installing project dependencies...
uv sync
if %errorlevel% neq 0 (
    echo Dependency installation failed
    pause
    exit /b 1
)
echo Dependencies installed successfully

:: Execute babel internationalization
echo [3/5] Executing babel internationalization...
uv run pybabel extract -F babel.cfg -o messages.pot .
if %errorlevel% neq 0 (
    echo babel extract failed
    pause
    exit /b 1
)

:: Check if Chinese translation files exist
if not exist "lang\zh_CN\LC_MESSAGES\messages.po" (
    echo Initializing Chinese translation files...
    uv run pybabel init -i messages.pot -d lang -l zh_CN
    if %errorlevel% neq 0 (
        echo babel init failed
        pause
        exit /b 1
    )
) else (
    echo Updating Chinese translation files...
    uv run pybabel update -i messages.pot -d lang -l zh_CN
    if %errorlevel% neq 0 (
        echo babel update failed
        pause
        exit /b 1
    )
)

:: Compile translation files
uv run pybabel compile -d lang -l zh_CN
if %errorlevel% neq 0 (
    echo babel compile failed
    pause
    exit /b 1
)
echo babel processing completed

:: Execute alembic database migration
echo [4/5] Executing alembic database migration...
uv run alembic upgrade head
if %errorlevel% neq 0 (
    echo alembic migration failed
    echo Please check database connection configuration
    pause
    exit /b 1
)
echo alembic migration completed

:: Start service
echo [5/5] Starting FastAPI service...
echo Service will start at http://localhost:3001
echo Press Ctrl+C to stop the service
echo ========================================

uv run uvicorn main:api --reload --port 3001 --host 0.0.0.0

pause
