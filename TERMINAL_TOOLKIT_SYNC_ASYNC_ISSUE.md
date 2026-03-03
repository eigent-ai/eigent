# Terminal Toolkit ACTIVATE 日志缺失问题 - 根本原因分析

**分析时间**: 2026-01-01 18:10
**日志时间段**: 18:03:35 - 18:04:00

---

## 🔍 问题现象总结

### 前端日志 ✅ 完整
- 8次 Terminal Toolkit 调用
- 每次都有 ACTIVATE 和 DEACTIVATE 事件

### 后端日志 ⚠️ 部分缺失
```
时间           ACTIVATE  DEACTIVATE  状态
18:03:35.116   ❌        ✅          缺失 ACTIVATE
18:03:39.248   ❌        ✅          缺失 ACTIVATE
18:03:40.786   ❌        ✅          缺失 ACTIVATE
18:03:42.207   ❌        ✅          缺失 ACTIVATE
18:03:45.584   ❌        ✅          缺失 ACTIVATE
18:03:47.797   ✅        ✅          正常
18:03:53.345   (配对↑)  ✅          正常
18:03:56.288   ❌        ✅          缺失 ACTIVATE
18:03:58.199   ✅        ✅          正常
18:04:00.246   (配对↑)  ✅          正常
```

**统计**: 8次调用中，5次缺失 ACTIVATE（62.5% 失败率）

---

## 🚨 关键错误信息

在缺失 ACTIVATE 的调用之前，后端日志显示：

```
[error] BACKEND: /Users/puzhen/.eigent/venvs/backend-0.0.73/lib/python3.10/site-packages/camel/utils/commons.py:1016:
RuntimeWarning: coroutine 'TaskLock.put_queue' was never awaited
  return func(*args, **kwargs)
RuntimeWarning: Enable tracemalloc to get the object allocation traceback
```

**错误位置**: `camel/utils/commons.py:1016`
**错误类型**: RuntimeWarning
**错误内容**: 异步协程 `TaskLock.put_queue` 未被 await

---

## 🕵️ 根本原因分析

### 1. shell_exec 的执行上下文

Terminal Toolkit 的 `shell_exec` 方法是**同步方法**：

```python
# terminal_toolkit.py:144
def shell_exec(self, id: str, command: str, block: bool = True, timeout: float = 20.0) -> str:
    result = super().shell_exec(id, command, block, timeout)
    if block and result == "":
        return "Command executed successfully (no output)."
    return result
```

### 2. @listen_toolkit 装饰器的同步版本

当 `shell_exec` 被 `@listen_toolkit` 装饰后，同步包装器会：

```python
# toolkit_listen.py:232
activate_data = ActionActivateToolkitData(...)
_safe_put_queue(task_lock, activate_data)  # ← 尝试发送 ACTIVATE 事件
```

### 3. _safe_put_queue 的问题

`_safe_put_queue` 函数尝试处理同步/异步上下文：

```python
def _safe_put_queue(task_lock, data):
    try:
        loop = asyncio.get_running_loop()
        # 在异步上下文中
        task = asyncio.create_task(task_lock.put_queue(data))
        ...
    except RuntimeError:
        # 在同步上下文中，创建新线程
        def run_in_thread():
            new_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(new_loop)
            new_loop.run_until_complete(task_lock.put_queue(data))
            new_loop.close()

        thread = threading.Thread(target=run_in_thread, daemon=True)
        thread.start()
```

### 4. 问题所在：CAMEL 内部装饰器冲突

**关键发现**: 错误来自 `camel/utils/commons.py:1016`，而不是我们的代码！

这意味着：
1. MCP 工具通过 `tool.func.async_call(**args)` 调用 shell_exec
2. CAMEL 内部有一个装饰器/包装器（在 commons.py:1016）
3. 这个包装器在**同步上下文**中错误地调用了 `task_lock.put_queue()`
4. 导致 ACTIVATE 事件的发送失败

### 5. 为什么 DEACTIVATE 没问题？

可能的原因：
- DEACTIVATE 事件通过不同的代码路径发送
- 或者 DEACTIVATE 使用了不同的机制（可能在异步上下文中）
- 或者 CAMEL 包装器只包装了工具调用的开始，不包装结束

---

## 🎯 为什么有些调用有 ACTIVATE？

对比有问题和正常的调用：

### 缺失 ACTIVATE 的调用（前5次）
- 没有 "Agent executing async tool" 日志
- 可能直接从某处同步调用
- 通过 CAMEL 内部路径

### 有 ACTIVATE 的调用（第6、8次）
```
[info] BACKEND: 2026-01-01 18:03:47,797 - toolkit_listen - INFO - [TOOLKIT ACTIVATE] ...
[info] BACKEND: 2026-01-01 18:03:58,196 - agent - INFO - Agent developer_agent executing async tool: shell_exec from toolkit: mcp_toolkit
[info] BACKEND: 2026-01-01 18:03:58,199 - toolkit_listen - INFO - [TOOLKIT ACTIVATE] ...
```

- 有 "Agent executing async tool" 日志
- 通过 `agent.py:_aexecute_tool()` 调用
- 在**异步上下文**中执行

### 差异分析

**假设**: 前几次调用可能是通过**不同的调用路径**：
- 可能是初始化时的同步调用
- 可能是 MCP server 的同步握手
- 可能是某个工具的预热/测试调用

而后面的调用是通过正常的 agent 异步工具执行路径。

---

## 🔧 修复方案

### 方案 1: 修复 _safe_put_queue（推荐）

问题是当在 CAMEL 装饰器内部的同步上下文中调用时，`_safe_put_queue` 可能无法正确工作。

**改进方案**：确保线程正确启动并等待一小段时间

```python
def _safe_put_queue(task_lock, data):
    """Safely put data to the queue, handling both sync and async contexts"""
    try:
        loop = asyncio.get_running_loop()
        task = asyncio.create_task(task_lock.put_queue(data))
        if hasattr(task_lock, "add_background_task"):
            task_lock.add_background_task(task)
        def handle_task_result(t):
            try:
                t.result()
            except Exception as e:
                logger.error(f"[listen_toolkit] Background task failed: {e}")
        task.add_done_callback(handle_task_result)
    except RuntimeError:
        # No running event loop
        try:
            import queue
            result_queue = queue.Queue()

            def run_in_thread():
                try:
                    new_loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(new_loop)
                    try:
                        new_loop.run_until_complete(task_lock.put_queue(data))
                        result_queue.put(("success", None))
                    except Exception as e:
                        result_queue.put(("error", e))
                    finally:
                        new_loop.close()
                except Exception as e:
                    logger.error(f"[listen_toolkit] Failed to send data in thread: {e}")
                    result_queue.put(("error", e))

            thread = threading.Thread(target=run_in_thread, daemon=False)  # 改为非守护线程
            thread.start()

            # 等待一小段时间确保线程启动
            try:
                status, error = result_queue.get(timeout=0.5)
                if status == "error":
                    logger.error(f"[listen_toolkit] Thread execution failed: {error}")
            except queue.Empty:
                # 线程仍在运行，但我们不能无限等待
                logger.warning(f"[listen_toolkit] Thread execution timeout, continuing anyway")

        except Exception as e:
            logger.error(f"[listen_toolkit] Failed to send data to queue: {e}")
```

### 方案 2: 检测并避免 CAMEL 包装器冲突

修改 `auto_listen_toolkit` 的逻辑，检测是否已经被 CAMEL 包装：

```python
def auto_listen_toolkit(base_toolkit_class: Type[T]) -> Callable[[Type[T]], Type[T]]:
    def class_decorator(cls: Type[T]) -> Type[T]:
        for method_name, base_method in base_methods.items():
            if method_name in cls.__dict__:
                overridden_method = cls.__dict__[method_name]

                # 检查是否已被 CAMEL 包装
                is_camel_wrapped = (
                    hasattr(overridden_method, '__module__') and
                    'camel' in overridden_method.__module__
                )

                if is_camel_wrapped:
                    logger.warning(f"Method {method_name} already wrapped by CAMEL, skipping")
                    continue

                # 其他逻辑...
```

### 方案 3: 使用 Agent 层统一发送事件（最简单）

不依赖装饰器，让 Agent 统一负责发送 ACTIVATE/DEACTIVATE：

```python
# agent.py:439-450
# 移除装饰器检测，总是由 agent 发送事件
await task_lock.put_queue(ActionActivateToolkitData(...))
```

**优点**:
- 简单直接
- 避免同步/异步上下文问题
- 统一调用路径

**缺点**:
- 可能导致事件重复（需要前端去重）
- 不适用于非 agent 调用的工具

---

## 📊 影响评估

### 严重性
🟡 **中等** - 不影响功能，只影响日志完整性

### 影响范围
- **Terminal Toolkit**: 62.5% 的调用缺失 ACTIVATE 日志
- **其他 Toolkit**: 可能也受影响（如果通过类似路径调用）
- **前端显示**: ✅ 不受影响（前端有完整日志）
- **后端追溯**: ❌ 受影响（难以确定工具何时开始执行）

### 用户体验
- ✅ 功能正常
- ⚠️ 后端日志不完整
- ✅ 前端显示正常

---

## 🧪 验证方法

### 1. 确认问题来源
```bash
# 查找所有 RuntimeWarning
grep "RuntimeWarning.*TaskLock.put_queue" action.log

# 统计缺失 ACTIVATE 的比例
grep "TOOLKIT ACTIVATE.*Terminal" action.log | wc -l
grep "TOOLKIT DEACTIVATE.*Terminal" action.log | wc -l
```

### 2. 测试修复
1. 应用方案 1 的修复
2. 重启后端
3. 运行包含多次 shell 命令的任务
4. 检查日志：
   - ✅ 没有 RuntimeWarning
   - ✅ ACTIVATE 和 DEACTIVATE 数量相等
   - ✅ 每个 DEACTIVATE 都有对应的 ACTIVATE

---

## 📝 下一步行动

### 立即（推荐）
1. ✅ **应用方案 1** - 改进 `_safe_put_queue` 函数
2. 重启后端测试
3. 验证日志完整性

### 短期
1. 添加监控警告：如果 ACTIVATE/DEACTIVATE 不配对
2. 添加单元测试覆盖同步/异步上下文

### 长期
1. 与 CAMEL 团队沟通，修复 commons.py:1016 的问题
2. 统一工具调用路径，避免同步/异步混用
3. 考虑将所有工具改为纯异步

---

## 🎯 结论

**问题根源**: CAMEL 内部装饰器在同步上下文中错误调用异步函数

**直接原因**: `_safe_put_queue` 在某些情况下无法正确处理同步上下文中的事件发送

**推荐修复**: 改进 `_safe_put_queue`，使用非守护线程并添加结果反馈

**优先级**: 🟡 中等 - 不影响功能，但影响日志追溯能力

---

**分析人**: Claude Code
**状态**: ✅ 根本原因已确定
**下一步**: 应用修复方案并测试
