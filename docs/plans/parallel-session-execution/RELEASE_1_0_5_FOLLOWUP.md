# 1.0.5 默认 Session 并行：问题记录与后续处理

日期：2026-09-25，时间均为 Asia/Singapore（UTC+8）。
状态：根因已确认；默认产品路径尚未修复。本记录是处理建议，不表示实现或验收完成。

## 用户目标与当前缺口

用户希望同一 Space 下的普通 Session 无需环境变量或预览选项即可同时执行，成功结果自动整合回 Space；同一 Session 内的消息仍保持顺序。此次实际场景是 Single Agent、GPT-6 Astra、默认工具配置。

1.0.5 包含受限 managed execution 预览，但普通 Single Agent 仍走 legacy 通道。已注册 Git 内容仓库的 Space 中，这些 Session 共用 primary checkout，并持有覆盖整个 Run 的写锁。第二个 Session 因而等待第一个完成。用户看到的持续状态是 `Preparing to start tasks`，没有获得清晰的排队解释。

此前对手工测试结果的判断需要更正：测试中的并发是真的，但来自未进入写锁调度，不能据此认定默认产品路径的隔离并行已经交付。[已有 C6 合成验收](LOCAL_ACCEPTANCE.md) 的受限结论仍然有效，不应将其扩大为正式版默认能力。

## 已确认的对照证据

检查对象为安装的 `/Applications/Eigent.app` 1.0.5、当天 `main.log`、两个本地 RunJournal，以及开发测试提交与发布基线。只读检查，没有修改用户数据库、Space、应用包或环境配置。

| 项目                      | 当天开发测试                                         | 1.0.5 正式版运行                                           |
| ------------------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| 任务                      | ISS 交互页面、2048                                   | OpenAI 更新调研、2048                                      |
| 账户服务                  | `test-dev.eigent.ai`                                 | `dev.eigent.ai`                                            |
| RunJournal                | `~/.eigent/run-journal-pr1963-e2e.sqlite3`           | `~/.eigent/run-journal.sqlite3`                            |
| Session 路由              | 两条都是 `legacy`                                    | 两条都是 `legacy`                                          |
| 每组的工作目录            | 同一 Space、同一目录、`direct-write`                 | 同一 Space、同一目录、`direct-write`                       |
| 测试库 Git / 工作目录状态 | `git_repositories=0`、`project_workspace_bindings=0` | 当前 Space 有 Git 仓库注册，两条 Session 指向同一 checkout |
| 写锁                      | 测试库 `workspace_writer_requests=0`                 | 第二个有明确 queued / acquired 记录                        |
| managed 执行              | `execution_requests=0`                               | `execution_requests=0`                                     |

时间线：

- 16:52:39：ISS 开始实际 Attempt。
- 16:52:58：2048 开始实际 Attempt；ISS 尚未完成，两者确实重叠。
- 16:57:40：2048 完成。ISS 后续经过重新启动/继续执行，于 17:15:21 完成；不能把整个墙钟区间当作连续运行时间。
- 22:50:23：正式版第一个任务取得共享 checkout 写锁。
- 22:50:46：第二个任务产生 `workspace.writer.queued`，`blocker_task_id` 指向第一个。
- 22:52:38：第一个完成并释放锁；第二个立即取得锁，`wait_duration_ms=111790`。
- 22:52:39：第二个开始实际 Attempt。

开发配置中已有 `EIGENT_RUN_JOURNAL_PATH` 指向独立测试库。该库没有携带原 Space 的 Git 注册状态；默认库中原测试 Space 的注册仍存在。正式版使用默认库，当前 Space 的仓库注册也存在。因此，环境差异不能归因于用户忘记设置 managed execution 开关，也不是模型请求的 112 秒延迟。

代码对照：开发测试 checkout 的 `f5a8ab909` 与发布基线 `5c11460ee`，以及实际安装包中的以下四个文件逐字节一致：

- `backend/app/controller/chat_controller.py`
- `backend/app/workspace_git/coordinator.py`
- `backend/app/workspace_git/scheduler.py`
- `backend/app/run_runtime/admission.py`

本次没有发现上述调度路径在打包时被换成另一份代码。远端 server 的全部配置和代码不在此次一致性结论内。

## 原因与代码位置

1. [WorkspaceGitCoordinator.admit_run](../../../backend/app/workspace_git/coordinator.py) 查询本地 `get_space_git_repository(space_id)`；没有记录时直接返回 `None`，不创建写锁请求。这解释了独立测试库中的 legacy 并发。
2. 同一函数对 Single Agent 使用 primary checkout；其他模式存在内部 Run checkout 分支。不能把那个条件反转一下就认定 Single Agent 完成隔离：工具目录、产物归属、整合和取消收尾也必须接通。
3. [WorkspaceWriterScheduler](../../../backend/app/workspace_git/scheduler.py) 对共享 checkout 串行准入；[chat_controller](../../../backend/app/controller/chat_controller.py) 接入此流程。这个锁仍承担共享目录的一致性责任。
4. [workspace_runtime/runtime.py](../../../backend/app/workspace_runtime/runtime.py)、[registration.py](../../../backend/app/workspace_runtime/registration.py) 和 [agent_configuration.py](../../../backend/app/workspace_runtime/agent_configuration.py) 构成另一条显式启用的受限通道。普通模型、Responses API、通用工具和旧 Session 尚未完成产品迁移；提供 manifest 不能直接解决本次默认使用场景。
5. [chat adapter](../../../src/lib/projector/chat/adapter.ts) 已有 `workspaceWriterNotice`，并非完全没有等待事件映射。还需追踪事件投影、时间线模式与 [PreparingToExecuteTasks](../../../src/components/ChatBox/MessageItem/PreparingToExecuteTasks.tsx) 的显示优先级。此次只确认后端持久化了等待事实、用户仍看到 Preparing，尚未定位具体 UI 分支。

## 建议处理顺序

### 1. 先补可重复的默认入口复现

- 保持用户数据不动，使用合成账户、Space 和目录创建隔离夹具，但通过正常流程注册真实 Git 内容仓库及工作目录绑定。
- 测试开始时断言目标 Space 的仓库和 binding 存在，两个 Session 指向同一物理目标；缺失时测试失败，不能继续把它作为默认并行用例。
- 从普通发送入口发起两个 Single Agent 任务，不手工插入 managed policy、不设置并行 manifest、不跳过写锁。用可控制的模型响应门控验证第二个是否在第一个释放前到达实际执行。
- 将当前排队行为作为已知问题复现，并保留已有共享目录写锁测试。最终修复应让普通 Session 执行于私有目录，而不是破坏共享写入的串行保证。
- 对“有 Git 注册”和“确实无 Git 内容仓库”的 Space 分别验收。磁盘上有 `.git` 但隔离库丢失注册的情况单独记录，不能与正常 Gitless Space 混为一谈。

### 2. 单独修正等待状态的展示

- 复用现有 writer 事件与投影，明确展示正在等待共享目录及解除等待的状态；有可靠的阻塞 Session 身份时才展示对应名称。
- queued、acquired、取消、失败、完成及事件重放均需更新显示；只在尚未获得具体启动状态时使用通用 Preparing。
- 复用现有时间线及状态组件，遵守 [设计系统](../../design-system/design.md) 和 [产品术语](../../product-terminology.md)，保留现有事件、路由和 persisted key。
- 这一步只改善可解释性，不能单独关闭默认并行问题。

### 3. 完成普通 Session 的隔离执行接入

建议继续复用 `workspace_runtime` 已有的准入、私有 workspace、固定产物、finalizer 和自动整合协议，补完整 Single Agent 适配；避免再建立一套互相独立的消息队列或整合协议。

首个产品范围必须覆盖本次真实场景：默认模型选择（包括当前 Astra / Responses 路径）、正常权限配置，以及任务实际使用的文件、Terminal、Browser 和 connector/MCP 路径。逐项核对能力；不能通过换模型、禁用默认工具或提高权限来让测试通过。不能保证并行的外部资源应只对该资源明确排队，不应让整个 Space 的所有任务静默串行。

需要一起接通的边界：

- 不同 Session / Run 使用独立可写目录；模型、文件工具、shell 的 cwd、附件与产物解析都绑定到该 Run，禁止意外落回 Space 主目录。
- 执行阶段互不持有整个共享 checkout 的写锁；收尾保存不可变产物，再经现有整合协议短时占用目标发布权。实际冲突保留双方内容并明确展示。
- 同一 Session 保持 FIFO；Stop、Send now、失败、应用关闭都按精确 owner 收尾。Terminal / Browser / MCP 的实际写入者未停稳时，不得仅凭前端完成状态释放整合屏障。
- 新 Session 的默认准入、已存在 legacy Session 的后续消息、旧 Run 恢复分别制定兼容规则。现有 [routing.py](../../../backend/app/workspace_runtime/routing.py) 明确拒绝原地领取 legacy Session；需要显式设计空闲时的迁移边界，不能直接改数据库 route 或在活跃 Run 上切换 owner。
- 打包、启动和账户服务部署一并交付。正式用户正常启动应用就应得到已验收的能力，不再依赖手工 manifest、开发环境变量或手动导入 tokenizer。

可复用 legacy 的私有 checkout 代码，但仅调整 `session_mode` 分支或仅换工作目录不足以通过上述验收。最终桥接方式需在实现前以一条完整、可取消、可自动整合的真实任务链验证。

### 4. 用发布包关闭问题

| 验收场景                               | 必须证明的结果                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| 同 Space、已注册 Git、两个普通 Session | 第一个仍执行时第二个已实际调用模型/工具；可写目录独立                            |
| Gitless Space、两个普通 Session        | 同样可以隔离执行，不能依赖丢失元数据绕过调度                                     |
| 跨 Space                               | 不同目录互不阻塞；同一物理目标的整合仍正确协调                                   |
| 同 Session 连发消息                    | FIFO，始终只有一个活跃 owner                                                     |
| 两个 Session 修改同一文件              | 可合并改动自动整合；冲突不覆盖任一方；无关任务继续                               |
| Stop / 失败 / 应用重启                 | 无重复执行、遗留写进程或错误完成状态；一个 Session 停止不停止另一个              |
| 默认 Astra / Responses 与正常工具      | 保持用户配置执行，不改用受限测试 profile                                         |
| Review / 文件打开 / 完成图标           | 不依赖关闭再打开刷新；固定产物正确；此项作为相关体验回归，不预设与本次写锁同根因 |
| 开发启动与安装包启动                   | 同一夹具功能状态下行为一致；无手工环境配置；保留路由、目录、事件时间线证据       |

并发证据必须包含两个 Run 的实际执行重叠、目录绑定与模型/工具活动，不能只看两条 Running 图标、请求已受理或 `step_solve STARTED` 日志。真实默认配置与安装包 E2E 不能由合成 API smoke 替代。

## 不采用的处理

- 不清除用户数据库、Space Git 注册或工作目录绑定以恢复并发。
- 不删除共享 checkout 写锁，也不在写入者仍活跃时提前释放。
- 不以自动打开受限预览、延长超时或修改 Preparing 文案作为完整修复。
- 不把此次调度根因直接套用到此前 Review、完成图标或文件点击问题；那些问题需要各自的证据和回归。

## 跟进清单与本次交付

- [x] 确认开发测试与正式版两组任务及各自 journal、route、工作目录和写锁事实。
- [x] 核对相关调度代码一致性，记录此前验收遗漏。
- [x] 记录建议实现方向、兼容性边界和发布验收条件。
- [ ] 增加默认入口与完整 Space 注册状态的复现夹具。
- [ ] 定位并修复等待状态显示优先级。
- [ ] 完成完整 Single Agent 隔离执行、整合、部署及旧 Session 兼容方案并实施。
- [ ] 在真实默认配置和安装包上完成上述验收，之后再关闭问题。

本次仅新增问题记录并链接既有设计/验收文档，没有修改运行时或用户配置。文档校验见本次交付说明；没有运行应用测试，也没有宣称问题已修复。
