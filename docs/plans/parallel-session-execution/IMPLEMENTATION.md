# 并行 Session：C1–C6 接线状态

C1 经审查接受的提交为 `f3d9a7c75c9b1c817f61c278e051cb31140793c9`，C2 为 `1142e72f20684d5d151f602c219473fbab25640b`，C2-R6-1 已关闭。C3 的真实 Workforce 受限 profile 在 Round8 获 Accepted-for-next-stage，提交为 `ba4e11157f274893a5c998ab7060d6df6842d48b`。C4 的修复提交 `1d0c85f7c1d4b01aae27a8e9bdb83640628e609b` 在 Round10 获 Accepted-for-next-stage，C4-R9-1 已关闭。C5 已接通受限 Single Agent / Workforce 的同 Session 历史输入；C6 接通默认关闭、逐个新 Session 显式 opt-in 的本地 Single 受限入口。C1–C5 与当前有限 C6 代码在 Round18 已完成独立 review，历史 native/旧 publication 超时归因仍 Unknown/Open。部署与本轮可重复验收见 [C6 本地验收说明](LOCAL_ACCEPTANCE.md)。沿用已审查的 [架构设计](README.md)，完整产品迁移与默认 rollout 仍未完成。

## 已接通的调用链

认证 API → 单一消息/准入事务 → 后台公平 dispatcher → Git / directory 固定输入 → 私有 workspace → dormant RunCoordinator → durable activation → 已注册 runtime handler（C2：真实 Single Agent；C3：真实 Workforce 任务流）→ 显式 cwd/env 的受控文件 worker → 停写证明 → immutable checkpoint / artifacts → terminal、barrier、lease、outbox 原子结算 → 后台自动整合。

- 同一或不同 Space 的不同 Project/Session 独立执行；同一个 Project 的请求继续 FIFO，Send now 与兼容消息队列在同一事务同步。
- Send now 在同一事务写入优先级、操作回执和当时 canonical lease 对应的 Run/Attempt/generation 取消意图。实际 owner 停稳并由 finalizer 保留 partial artifacts、释放 barrier 后，后继才准入；preparing claim 保持原行为。V38 仅新增 `execution_delivery_operations`，也保存“当时没有 admitted owner”的回执，迟到重试不重新选择取消目标。
- 新 API 只接收引用，不接受原始环境、credentials、绝对输出目录或 client origin。`ExecutionPolicyRegistry` 由可信部署代码显式注册 Project、principal、配置 revision、源目录、provider、权限检查和 runtime resolver。未知配置引用在持久化前拒绝，缺配置不猜测。
- runtime resolver 必须保存属于该 Run 的不可变 EnvironmentSpec；交接沿用 RunJournal 的 ownership/digest 检查。每个工具启动前重新检查权限、durable cancel、Run/Attempt/generation 和 finalization owner。
- 文件写入只支持内置、无后代进程的声明式文件 worker；不接受 shell/eval/MCP/任意子进程。stop 会 seal dispatch、等待注册任务、终止并 reap 自己持有的进程，证据不足保留 barrier。这个边界不能推广为任意第三方工具或 OS sandbox。
- 本地取消和另一服务实例提交的 durable cancel 都由实际 owner 消费；取消等待 API 或关闭等待者不会遗失正在运行的准备线程或 finalizer。
- Run 提前进入终态也必须停止尚未结算的实际 owner；取消、关闭和后台扫描沿用 exact owner 停写，保留既有终态。准备失败先释放 claim 并隔离重试，仅在核实未交接且能普通清理私有副本后继续；Git dirty overlay 或未知/部分准备现场保留证据，进入持久 `preparation_cleanup_required`，不重复分配副本。成功 handoff 后释放临时 preparation 引用，Run 输入引用继续保留。
- 自动整合使用原有 integration core，在真实 physical target、binding 与当前 source/target 授权匹配后发布。配置改绑到 B 不授权旧 outbox 写 A。无正常流程的手动 Apply；真实冲突保留原版本与输出。
- 部分整合且仍有 pending/waiting 路径的请求继续按 backoff 自动重试；前序完成后可推进后继路径。只剩冲突或需要 rebase 的请求等待 resolution，不因部分成功而反复调度。
- 下一轮输入在固定 target revision 上按每轮原始 I→O 折叠尚未整合的 Session 修改；真实输入冲突、目录依赖或不明覆盖范围进入 typed wait。其他 Session 继续执行。不会静默选边或把旧 mutation receipts 当作新授权。
- 产物读取只解析 finalization 指向的固定 CAS revision；后续修改工作目录、共享目录或同名文件不改变旧产物内容。
- 旧 start/improve/follow-up/Resume/activation/cancel/stop 在副作用前拒绝受新准入管理的 Session；旧 artifact-first 恢复与 Git auto-writeback 不得固化或释放 isolated owner。启动只观察其他实例的未验证 owner，不通过 TTL 或改 generation 接管。
- 旧 follow-up 的新增、提权、取消、拒绝和 admitted mutation 在自己的 SQLite 写事务内再次检查 managed ownership；竞争中若新 canonical 准入已提交，旧 API 明确返回 `409 managed_execution_required`，不留下只改兼容消息的半份状态。

## C2：真实 Single Agent 的受限接线

可信后端代码显式构造 `FrozenAgentConfiguration`、`LoadedOpenAITokenizer` 和 `SingleAgentExecutionAdapter`，再把 adapter 生成的 policy 注册到既有 registry。其 handler 调用 `managed_single_agent_turn` → 既有 `single_agent` 工厂 → 既有 `agent_model` / `ModelFactory.create` → `OpenAIModel` → `ListenChatAgent.astep` / CAMEL 循环。没有包装旧 solve 的 Session lifecycle，也没有用叶子 worker 模拟 Agent。

- **完整配置身份独立于 Bundle。** `agentcfg:` revision 固定本 profile 支持的全部非秘密模型参数、显式 endpoint、constructor 参数、provider capability/transport/effort、tokenizer 内容引用、工具集合和 Space/Project/principal/权限/credential 引用。调用方后续改字典不改快照；改 registry 配置不能重定向已入队请求。Run-owned EnvironmentSpec 保存完整快照及私有 materialization，Bundle revision 保持原义。模型工厂使用已冻结 capability，不重新读取当前 catalog。
- **窄模型能力。** 当前仅 direct OpenAI 兼容的 async Chat Completions，非 streaming、单个响应、显式 HTTPS endpoint、受限参数 schema；无 subscription/OAuth、Responses、云账户恢复或未知 constructor 字段。未知配置明确失败，不静默丢弃参数或回退 latest。权限只按 preset/exact Space revision 解析，缺失或比 Bundle 更宽的 profile 在模型创建前等待；不采用当前 Space 默认值。
- **资源归属。** 每次 Run 新建 Agent、两个 SDK client 和投影。SDK 显式 key/base URL/timeout/retry/organization/project/webhook 设置，HTTPX `trust_env=False`。部署必须传入已在内存加载且内容匹配的 CAMEL/tiktoken counter；本 adapter 不下载 tokenizer、不搜索缓存，不复制主进程环境。credential resolver 必须按 exact identity 查询，key 仅在内存；撤权或材料变更不热换到正在执行的 Agent。
- **工具与权限。** 只装配 private root 的有界 UTF-8 `read_file` / `write_to_file`；写入只替换文件，父目录必须存在，单文件上限一 MiB，不开放任意代码执行或目录发现工具。保留真实 permission engine、tool checkpoint 与 mutation receipt。路径验证在 worker 启动前可返回既有 typed no-write 拒绝；启动后的 worker 错误仍保守保留未知/partial outcome，不能改称无副作用。人工 approval bridge 尚未迁移，需人工确认的动作以 `interactive_approval_unsupported` 拒绝，既有 checkpoint 收尾关闭相应 pending approval。
- **私有 compatibility scope。** RunContext、journal 和 Agent 侧 TaskLock lookup 绑定当前 owner；相同技术 Project 名的并发上下文也不改共享 map。legacy 调用不在 scope 时保持原路径。投影进入当前 journal，不能唤醒 process-global cloud sync；未证明安全的 CAMEL telemetry instrumentation 在创建前拒绝，实例模型文件日志在首个请求前禁用。
- **真实收尾。** first-party 投影、tool checkpoint 与 model capture 的线程/任务均登记并 drain。取消发生在 model capture 开始行提交期间时，先等提交完成，再记录未派发失败。取消等待者不会遗弃线程；连续取消也必须等待 scope drain。model/agent waiter 可取消，SDK client 会关闭，文件 worker 仍由 BoundRuntime seal/reap。finalizer 必须等 handler 和这些 writer 停稳才可 checkpoint、释放 barrier；取消结果只保留固定 partial artifacts，不自动发布。

follow-up 的本轮提示从匹配 request/Project/admitted Run 的 canonical 消息行读取，工作文件沿用 C1 固定输入与未整合输出折叠。每轮都重建 Agent；尚未恢复历史对话 memory、warm runtime、Bundle instructions/context/skills/connectors/MCP 或自定义多 Agent 声明，这些声明在本 profile 中明确拒绝。backend 主动注册能力只适用于这个 profile，不能作为完整 Single Agent 模式已迁移的依据。

## C3：真实 Workforce 的受限接线

可信部署代码使用 `FrozenAgentConfiguration(session_mode="workforce")` 与 `WorkforceExecutionAdapter` 注册 policy，复用 C2 的完整配置、凭据、tokenizer、RunContext、私有投影和 C1 的准入/finalizer。Single 和 Workforce adapter 在注册前检查 mode，不能用同一配置悄悄换执行模式。`workforce-workspace-files-v1` 将两个固定 worker、16 个子任务上限、关闭动态 worker/恢复策略/共享 memory 纳入配置快照及 revision。

| 阶段       | 实际调用与边界                                                                                                                                                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 准入       | 既有 API → `ExecutionService` / canonical request → dispatcher → 私有 workspace → Run-owned EnvironmentSpec → `WorkforceExecutionAdapter._run` / `_execute`                                                                                    |
| 构造       | `construct_managed_workforce` → 四次真实 `agent_model` / `ModelFactory.create` / `ListenChatAgent` → `ManagedWorkforce(Workforce)`；无 legacy `step_solve` lifecycle                                                                           |
| 分解       | 实际 task Agent `astep` → CAMEL `Task._decompose_non_streaming` / `parse_response` → parent/subtask 与依赖记录；空任务或超限失败，不凭默认 task 绕过                                                                                           |
| 分配       | 实际 coordinator `astep` → CAMEL assignment schema → 全量唯一分配、既有 worker、已知依赖及无环检查；不创建未知 worker 或用默认模型重试                                                                                                         |
| 调度执行   | 既有 `eigent_start` → CAMEL `start` / `_listen_to_channel` / `_post_ready_tasks` → `TaskChannel` → CAMEL Worker listener / `_process_single_task` → Eigent `SingleAgentWorker._process_task` → 实际 worker `ListenChatAgent.astep` / tool loop |
| 文件与完成 | C2 私有 `read_file` / `write_to_file` → 真实权限和 checkpoint → C1 文件进程/receipt；CAMEL 回传 Task、完成传播、父任务聚合与依赖后继启动                                                                                                       |
| 停止       | Runtime cancel → 停止调度 → 取消并 join 已持有的 worker/model waiter、listener 及 channel getter → 关闭全部 SDK client → drain 实际 checkpoint/capture/Step/投影线程和任务                                                                     |
| 固化整合   | 已停止的 handler / 文件 worker → C1 settlement / partial CAS / finalizer / 自动整合；超时、Task 终态或 stop flag 都不是停写证明                                                                                                                |

### 构造与执行边界

- 每轮新建 coordinator、planner、file author、file editor 四个 Agent 和四组独立 SDK client。所有角色从同一冻结 options、capability、effort、permission、credential、tokenizer 与 private root 构造；没有角色默认模型或 latest catalog 回退。既有 task Agent 强制 streaming 的规则仅留在 legacy 分支，本 profile 保持冻结的非 streaming 参数。
- CAMEL 构造器会围绕传入的 model/memory 创建临时 ChatAgent。受管构造保留其追加的管理提示，并在首个模型调用前恢复实际工厂创建的 ListenChatAgent；临时对象使用已提供的模型和内存，不另建 SDK、默认模型或工具。测试核对实际执行对象身份及四个模型参数。
- 每个 worker 在本轮只使用自己的显式 Agent，不进入 clone/pool；同一 worker 的多个子任务依次使用并 reset 本地对话，两个 worker 可同时运行。两个 worker 共享本 Run 私有目录，工具写入继续由 BoundRuntime 的 mutation guard 管理；跨 worker 读写先由 CAMEL 依赖关系排序。不同 Run 使用不同副本，不共享 Agent、client 或 TaskLock。
- coordinator/planner 无文件工具，两个 worker 只有有界 UTF-8 read/write。动态 worker、嵌套 Workforce、role-playing/delegation 和 warm clone 明确拒绝；关闭质量重规划及自动重试，失败保留实际结果。Browser、Terminal、MCP、human bridge、Skills、Bundle 内容、历史/工作流 Memory 和未知 telemetry 仍不进入此 profile。Agent 本轮推理所需的内存不等于恢复用户历史 Memory。
- 默认 WorkforceLogger/metrics 不构造。CAMEL telemetry 检查沿用 C2，并在构造前拒绝 traceroot。没有安装、启动服务、查找用户凭据或 tokenizer 资产的 bootstrap。

### 归属与停止顺序

- 每个真实 worker 子任务进入它的 authored Step scope，model capture、tool checkpoint 与投影均关联相应 Step。受管 Workforce 的 checkpoint ID 在 Run 内再按该 Step 命名，保留 provider 原始 ID；不同 worker 返回同一个 provider ID 时，不共用 receipt。Single/legacy 的 ID 规则不变。
- 既有 Workforce 的 TaskLock lookup 支持 C2 私有 scope；scope 外仍走 legacy map。Step 写入线程由 owner 持有。若取消发生在 queued/running Step 提交期间，先等待真实提交，再关闭尚未 post 给 CAMEL 的 Step；提交失败不伪造完成记录。
- CAMEL listener 创建的实际 worker task 保留独立 handle，stop 不清空后丢弃。关闭入口自身登记为 owned task，连续取消 handler/API/close 等待者也须等它结束；worker 的模型/工具收尾和 SDK 全部关闭后，外层 scope 继续等待尚在提交的 checkpoint/capture/投影。子任务终态投影只说明事实，不能代替停写。
- 取消或失败产物固化为真实 partial CAS，不能自动发布。取消落在已经派发的工具内时仍保留 `outcome_unknown` / 外部效果可能发生的记录，不改称“已知未写入”；后继继续受既有未解决工具结果保护。未知 graph/descendant 或 SDK 关闭证明失败调用 sticky unmanaged-writer gate，finalizer 保留 `needs_attention` 和 barrier；其他 Session 不受阻。
- 本链路是对固定第一方代码的任务/进程归属管理，不把 ContextVar、coroutine 或普通进程称为 OS sandbox，不涵盖任意第三方后代、重启接管或跨进程恢复。

## C5：同一 Session 历史上下文（默认关闭）

用户明确授权：同一 Session 已提交、脱敏的消息、工具结果和历史交互，可以作为上下文发送到该 Run 已配置、授权并固定的 Provider。本片仅用 mock 模型响应验证，未启用真实部署或发送真实历史。

- 本地投影从匹配 request / Project / admitted Run / Attempt 的 canonical 消息读取当前问题；历史仅选择同一 Project、同一账户／设备权威及同一 Space 下已完成真实结算的 managed Runs，并复核注册配置、Run-owned EnvironmentSpec 和 workspace binding 的身份及摘要。
- 每次读取使用有界 SQLite 只读快照，通过既有 Project / updated_at 索引读取最近更新的最多 8 个历史 Run 候选及一个溢出标记，再按验证后的 admission generation 排成实际执行顺序。Send now 改变执行顺序时不按 intent queue_seq 漏掉前继。每轮最多 512 events / 128 KiB、总 payload 一 MiB；超限整轮省略并报告缺失。无 canonical 注册记录或可验证配置的旧历史明确缺失，矛盾或损坏的身份与消息拒绝读取；不为填满 8 Runs 无界扫描旧历史。既有 legacy ContextProjector 不变。
- 保留 user、assistant final、成对工具请求／最新结果、错误／取消／未知状态及历史交互事实；排除 hidden reasoning 和 display token，typed / legacy 去重，复用秘密与设备 home 路径脱敏。历史 approval 仅是已发生的事实，不生成当前权限。
- 在该 Run 开始执行、前继已真实结算后，通过 owned thread 读取一次不可变来源；排队期间刚完成的前继会被纳入，capture 后才提交的事件等到下一个 Run 才可见。当前问题来自 canonical 消息，只进入本轮任务一次，当前 Run 不属于历史。
- 每个新建 Agent 的实际 async Chat Completions `create` / `parse` 边界使用同一份 Run 来源，以独立 user 消息插入历史数据，并在原 system/developer 指令后加入历史使用约束。Single、Workforce planner/coordinator/两个文件 worker 都执行此路径；历史不追加到 CAMEL memory，也不复制进 `Task.content`，后续模型调用中仍只有一份。
- 预算使用已加载的真实 tokenizer 和实际模型窗口，计入最终 system/current messages、完整 tool-call arguments、tools/schema 和输出预留。结构化响应按 SDK 实际 JSON schema 计数；输入上限为模型窗口减输出预留与 64 Ki tokens 的较小者，历史上限 8192 tokens，另保留 256 tokens 协议余量。输出优先采用固定配置里的正整数 `max_tokens` / `max_completion_tokens`；两者并存或无效即拒绝。两者都未提供时，将 4096 写入实际请求作为输出上限。仅选择连续最近的完整 Run，不截取成功结果；一个 Agent 首次选择后保持该投影，后续输入增长超限会拒绝，不能静默换历史。
- 派生诊断继续使用既有表，仅保存实际保留的 source event IDs、capture 时的 Project state version、投影 SHA-256 及真实 token 数；新增路径不保存原始历史 prompt，不创建第二个 history store。SDK 注入发生在既有 model capture 的请求记录之后，历史不会再次写进该记录。拒绝仅记录固定原因码。
- SDK 派发前重新复核现有 runtime/Provider 凭据权限，并检查实际 client endpoint/model 与固定来源一致；不会选 latest Provider，也没有固定 OpenAI URL 或额外目的地白名单。预算后的 messages 和 tools/schema 使用副本。capture、tokenization、diagnostic work 全部属于 handler 的 owned scope；取消等待者、取消 Run 或关闭服务必须等实际线程结束，才允许 finalizer 结算与释放 barrier。

开关是可信部署 manifest 的可选布尔字段 `session_history_enabled`，缺省为 `false`。启用后新注册配置的 binding 固定 `history_context: journal-context-v1`，进入既有 registration digest / configuration revision。已有 C4 配置仍关闭历史；旧 intent 不会随着新默认值静默升级。关闭开关时，已启用历史的待执行配置不可恢复，保留 intent 等待原能力恢复，不能静默丢弃历史降级执行。HTTP 请求体不能自行启用它；本片未修改真实部署 manifest。

合成验证保留 C4 注册/API/准入/调度/finalizer、真实工厂/CAMEL/SDK 对象，mock 仅位于账户 server、模型响应和 tokenizer 资产边界。覆盖正常 start/follow-up、同/跨 Space 两个配置不同 Provider 的并行、排队前继、当前消息去重、角色分隔、秘密/设备 home 脱敏、真实失败/取消、未知结果语义、完整 Run 预算裁剪、响应 schema、配置/账户/Attempt 错配、权限撤销、默认关闭与恢复、dispatch 前不可变 capture、两 profile 的取消/关闭与阻塞线程收尾。命令、结果及提交身份以既有外部开发报告的本次冻结证据为准。

## API 与启用边界

C4 按统筹确认的 A 路径复用现有 server 账户／设备认证与 Provider 权威源。服务启动只有在显式部署 manifest 和完整 tokenizer 资产可用时，才创建受控服务；能力查询不读取配置、资产、凭据、数据库，也不启动同步 worker。旧完整模式的 capability 仍为 false。

### C4 配置注册与恢复

- server 新增 `/api/v1/sync/execution/identity`、`/projects/{project_id}/configuration` 和 `POST /projects/{project_id}/credentials:resolve`（后三者均在 `/api/v1/sync/execution` 下）。复用真实 JWT 用户查询、黑名单检查及 DesktopDevice 归属／撤销检查。配置读取把最终 Project、Space、Device、Provider 放在同一查询内复核，初次注册的 modelSelection／thinkingEffort 来自实际 Project metadata；精确 resolve 不重新选择默认 Provider。
- Provider 新增数据库管理的随机 `execution_revision`。SQLite／PostgreSQL trigger 覆盖 ORM、bulk、原始 SQL 和旧 CRUD；key、模型、endpoint、参数、归属、有效性、删除变化都使旧引用失效，单独 prefer 变化保持引用。事务回滚同时恢复原引用，重建同 ID 也得到新 nonce。既有 ProviderIn／ProviderOut API 保持原义，没有添加第二个凭据库；nonce 不是 key／token 的 hash。
- Brain 从现有 command sync 的内存认证通道读取配置，调用真实 authority 验证后得到 account/device origin，不能以 renderer 的 local 字符串、请求体 user_id 或路径建立身份。注册入口 `POST /projects/{project_id}/execution-configurations` 只接受空 body／空对象，返回可提交的非敏感 envelope。未知字段不回显输入内容。
- 注册核对 server Project→Space→本机 account 主 binding，固定物理 root 和 Git common-directory 身份；不采用 email legacy fallback。只接受已 materialized 的精确 Bundle proposal、无资产／本地或 secret bindings／override 的受限配置，以及当前精确权限 revision。所有非秘密模型参数、capability、effort、tokenizer 和授权身份进入 `agentcfg:`。V39 的 `managed_execution_configurations` 保存此非秘密快照，队列保留自己的配置 revision；新增配置不会覆盖已排队请求。
- 重启从 SQLite 恢复同一个配置快照及 capability，不查询 latest 模型、Bundle 或权限替换旧值。缺认证／原引用／原 root／资产时保留 intent 并等待，不创建 Attempt。新的有效账户认证可恢复原引用可用的 pending 请求；这不授权恢复已经失去运行进程的 admitted owner，也不开放 Resume transfer。
- 凭据只在有界异步 resolve 后驻留内存；不写 token、key 或其可验证摘要到新快照、envelope、日志或状态。提交、准备前后、模型／文件工具、后台活跃 owner 检查、自动整合各 publication fence 都复核原 authority 与本机绑定。活跃检查独立异步执行，不占住全局 dispatcher。撤权取消实际 owner，保留 partial artifacts，停稳后释放 barrier；已完成输出撤权后也不能自动写回。账户仍有效时可查询、取消自己因旧 Provider 撤销而等待的请求。

### C4-R9-1：授权请求的取消与收尾

BoundRuntime 单独登记本 Run 的只读授权请求。调用者取消或 runtime stop 时，只取消这些具体请求；请求仍保留在 owned tasks 中，直到实际 coroutine 的 HTTP 清理完成。等待共享 registration lock 的任务只撤销自己的等待，不取消持锁的后台扫描或其他 Session 请求。已开始清理的同一任务不会因重复 cancel／stop 再收一次取消。

stop 先 seal 新派发并取消上述请求，再等待 runtime 锁，以便正在锁内等待授权的文件读取能退出。文件派发仍先在该锁内记录具体 child handle，stop 随后按原流程终止、reap 并核对所有任务／进程。普通 handler、模型和文件 writer 不进入授权取消集合；生产 `stop_timeout=5.0`、未知 writer 的拒绝结算、partial/unknown 工具结果和 finalizer 事务规则不变。没有以增加 timeout、复用旧凭据或强清 barrier 解决阻塞。

回归覆盖真实后台扫描持锁、两个 Workforce worker 排队、生产 deadline、重复取消／关闭、认证恢复与同 Session 单 Attempt 后继，以及另一 Session 继续执行。原 Round9 最终 probe 保持原文，只用新临时 runner 指向修复源码重放。Round10 已由原 reviewer 独立复核该提交和原 probe，C4-R9-1 Closed；其证据及验收边界见既有正式评审报告的 Round10。

### C4 显式部署资产合同

部署方先完成 server Alembic migration，再把下列非秘密 JSON 保存到明确的绝对路径，并通过 `EIGENT_MANAGED_EXECUTION_MANIFEST` 指定该文件。此环境项默认空；不会读取任意模型 key 环境变量。

```json
{
  "schema_version": 1,
  "enabled": true,
  "server_url": "https://existing-account-server.example",
  "tokenizer_asset_directory": "/absolute/release-assets/tokenizers",
  "capacity": 4,
  "session_history_enabled": false
}
```

`server_url` 必须与现有 command sync 认证配置的 authority 一致；HTTPS，或仅 loopback 的 HTTP。`capacity` 为 2–16。后端 `main.py` 在既有恢复事实检查后调用 `initialize_execution_service()`，随后启动 dispatcher；关闭时先停止服务及其 owned work，再关闭 journal/coordinator。

仓库随代码提供 `backend/app/workspace_runtime/tokenizer_assets.json`：当前固定 `o200k_base.tiktoken`，SHA-256 `446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d`，来源与 encoding/counter 参数均写在清单。**实际 rank 文件须由发布／部署流程放到指定资产目录，本提交没有下载或附带该二进制资产。** loader 只读取该清单对应的有界普通文件，校验完整内容，构造真实 tiktoken Encoding 和 CAMEL OpenAITokenCounter；不调用全局 encoding registry、不搜索缓存、无估算回退。缺资产或校验失败时 profile 不注册，服务保持不可用。发布打包资产、真实 PostgreSQL 部署与 Windows 验收尚未执行，不能宣称开箱可用。

本片只开放已审查的 `single-agent-workspace-files-v1`／`workforce-workspace-files-v1`。通用工具、Bundle 内容、cloud model、subscription、未知 transport、renderer／Electron 新身份链及旧 remote／trigger 迁移不在此片内。

| 路由                                                           | 行为                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------- |
| `GET /executions/capabilities`                                 | 返回实际能力，需本地控制认证                         |
| `POST /projects/{project_id}/executions`                       | start / follow-up / Resume 的幂等受理                |
| `GET /executions/{request_id}`                                 | 不含配置、credential 或私有路径的准入状态            |
| `DELETE /executions/{request_id}`                              | pending/preparing 取消，或 exact admitted owner 取消 |
| `POST /executions/{request_id}/delivery`                       | 单一 canonical 队列的优先级调整                      |
| `GET /executions/{request_id}/artifacts`                       | 固定产物元数据                                       |
| `GET /executions/{request_id}/artifacts/{artifact_id}/content` | 经归属检查的有界二进制内容                           |

`workspace_runtime.runtime.initialize_execution_service()` 是 C4 实际部署初始化入口；`configure_execution_service()` 保留为已有内部注册接口。默认没有服务实例，API 返回 capability false / 503；不能仅因为 server 启动就自动把旧 Agent 接到受控 worker。配置、权限与 workspace 解析由上述可信注册源和已批准 adapter 提供，不能从当前 renderer 的活跃 Space 推断。

HTTP source 由服务端认证确定为 local。remote / scheduled 的可信内部调用保留 canonical source / command 约束；旧 remote bridge 和 trigger 尚未迁移，不能把 HTTP body 的 source 当作认证。

`POST /executions/{request_id}/delivery` 接受 `operation_id`：每次新的用户优先级操作使用新的 ID，重试复用原 ID。相同 ID 改用其他 request 或 delivery mode 会冲突；旧操作重试返回当前请求事实，不恢复已被后来动作覆盖的优先级，也不取消新的 owner。省略该字段的兼容调用按 request + delivery mode 视为一次动作；再次主动提权须提供新 ID。首次 submit 的 Send now 继续使用既有 request 身份去重，其内部键与显式 delivery 操作键分开。

## 尚未完成的产品迁移

| 范围                                         | 当前边界                                                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 完整 Single Agent / Workforce / warm runtime | C2/C3 接通上述受限后端 profile；默认完整工具集、动态 Agent、warm 复用尚未迁移，公开模式 capability 继续为 false |
| 通用 Terminal、Browser、MCP                  | 未声明停写证明或第三方 descendant containment 支持                                                              |
| Memory / Skills / Bundle 内容 / 人工交互     | 未迁移，不静默装配旧工具或转发到 global TaskLock                                                                |
| 正式配置与权限恢复                           | 当前是可信显式 policy 注册；未自动启用现有用户配置、credentials 或账户数据库                                    |
| renderer / remote / scheduled 入口迁移       | C6 已接本地 Single 显式新 Session 入口；旧 Session、remote、scheduled 不自动迁移                                |
| Resume transfer                              | 保留原 Run 身份并等待恢复；没有凭重启或 TTL 建立新 owner 的捷径，capability 为 false                            |
| 冲突处理与跨进程 publication recovery        | 保留 core 的 conflict / needs_attention；本切片不新增 resolution UI 或不受验证的 worker takeover                |
| Windows / 任意 shell / 产品端到端            | 未验证，不能开启默认 rollout                                                                                    |

## 验证与 review

正式测试均使用合成 SQLite、Git 仓库和临时目录，禁 dotenv、真实模型请求和账户数据。C1 服务链测试覆盖实际进程重叠、FIFO、消息事务、自动整合、固定产物、取消与激活/结算竞争、撤权、双实例取消、启动观察和关闭等待者取消。C2 正向链路保留真实 SDK client、ModelFactory、Single Agent 工厂、ListenChatAgent 和文件 worker，只在模型响应 I/O 与 tokenizer 资产加载边界使用 deterministic 合成数据；不继承 root conftest 的 Agent mock。另有明确故障注入测试，覆盖 checkpoint/model capture 线程阻塞、SDK 部分构造失败、权限、路径、配置绑定和 telemetry gate。最终命令、内容身份、计数、正常 hooks 与本地 commit 记录写入外部 `PR-Review/parallel-session-execution-dev.md`，以该次冻结记录为准。

C3 正向验证保留真实 Workforce 构造、四个真实 Agent 工厂、ModelFactory、CAMEL Task 解析/分配/依赖调度/Worker 执行/完成传播、权限/checkpoint、文件进程、finalizer 和自动整合；仅模型响应及 tokenizer 资产 I/O 使用合成内容。覆盖两 provider、同/跨 Space 两个 Workforce 或 Single+Workforce 重叠、同 Session FIFO/Send now、取消一方另一方继续、重复取消及 SDK 关闭门控、exact config/只读权限/撤权、准备/收尾/Step/model capture 提交门控、部分构造失败、失败及已派发取消的 partial CAS、未知 assignment/graph 与关闭失败。故障注入用例明确标注门控或注入点；不以 stub 调度器或 sleep 模拟重叠。C2、旧 Workforce/worker、Agent、journal/runtime 与 C1 service/finalizer 回归的结果、未通过的开发中间运行和既有 warnings 均保留在本次开发证据中。

C4 测试从实际部署 JSON、资产 loader、Bundle parser／SQLite、账户主 workspace binding、本地控制认证和新注册 API 进入真实 Single／Workforce、dispatcher／finalizer。Server 端另行验证真实 JWT／Device API／Provider CRUD／迁移／并发写入，仅 Redis 黑名单 I/O 使用合成回答；Backend server/model I/O 与发布资产内容为合成夹具，未手写 policy 替代注册入口。证据包括 12 组 provider×Space×运行模式并行组合、FIFO、重启缺认证后恢复、当前模型意图变化仍用队列旧配置、撤权取消与 partial artifacts、准备和整合窗口复核、配置／root／权限／tokenizer 缺失，以及无副作用 capability。

本 task 没有修改架构 README 与外部设计 14/18/19/21；外部设计 19 的并发编辑事实与观察 hash 单独记入开发报告，不把其新声明自动纳入本切片。只有完整产品迁移完成、通过独立 review 和对应验收后，才可宣称整个并行 Session 功能完成。
