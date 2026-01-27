### Propósito

`server/` fornece um backend local (FastAPI + PostgreSQL) para alcançar separação completa entre ambientes locais e na nuvem. Após implantar este serviço, dados sensíveis como registro de usuários, configurações de provedores de modelos, configurações de ferramentas e histórico de bate-papo são armazenados em sua máquina e não são enviados para nossa nuvem, a menos que você configure explicitamente serviços externos (por exemplo, provedores de modelos na nuvem ou servidores MCP remotos).

### Serviços Fornecidos (Módulos Principais)

- Usuários e Contas
  - `POST /register`: Registro por email + senha (apenas banco de dados local)
  - `POST /login`: Login com email + senha; retorna um token emitido localmente
  - `GET/PUT /user`, `/user/profile`, `/user/privacy`, `/user/current_credits`, `/user/stat`, etc.
- Provedores de Modelos (armazenar configurações de acesso a modelos locais/na nuvem)
  - `GET /providers`, `POST /provider`, `PUT /provider/{id}`, `DELETE /provider/{id}`
  - `POST /provider/prefer`: Definir um provedor preferido (frontend/backend priorizará)
- Centro de Configuração (armazenar segredos/parâmetros necessários para ferramentas/capacidades)
  - `GET /configs`, `POST /configs`, `PUT /configs/{id}`, `DELETE /configs/{id}`, `GET /config/info`
- Chat e Dados
  - Histórico, snapshots, compartilhamento, etc. em `app/controller/chat/`, todos persistidos no banco de dados local
- Gerenciamento de MCP (importar servidores MCP locais/remotos)
  - `GET /mcps`, `POST /mcp/install`, `POST /mcp/import/{Local|Remote}`, etc.

Nota: Todos os dados acima são armazenados no volume PostgreSQL local no Docker (veja "Persistência de Dados" abaixo). Se você configurar modelos externos ou MCP remoto, as solicitações vão para os serviços de terceiros que você especificar.

---

### Início Rápido (Docker)

#### Pré-requisitos

- **Docker Desktop**: Instalado e em execução
- **Python**: 3.10.\* (3.10.15 recomendado)
- **Node.js**: >=18.0.0 <23.0.0

#### Etapas de Configuração

1. Inicie os serviços

```bash
cd server
# Copie .env.example para .env (ou crie .env de acordo com .env.example)
cp .env.example .env
docker compose up -d
```

2. Inicie o Frontend (Modo Local)

- No diretório raiz do projeto, crie ou modifique `.env.development` para ativar o modo local e apontar para o backend local:

```bash
VITE_BASE_URL=/api
VITE_USE_LOCAL_PROXY=true
VITE_PROXY_URL=http://localhost:3001
```

- Inicie a aplicação frontend:

```bash
npm install
npm run dev
```

### Abra a documentação da API

- `http://localhost:3001/docs` (Interface do Swagger)

### Portas

- API: Host `3001` → Contêiner `5678`
- PostgreSQL: Host `5432` → Contêiner `5432`

### Persistência de Dados

- Os dados do banco de dados são armazenados no volume Docker `server_postgres_data` em `/var/lib/postgresql/data` dentro do contêiner
- As migrações de banco de dados são executadas automaticamente na inicialização do contêiner (veja `start.sh` → `alembic upgrade head`)

### Comandos Comuns

```bash
# Listar contêineres em execução
docker ps

# Parar/Iniciar contêiner da API (manter DB)
docker stop eigent_api
docker start eigent_api

# Parar/Iniciar tudo (API + DB)
docker compose stop
docker compose start

# Exibir logs
docker logs -f eigent_api | cat
docker logs -f eigent_postgres | cat
```

---

### Modo Desenvolvedor (Opcional)

Você pode executar a API localmente com hot-reload enquanto mantém o banco de dados no Docker:

```bash
# Parar API no contêiner, manter DB
docker stop eigent_api

# Inicializar banco de dados (primeira execução ou quando o esquema do BD muda)
cd server
uv run alembic upgrade head

# Executar localmente (fornecer string de conexão do BD)
export database_url=postgresql://postgres:123456@localhost:5432/eigent
uv run uvicorn main:api --reload --port 3001 --host 0.0.0.0
```

---

### Outros

- Documentação da API: `http://localhost:3001/docs`
- Logs de tempo de execução: `/app/runtime/log/app.log` no contêiner
- i18n (para desenvolvedores)

```bash
uv run pybabel extract -F babel.cfg -o messages.pot .
uv run pybabel init -i messages.pot -d lang -l zh_CN
uv run pybabel compile -d lang -l zh_CN
```

Para um ambiente completamente offline, use apenas modelos locais e servidores MCP locais, e evite configurar quaisquer Provedores externos ou endereços MCP remotos.
