### Purpose
`server/` provides a local backend (FastAPI + PostgreSQL) to achieve complete separation between local and cloud environments. After deploying this service, sensitive data such as user registration, model provider configurations, tool settings, and chat history are stored on your machine and are not uploaded to our cloud unless you explicitly configure external services (e.g., cloud model providers or remote MCP servers).

### Services Provided (Main Modules)
- Users & Accounts
  - `POST /register`: Email + password registration (local DB only)
  - `POST /login`: Email + password login; returns a locally issued token
  - `GET/PUT /user`, `/user/profile`, `/user/privacy`, `/user/current_credits`, `/user/stat`, etc.
- Model Providers (store local/cloud model access configurations)
  - `GET /providers`, `POST /provider`, `PUT /provider/{id}`, `DELETE /provider/{id}`
  - `POST /provider/prefer`: Set a preferred provider (frontend/backend will prioritize it)
- Config Center (store secrets/params required by tools/capabilities)
  - `GET /configs`, `POST /configs`, `PUT /configs/{id}`, `DELETE /configs/{id}`, `GET /config/info`
- Chat & Data
  - History, snapshots, sharing, etc. in `app/controller/chat/`, all persisted to local DB
- MCP Management (import local/remote MCP servers)
  - `GET /mcps`, `POST /mcp/install`, `POST /mcp/import/{Local|Remote}`, etc.

Note: All the above data is stored in the local PostgreSQL volume in Docker (see "Data Persistence" below). If you configure external models or remote MCP, requests go to the third-party services you specify.

---

### Prerequisites
- Docker Desktop installed and running
- Node.js and npm installed (for frontend development)
- At least 2GB of free disk space

### Quick Start (Docker)

#### 1. Initial Setup
```bash
cd server

# Create the required public directory
mkdir -p app/public

# Copy and configure environment variables
cp .env.example .env

# Generate secure keys for your .env file
echo "Generating secure keys..."
echo "secret_key=$(openssl rand -hex 32)"
echo "CHAT_SHARE_SECRET_KEY=$(openssl rand -hex 32)"
echo "CHAT_SHARE_SALT=$(openssl rand -hex 16)"
```

#### 2. Configure Environment Variables
Edit the `.env` file and replace the placeholder values with the generated keys:

```bash
# IMPORTANT: Replace these with the values generated above
secret_key=YOUR_GENERATED_SECRET_KEY_HERE
CHAT_SHARE_SECRET_KEY=YOUR_GENERATED_CHAT_SECRET_HERE
CHAT_SHARE_SALT=YOUR_GENERATED_SALT_HERE

# Database configuration (you can change the password)
database_url=postgresql://postgres:your_secure_password@eigent_postgres:5432/eigent
POSTGRES_PASSWORD=your_secure_password
```

**Security Note**: 
- Never commit the `.env` file with real values to version control
- Use strong, unique passwords for production environments
- The secret keys should be different for each deployment

#### 3. Start Services
```bash
# Build and start all services
docker compose up -d

# Wait for services to be ready (about 30 seconds for first run)
# Check if services are healthy
docker ps

# Verify the API is running
curl http://localhost:3001/health
# Should return: {"status":"healthy","service":"eigent-api"}
```

#### 4. Start Frontend (Local Mode)
In the project root directory (not in the server folder):

```bash
# Go back to the project root
cd ..

# Create or update .env.development to enable local mode
cat > .env.development << EOF
VITE_BASE_URL=/api
VITE_PROXY_URL=http://localhost:3001
VITE_USE_LOCAL_PROXY=true
EOF

# Install dependencies and start frontend
npm install
npm run dev
```

The application will be available at:
- Frontend: http://localhost:3000
- API: http://localhost:3001
- API Documentation: http://localhost:3001/docs

---

### Troubleshooting

#### Container keeps restarting
Check the logs to identify the issue:
```bash
docker logs eigent_api --tail 50
```

Common issues:
- **Missing environment variables**: Ensure all required variables in `.env` are set
- **Database connection failed**: Check that PostgreSQL is running and passwords match
- **Missing directories**: Ensure `app/public` directory exists

#### Database migration errors
If you see migration-related errors, you may need to reset the database:
```bash
# Stop services and remove volumes (WARNING: This deletes all data)
docker compose down -v

# Restart services
docker compose up -d
```

#### Port conflicts
If ports 3001 or 5432 are already in use, you can change them in `docker-compose.yml`:
```yaml
ports:
  - "3002:5678"  # Change 3001 to 3002 for API
  - "5433:5432"  # Change 5432 to 5433 for PostgreSQL
```

Remember to update the frontend `.env.development` accordingly.

---

### Common Commands
```bash
# View running containers
docker ps

# Stop/Start API container (keep DB)
docker stop eigent_api
docker start eigent_api

# Stop/Start all services
docker compose stop
docker compose start

# View logs
docker logs -f eigent_api
docker logs -f eigent_postgres

# Rebuild after code changes
docker compose build api
docker compose up -d

# Complete reset (WARNING: Deletes all data)
docker compose down -v
docker compose up -d
```

---

### Developer Mode (Optional)
For hot-reload during development:

```bash
# Stop API container, keep database running
docker stop eigent_api

# Run API locally with hot-reload
cd server
export database_url=postgresql://postgres:your_password@localhost:5432/eigent
export secret_key=$(openssl rand -hex 32)
export CHAT_SHARE_SECRET_KEY=$(openssl rand -hex 32)
export CHAT_SHARE_SALT=$(openssl rand -hex 16)

# Install dependencies and run
pip install uv
uv sync
uv run uvicorn main:api --reload --port 3001 --host 0.0.0.0
```

---

### Data Persistence
- Database data: Stored in Docker volume `server_postgres_data`
- Location: `/var/lib/postgresql/data` inside the container
- Migrations: Run automatically on container startup via `start.sh`

To backup your data:
```bash
# Backup database
docker exec eigent_postgres pg_dump -U postgres eigent > backup.sql

# Restore database
docker exec -i eigent_postgres psql -U postgres eigent < backup.sql
```

---

### Security Considerations

1. **Environment Variables**: 
   - Always use strong, randomly generated secrets
   - Never use the default/example values in production
   - Keep `.env` file secure and never commit it to version control

2. **Database**:
   - Change the default PostgreSQL password
   - Consider using SSL for database connections in production
   - Regularly backup your database

3. **API Access**:
   - The API is exposed on localhost only by default
   - For production, implement proper authentication and HTTPS
   - Consider using a reverse proxy (nginx, traefik) for production deployments

4. **Offline Usage**:
   - For fully offline environment, only use local models and local MCP servers
   - Avoid configuring any external Providers or remote MCP addresses

---

### Advanced Configuration

#### Custom Database Settings
You can customize PostgreSQL settings by modifying `docker-compose.yml`:
```yaml
environment:
  POSTGRES_INITDB_ARGS: "--encoding=UTF-8 --lc-collate=C --lc-ctype=C"
  POSTGRES_HOST_AUTH_METHOD: "scram-sha-256"  # More secure authentication
```

#### Performance Tuning
For better performance with large datasets:
```yaml
# In docker-compose.yml under postgres service
command: 
  - "postgres"
  - "-c"
  - "shared_buffers=256MB"
  - "-c"
  - "max_connections=200"
```

#### Using External PostgreSQL
If you prefer to use an external PostgreSQL instance:
1. Update `database_url` in `.env` to point to your PostgreSQL server
2. Comment out the `postgres` service in `docker-compose.yml`
3. Remove the `depends_on` section from the `api` service

---

### API Documentation
Full API documentation is available at `http://localhost:3001/docs` (Swagger UI) after starting the services.

### Support
For issues or questions:
- Check the logs first: `docker logs eigent_api`
- Review common issues in the Troubleshooting section
- Ensure all prerequisites are met and steps are followed in order