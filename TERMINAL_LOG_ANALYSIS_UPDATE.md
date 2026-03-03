# Terminal Toolkit 日志分析 - 更新报告

**分析时间**: 2026-01-01 18:16
**测试日志**: 18:12-18:15

---

## 📊 数据统计

### 实际调用次数（基于前端日志）
```bash
grep "FRONTEND TOOLKIT ACTIVATE.*Terminal" localhost-1767291166945.log | wc -l
# 结果: 9次
```

### 后端日志统计
```bash
# ACTIVATE 日志
grep "TOOLKIT ACTIVATE.*Terminal" action.log | wc -l
# 结果: 5次 (实际应该是 9次)

# DEACTIVATE 日志
grep "TOOLKIT DEACTIVATE.*Terminal" action.log | wc -l
# 结果: 18次 (每次重复2遍，实际 9次)
```

### 日志配对情况
| 序号 | 实际情况 | ACTIVATE (后端) | DEACTIVATE (后端) | 状态 |
|------|---------|----------------|------------------|------|
| 1    | ✅ 调用  | ✅ 有           | ✅ 有             | 正常 |
| 2    | ✅ 调用  | ❌ 缺失         | ✅ 有             | 缺失 ACTIVATE |
| 3    | ✅ 调用  | ❌ 缺失         | ✅ 有             | 缺失 ACTIVATE |
| 4    | ✅ 调用  | ❌ 缺失         | ✅ 有             | 缺失 ACTIVATE |
| 5    | ✅ 调用  | ❌ 缺失         | ✅ 有             | 缺失 ACTIVATE |
| 6    | ✅ 调用  | ✅ 有           | ✅ 有             | 正常 |
| 7    | ✅ 调用  | ✅ 有           | ✅ 有             | 正常 |
| 8    | ✅ 调用  | ❌ 缺失         | ✅ 有             | 缺失 ACTIVATE |
| 9    | ✅ 调用  | ✅ 有           | ✅ 有             | 正常 |

**成功率**: 5/9 = 55.6% (有 ACTIVATE 日志)
**失败率**: 4/9 = 44.4% (缺失 ACTIVATE 日志)

---

## 🔍 关键发现

### 1. 日志重复问题
后端每条日志都重复2次，例如：
```
[info] BACKEND: 2026-01-01 18:12:18,365 - toolkit_listen - INFO - [TOOLKIT ACTIVATE] ...
[info] BACKEND: 2026-01-01 18:12:18,365 - toolkit_listen - INFO - [TOOLKIT ACTIVATE] ...  # 重复
```

**原因**: 可能有两个日志 handler 配置

### 2. RuntimeWarning 的时机

```
[info] 18:12:18,365 - [TOOLKIT ACTIVATE] Toolkit: Terminal Toolkit ...  ✅ ACTIVATE 成功记录
[info] 18:12:18,365 - [TOOLKIT ACTIVATE] Toolkit: Terminal Toolkit ...  (重复)
[error] RuntimeWarning: coroutine 'TaskLock.put_queue' was never awaited  ⚠️ 警告出现
  at /Users/puzhen/.eigent/venvs/backend-0.0.73/lib/python3.10/site-packages/camel/utils/commons.py:1016
[info] 18:12:18,410 - [TOOLKIT DEACTIVATE] Toolkit: Terminal Toolkit ...
```

**重要**: RuntimeWarning 出现在 ACTIVATE 成功记录**之后**！

这说明：
- `_safe_put_queue` 成功发送了 ACTIVATE 事件到队列
- 日志成功记录了
- 但是 CAMEL 的 `@with_timeout` 装饰器仍然报告协程未被 await

### 3. 调用路径差异

#### 有 ACTIVATE 的调用（通过 Agent）
```
[info] 18:12:36,172 - toolkit_listen - [TOOLKIT ACTIVATE] Terminal Toolkit ...
```
- 通过 `agent.py:_aexecute_tool()` 调用
- 在异步上下文中
- `@listen_toolkit` 装饰器正常工作

#### 缺失 ACTIVATE 的调用（直接调用）
```
[info] 18:12:24,322 - toolkit_listen - [TOOLKIT DEACTIVATE] Terminal Toolkit ...
# 没有对应的 ACTIVATE
```
- 可能通过 MCP 的同步调用路径
- 或者是某种初始化调用
- ACTIVATE 事件发送失败

---

## 🚨 问题根源

### RuntimeWarning 来自 CAMEL 内部

**文件**: `camel/utils/commons.py:1016`
**装饰器**: `@with_timeout()`

```python
# camel/utils/commons.py:1005-1016
@functools.wraps(func)
def wrapper(*args, **kwargs):
    effective_timeout = timeout
    if effective_timeout is None and args:
        effective_timeout = getattr(args[0], 'timeout', None)

    if effective_timeout is None:
        return func(*args, **kwargs)  # ← 第 1016 行
    ...
```

当 `shell_exec` 被调用时：
1. CAMEL 的 `@with_timeout` 包装器执行
2. 调用我们的 `@listen_toolkit` 装饰的 `shell_exec`
3. `@listen_toolkit` 内部调用 `_safe_put_queue`
4. `_safe_put_queue` 在新线程中创建事件循环并发送事件
5. **但是** `@with_timeout` 没有等待这个线程完成就返回了
6. Python 检测到有协程（`task_lock.put_queue()`）在线程中被创建但原始函数已经返回
7. 触发 RuntimeWarning

### 为什么有些调用没有 ACTIVATE？

可能的原因：

#### 假设 1: 线程竞争条件
```python
# _safe_put_queue 中
thread = threading.Thread(target=run_in_thread, daemon=False)
thread.start()

# 等待结果（最多 1 秒）
try:
    status, error = result_queue.get(timeout=1.0)
    ...
except queue.Empty:
    logger.warning("Thread execution timeout after 1s")
```

如果线程执行时间 > 1秒，主函数会继续执行，但事件可能还未发送。

#### 假设 2: 同步上下文检测失败
某些调用可能在一个"假异步"上下文中：
- `asyncio.get_running_loop()` 返回一个 loop
- 但实际在线程池中执行
- 导致 `create_task` 失败

#### 假设 3: CAMEL 装饰器顺序问题
如果 CAMEL 内部有多层装饰器，可能导致某些调用绕过了我们的 `@listen_toolkit`。

---

## 🔧 新的修复方案

### 方案 A: 直接在 TaskLock 中修复（推荐）

修改 `task_lock.put_queue()` 使其能够在同步上下文中安全调用：

```python
# backend/app/service/task.py
class TaskLock:
    async def put_queue(self, data):
        ...

    def put_queue_sync(self, data):
        """同步版本的 put_queue，用于同步上下文"""
        try:
            loop = asyncio.get_running_loop()
            # 在异步上下文中，创建 task
            return asyncio.create_task(self.put_queue(data))
        except RuntimeError:
            # 在同步上下文中，创建新的事件循环
            new_loop = asyncio.new_event_loop()
            try:
                return new_loop.run_until_complete(self.put_queue(data))
            finally:
                new_loop.close()
```

然后在 `_safe_put_queue` 中：
```python
def _safe_put_queue(task_lock, data):
    if hasattr(task_lock, 'put_queue_sync'):
        task_lock.put_queue_sync(data)
    else:
        # 旧的方法
        ...
```

### 方案 B: 完全绕过装饰器（简单但不优雅）

不使用 `@listen_toolkit` 装饰器，让 Agent 统一发送所有事件：

```python
# agent.py:439-450
# 移除装饰器检测，总是发送 ACTIVATE
await task_lock.put_queue(ActionActivateToolkitData(...))
```

### 方案 C: 忽略 RuntimeWarning（临时方案）

添加警告过滤器：
```python
import warnings
warnings.filterwarnings('ignore',
                       message='.*TaskLock.put_queue.*never awaited')
```

---

## 🧪 验证步骤

### 1. 确认线程超时
添加日志：
```python
# toolkit_listen.py:67-72
try:
    status, error = result_queue.get(timeout=1.0)
    if status == "error":
        logger.error(f"Thread execution failed: {error}")
    else:
        logger.info(f"Thread execution succeeded")  # 添加这行
except queue.Empty:
    logger.warning(f"Thread execution timeout after 1s")
```

### 2. 检查是否有超时
```bash
grep "Thread execution" action.log
```

### 3. 统计成功率
```bash
# 成功的线程
grep "Thread execution succeeded" action.log | wc -l

# 超时的线程
grep "Thread execution timeout" action.log | wc -l
```

---

## 📝 建议

### 立即
1. ✅ 添加更多调试日志确认问题
2. 检查是否有线程超时
3. 确认 RuntimeWarning 的具体触发点

### 短期
1. 实施方案 A - 添加同步版本的 put_queue
2. 或实施方案 B - 让 Agent 统一处理事件
3. 修复日志重复问题

### 长期
1. 与 CAMEL 团队沟通 `@with_timeout` 装饰器的问题
2. 统一工具调用路径
3. 改进异步/同步边界处理

---

## 🎯 结论

**问题状态**: 🟡 部分修复，仍需改进

**当前情况**:
- ✅ 修复方案部分有效（55.6% 成功率）
- ❌ 仍有 44.4% 的调用缺失 ACTIVATE
- ⚠️ RuntimeWarning 仍然存在

**推荐下一步**:
1. 添加调试日志验证线程执行情况
2. 实施方案 A - 添加同步 API
3. 或考虑方案 B - 统一由 Agent 发送事件

**优先级**: 🟡 中等 - 不影响功能，但影响日志追溯

---

**分析人**: Claude Code
**状态**: 需要进一步修复
**下一步**: 添加更多调试日志并选择最终修复方案
