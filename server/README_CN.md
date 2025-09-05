### 背景与目标
本目录 `server/` 是在客户端本地下放的后端服务（FastAPI + PostgreSQL）。目标：实现本地与云端完全数据分离。部署该服务后，用户的注册信息、模型提供商配置、工具配置、聊天历史等敏感数据均保存在本机的数据库中，不会上传到我们的云端，除非你主动配置了外部服务（如云端模型提供商或远程 MCP 服务器）。

### 本地下放的服务范围（主要模块）
- 用户与账号
  - `POST /register`：邮箱 + 密码注册（仅本地 DB）
  - `POST /login`：邮箱 + 密码登录，返回本地签发的 Token
  - `GET/PUT /user`、`/user/profile`、`/user/privacy`、`/user/current_credits`、`/user/stat` 等
- 模型提供商 Provider（保存你的模型访问配置）
  - `GET /providers`、`POST /provider`、`PUT /provider/{id}`、`DELETE /provider/{id}`
  - `POST /provider/prefer`：设置首选 Provider（前端与后端将优先使用）
- 配置中心 Config（保存各类工具/能力所需的密钥或参数）
  - `GET /configs`、`POST /configs`、`PUT /configs/{id}`、`DELETE /configs/{id}`、`GET /config/info`
- 聊天与数据
  - 历史、快照、分享等接口位于 `app/controller/chat/`，数据全部落在本地数据库
- MCP 服务管理（导入本地/远程 MCP 服务器）
  - `GET /mcps`、`POST /mcp/install`、`POST /mcp/import/{Local|Remote}` 等

说明：上述数据均保存在 Docker 中的本地 PostgreSQL 卷中（见“数据持久化”），不经我们云端。若你配置了外部模型或远程 MCP，则相应请求会发往你指定的第三方服务。

---

### 快速开始（Docker 推荐）
前置要求：已安装 Docker Desktop。

1) 启动服务
- 
```bash
cd server
# 复制 .env.example 为 .env(或者按照.env.example的格式创建.env)
cp .env.example .env
docker compose up -d
```

2) 启动前端（本地模式）
- 在项目根目录创建或修改 `.env.development`，开启本地模式并指向本地后端：
```bash
VITE_BASE_URL=/api
VITE_USE_LOCAL_PROXY=true
VITE_PROXY_URL=http://localhost:3001
```
- 启动前端应用：
```bash
npm install
npm run dev
```

### 访问 API 文档
- 浏览器打开 `http://localhost:3001/docs`（Swagger UI）

### 容器与端口
- API 服务：本机 `3001` → 容器 `5678`
- PostgreSQL：本机 `5432` → 容器 `5432`

### 数据持久化
- 数据库数据存放在 Docker 卷 `server_postgres_data`，容器路径 `/var/lib/postgresql/data`
- 容器启动时会自动执行数据库迁移（见 `start.sh` 中的 `alembic upgrade head`）

### 常用命令
```bash
# 查看运行中的容器
docker ps

# 停止/启动 API 容器（保留数据库）
docker stop eigent_api
docker start eigent_api

# 停止/启动全部（API + DB）
docker compose stop
docker compose start

# 查看日志
docker logs -f eigent_api | cat
docker logs -f eigent_postgres | cat
```
提示：若拉取镜像缓慢，可在 Docker Desktop 配置国内镜像加速后重试。

---

### 开发模式（可选）
如果希望在本地以热重载方式开发 API（数据库仍用 Docker 中的 Postgres）：
```bash
# 1) 停止容器中的 API 服务，仅保留数据库
 docker stop eigent_api

# 2) 本地启动（需提供数据库连接串）
 cd server
 # 方式 A：在当前 shell 导出环境变量
 export database_url=postgresql://postgres:123456@localhost:5432/eigent
 uv run uvicorn main:api --reload --port 3001 --host 0.0.0.0

 # 方式 B：在 server/.env 中写入（示例）
 # database_url=postgresql://postgres:123456@localhost:5432/eigent
 # 然后直接运行同样的 uvicorn 命令
uv run uvicorn main:api --reload --port 3001 --host 0.0.0.0
```

---

### 其它
- API 文档：`http://localhost:3001/docs`
- 运行时日志：容器内 `/app/runtime/log/app.log`
- i18n 相关（仅开发者使用）
```bash
uv run pybabel extract -F babel.cfg -o messages.pot .
uv run pybabel init -i messages.pot -d lang -l zh_CN
uv run pybabel compile -d lang -l zh_CN
```

如需完全离线环境，请仅使用本地模型与本地 MCP 服务器，并避免配置任何外部 Provider 与远程 MCP 地址。