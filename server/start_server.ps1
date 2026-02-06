# Set console encoding to UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "========================================" -ForegroundColor Green
Write-Host "Auto Start Server Service" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

# Check if running in correct directory
if (-not (Test-Path "pyproject.toml")) {
    Write-Host "Error: Please run this script in the server directory" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Check if uv is installed
Write-Host "[1/5] Checking if uv is installed..." -ForegroundColor Yellow
try {
    $uvVersion = uv --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "uv is installed: $uvVersion" -ForegroundColor Green
    } else {
        throw "uv not found"
    }
} catch {
    Write-Host "uv is not installed, attempting to install..." -ForegroundColor Yellow
    Write-Host "Downloading and installing uv..." -ForegroundColor Yellow

    try {
        Invoke-RestMethod -Uri "https://astral.sh/uv/install.ps1" | Invoke-Expression
        if ($LASTEXITCODE -eq 0) {
            Write-Host "uv installation completed" -ForegroundColor Green
            # Refresh environment variables
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        } else {
            throw "Installation failed"
        }
    } catch {
        Write-Host "Auto installation failed, please install uv manually:" -ForegroundColor Red
        Write-Host "1. Visit https://docs.astral.sh/uv/getting-started/installation/" -ForegroundColor Cyan
        Write-Host "2. Or run: curl -LsSf https://astral.sh/uv/install.sh | sh" -ForegroundColor Cyan
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# Install project dependencies
Write-Host "[2/5] Installing project dependencies..." -ForegroundColor Yellow
try {
    uv sync
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Dependencies installed successfully" -ForegroundColor Green
    } else {
        throw "Dependency installation failed"
    }
} catch {
    Write-Host "Dependency installation failed" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Execute babel internationalization
Write-Host "[3/5] Executing babel internationalization..." -ForegroundColor Yellow
try {
    uv run pybabel extract -F babel.cfg -o messages.pot .
    if ($LASTEXITCODE -ne 0) { throw "babel extract failed" }

    # Check if Chinese translation files exist
    if (-not (Test-Path "lang\zh_CN\LC_MESSAGES\messages.po")) {
        Write-Host "Initializing Chinese translation files..." -ForegroundColor Yellow
        uv run pybabel init -i messages.pot -d lang -l zh_CN
        if ($LASTEXITCODE -ne 0) { throw "babel init failed" }
    } else {
        Write-Host "Updating Chinese translation files..." -ForegroundColor Yellow
        uv run pybabel update -i messages.pot -d lang -l zh_CN
        if ($LASTEXITCODE -ne 0) { throw "babel update failed" }
    }

    # Compile translation files
    uv run pybabel compile -d lang -l zh_CN
    if ($LASTEXITCODE -ne 0) { throw "babel compile failed" }

    Write-Host "babel processing completed" -ForegroundColor Green
} catch {
    Write-Host "babel processing failed: $($_.Exception.Message)" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Execute alembic database migration
Write-Host "[4/5] Executing alembic database migration..." -ForegroundColor Yellow
try {
    uv run alembic upgrade head
    if ($LASTEXITCODE -eq 0) {
        Write-Host "alembic migration completed" -ForegroundColor Green
    } else {
        throw "alembic migration failed"
    }
} catch {
    Write-Host "alembic migration failed" -ForegroundColor Red
    Write-Host "Please check database connection configuration" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# Start service
Write-Host "[5/5] Starting FastAPI service..." -ForegroundColor Yellow
Write-Host "Service will start at http://localhost:3001" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop the service" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Green

try {
    uv run uvicorn main:api --reload --port 3001 --host 0.0.0.0
} catch {
    Write-Host "Service startup failed: $($_.Exception.Message)" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
