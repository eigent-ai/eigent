# Server 重构 v1 - 升级指南

> 适用版本: v0.0.89+
> PR: #1509

## 改动概述

Server 代码从扁平结构重构为**领域驱动架构 (Domain-Driven)**。API 接口和数据库结构均未变更，这是一次纯代码组织层面的重构。

### 目录变更对照

| 重构前 | 重构后 | 说明 |
|---|---|---|
| `app/component/` | `app/core/` | 基础设施（数据库、加密、celery 等） |
| `app/controller/` | `app/domains/*/api/` | 按领域分组的 API 控制器 |
| `app/service/` | `app/domains/*/service/` | 按领域分组的业务逻辑 |
| `app/exception/` | `app/shared/exception/` | 异常处理 |
| `app/type/` | `app/shared/types/` | 共享类型定义 |
| _(新增)_ | `app/shared/auth/` | 认证与授权 |
| _(新增)_ | `app/shared/middleware/` | CORS、限流、Trace ID |
| _(新增)_ | `app/shared/http/` | HTTP 客户端工具 |
| _(新增)_ | `app/shared/logging/` | 日志与敏感信息过滤 |

### 领域结构

每个领域（`chat`、`config`、`mcp`、`model_provider`、`oauth`、`trigger`、`user`）遵循统一结构：

```
app/domains/<领域>/
  api/            # 控制器（路由处理）
  service/        # 业务逻辑
  schema/         # 请求/响应模型
```

## 升级操作（必须）

**此改动对本地部署是 breaking change。** 旧版 server 代码因 import 路径变更将无法启动。

### Docker 用户

```bash
cd server
docker-compose up --build -d
```

**必须**加 `--build` 参数重新构建镜像。直接 `docker-compose up -d` 会使用旧镜像导致启动失败。

### 非 Docker 用户（本地开发）

如果你通过 `start_server.sh` 或 `uv run uvicorn` 直接运行 server：

1. 停止正在运行的 server 进程
2. 拉取最新代码
3. 重新启动 server

```bash
# 使用 start_server.sh
cd server
./start_server.sh

# 直接运行 uvicorn
cd server
uv run uvicorn main:api --reload --port 3001 --host 0.0.0.0
```

### Electron 桌面应用用户

重启应用即可，server 会自动重启。

## 常见问题

**Q: 数据会丢失吗？**
A: 不会。数据库卷和表结构未受影响，仅 Python 源码目录结构发生了变化。

**Q: 需要重新执行数据库迁移吗？**
A: 不需要。此次改动没有新增数据库迁移。

**Q: 出现 `ModuleNotFoundError: No module named 'app.component'`**
A: 说明正在运行旧版 server。请按上述升级步骤操作。
