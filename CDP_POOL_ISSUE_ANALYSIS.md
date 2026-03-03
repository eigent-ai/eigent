# CDP浏览器池问题分析报告

## 问题描述

当前CDP池在第一次运行时正常工作，可以并行使用多个CDP浏览器（9223, 9225, 9226, 9227）。但是任务完成后第二次运行时，**只使用一个浏览器**（只使用9223）。

## 根本原因分析

### 1. 浏览器释放机制

通过代码检查发现，CDP浏览器的释放是通过以下调用链完成的：

```
Action.end/Action.stop
  → stop_gracefully()
  → _cleanup_all_agents()
  → agent._cleanup_callback()
  → _cdp_pool_manager.release_browser()
```

**关键代码位置：**
- `backend/app/utils/workforce.py:403` - stop_gracefully调用_cleanup_all_agents
- `backend/app/utils/workforce.py:408-436` - _cleanup_all_agents遍历agents并调用cleanup_callback
- `backend/app/utils/agent.py:1233-1241` - cleanup_cdp_browser函数释放浏览器
- `backend/app/service/chat_service.py:853-854` - Action.end时调用stop_gracefully

### 2. 实际日志证据

从`action.log`中发现关键问题：

```log
[WF-CLEANUP] Starting cleanup for all agents in workforce 12902385984
[WF-CLEANUP] ✅ Cleanup completed, 0 agent(s) cleaned up
```

**清理了0个agent！** 这说明虽然调用了`stop_gracefully()`，但是`_cleanup_all_agents()`没有找到任何child workers或coordinator_agent需要清理。

### 3. 问题根源

查看`workforce.py`的`_cleanup_all_agents()`代码：

```python
def _cleanup_all_agents(self) -> None:
    cleanup_count = 0

    # Cleanup all child workers
    if hasattr(self, 'children') and self.children:
        for child in self.children:
            if hasattr(child, 'worker_agent'):
                agent = child.worker_agent
                if hasattr(agent, '_cleanup_callback') and callable(agent._cleanup_callback):
                    agent._cleanup_callback()
                    cleanup_count += 1

    # Cleanup coordinator agent
    if hasattr(self, 'coordinator_agent') and self.coordinator_agent:
        if hasattr(self.coordinator_agent, '_cleanup_callback'):
            self.coordinator_agent._cleanup_callback()
            cleanup_count += 1
```

**问题：** Workforce可能没有正确维护`children`或`coordinator_agent`，导致cleanup时找不到agents。

可能的原因：
1. Workforce在任务完成后清空了`children`/`coordinator_agent`
2. Agent没有被正确添加到workforce的children列表
3. 使用的是不同的workforce管理模式（不使用children）

## 日志中的其他Error分析

### Error 1: browser_get_page_snapshot参数错误

```
Error executing async tool 'browser_get_page_snapshot':
HybridBrowserToolkit.browser_get_page_snapshot() got an unexpected keyword argument 'message_title'
```

**问题：** Message integration包装器在调用`browser_get_page_snapshot`时传递了`message_title`参数，但该工具函数不接受此参数。

**影响：** 这会导致工具调用失败，影响页面截图功能。

### Error 2: Task lock not found

```
ERROR - Task lock not found
WARNING - Error executing async tool 'browser_get_page_snapshot': Task not found
WARNING - Error executing async tool 'shell_exec': Task not found
```

**问题：** 任务已经完成并删除了task lock（`await delete_task_lock(task_lock.id)`），但仍有异步工具在尝试访问task lock。

**原因：** 这是任务停止后的竞态条件 - agents仍在执行中，但task lock已被删除。

**影响：** 不影响核心功能，但会产生大量error日志。

## 测试脚本验证

创建了测试脚本`test_cdp_release_issue.py`，成功复现问题：

```
异常场景：模拟没有调用cleanup_callback的情况
⚠️  任务完成，但是 cleanup_callback 没有被调用！
⚠️  问题复现！第二次任务只能获取 0 个浏览器（期望4个）
   当前占用的端口: [9223, 9225, 9226, 9227]
   这导致所有agent只能使用同一个浏览器（如果有fallback逻辑）
```

## 解决方案建议

### 方案1：在任务开始时清理遗留占用（推荐）

在每次任务开始时，检查并清理之前任务遗留的CDP浏览器占用。

**优点：**
- 最简单直接
- 不依赖cleanup_callback
- 即使cleanup失败也能恢复

**实现位置：**
- `backend/app/service/chat_service.py` - 在任务开始时添加清理逻辑

### 方案2：确保cleanup_callback总是被调用

修复workforce的agent管理，确保agents被正确添加到children列表。

**优点：**
- 修复根本问题
- 适用于所有资源清理场景

**缺点：**
- 需要深入了解workforce的agent管理机制
- 可能影响其他功能

### 方案3：添加基于任务ID的自动清理

使CDP pool manager维护任务ID到session ID的映射，任务结束时自动清理该任务的所有占用。

**优点：**
- 更健壮，不依赖callback链
- 可以处理异常终止的情况

**缺点：**
- 需要修改CdpBrowserPoolManager
- 增加复杂度

### 方案4：添加超时机制

为CDP浏览器占用添加超时机制，自动释放长时间未使用的浏览器。

**优点：**
- 防止资源泄漏
- 可以处理各种异常情况

**缺点：**
- 需要添加定时器逻辑
- 可能误释放正在使用的浏览器（如果任务执行时间过长）

## 推荐实施方案

**首选：方案1 + 方案3的组合**

1. **短期修复（方案1）：** 在任务开始时检查并清理遗留占用
2. **长期优化（方案3）：** 改进pool manager，基于任务ID自动管理占用

这样既能快速解决当前问题，又能提供更健壮的长期解决方案。

## 附加发现

1. **CDP端口可用性检查警告：**
   ```
   [warn] CDP port 9223 is not available: Error
   ```
   这些是正常的警告，因为端口已经被占用（浏览器正在运行）。

2. **Workforce状态管理：**
   - 第一次任务：`state: RUNNING, _running: False`
   - 第二次任务：`state: IDLE, _running: False`

   说明任务执行机制正常，问题仅在于资源清理。

## 测试建议

1. 运行`test_cdp_release_issue.py`验证问题
2. 实施修复后，测试连续多次任务执行
3. 验证所有4个CDP浏览器都能被正常使用
4. 检查日志确认cleanup正确执行
