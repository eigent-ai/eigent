# MCP Toolkit 名称显示问题修复

## 问题

前端显示 "mcp toolkit" 而不是 "Terminal Toolkit"

## 根本原因

### Agent 获取 toolkit 名称的方式（之前）
```python
toolkit_name = getattr(tool, "_toolkit_name") if hasattr(tool, "_toolkit_name") else "mcp_toolkit"
```

### 问题分析
1. **MCP 工具注册方式**：
   ```python
   terminal_toolkit = message_integration.register_functions([terminal_toolkit.shell_exec])
   ```
   使用 `register_functions` 注册单个方法，而不是整个 toolkit

2. **导致的问题**：
   - `tool._toolkit_name` 属性没有被设置
   - 使用默认值 "mcp_toolkit"
   - 前端显示 "mcp toolkit"

3. **装饰器为什么能获取正确名称**：
   ```python
   toolkit_name = toolkit.toolkit_name()  # 直接调用 toolkit 实例的方法
   # 返回 "Terminal Toolkit"
   ```

## 修复方案

### 多层 Fallback 机制
```python
# Method 1: Check _toolkit_name attribute
if hasattr(tool, "_toolkit_name"):
    toolkit_name = tool._toolkit_name

# Method 2: For MCP tools, check if func has __self__ (the toolkit instance)
if not toolkit_name and hasattr(tool, "func") and hasattr(tool.func, "__self__"):
    toolkit_instance = tool.func.__self__
    if hasattr(toolkit_instance, "toolkit_name") and callable(toolkit_instance.toolkit_name):
        toolkit_name = toolkit_instance.toolkit_name()

# Method 3: Check if tool.func is a bound method with toolkit
if not toolkit_name and hasattr(tool, "func"):
    if hasattr(tool.func, "func") and hasattr(tool.func.func, "__self__"):
        toolkit_instance = tool.func.func.__self__
        if hasattr(toolkit_instance, "toolkit_name") and callable(toolkit_instance.toolkit_name):
            toolkit_name = toolkit_instance.toolkit_name()

# Default fallback
if not toolkit_name:
    toolkit_name = "mcp_toolkit"
```

### 原理

**MCP 工具结构**：
```
FunctionTool (tool)
  └─ func (MCP wrapper)
       └─ func (bound method)
            └─ __self__ (TerminalToolkit instance)
                 └─ toolkit_name() → "Terminal Toolkit"
```

通过检查 `tool.func.__self__` 或 `tool.func.func.__self__`，我们可以获取到真实的 toolkit 实例，然后调用其 `toolkit_name()` 方法。

## 预期效果

重启后端后，前端应该显示：
- ✅ "Terminal Toolkit" 而不是 "mcp toolkit"
- ✅ 其他通过 MCP 注册的工具也会显示正确名称

## 测试步骤

1. 重启后端
2. 运行使用 Terminal 的任务
3. 检查前端 WorkFlow 面板，应该看到 "Terminal Toolkit"

---

**修复人**: Claude Code
**状态**: ✅ 修复完成
**文件**: backend/app/utils/agent.py (第 429-451 行)
