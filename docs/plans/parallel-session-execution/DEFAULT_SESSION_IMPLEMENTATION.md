# 默认 Single Agent Session 并行：实现候选与验证记录

日期：2026-09-26，Asia/Singapore。分支：`fix/default-session-parallel-execution`。
基线：1.0.5，`5c11460ee7e885f6713e31b6531c38dce7061b15`。
状态：**实现候选，尚未完成真实默认配置和安装包验收，不能关闭发布问题。**
本分支用于草稿 PR，尚未合并或发布；未修改已安装应用或用户 RunJournal、Space 注册、配置。
[1.0.5 问题记录](RELEASE_1_0_5_FOLLOWUP.md) 保留历史结论，本页单独记录后续代码。

## 这份候选实现做了什么

普通 POSIX Single Agent 的首次发送和空闲时后续消息，从原入口接入现有
`workspace_runtime` 的 source capture、私有 workspace、不可变 CAS、finalizer、
publication outbox 和自动整合。不设置 managed manifest，不领取或重写 Session
的 managed route，也没有另建消息队列。原 RunCoordinator、FollowUp 队列和
Project 执行租约继续决定同一 Session 的顺序。

Git Space 保留原内容仓库注册和 primary checkout binding，执行时使用私有目录；
Gitless Space 使用 directory provider。共享目标只在源捕获和整合时经过原有 fence，
不再让普通 Run 的整个模型/工具执行阶段占用 primary writer。成功收尾先保存产物，
再提交自动整合。冲突保留产物和整合状态；一个 native Run 的增量作为一个一致性组，
其中一个文件冲突会暂缓该 Run 的整组发布，其他 Run 仍可继续。

普通 Agent factory、Astra Responses SDK、权限检查和工具 schema 保留。文件路径、
Terminal cwd、Browser 下载和缓存、stdio MCP cwd 绑定到私有目录。已知 File/上传
路径参数和本地 MCP 配置的原 Space 前缀在权限检查前映射；不会尝试理解任意远端
MCP 参数或把远端账户资源当作本地文件。

`NativeAgentRuntime` 保留 turn、工具线程/异步调用、子 Agent 和实际资源；Stop
先封闭派发，再停止本 Run 的 Terminal 并等待工具退出，随后关闭 Browser/MCP。
取消审批等待不会取消一个已经派发的文件写入者。清理失败、根目录身份变化或未知
写入者进入 needs-attention，不生成虚假的 settled receipt。

Browser 的已配置 CDP 池在工具首次使用时领取目标。资源忙时保留 Browser 工具，
等待可用目标并记录 waiting/acquired；停止等待者不释放其他 owner 的目标。
Node worker 直接使用已安装 `nodejs-wheel` 的实际二进制，避免杀掉 Python console
launcher 后留下 Node。关闭失败保留未结算状态，连接异常不能静默替换 owner。
stdio MCP 的 transport enter/exit 始终发生在同一个保留的任务上；保留自动探测
HTTP→SSE 回退，显式 transport 不回退，清理失败不能换连接后假定安全。

完成文件通过 Run/artifact ID 读取不可变 CAS，前端校验摘要、账户和 abort 状态。
Git Review 使用保存的 revision；共享目标后续被修改不会改变该 Run 的 Review/文件。
后台 publisher 重试已有 outbox；已完成 Run 重开 journal 后不重跑模型即可整合。

## 兼容边界及仍未完成的工作

- Windows 仍走原路径；本次复用的 publication 锁依赖 POSIX，未宣称 Windows 并行。
- 旧 direct-write Run 保留原 owner。空闲后续消息按新准入边界创建私有 workspace，
  不在活跃 Run 上切换目录；已恢复的旧 Run 沿用旧路径。完整的已安装 1.0.5 Session
  迁移验收仍未完成。
- native Run 的原地 Resume 返回明确的 `workspace_resume_recovery_required`。
  当前没有实现进程重启后的 native writer 所有权转移，不能仅凭旧 PID 或超时释放
  barrier。新 Run 和对原 Run 的 Resume 不能混为一谈。
- CAS 捕获使用现有边界：10,000 文件、20,000 entries、32 MiB/文件、256 MiB 总量、
  深度 64。操作目录如 `.venv`、`node_modules`、`.cache` 不复制；Git tracked 内容
  优先保留。其他 symlink/超限目录会明确拒绝。这会影响依赖源目录环境的大型项目，
  尚需实际工作负载验收。
- 此实现是可信工具的生命周期与目录绑定，**不是 OS 文件系统 sandbox**。任意 shell
  自行脱离进程组、第三方 MCP 创建后台 daemon、远端异步任务或共享账户的副作用，
  不能由 asyncio drain 单独证明停止。通用远端 connector 资源争用尚未建立完整的
  资源级串行规则；不得把 stdio MCP 夹具扩大成所有 connector 已验收。
- Gitless 文件打开已接 CAS；Gitless Review 尚未提供与 Git Review 等价的差异界面。
- Send now/FIFO 的原队列回归与停止实际 Terminal 的测试已覆盖；完整 Electron
  Send now、应用退出/重启和任务图标体验仍需要端到端验收。
- 当前源码用真实 writer-queued 事件前缀重放时，两种 Timeline 都显示等待 Space，
  没有复现安装包持续 Preparing 的具体 UI 原因。新增 pre-header 订阅保证普通源捕获
  的等待事件可以提前被看到；这不等于已定位并修复原安装包 UI 分支。

## 验证范围与证据

所有 smoke 使用新临时 HOME、配置目录、SQLite、Space 目录和日志，不读取用户
`.env`/Eigent 数据。只复用现有依赖，无安装。API smoke 禁止网络；Browser 独立套件
只允许 Python loopback，使用新的临时 Chrome profile 和本地 HTTP 页面。没有真实
模型、账户服务或已安装 Electron 的运行结果。

| 检查                                                                         | 结果 / 证据                                                                                                                        |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 旧默认路径、完整 Git 注册的串行复现                                          | `/tmp/eigent-default-parallel-baseline-02`，第二个 Run 等待 writer；不能以丢失注册绕锁为成功                                       |
| 默认入口矩阵                                                                 | **12 passed**，`/tmp/eigent-default-parallel-final-02`；probe / normal factory / Stop × 已注册 Git / Gitless × 同 Space / 跨 Space |
| native 生命周期、真实 stdio MCP、Browser 租约、普通整合、service/coordinator | **54 passed**，`/tmp/eigent-native-regression-08`                                                                                  |
| workspace 协议完整回归                                                       | **812 passed, 1 skipped**，`/tmp/eigent-workspace-protocol-03`；跳过项是需要独立启动的真实 Browser 夹具                            |
| legacy FIFO / File / Browser tab 兼容                                        | **21 passed**，`/tmp/eigent-native-compatibility-03`；含原 CDP pool 和 Electron target guard 回归                                  |
| 执行入口 guard                                                               | **26 passed**，`/tmp/eigent-native-guards-01`                                                                                      |
| 当前真实 Browser 夹具                                                        | **未通过**，`/tmp/eigent-native-browser-08`；工具初始化之前的直接 CDP `Page.navigate` 10 秒超时，本地 HTTP 自检成功                |

默认矩阵真实调用 `/chat`/空闲 `/improve`、RunCoordinator、SQLite、内容仓库注册、
原 Agent factory 和 Responses SDK。只替换模型响应 transport，并使用合成 tokenizer
和启动/账户边界；`step_solve` 明确接入 `single_agent_solve`，不覆盖完整复杂度路由。
两个 Run 在第一个放行前均到达模型调用，随后真实 Terminal 和 File 工具写私有目录，
以一次性授权通过原权限流程，逐个自动整合。Stop 用真实 `sleep` 中的 shell，证明
停止一个 Run 不停止另一个。证据中保留目录、事件和 observations 摘要。

协议测试覆盖冲突保留、无关整合继续、失败/取消不发布、准备线程取消后等待真实
复制结束、旧 writer 尚未结算时等待、重开 outbox 不重复执行等。其合成工具环境不能
代替真实模型/Browser/connector 或进程崩溃恢复验收。

真实 Browser 早期夹具还发现 Node console launcher 会留下子进程；已改为直接持有
实际 Node。旧夹具的两个残留 worker 通过与测试 Python 相连的 stdout pipe 确认归属
后精确终止，没有按程序名批量关闭浏览器。修改后的失败夹具可退出并清理自己的进程。
Browser 下载/并行关闭的目标断言因前置导航失败仍没有通过，不标成成功或跳过验收。

可重复命令（`PYTHON` 指向已有 Python 3.11 环境）：

```sh
"$PYTHON" backend/scripts/smoke_parallel_sessions.py --suite default --output /tmp/eigent-default-new
"$PYTHON" backend/scripts/smoke_parallel_sessions.py --suite native --output /tmp/eigent-native-new
"$PYTHON" backend/scripts/smoke_parallel_sessions.py --suite protocol --output /tmp/eigent-protocol-new
"$PYTHON" backend/scripts/smoke_parallel_sessions.py --suite compatibility --output /tmp/eigent-compatibility-new
"$PYTHON" backend/scripts/smoke_parallel_sessions.py --suite browser --output /tmp/eigent-browser-new
```

输出目录必须不存在。Browser 需要 macOS Chrome 和已有 Node 依赖；其前置运行条件
不满足时应保留失败证据，不更换用户 profile、放宽账户权限或改模型来获得通过结果。

## UI 与术语交付检查

本次复用既有 Timeline notice、RunFiles、FilePreview、Folder 和 Review；notice 使用
已有 `info` / `warning` 状态。没有新增标准控件、颜色、尺寸、阴影或 token，没有编辑
生成的 token，没有注册设计例外。新文案覆盖全部 11 个 locale；后端 `Project`、
`project_id`、路由、translation key 的既有兼容契约不重命名。

验证状态包括 preparing / 等待 Space、Browser 等待与取得、整合成功/等待/冲突、收尾
需处理、取消、不可变文件、摘要不符和账户/abort 防护。主题使用设计系统的程序检查；
尚未完成实际浅/深色画面检查。设计 HTML 的 `file://` 预览此前被浏览器 URL 策略阻止，
没有改用其他入口绕过。

最终检查结果：

- 聚焦前端 8 个文件 **370 passed**，日志 `/tmp/eigent-parallel-frontend-final-02.log`。
  包含 Timeline 双模式、投影、产物摘要/账户防护、fresh delivery、Space 模型选择和
  event registry。使用 `vitest run --silent --no-cache`；首次测试断言通过，但共享依赖
  目录中的 Vitest cache 写入被沙箱拒绝，已禁用 cache 重跑成功，没有扩大目录权限。
- `npm run type-check`、`npm run check:i18n`、`npm run check:design-tokens` 通过；
  设计系统检查覆盖 12 个主题 × 5 档对比度，共 60 个变体。
- 修改的产品 TS/TSX 聚焦 ESLint、修改文件 Prettier、35 个 Python 文件 Ruff format
  及 `git diff --check` 通过。Ruff check 使用 `--extend-ignore UP042` 通过；不加该参数
  会报告 `task.py` 两个原有 Enum 建议，已对 HEAD 原文件验证同样存在，未借此改枚举契约。
- 没有运行完整桌面打包或安装包 E2E，没有运行用户账户模型请求，也没有人工主题视觉验收。
- 提交前使用仓库锁定的 Ruff 0.14.3，35 个 Python 文件的 lint 和 format 全部通过（无需忽略规则）；修改 Python 文件的 Bandit 检查通过。均复用现有缓存工具，未安装依赖。

真实 Astra、完整 connector、安装包启动及账户服务部署均未运行；本候选不具备发布验收结论。
