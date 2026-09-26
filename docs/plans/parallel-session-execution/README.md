# Session 并行执行：详细设计与交付计划

默认入口的后续代码与验收边界见[实现候选记录](DEFAULT_SESSION_IMPLEMENTATION.md)。
该候选尚未完成真实 Browser、默认配置和安装包验收，不能作为发布完成证明。

1.0.5 默认普通 Session 的正式版问题、复现证据及本次修复边界见
[发布后续记录](RELEASE_1_0_5_FOLLOWUP.md)。本页历史设计和 C6 受限验收
不代表默认模型、普通工具或安装包已通过并行验收。

状态：Draft，设计分支 `enhance/parallel-session-execution`。代码基线 `abb46a17b10d5c7ccf1c8458558bd5375bbdc347`；2026-09-18 在设计快照 `8d0cbf7a6e18bdc181f16260310465802dfc659f` 上按用户最新方向修订：隔离并行执行，系统自动整合；待同一 reviewer 复审。

本分支先细化协议与实施切片，不启用新的产品行为。参考外部架构稿 `eigent-docs/refactor_docs/design/21-parallel-session-execution/README.md` 与 `HISTORY.md`。本文是仓库内的工程设计入口；所有新增类、表、接口和测试名均为拟议实现，不表示已经落地。

用户已接受隔离执行，明确要求正常流程无需手动 Apply 或另行导出整合；本稿据此替换上一轮的待选发布模式。本轮仅修订并冻结设计，不实施 A0/默认关闭基础设施、不改代码或已冻结设计 14/18/19；架构 review 后才进入获授权的实现。

## 1. 功能边界

目标是同一 Space、不同 Space 的多个 Session 同时运行。Session 对应技术层 `Project/project_id`，保留现有路由、事件和持久化术语。一个 Session 内的多轮 Run 继续 FIFO。

main 的 Single Agent 默认共用 primary checkout，`WorkspaceWriterScheduler` 让后续 Session 等整个前一 Run 结束。Workforce 已有独立 Run checkout。跨 Space 不同目录没有全局 writer 锁；跨 Space 相同物理目录需要额外的真实资源身份协调。

确定的产品方向：内部 workspace 隔离；成功且已结算的结果自动整合回 Space；Gitless 完整纳入。相同文件可确定性合并的不同改动自动整合，相同改动去重；真实冲突保留双方，只暂停相关文件/一致性组的发布，其他 Session 继续运行。本次不开放同一 Session 的并行 Run，不把人工 Apply、只导出或要求用户暂停外部编辑器作为正常流程。

### 1.1 一手资料与设计推论

2026-09-18 实际读取了以下官方页面，借鉴范围如下：

- [Codex Worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)：独立 checkout 支持并行，Handoff 在 Local/Worktree 间迁移任务和代码；不据此推断任意冲突会被自动消解。
- [Cowork Projects](https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork)：项目共享文件上下文、指令和项目记忆。[Cowork architecture](https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview)：云 session 有独立临时 sandbox，本地文件经 Desktop 权限检查；本地部署的 folder 读写为 native，shell/code 在 VM。这不是所有共享文件写入均有副本或自动合并的证据。
- [Claude Code Desktop](https://code.claude.com/docs/en/desktop#work-in-parallel-with-sessions)：Git worktree 提供独立副本，编辑器遇磁盘变更会提示。Claude Code 与 Cowork 的机制不能混称。

下文“Run 增量 + 确定性三方合并 + 自动发布队列”是 Eigent 针对当前代码的设计推论，复用既有 workspace_git、autosync 与 durability；不引入通用 VFS 或通用 LLM 冲突修复系统。

## 2. 模块边界与拟议接口

| 模块                              | 单一职责                                                      | 接入现有代码                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `ExecutionAdmissionService`       | 所有 start/follow-up/resume 的幂等受理、claim、事务交接       | [chat_controller.py](../../../backend/app/controller/chat_controller.py)、[store.py](../../../backend/app/run_journal/store.py)            |
| `ExecutionDispatcher`             | 后台公平扫描不同 Project，不等待一个 Run 完成才派发下一个     | [runtime.py](../../../backend/app/run_runtime/runtime.py)、[backend/main.py](../../../backend/main.py)                                     |
| `WorkspaceProvider`               | 固定 source、建立私有 workspace、checkpoint、按 revision 读取 | [coordinator.py](../../../backend/app/workspace_git/coordinator.py)、[snapshot.py](../../../backend/app/workspace_git/snapshot.py)         |
| `PhysicalResourceRegistry`        | logical repository 与真实 checkout/common-dir 的映射          | [content.py](../../../backend/app/workspace_git/content.py)、RunJournal                                                                    |
| `WorkspaceFinalizer`              | settle 写工具、保存产物、Session promotion、释放安全 barrier  | [lifecycle.py](../../../backend/app/workspace_git/lifecycle.py)、[RunCoordinator](../../../backend/app/run_runtime/coordinator.py)         |
| `WorkspaceIntegrationCoordinator` | 自动整合请求、三方合并、精确候选验证、目标发布与恢复          | 既有 lifecycle 自动写回、Git operation journal、[workspace_git_controller.py](../../../backend/app/controller/workspace_git_controller.py) |
| `ArtifactContentResolver`         | 根据归属和不可变 revision 返回产物，独立于 primary 当前内容   | [artifacts.py](../../../backend/app/artifacts.py)、[file_controller.py](../../../backend/app/controller/file_controller.py)                |

新增协议放在 `backend/app/workspace_runtime/`，Git adapter 委托既有 `workspace_git` 服务，directory adapter 不依赖 Git。避免把非 Git 逻辑塞入名称为 Git 的 controller/service。工作量按职责切分，首批不重写整个 RunJournal 文件。

```python
class WorkspaceProvider(Protocol):
    def capture_source(self, owner, policy, expected_source) -> SnapshotRef: ...
    def prepare(self, snapshot, owner_generation) -> WorkspaceHandle: ...
    def checkpoint(self, handle, mutation_receipts) -> WorkspaceRevision: ...
    def read(self, revision, relative_path, byte_range) -> ContentRange: ...
    def retain(self, revision, reference_owner) -> None: ...
    def release(self, revision, reference_owner) -> None: ...

class WorkspaceIntegrationCoordinator:
    def enqueue(self, finalized_run_receipt, target_binding) -> IntegrationRequest: ...
    def prepare(self, request_id, expected_target) -> MergeCandidate: ...
    def publish(self, candidate_id, expected_fence) -> IntegrationResult: ...
    def reconcile(self, operation_id) -> RecoveryResult: ...
```

provider 只能修改私有 workspace；共享目标发布统一经 integration coordinator（下文 Apply 仅指内部发布动作及旧兼容记录，不代表用户按钮）。所有 mutating 方法接收 owner/generation；`None` 不代表允许退回 primary，失败使用 typed error。阻塞的扫描、Git 与复制通过有界 worker 执行，不占 asyncio owner loop。

## 3. 准入记录：消息与执行请求分工

现有 `follow_up_requests` 只能表达 prompt 队列。首次 start 和 Resume 也必须通过同一准入边界，但 Resume 不能伪装成新消息，因此增加公共 `execution_requests` 记录。

### 3.1 拟议数据模型

| 记录                                     | 主键/约束                                                                                | 字段与权威范围                                                                                                                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `execution_requests`（新增）             | `request_id` PK；`source_follow_up_request_id` 可空且唯一；`target_run_id` 为可空 Run FK | `project_id`、kind=`start/follow_up/resume`、immutable envelope/digest、source/command identity、准入 status、queue_seq/delivery_mode、wait_reason、created/updated；Resume 必须有 target_run_id |
| `project_admission_claims`（新增）       | `project_id` PK；`request_id` 引用 execution_requests                                    | owner process identity、单调 generation、state、heartbeat；按 Project 保留，不删行重置 generation                                                                                                |
| `project_run_execution_leases`（已有）   | project_id PK；run_id/attempt_id 非空 FK                                                 | 继续保护已创建 Attempt 的单 Session 执行，不作为尚无 Run 的 claim                                                                                                                                |
| `run_workspace_finalizations`（新增）    | run_id PK/FK；owner_attempt_id FK；owner/generation 以 CAS 转移                          | workspace owner、pending/settling/settled/needs_attention、intended_outcome、receipt/artifact revision、process settlement；只存收尾事实，历史转移写入事件                                       |
| `run_workspace_bindings`（新增通用记录） | Run + generation 唯一；active owner 唯一                                                 | provider、workspace_id、policy_version、snapshot/revision、physical identity、preparing/ready/recovery/retained 状态                                                                             |

`follow_up_requests` 保留消息内容、附件和用户队列操作的兼容契约；`execution_requests` 是所有入口统一的准入权威，不再增加第二份可编辑 prompt。follow-up envelope 引用原消息及不可变 digest，start 的首次输入由对应请求拥有，Resume 只引用已有 Run。迁移时 FIFO/Send now 顺序及取消在同一事务同步到准入记录，dispatcher 只选择一份 canonical 候选，不把两张表分别各派发一次。

技术 ID 不重命名。follow-up 沿用 `request_id == 新 run_id`；start 同样稳定映射；Resume 的新 request_id 对应已有 target_run_id + 新 attempt_id，不能创建新对话 Run。相同幂等键的不同 payload 返回冲突，相同 payload 返回原状态。

### 3.2 不可变 execution envelope

envelope 固定用户提交意图：Space/Project、模型与 effort、Agent mode、Workspace policy/config revision、附件对象引用、工具授权约束、source/trigger/remote command 与身份。禁止保存 API key、完整进程 env 或由客户端决定的任意绝对输出路径。

准入时解析最新可用 credential reference，并检查权限撤销、模型可用性、源 revision、附件可读性。不能借排队时的旧配置绕过撤权，也不能使用当前 UI 打开的 Space 配置。缺配置返回 typed wait/error 并保留请求。

老 pending rows 没有完整 envelope：优先从已持久化 Project/EnvironmentSpec 恢复；不能确定原意的请求进入 `configuration_required`，由用户补充。禁止在升级时猜测模型并自动执行。

## 4. claim、execution lease 与取消事务

```text
request: pending → preparing → admitted
                   ↘ pending（可重试准备失败）
         pending/preparing → cancelled 或 rejected

claim: released → claimed(generation + 1) → handed_off → released
                      ↘ released（取消 / 准备失败）

Run lifecycle: 既有状态不变
workspace finalization: pending → settling → settled
                                      ↘ needs_attention → settling
```

1. **提交事务**：校验身份与幂等 digest；写消息/执行请求并建立稳定映射。提交后唤醒 dispatcher；唤醒丢失靠定期扫描恢复。
2. **Claim 事务**：`BEGIN IMMEDIATE` 内检查无另一 execution lease、未解决的 finalization barrier/中断恢复；按 Project 顺序选队首，CAS claim generation。Resume 可走显式恢复路径，但不能绕过旧工具结果未知和进程存活检查。
3. **准备阶段**：事务外固定 source、建立 private workspace、解析 env。不持数据库写事务做 Git/复制/网络；对不同 Project 有界并行。
4. **交接事务**：再检查 request 未取消、claim owner/generation、envelope、workspace ready；创建/关联 Run 和 Attempt，取得既有 execution lease，写 binding 和 pending finalization barrier，设置 admitted，并将 claim 标为 handed_off。对 follow-up 同事务更新兼容行 admitted。isolated policy 缺 barrier 时必须拒绝 activation/释放，不能视作 legacy；没有两个准入 owner 之间的空窗。
5. **启动**：事务外先通过 RunCoordinator 注册不能执行工具的 dormant handle，然后在短事务内检查 durable cancel intent、expected Attempt 与 generation，CAS activation；成功才打开执行闸。Cancel 先提交则 activation 拒绝，后提交则能定位已注册 handle 并设置停止信号；工具 dispatch 再遵守 cancel checkpoint，不能出现“取消时无 handle、取消完成后才启动”的窗口。不依据 renderer 的 Running 标记。
6. **取消**：取消 pending/preparing 时 CAS request 与 claim；准备异步任务只清理自己的 generation。admitted 后转换为 exact Run/Attempt cancel，不再删除消息。取消/交接竞争由 SQLite 顺序决定；若交接先成功，使用执行取消路径。

所有新旧 start/improve/resume 入口必须共用 guard。只让 dispatcher 检查 claim 而让旧 `/chat` 绕过，会继续产生重复执行。T2 将现有 `create_run_attempt()` 等拆出接收同一 connection 的内部 helper，不嵌套 `BEGIN IMMEDIATE`；使用 activate=False 准备，提交后再做 fenced activation。配置解析必须接收 envelope 的显式 revision，不复用只取 latest materialization 的隐式路径。

HTTP controller 只提取已验证的 `ExecutionOrigin`（principal、source、Hands capability、授权上下文）；service 不保留 FastAPI Request 对象。后台重新启动时从持久化身份与可恢复 reference 构造上下文，缺少有效授权就等待/拒绝，不能为了脱离 renderer 默认授予更高权限。

## 5. 收尾 barrier 与恢复

main 的 `_append_event_in_transaction()` 在 Run interrupted/completed/failed/cancelled 时无条件删除 Project lease；`create_run_attempt()` 还会回收同 Run 无 active Attempt 的 lease。两处必须连同 barrier 一起改，单独增加表无法保证安全。

新策略正常成功顺序：停止或明确转移写进程 → settle mutation/tool outcome → checkpoint → Run 向 Session integration 做 CAS promotion → 固定产物 revision/manifest → finalization settled → 写 terminal event/释放执行 lease。最后同一 SQLite 事务持久化自动整合 outbox，后台 worker 随后发布；通知丢失靠扫描恢复。全是幂等阶段，失败阶段在 journal 可定位。

失败/取消保存 recovery checkpoint 与 partial artifacts，不要求成功 promotion、不发布成功结果。最后的 settled、终态写入和 lease/claim 释放必须在一个 SQLite 事务完成，且 owner/generation 精确匹配；如果已有终态事件，只补最终结算，不改写历史结论。

若异常路径先写入 terminal event，durable finalization barrier 仍阻止该 Session 的普通新准入。判断必须同时覆盖 claim、execution lease 与 barrier；显式 Resume 经过旧进程 fencing、工具未知结果检查后，在同一事务以旧 owner/generation CAS 更新该 Run 唯一 barrier 的 owner_attempt_id 和 generation，重置为 pending 并交接 claim/lease，同时追加记录旧 owner → 新 owner 的转交事件。普通准入只读这条 current-owner barrier，旧历史 generation 不参与活跃 barrier 扫描；转交不清除未知工具结果。Apply pending/conflict 不构成此 barrier。

### 5.1 isolated 启动恢复与最终 manifest（B1）

isolated policy 不再直接执行 main 的 artifact-first 固化顺序。恢复分成两个阶段：

1. **事实校验**：读取已有事件、cancel intent、manifest、mutation receipt 和 retention；保留原始扫描时间窗与来源。校验既有不可变对象是否存在，但不扫描仍可变目录来生成最终 manifest，不把 terminal + existing manifest 当作已结算。该阶段可记录 interrupted/cancelled 执行事实，不能清除未结算 barrier。
2. **当前 owner 收尾**：确认旧 writer 停稳，或已被实际隔离而不再能写本次 checkpoint 的源（仅更新 generation 数字不等于停止 OS writer）；以 CAS 取得当前 finalizer generation，依次 settle → checkpoint/recovery revision → 必要的 Session promotion → 从该不可变 revision 固化 manifest。不能证明源已停写则停在 needs_attention，不固化、不释放所属 Session。

manifest 的结算 receipt 必须绑定 `(run_id, owner_attempt_id, finalizer_generation, checkpoint_revision, manifest_digest)`。最后由当前 generation 的 finalizer 在同一短事务验证 receipt、更新 canonical manifest 引用、置 barrier settled 并释放 lease/claim；已有 terminal 不绕过此事务。重试只有匹配已结算 receipt 才可复用最终 manifest；无匹配 receipt 的旧 manifest 仅是待核对历史，必要修正追加有前驱引用的新 manifest revision，不改写旧事件。旧 generation 的迟到扫描/固化/CAS 必须被拒绝。

完整启动顺序：隔离请求暂不 dispatch → 上述事实校验 → process/workspace ownership reconciliation → 当前 generation 的 settle/checkpoint/最终 manifest → physical target/Apply 恢复 → dispatcher 接受具备安全条件的候选。legacy policy 可保留原恢复分支；不能让该分支代替 isolated finalizer 或提前解除共享目标的恢复 barrier。关闭顺序先停止新 claim，再有界 drain/标记 interrupted，最后关闭 RunCoordinator/Journal。

TTL/心跳只提供失联线索，不能直接抢用旧 writable directory。PID 还需 process birth identity，避免 PID 复用；不能确认旧 writer 停止时保留现场和 needs_attention。新 Attempt 使用新 generation，迟到回调不得提交、释放或清理新 owner。

## 6. Workspace 与 source 的精确定义

```text
SnapshotRef:
  provider, snapshot_id, owner, session_revision S,
  common_primary_revision B, primary_revision P,
  overlay_manifest_digest, source_token, coverage,
  physical_target_id, settled_revision, write_epoch,
  integration_receipt_cursor（与 P 同一边界）

WorkspaceHandle:
  workspace_id, generation, owner, provider, snapshot_id,
  local_root（只留本地）, immutable environment binding

WorkspaceRevision:
  Git exact commit OID 或 directory manifest digest,
  changed-path receipts, source refs, retention refs
```

Git provider 复用 Project integration + Run/Agent worktree。directory provider 使用独立复制/reflink 与内容 manifest，不自动 git init、不使用可写 hardlink、不回退共享目录。普通 terminal 启动前需完成其声明工作范围的投影；超配额、符号链接越界、unsupported path 必须明确失败，不能悄悄省略后声称完整 Space。

新一轮保留 S/B/P lineage，并复用 §8 的确定性逐文件合并规则：双侧不同不直接等于冲突，同文件不同行可以自动合并；dirty/untracked overlay 也做共同基线检测。具体从本次 pinned P 构建新的输入候选，按 Session 顺序折叠尚未整合的 I→O delta；已 integrated/equivalent 的 delta 跳过，不能把旧累计 S 再覆盖到 P。每条 pending delta 使用自己的原始基线和前序 receipt，而不是猜一个共同 HEAD；只在当前已结算 Session revision 边界内构建，不改写历史 S。未解决的 Session 私有改动仍保留；输入合并若真实冲突则该请求等待解决或显式选定旧的不可变输入，不能静默选边。复制/读取前后 source token 不同则丢弃重试。活跃 Run 固定最终输入 I；自动发布/重算只改变发布候选，不修改 I、运行目录或旧产物。

P 与 `integration_receipt_cursor` 在同一短事务取得，并在 capture 最终 fence 核对；跳过 delta 要求其 receipt 已属于该 P 的 settled lineage，不能用旧 P 配最新 receipt。否则发布在两次读取之间完成时会出现“P 尚无改动、receipt 已整合、又跳过私有 delta”的丢输入。已保留旧 revision 路径也必须读取对应 receipt 历史，而非最新进度；相关 revision 与 cursor 一起 retention。

隔离物化只校验固定 snapshot、自身 Session ref/version 与 workspace generation。原 coordinator 对整个 primary 的 `expected_repo_state_digest` 检查必须拆分，否则另一个 Session 的 Apply 仍会让无关 Run 物化失败。

`PhysicalResourceRegistry` 分开标识 Git common dir 和实际 checkout root。用 canonical path + 平台文件身份检测路径别名、替换、移动；同真实目录不同 Space 共用 Apply 目标资源，但权限与数据归属独立。不同 worktree 只共享 Git 元数据短锁，不共享整个 Run writer。

### 6.1 source capture 必须跨越已结算边界（B3）

每个 physical target 增加同一 Brain/SQLite 权威的状态：`owner(kind/id/generation)`、单调 `write_epoch`、`settled_revision`、`state=settled/writing/recovery_required`。受管 writer 在任何文件变更前先领取 owner、推进 epoch 并置 writing；安全结算后再记录新的不可变 revision、推进 epoch 并置 settled。异常/partial Apply 保持 recovery_required，不能靠“目前没有进程”或内容 hash 稳定置 settled。owner 同时覆盖 §8.4 的 legacy direct 与 Apply。

source 有两条明确路径：

- **已结算不可变输入**：读取并 retain 指定 Git OID 或 directory manifest 及其内容对象，不读 live index/工作树/dirty overlay。即使 primary 有 writer 也可以继续隔离执行；若请求要求当前 dirty 内容，不能静默改用旧 revision。
- **live source/overlay 捕获**：先在短读取 fence 内确认 target settled、无 owner、无未恢复操作，取得 `(physical identity, write_epoch, settled_revision)`；锁外复制/有界读取并验证内容 token；最后在同一 coordinator 的短事务再验证身份、epoch、revision 全未改变且仍 settled/无 owner，才能发布 snapshot 并建立 retention 引用。受管 writer 即使在扫描间完成一次修改又恢复原 bytes，epoch 变化也使候选作废。每个 lazy chunk 同样满足该 fence，或直接读取已保留不可变内容，不能接受不同边界的混合内容。

active/partial Apply 时返回 `source_waiting_for_settlement`；epoch 改变返回 `source_changed`，丢弃本轮候选后有界重试。恢复只有完整 roll-forward 或在校验通过后恢复完整 preimage，并记为新 settled revision 后，live capture 才恢复。长复制和整个 Run 不持目标锁；已获得合法不可变 snapshot 的其他 Run 不受影响。

前后 hash 相同只证明观察窗口内未检测到变化，不能证明不存在半事务；其作用是补充 epoch/settlement fence。以上一致性保证针对参加 coordinator 的受管 writer。对不协作外部 writer，只提供变更检测而非原子快照保证，采用 §8.5 的产品边界；需要严格固定输入时使用已保留的不可变 revision。

## 7. Runtime 绑定与产物读取

所有工具通过 frozen WorkspaceHandle 得到 cwd、输出、download 和临时目录。第一方 env 使用 immutable RunContext；子进程显式传 env/cwd。运行级逻辑不得修改全局 `os.environ`/`os.chdir`。依赖进程全局配置的第三方库移入专用 worker，普通 worker 进程本身不宣称 OS sandbox。

warm runtime 只有在 env、permission revision 和 workspace binding 兼容时复用；新 Run 必须重新绑定所有 tool workspace，而非仅修改 Task ID。若无法完整 rebind，则重建该 runtime。保留 Session 内消息 reset 与一次 ContextProjection 规则。

N1 文档修订清单：后续经批准同步设计 19 §6 的 warm latency 表述及 §14 的“不重连 MCP/不重建 Browser/Terminal”验收，限定为 environment/permission/workspace binding 兼容或已验证完整 rebind 的路径。需要重建时不得为满足旧性能断言继续使用旧 cwd；本轮仅记录修订点，不改设计 19 或重构 runtime。

产物 resolver 输入为 principal + project_id/run_id/artifact_id，先验证 manifest 归属，再读其固定 revision，不接受客户端任意绝对路径。main `artifacts.py` 虽用 exact OID 计算变化，但内容仍可能从 primary/可变 Project worktree 读取，必须修正。

后续 Run 修改同名文件、Apply、归档和切换 Space，都不能改变旧 artifact 的 bytes。Remote 只传逻辑 ID/授权内容；保留现有 upload policy，源 snapshot 不因隔离而自动上传。manifest、pending Apply、interrupted Run 和后台进程共同持有 retention 引用，归零后才清理。

## 8. 系统自动整合协议

### 8.1 固定本轮增量，复用现有 autosync

`prepare_successful_run()` 的 settle、`promote_run()` 的 Session CAS 和私有 projection 保留。原 `_auto_apply_project_to_space()` 的 prepare-success、terminal、archived retry 三处改成幂等 ensure-request/query，实际写入统一交给自动整合 worker。不得在 early prepare 阶段自动发布，也不能保留另一条绕 owner 的复制路径。旧函数目前只自动投影普通输出文件、且主要限 Eigent-owned Space；新策略经既有文件权限检查扩展至支持的 adopted folder，绑定授权不等于任意外部路径写权限。

只消费 §5 当前 generation 的 finalized receipt。每个 Run 固定 `I = 本轮完整输入 revision`、`O = 本轮结算输出 revision`；发布的是有 mutation provenance 的 `I → O`，不是 Session integration 相对最初 primary 的累计 diff。读取 O 用 immutable resolver，不要求当前 Session head 仍等于 O。入站吸收的其他 Session 内容及仅读的 dirty overlay 不算本轮输出。

复用 operation journal，最小增量为 integration request + 逐路径 receipt：

| 记录           | 固定身份与进度                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Request/outbox | 唯一键 `(run_id, finalized_revision, target_binding_version, policy_version)`；payload digest、finalizer receipt、I/O retention、授权 reference、canonical physical target；相同键不同 payload 拒绝    |
| Path change    | `change_id/request_id/path_group`、I/O 对象、type/mode/tombstone、前序同路径 change_id；pending/equivalent/integrated/conflict/waiting/needs_rebase；target before/after revision、operation receipt   |
| Candidate      | 上述 source digest、目标 settled revision/write_epoch/ref/index/受影响路径 token、target binding version、worker owner/generation、merge policy version、输出 tree/manifest digest、validation receipt |
| Conflict       | 不可变 B/S/T 三份对象及 lineage、冲突原因、候选/目标版本；受影响文件/一致性组、resolution revision；不是 Run 执行失败                                                                                  |

只推进已成功的逐路径 watermark；`pending_apply` 可保留为兼容汇总，不能代表所有文件进度。已 integrated/equivalent 的通知重放只返回 receipt，即使别人后来修改了该文件也不再次写它。同 Session R1 改 x，R2 仅改 y，R2 绝不重新发布 x；R2 又改 x 且 R1.x 未解决时，只有 R2.x 等前序，R2.y 仍可发布。前序被用户明确放弃或换成不同 resolution 时，后继 x 进入 needs_rebase，以保留的原基线、已接受 resolution 和后继 delta 重新计算；不能假定旧输出已发布。不得以跳过未决前序来自动覆盖它。

### 8.2 同文件三方合并与部分发布

每次候选采用 `B = I[path]`、`S = O[path]`、`T = 当前目标已结算内容[path]`；“不存在”是可比较 tombstone。先处理相等关系，再按类型合并：

| 情况                                                     | 自动行为                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| S=B                                                      | 无本轮输出，不写目标                                                 |
| T=S                                                      | identical/equivalent 去重，记录 receipt                              |
| T=B                                                      | 采用 S；包括获得既有任务/文件权限授权的创建或删除                    |
| 同一文本的两侧改动在不同区块                             | 确定性三方合并，自动包含双方；不因文件 hash 都变化就报冲突           |
| 重叠区块内容相同                                         | 确定性去重；其他独立区块继续合并                                     |
| 同一区块两种不同结果、同路径不同新增、delete/modify      | conflict；保留 B/S/T，不选最后完成者、不写 conflict markers 到 Space |
| 二进制双方不同、类型/symlink 变化或无法可靠判断的 rename | 保留双方并等待明确处理；无差异/单侧二进制修改仍可自动整合            |

第一版只对可验证编码的普通文本进行内容合并；算法及版本固定，不调用用户 Git merge driver/hook 自动执行任意代码，不用 LLM 猜意图。rename/delete-create 的关联路径、声明的跨文件依赖组成同一发布组；一处冲突则该组保留旧目标。其余确定性无冲突路径可独立发布，请求为 `partially_integrated`。不推断任意代码/文档的语义独立性；已有验证能识别的依赖失败扩大到相关组，无法定位的整批验证失败只挂起该批发布，不锁 Session 执行。

例：B 的第 2 行为 a、第 20 行为 b；A 改第 2 行为 a1，C 改第 20 行为 b1。A 先整合后，C 用 B/S/T 计算得到 a1+b1 并自动写回。同一行两者都改为 a1 则去重；分别改 a1/a2 时该文件保留 A 的当前目标与 C 的私有输出供决定，C 的另一无冲突文件仍可整合。

Gitless 的 B/S/T 是 retained manifest + 内容对象，记录 parent/source lineage、类型、模式、tombstone；不能仅存当前目录 digest。与 Git provider 共用纯 merge planner 和相同测试向量；directory provider 不以用户安装 Git 或存在仓库为前提。每个成功批次生成新的不可变 target manifest；冲突文件仍引用旧目标，其他文件的新 revision 可供后续 Run 使用。`conflict` 在写前发生，不使整个目标 recovery_required；实际部分写入/崩溃未结算才触发 B3。

### 8.3 有界重算、验证与发布

1. **Prepare（锁外）**：重新验证授权和 target binding，读取 retained I/O 与 §6.1 允许的目标快照，形成无冲突发布组。读取中发现外部目标变化先固定新观察对象，再重新合并，不把用户改动当 Agent 产物。source 不因重算变化。
2. **验证精确候选**：路径/权限/类型/配额/编码与完整 merge 必须通过；已有配置要求的格式或测试在候选私有目录有界运行，不在 primary 执行。receipt 绑定 source、B/S/T、候选 digest、validation policy、目标 revision/epoch/binding 与 worker generation。没有配置的测试如实记为 not_configured；文本无冲突不等于业务语义正确。不能复用另一候选或另一 generation 的 pass。
3. **取得发布 owner**：同 §8.4 的 physical target 短事务检查无 legacy/恢复 owner，CAS target settled revision/epoch 并领取新的 publishing generation。记录“已验证候选 → 此次 owner/generation”的精确移交 receipt；再次核对 ref/index/受影响路径 token。任一不符则未写入前释放 owner、丢弃候选/验证，回到 prepare。旧 worker 不得发布或释放新 owner。
4. **有界自动追赶**：每次唤醒最多两次 prepare/validate/publish 尝试（初次 + 一次重算）；持续变化后写 durable `waiting_target_stable`，记录观察版本和 backoff。目标结算/内容变化事件或定时退避再唤醒，有容量与公平预算；不在锁内循环或等待用户。真实冲突不反复重试同一 B/S/T，只在 source/target/明确 resolution 变化后重算。自动 rebase 仅指发布候选的重算，不重跑 Agent、改活跃 Run 输入或重放外部副作用。
5. **Journal 与写入**：持 owner 保存每组完整 pre/postimage、ref/index token、候选 digest 和 retention，标 prepared/dispatched 后更新精确路径。Git 使用已有对象库/私有 ref 或 tree 保存 revision，默认沿当前 autosync 语义仅更新 Space 文件，**不推进用户 HEAD、不 stage、不改用户 index、不自动 commit/push**。dirty/staged 文件的工作树内容纳入 T 后三方合并；index 保持原 bytes，新增 Agent 部分显示为未暂存变更。不要为自动整合引入用户分支提交事务。directory provider 使用同样的对象/manifest 与操作 journal，不创建 .git。
6. **结算**：验证 postimage 后，在同一 SQLite 事务推进目标 settled revision/epoch、path receipts/outbox 状态，释放 owner；记录的 revision 保留最终合并内容及来源。每个发布组具备可恢复的逻辑一致性，不声称跨文件 OS 原子性。Space 与 Session 的内容/产物各有 revision，合并结果不会改写旧 Run artifact。
7. **恢复**：崩溃保留 owner/recovery_required，逐路径按 journal 判定 preimage/postimage；只有在当前身份/fence 与完整预期都符合时 roll-forward，完整验证后才 settled。第三种内容先保留，禁止盲 rollback/强制覆盖；标记相关操作 needs_attention。无法确定半写入边界时，该物理目标 live capture/发布等待恢复，已固定输入的其他 Session 仍执行。B4 对外部 writer 的检查窗口同样存在，恢复日志不构成强内容 CAS。

拟议只读进度接口为 `GET /projects/{project_id}/workspace/integrations` 与 `GET /projects/{project_id}/workspace/integrations/{request_id}`，返回 canonical 分组状态/冲突引用；不是已存在路由。成功结算直接 enqueue，无 routine preview/approved_digest/Apply API 调用。异常真实冲突可使用 `POST .../{request_id}/resolve`，提交授权 principal、幂等键、精确 conflict/target/source revision 与选择或 resolution 内容；服务端重新验证并走同一候选协议，stale 决定不能覆盖新目标。权限检查覆盖 source 与 target，Remote 不获得私有绝对路径。手动 retry 仅为异常恢复入口，不是正常流程必需步骤。

### 8.4 自动发布与 legacy writer 双向互斥（B2）

现有 `(repository_id, checkout_id)` writer request 必须映射到 §6.1 的同一 physical target。`PhysicalResourceRegistry` 不另建互不相干的锁域：所有 legacy admission、promotion、release、Apply/recovery 都经同一 target-owner 事务。跨 Space 的目录别名先归一，再检查各自权限。

1. 开启新 Apply capability 前，先将已有 acquired/interrupted legacy writer 映射为 physical owner；未完成 finalization 的旧终态也保留恢复 barrier。遇到多个旧 owner/无法确定路径身份时，该目标 recovery_required，禁止新 Apply/legacy 准入，先收敛现场，不能任选一个 owner。
2. legacy 取得 writer 时，在同一 SQLite 短事务检查无 Apply/恢复 owner，原子取得 physical owner 并推进 write_epoch，再设置原 writer lease 为 acquired；旧 FIFO 提升也走这一事务。若物理目标忙，原请求保持 queued。
3. Apply 领取 owner 时同事务检查无 legacy owner/未结算 barrier，并写入 Apply ownership 与 writing epoch。遇到旧 Run 仍写则 Apply 等待；isolated Run 可以基于明确选择的已结算 immutable revision 执行完成，产物照常可读。
4. legacy 只有在 writer 停稳、mutation/checkpoint/finalization 已结算后，才能同事务释放旧 lease 和 physical owner、发布 settled revision/epoch。Apply 同样在文件/index/ref 与操作日志收敛后释放；partial crash 保留 recovery_required。仅 Run terminal、lease TTL 或旧 `finish_task` 返回均不足以放行。
5. 新 legacy 准入不能绕过未结算 Apply；恢复操作持有相同 owner/fence。对同一目标的唤醒从 canonical 队列重新竞争，不能从内存“看起来已空闲”直接 dispatch。

此协议要求同一个已升级 Brain 承担所有受管入口；不兼容旧 Brain 并发写同一目录不在支持范围。迁移保留旧 direct Run 原目录及原执行期独占，新锁适配阻塞的是该目标的 Apply/新 legacy writer，而不是整个 Space 的隔离推理。

### 8.5 外部编辑器边界与用户介入（B4）

`check hash → os.replace → check postimage` 不是文件内容原子 compare-and-replace。外部编辑器可在检查后保存 U，再被发布的 B 覆盖，最终检查仍成功。Git ref CAS、更多 hash、watcher 或 pre/postimage journal 都不能关闭这个窗口，也无法挽回未捕获且已被替换的 U。本版不新增 VFS/强制文件系统 sandbox，不给任意外部 writer 无条件零丢失承诺。

正常行为只有一条：**隔离执行 → 系统自动整合**。不要求用户关闭/暂停编辑器，不将此假设写进前提，不提供日常“原地/导出”二选一。受管 Session、legacy writer、恢复都经过共同 owner，因此可保证其整合不会互相静默覆盖；未参加协议的编辑器/外部 Git/越过 cwd 的任意 shell 只有变更检测能力。

- **自动整合**：目标观测稳定、owner/fence 合法、三方合并及候选验证通过；无需点 Apply。用户已保存且被捕获的 dirty 内容参与 T，保留其来源与原 index。
- **安全等待、保留版本**：观察到连续外部保存、绑定变化、owner 未结算、受影响路径类型变更、候选验证失败时，相关文件/发布组等待，保留 I/O、所有已观察 T、候选及操作 receipt。短暂变化自动退避重算，其他文件与 Session 继续；不因等待静默丢弃 Session 成果。出现未结算的部分物理写入时仍按 B3 对该目标阻止 live capture。
- **异常决定**：真实内容冲突、删除对修改、无法确定的恢复第三种内容、必需验证持续失败且不能确定安全结果时，才呈现具体双方版本和相关文件供用户决定；决定绑定精确 revision，变化后重新计算。连续编辑本身先等待，不不断弹确认。二进制双方冲突不交给 LLM 自动改写，也不强迫用户正常只导出。

因此，“受管 Session 的确定性自动整合”和“不合作外部写入的检测边界”分别验收。默认自动流程仍存在未观测到的外部 check-to-replace 残余竞争，不能在产品文案写成绝对无损；增加 hash 不算解决 B4。后续如需强保证，另需真实排他/文件系统能力与单独设计，不把这项未实现能力隐含为本轮交付。

## 9. 后台调度和兼容发布

dispatcher 按 Project round-robin；每个 lane 最多一个 claim/Run。有界准备任务、resident runtime 和 provider inference 分别计数；建议默认 active Sessions=4，待目标设备压测确认。等待用户可释放 inference slot，保留该 Session 执行顺序；等待 Apply 不占执行槽。

旧 renderer 的 ChatBox follow-up effect、Remote bridge 和 trigger processor 分阶段切到提交/订阅。Brain 返回明确 capability 后 renderer 才停用旧派发；旧客户端可以继续调用原入口，但后端统一幂等服务保证只执行一次。禁止新旧双方分别启动同一个请求。

feature/policy version 固定到 Run；现有 direct Run 不迁目录、不偷释放旧 writer，但其 admission/release 必须接入 §8.4 的兼容互斥后才能开启新 Apply。新策略关闭时不接受新 isolated 请求，但已有现场、产物和 Apply 仍可恢复/读取。不要 drop 新表或降级将 private 内容静默复制回 primary。

## 10. 工程切片与完成门槛

| 切片                     | 内容                                                                                           | 合入前验证                                                                                                | 是否改变默认                 |
| ------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------- |
| A：数据与协议            | envelopes/claims/barrier schema、事务 helper、provider/identity/retention contract             | 重复迁移、双连接 CAS、cancel/claim race、旧 schema/leases 不变                                            | 否                           |
| B：私有 workspace 与读取 | Git/directory provider、source pinning、环境绑定、artifact resolver                            | 两 provider parity、同名文件隔离、source 变化、旧产物不可变、越权/磁盘满/crash                            | 否                           |
| C：后台准入闭环          | 全入口 service、dispatcher、claim→lease、启动恢复、renderer capability handshake               | 同 Space/跨 Space 真重叠；页面卸载后 follow-up 开始；single/workforce/remote/trigger 去重                 | 仅测试/显式 opt-in           |
| D：自动整合与 UX         | outbox/path receipts、三方 merge、bounded rebase/验证、target identity、Session/Space 来源投影 | 无点击自动整合、同文件不同/相同/冲突、Gitless parity、新旧互斥、source fence、partial crash、外部编辑边界 | 仅实现审查后 opt-in          |
| E：开启与观测            | 迁移、容量、公平性、rollout、回滚                                                              | 全矩阵及旧 Run durability/权限回归通过                                                                    | 产品批准及实现 Review 后开启 |

不把“完成 A”描述为功能完成。用户目标完成至少要求 B/C/D/E 全部满足，不以只支持 Workforce、只有 Git Space、只能前台页面启动代替。

## 11. 测试设计

采用 fake deterministic runtime + barriers 验证顺序，不依赖模型耗时或 sleep 猜测并发。

- **`same_space_sessions_overlap`**：A 到工具 barrier 后不结束，提交 B 并要求 B 也到 barrier；两个 result.txt 不互相覆盖。
- **`cross_space_four_sessions_overlap`**：两个 Space 各两个 Session，全部到 barrier；取消一个仅释放自己的 owner。
- **`same_project_fifo_and_send_now`**：一个 Session 三个请求，仅队首进入工具；Send now 待旧进程 settle 后转交，部分结果保留。
- **`claim_handoff_cancel_race`**：两个 SQLite connection 同时 claim/cancel/admit；恰有一个 owner，无丢消息、无重复 Attempt。
- **`resume_preserves_run_identity`**：Resume 创建新 Attempt，不创建新 Run/用户消息；未知副作用仍阻止自动 dispatch。
- **`terminal_before_settlement_blocks_only_owner`**：先写 terminal、延迟 checkpoint，所属 Session 下一轮被 barrier 挡住，其他 Session 不受影响。
- **`source_overlay_three_way_conflict`**：B/P x=1、S x=2、dirty x=3 必须冲突；同内容去重；读取不会 stage 用户数据。
- **`artifact_revision_survives_next_run_and_gc`**：下一轮同名覆盖/Apply/归档后，旧 artifact 仍读旧 bytes，retention 在引用存在时拒绝 GC。
- **`same_physical_target_auto_integration`**：两个 Space 别名同目录，自动发布识别同一目标；dirty 参与三方 merge，index/HEAD 不被更改，冲突保留版本。
- **`same_file_auto_merge_and_dedup`**：同文件不同区块自动合并，相同重叠去重并保留其他 hunk；真实重叠只阻该文件组，其他文件/Session 继续，无 routine Apply。
- **`per_run_delta_receipts_and_successors`**：R1.x 完成后其他 Session 改 x，R2 仅改 y 不重复发布 x；duplicate outbox 不覆写；未决前序只挡相关路径，前序被放弃后后继必须 rebase。下轮输入跳过已整合 delta，不能复活被后续版本替代的旧结果。
- **`snapshot_receipts_share_target_boundary`**：捕获 P 与读取 receipts 之间完成一次发布，不能用旧 P 加最新进度漏掉 Session delta；旧 retained P 使用对应历史 cursor。
- **`bounded_recompute_exact_validation`**：target/source/binding/owner/generation 任一变化使候选和验证失效；两次失败转 durable wait，恢复不无限循环。活跃 Run 输入、旧 artifact 保持原 digest。
- **`gitless_auto_integration_parity`**：同一组 B/S/T 文本/二进制/创建/删除/rename fixtures 两 provider 结果一致；保留完整 lineage/content，Gitless 不用 live 目录猜 base。
- **`global_env_and_cwd_do_not_leak`**：不同 endpoint/env/MCP/download/context 哨兵值，跨 async/thread/subprocess 均归正确 owner。
- **`restart_reconciles_all_boundaries`**：claim、半物化、admitted-before-start、tool-dispatched、promotion、Apply 半写入逐点 crash；恢复无盲重放。

本轮 B1–B4 最小确定性验证计划（Git/directory 都适用；临时 fixture 的 pass 不代表实现通过）：

- **B1 `cancel_restart_manifest_after_settle`**：durable cancel + 模拟存活 writer；事实校验后、停稳前追加 late 文件，断言尚无最终 manifest；停稳→settle→checkpoint 后当前 generation 固化包含 late 的 recovery revision。预置 terminal/旧 manifest 也不能跳过 barrier；旧 generation 再发布被拒绝；无法停稳则 needs_attention。
- **B2 `legacy_apply_mutual_exclusion_both_directions`**：A legacy 停在写 barrier，B 隔离执行完成且 artifact 可读，B Apply 必须等待；A terminal 但未 settle 仍等待，安全释放后才能发布。反向先持 Apply/recovery，新的 legacy request 保持 queued；两个 Space 别名同目录结果相同。
- **B3 `capture_rejects_stable_partial_publish`**：在 a/b 每次文件写边界和 ref/index 更新前后暂停/模拟 crash；即使完整前后 hash 相同，writing/recovery_required 时 live capture 都被拒绝。copy 期间一次受管 write/restore 的 epoch 变化也使结果作废；只有已结算完整 preimage/postimage 可发布，旧不可变 revision 可独立读取。
- **B4 `external_save_between_check_and_replace`**：在最终检查与 replace 间明确注入 U，证明未合作外部保存仍可能丢失；pass 表示边界反例成立。另测已捕获的外部改动进入 T，目标持续变化有界等待并保留版本；正常稳定候选自动发布且没有暂停编辑器确认。不能用更多 hash、导出或用户停止编辑的假设宣称已关闭外部竞争。

已有 `test_coordinator.py` 和 `test_scheduler.py` 中 direct FIFO 用例保留为 legacy policy 的回归，不直接删除/改断言掩盖策略迁移。新策略另写参数化覆盖。#1924 同 Run operation 与 terminal settle 保护继续通过。

实现阶段运行 backend workspace_git/run_runtime/run_journal/queue focused suites，以及前端相关 ChatBox/Remote/trigger/projection 测试；UI 修改后再运行 type-check、design-token、locale checks。本次仅 Markdown 设计，验证相对链接、格式、术语与 `git diff --check`。

## 12. Review 检查点

1. 按已明确的产品方向审查：隔离执行 + 默认自动整合，无日常 Apply/只导出；Gitless 完整纳入。同 Session FIFO 保留，容量 4 仍待压测。
2. 协议决定：execution_requests 与 follow_up_requests 权威边界、Resume 幂等身份、claim→lease 原子交接。
3. 数据正确性：terminal 释放与 finalization barrier、generation fencing、稳定 artifact 与 source retention。
4. 发布语义：逐 Run delta/path receipts、同文件确定性合并、bounded rebase 与精确验证、legacy 双向互斥/source fence；外部 writer 检测的残余竞争明确。发布等待不占 Session lane；下轮若需要尚未解决的冲突输入，单独显示其依赖。
5. 推进顺序：A/B 是后续授权后的切片，不是本轮实施许可；本轮冻结文档后停止。默认开关须获产品批准且通过 C/D/E 实现审查，不能把设计审查或阶段性能力当完整交付。
