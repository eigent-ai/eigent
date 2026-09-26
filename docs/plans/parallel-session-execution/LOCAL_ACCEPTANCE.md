# C6 本地受限并行 Session：部署与验收

后续普通入口的代码和测试结果单列于[实现候选记录](DEFAULT_SESSION_IMPLEMENTATION.md)，
不改变本页 C6 受限验收范围，也不代表安装包已通过验收。

1.0.5 普通 Session 在完整 Git 注册状态下的串行问题另见
[发布后续记录](RELEASE_1_0_5_FOLLOWUP.md)。本页结论仅适用于下述受限预览；
默认路径修复须单独完成真实模型、工具和安装包验收。

本切片允许显式选择的新 Session 在同一 Space 或不同 Space 并行执行，同一 Session 的消息仍按队列执行。范围是本地 Single Agent 的受限文件流程；默认关闭。C1–C5 与 C6 的既有代码在 Round18 对提交 `b62ab832bf60a13588dcf5e99f152e3c7199365a` 完成独立有限验收。本页补齐部署说明与可重复 smoke，不等于真实用户环境或全平台已验收。

## 三层启用边界

1. Brain 进程启动时未提供 `EIGENT_MANAGED_EXECUTION_MANIFEST`，则没有 managed execution 服务。
2. 显式 manifest 的 `enabled: true` 只注册后端服务；C6 产品入口还要求 `local_single_session_enabled: true`。该字段缺省为 `false`。
3. 每个新 Session 必须由用户选择「为此 Session 启用并行执行（预览）」。能力检查不领取 Session，未选择的 Session 保持原入口。已有 legacy Session 不迁移；已经领取的 managed Session 不能因开关关闭或服务不可用而回退到 legacy。

`session_history_enabled` 是独立的 C5 开关，缺省为 `false`。本页新增的 API smoke 保持它关闭。既有 TS→Python integration tests 会单独开启它，只使用合成历史和 mock 模型响应。权限、Provider 或 Space 失效时等待/拒绝，不临时扩大权限或更换 Provider。

## Manifest 与启动入口

[默认关闭的合成示例](deployment.synthetic.example.json) 只用于说明字段，`.test` 地址和绝对路径是占位值，不能直接作为实际部署配置。

| 字段                           | 含义                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `schema_version`               | 当前为 `1`。                                                                                                 |
| `enabled`                      | 须显式为 `true` 才初始化服务；示例为 `false`。                                                               |
| `server_url`                   | 既有账户/设备认证服务的 authority，须与 command sync 配置一致。HTTPS 或 loopback HTTP；这不是模型 endpoint。 |
| `tokenizer_asset_directory`    | 发布流程提供的 tokenizer 文件目录，必须为绝对路径，内容须匹配仓库固定的资产清单。                            |
| `capacity`                     | 全服务并行容量，整数 `2`–`16`；不等于允许同一 Session 同时运行多个 Run。                                     |
| `local_single_session_enabled` | 是否向产品开放 C6 本地 Single 入口，缺省 `false`。                                                           |
| `session_history_enabled`      | C5 同 Session 已提交、脱敏历史，缺省 `false`；进入每个注册配置的固定身份。                                   |

Manifest 不包含 key、账户列表、模型 URL、模型参数或用户目录。模型 endpoint 来自该 Run 已配置、授权并固定的 Provider；没有为 C6 增加固定 OpenAI 目的地。队列中已固定的配置不会随当前设置修改。

生产入口是 `backend/main.py` 的 startup：完成既有事实恢复之后，读取上述环境项，调用 `initialize_execution_service()` 和 `start_default_execution_service()`。shutdown 先关闭 execution service 及所属工作，再关闭 RunCoordinator/RunJournal。Electron 的 `electron/main/init.ts` 将父进程环境传入 Brain；要让该环境项生效，必须在启动该 Electron/Brain 进程之前显式提供，运行中编辑文件不会自动重新注册。不要把它写入共享 `.env` 或全局 shell 配置。

实际部署还需要这些已有条件：

- 账户服务已完成该分支对应的 Alembic migrations，已有账户、设备及 Provider 身份有效；Brain 拿到现有认证通道。本次 smoke 以 MockTransport 替代服务响应，没有部署 PostgreSQL/Redis。
- 发布目录具备 `backend/app/workspace_runtime/tokenizer_assets.json` 固定的 rank 文件与摘要。生产 loader 不下载、不搜索用户缓存、不估算回退。缺失资产不会注册 profile。本次 smoke 使用明确标记的合成 rank 文件与替换清单，只验证 loader 接线，不能证明发布包已包含真实资产。
- 新本地 folder/blank Space 的账户主 workspace binding、已 materialized 的精确 Bundle 和权限一致。C6 当前要求已有 `full_access` 受限文件配置，无审批交互；入口不会自动升级权限。
- Single 模式及已支持的 direct Chat Completions Provider；不包含附件、MCP、通用 Terminal/Browser、Workforce 产品迁移、旧 Session、warm Resume 或 cloud。
- RunJournal 本地 SQLite 按已有 schema 自动迁移；验收应使用隔离数据库，不能把 smoke 指向用户数据库。关闭开关不回滚 schema、不清除请求或 barrier。

## 可重复的合成 API smoke

使用已安装的 Python 3.11 backend 依赖和系统 Git，无需启动服务、安装依赖或设置 key。在仓库根目录执行：

```sh
backend/.venv/bin/python -B backend/scripts/smoke_parallel_sessions.py \
  --output /absolute/new/c6-smoke-evidence
```

也可以将 Python 路径替换为已存在的 backend venv 解释器绝对路径。`--output` 必须是尚不存在的新目录，runner 不覆盖或清理旧证据。

runner 在导入应用前创建独立 HOME、临时目录和 SQLite；子进程只接收显式环境。dotenv 读取、真实 DNS/socket 网络与隔离目录外的 Eigent 用户数据访问会报错。Git 使用合成目录，忽略全局/system 配置。它不读取真实账户、不运行 `uv sync`/依赖安装、不启动完整 `main.py`、Electron、telemetry 或 cloud sync。

测试装配真实 FastAPI execution router，并通过 lifespan 调用与生产入口相同的初始化、启动和关闭函数。外部账户响应、本地控制凭据、tokenizer 资产和模型 HTTP 响应是合成的；注册、权限/归属检查、SQLite 准入、scheduler、Single Agent/CAMEL/SDK 请求序列化、文件 worker、finalizer、固定产物与自动整合保持实际实现。

七个用例覆盖：

- 无 manifest、示例关闭、只启后端而省略 C6/C5 字段：均不能领取新 Session；缺本地控制凭据返回 401。后端已启用的情况仍执行账户身份校验，不访问配置/模型凭据。
- directory/Git × 同 Space/跨 Space 四种组合：两个 Session 的真实模型请求同时到达 mock transport，并在彼此释放前仍未结算，证明执行重叠。
- 第三个只查询能力的 Session 保持未领取；同一 Session 的后续消息在前继结算前保持 pending。
- 三个 Run 经过真实文件写入、结算和自动整合；API 仍能读取前后两个同名文件的不同固定内容。Provider wire 只指向合成的 `https://model.example.test/authorized/v1/chat/completions`。

结果位于输出目录的 `result.json`、`smoke.log`、`junit.xml` 和各用例的 `state/*/smoke-observations.json`。合成 SQLite/Git/资产也保留在该目录，失败时可检查当次事实。退出码非零即未通过；不要把历史 suite 通过数当成本次结果。

现有跨语言补充验收是 `test/integration/sessionExecution.test.ts`：真实 TS transport/store → JSON-lines bridge → ASGI，涵盖丢失回执重试、同/跨 Space 并行、FIFO、设置保存与冻结配置、Send now/Stop、固定产物、合成历史及事件 hydration。它不是 Electron/浏览器点击测试。已有 `.venv` 和 Node 依赖的隔离 checkout 可运行：

```sh
node node_modules/vitest/vitest.mjs run test/integration/sessionExecution.test.ts \
  --config vitest.config.ts --reporter=default
```

跨语言 fixture 自建临时 HOME、SQLite、Git，模型/账户 I/O 使用 mock；其缓存和日志属于测试 checkout。若 Node 依赖通过只读共享目录提供，须另将 Vite `cacheDir`/Vitest 输出设置到隔离目录，不能向共享 checkout 写缓存。

## 独立 review 后仍需用户/部署方验收

以下为后续验收步骤，本次未执行真实配置、登录或模型调用：

1. 在专用测试安装及新数据目录准备账户服务、设备身份、Provider、发布 tokenizer 和新测试 Space；核对 manifest 与能力返回。保持默认安装关闭，显式测试安装才启用 C6。
2. 在同一 Space 分别新建两个 Session，逐个勾选并行预览；再在另一个 Space 新建第三个并勾选。发送不同文件任务，观察重叠执行及独立状态。未选择的第四个 Session 应保持原行为。
3. 在同一 Session 追加两条消息，核对队列顺序；执行 Stop、Send now 和切换 Space/Session，核对取消收尾、另一个 Session 继续、页面重新进入后状态一致。
4. 修改同名文件后，核对每个 Run 的固定产物预览/下载与自动整合结果；冲突保持可见，不静默覆盖。检查一次退出/重启后已结算事实，不能把它解释成恢复失去进程的 warm Run。
5. 检查关闭开关后新入口不可用、已有 managed Session 无 legacy 回退。按需要分别验收操作系统与打包环境；本次无 Windows/发布包/真实 PostgreSQL 验证。

历史 native SQLite 崩溃与旧 8 秒 publication 超时的归因仍为 Unknown/Open，诊断暂停。Round18 已通过的是当前限定代码及自动化 gates；本轮不重放历史故障序列，也不从新增 smoke 通过推断历史根因已关闭。用户最终风险确认、远端 PR/CI 和发布由统筹推进，本轮不 merge。
