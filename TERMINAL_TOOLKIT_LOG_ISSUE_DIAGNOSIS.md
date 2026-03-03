# Terminal Toolkit 日志缺失问题诊断报告

**诊断时间**: 2026-01-01 17:10
**问题**: Terminal Toolkit 的 `shell_exec` 调用缺少 ACTIVATE 日志

---

## 🔍 问题现象

### 前端日志 ✅ 正常
```
[FRONTEND TOOLKIT ACTIVATE] Toolkit: Terminal Toolkit | Method: shell exec | Task ID: 1767287191028-2399 | Agent: document_agent | Timestamp: 2026-01-01T17:07:16.140Z
[FRONTEND TOOLKIT DEACTIVATE] Toolkit: Terminal Toolkit | Method: shell exec | Task ID: 1767287191028-2399 | Agent: document_agent | Timestamp: 2026-01-01T17:07:24.843Z
```

### 后端日志 ⚠️ 缺失 ACTIVATE
```
# 只有 DEACTIVATE 日志
[info] BACKEND: 2026-01-01 17:07:24,773 - toolkit_listen - INFO - [TOOLKIT DEACTIVATE] Toolkit: Terminal Toolkit | Method: shell exec | Task ID: 1767287191028-2399 | Agent: document_agent | Status: SUCCESS | Timestamp: 2026-01-01T17:07:24.773790

# 但没有对应的 ACTIVATE 日志
```

### Agent 日志显示关键信息
```
[info] BACKEND: 2026-01-01 17:07:16,018 - agent - INFO - Agent document_agent executing async tool: shell_exec from toolkit: mcp_toolkit with args: {...}
```

**关键发现**: 工具来自 `mcp_toolkit`，不是直接来自 `TerminalToolkit`！

---

## 🕵️ 根本原因分析

### 1. 工具调用路径

```
User Request
    ↓
Agent (document_agent)
    ↓
MCP Toolkit (mcp_toolkit)
    ↓
shell_exec 工具 (FunctionTool)
    ↓
TerminalToolkit.shell_exec (实际执行)
```

### 2. Agent 的装饰器检测逻辑

在 `agent.py:431-450`：

```python
# 检查工具是否已被 @listen_toolkit 装饰
has_listen_decorator = hasattr(tool.func, "__wrapped__")

# 如果工具已被装饰，agent 不发送 ACTIVATE 事件
# 期望装饰器自己来发送
if not has_listen_decorator:
    await task_lock.put_queue(ActionActivateToolkitData(...))
```

### 3. MCP 工具的特殊性

MCP (Model Context Protocol) 工具是通过 `FunctionTool` 包装的：

```python
# MCP toolkit 注册工具时
tool = FunctionTool(
    func=terminal_toolkit.shell_exec,  # 被装饰的方法
    name="shell_exec",
    ...
)
```

**问题**: `tool.func` 可能指向 MCP 的包装层，而不是 TerminalToolkit.shell_exec 的装饰器包装层。

### 4. 装饰器检测失败的原因

```
FunctionTool
    ├─ func → MCP async_call wrapper
    │         ├─ __wrapped__? ❌ 不存在（MCP 包装层）
    │         └─ 实际调用 → TerminalToolkit.shell_exec
    │                       └─ __wrapped__? ✅ 存在（@listen_toolkit）
    └─ 结果：hasattr(tool.func, "__wrapped__") = False
```

因此：
1. Agent 检测到工具**没有**被装饰（误判）
2. Agent **应该**发送 ACTIVATE 事件，但是...
3. Agent 代码在 439-450 行说：`if not has_listen_decorator:` 才发送
4. 等等，`has_listen_decorator = False`，所以应该发送 ACTIVATE 啊！

---

## 🔬 更深入的分析

让我重新检查逻辑...

### Agent 的实际行为（agent.py:439-450）

```python
if not has_listen_decorator:
    # 如果没有装饰器，agent 发送 ACTIVATE
    await task_lock.put_queue(ActionActivateToolkitData(...))
```

### 预期：
- `has_listen_decorator = False` → Agent 发送 ACTIVATE ✅
- 工具执行时，`@listen_toolkit` 也发送 ACTIVATE ❌（重复！）

### 实际：
- ACTIVATE 日志缺失
- DEACTIVATE 日志存在

### 可能的原因：

#### 假设 A: Agent 认为工具已被装饰（但实际检测失败）
```python
has_listen_decorator = True  # 误判
→ Agent 不发送 ACTIVATE
→ 期望装饰器发送
→ 但装饰器也没发送（或发送失败）
```

#### 假设 B: MCP 工具的异步调用路径绕过了装饰器
```python
# agent.py:456-457
if hasattr(tool, "func") and hasattr(tool.func, "async_call"):
    # MCP 工具走这条路径
    result = await tool.func.async_call(**args)
```

**关键**: `tool.func.async_call` 可能直接调用底层方法，绕过了 `@listen_toolkit` 装饰器！

---

## 🎯 核心问题

### MCP 工具的调用链可能是：

```
Agent._aexecute_tool()
    ↓
tool.func.async_call(**args)  ← MCP 的 async_call
    ↓
[绕过 @listen_toolkit 装饰器]
    ↓
TerminalToolkit.shell_exec() 的原始方法
    ↓
super().shell_exec()  ← 调用 BaseTerminalToolkit
```

### 为什么 DEACTIVATE 有日志？

可能是因为：
1. DEACTIVATE 日志来自 agent.py 的 497-500 行
2. Agent 在工具执行完成后总是发送 DEACTIVATE
3. 但 ACTIVATE 被条件判断跳过了

---

## 🧪 验证方法

### 1. 检查 tool.func 的实际类型
```python
# 在 agent.py:433 之后添加
traceroot_logger.info(f"Tool type: {type(tool)}")
traceroot_logger.info(f"Tool.func type: {type(tool.func)}")
traceroot_logger.info(f"Has __wrapped__: {hasattr(tool.func, '__wrapped__')}")
```

### 2. 检查 MCP async_call 路径
```python
# 在 agent.py:456-457 之前
if hasattr(tool, "func") and hasattr(tool.func, "async_call"):
    traceroot_logger.info(f"Using MCP async_call path for {func_name}")
```

### 3. 检查 @listen_toolkit 是否真的被调用
```python
# 在 toolkit_listen.py:113 之前
logger.info(f"[TOOLKIT ACTIVATE PRE-LOG] About to log activate for {toolkit_name}.{method_name}")
```

---

## 🔧 可能的修复方案

### 方案 1: 修复 Agent 的装饰器检测（推荐）

修改 `agent.py:431`，更深入地检查嵌套的 func：

```python
# 原代码
has_listen_decorator = hasattr(tool.func, "__wrapped__")

# 修复后
def check_has_listen_decorator(tool):
    # Check direct wrapper
    if hasattr(tool, "func"):
        if hasattr(tool.func, "__wrapped__"):
            return True
        # Check nested for MCP tools
        if hasattr(tool.func, "func") and hasattr(tool.func.func, "__wrapped__"):
            return True
    return False

has_listen_decorator = check_has_listen_decorator(tool)
```

### 方案 2: 在 MCP 工具层添加日志

修改 MCP toolkit 的 async_call 方法，确保调用装饰器。

### 方案 3: 强制 Agent 总是发送 ACTIVATE（简单但不优雅）

```python
# 始终发送 ACTIVATE，即使工具已被装饰
# 让装饰器和 agent 都发送（前端会去重）
if not has_listen_decorator or toolkit_name == "mcp_toolkit":
    await task_lock.put_queue(ActionActivateToolkitData(...))
```

---

## 📊 影响范围

### 受影响的 Toolkit
- **Terminal Toolkit** (通过 MCP 调用时)
- **可能还有其他通过 MCP 调用的 toolkit**

### 未受影响
- 直接调用的 toolkit (File Toolkit, Excel Toolkit 等)

---

## 🚦 下一步行动

### 立即验证 (5分钟)
1. 在 agent.py:433 添加调试日志，检查 `tool.func` 的类型
2. 在 toolkit_listen.py:113 添加前置日志，确认是否被调用
3. 重启后端，运行一个使用 terminal 的任务
4. 检查新日志，确认假设

### 短期修复 (30分钟)
1. 实现方案 1 或方案 3
2. 测试验证
3. 更新文档

### 长期优化 (后续)
1. 统一 MCP 工具和普通工具的调用路径
2. 改进装饰器检测机制
3. 添加单元测试覆盖 MCP 工具

---

## 📝 总结

**问题**: Terminal Toolkit 的 ACTIVATE 日志缺失
**根因**: MCP 工具的 async_call 调用路径可能绕过了 `@listen_toolkit` 装饰器
**证据**:
- Agent 日志显示 `toolkit: mcp_toolkit`
- 只有 DEACTIVATE 日志，没有 ACTIVATE
- 前端正常收到 SSE 事件

**推荐修复**: 方案 1 - 改进 Agent 的装饰器检测逻辑
**优先级**: 🟡 中 - 影响日志追溯，但不影响功能

---

**诊断人**: Claude Code
**状态**: 待验证假设
**下一步**: 添加调试日志重新测试
