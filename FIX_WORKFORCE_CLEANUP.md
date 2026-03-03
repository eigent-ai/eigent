# 🐛 问题根因已找到！

## 问题所在

在 `backend/app/utils/workforce.py` 的 `_cleanup_all_agents()` 方法中：

**❌ 错误代码（当前）：**
```python
if hasattr(self, 'children') and self.children:
    for child in self.children:
        # ...
```

**✅ 正确代码（应该改成）：**
```python
if hasattr(self, '_children') and self._children:
    for child in self._children:
        # ...
```

## 为什么会出错？

1. Workforce 继承自 BaseWorkforce（来自camel库）
2. BaseWorkforce 内部使用 `self._children` 存储子节点（私有属性，带下划线）
3. 你的cleanup代码使用了 `self.children`（没有下划线），所以 `hasattr(self, 'children')` 返回 False
4. 结果：cleanup时找不到任何children，清理了0个agents

## 修复方法

### 方法1：修改 workforce.py（推荐）

编辑 `/Users/puzhen/Desktop/pre/camel_project/eigent/backend/app/utils/workforce.py`

找到第414行附近的代码：
```python
# Cleanup all child workers
if hasattr(self, 'children') and self.children:  # ❌ 错误
    for child in self.children:  # ❌ 错误
```

改成：
```python
# Cleanup all child workers
if hasattr(self, '_children') and self._children:  # ✅ 正确
    for child in self._children:  # ✅ 正确
```

### 完整的修复补丁

```diff
diff --git a/backend/app/utils/workforce.py b/backend/app/utils/workforce.py
index xxx..xxx 100644
--- a/backend/app/utils/workforce.py
+++ b/backend/app/utils/workforce.py
@@ -411,8 +411,8 @@ class Workforce(BaseWorkforce):
         cleanup_count = 0

         # Cleanup all child workers
-        if hasattr(self, 'children') and self.children:
-            for child in self.children:
+        if hasattr(self, '_children') and self._children:
+            for child in self._children:
                 # Cleanup base agent
                 if hasattr(child, 'worker_agent'):
                     agent = child.worker_agent
```

## 验证修复

修复后，重新运行测试，日志应该显示：

**修复前：**
```
[WF-CLEANUP] Starting cleanup for all agents in workforce 5609259312
[WF-CLEANUP] ✅ Cleanup completed, 0 agent(s) cleaned up  ← 问题
```

**修复后：**
```
[WF-CLEANUP] Starting cleanup for all agents in workforce 5609259312
[WF-CLEANUP] Found AgentPool for worker: search_agent, available=3, in_use=1
[WF-CLEANUP] Called cleanup for pooled agent (available): xxx
[WF-CLEANUP] Called cleanup for pooled agent (available): xxx
[WF-CLEANUP] ✅ Cleanup completed, 3 agent(s) cleaned up  ← 成功！
```

## 测试步骤

1. 修改 `workforce.py` 文件
2. 重启应用
3. 运行第一个任务（观察使用4个CDP浏览器）
4. 任务完成后，检查cleanup日志（应该清理了N个agents，N > 0）
5. 运行第二个任务（应该再次能使用4个CDP浏览器）

## 额外检查

修复后还可以添加调试日志来验证：

```python
def _cleanup_all_agents(self) -> None:
    """Call cleanup callbacks for all agents to release resources (e.g., CDP browsers)."""
    logger.info(f"[WF-CLEANUP] Starting cleanup for all agents in workforce {id(self)}")
    logger.info(f"[WF-CLEANUP-DEBUG] Number of children: {len(self._children) if hasattr(self, '_children') else 0}")
    cleanup_count = 0

    # Cleanup all child workers
    if hasattr(self, '_children') and self._children:
        logger.info(f"[WF-CLEANUP-DEBUG] Processing {len(self._children)} children")
        for i, child in enumerate(self._children):
            logger.info(f"[WF-CLEANUP-DEBUG] Child {i}: type={type(child).__name__}, "
                       f"has_worker_agent={hasattr(child, 'worker_agent')}, "
                       f"has_agent_pool={hasattr(child, 'agent_pool')}")
            # ... rest of cleanup logic ...
```

这样可以清楚看到有多少children，以及它们的结构。
