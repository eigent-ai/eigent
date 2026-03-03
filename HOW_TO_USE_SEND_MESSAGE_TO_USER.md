# 如何让 Agent 使用 send_message_to_user

**目标**: 让 Agent 主动向用户发送进度消息和状态更新

---

## 📍 工具位置

**工具名称**: `send_message_to_user`
**所属**: HumanToolkit
**文件**: `backend/app/utils/toolkit/human_toolkit.py:65-124`

**签名**:
```python
send_message_to_user(
    message_title: str,           # 消息标题
    message_description: str,     # 消息描述（一句话）
    message_attachment: str = ""  # 可选：文件路径或 URL
) -> str
```

---

## ✅ 工具已经可用

所有 agent 都已经自动包含这个工具：
```python
# agent.py 中所有 agent 都有
tools = [
    *HumanToolkit.get_can_use_tools(options.project_id, agent_name),  # ← 包含 send_message_to_user
    ...
]
```

**你不需要添加工具，只需要在 prompt 中要求使用！**

---

## 📝 如何在 Prompt 中添加要求

### 示例 1：Developer Agent（强制使用）

在 `backend/app/utils/agent.py` 的 developer agent system message 中添加：

**位置**: `agent.py:687-780` (system_message 变量)

**在 `<role>` 标签后添加**:

```python
system_message = f"""
<role>
You are a Lead Software Engineer...
</role>

<communication>
You MUST use the `send_message_to_user` tool to keep the user informed throughout your work:
- Before starting a major task
- After completing each significant step
- When encountering issues or making important decisions
- When creating or modifying files

Example usage:
```python
send_message_to_user(
    message_title="Starting Analysis",
    message_description="Analyzing the codebase structure to identify the bug location."
)
```

Your messages should be:
- **Title**: Short and specific (e.g., "Code Analysis Complete")
- **Description**: One clear sentence explaining what happened or what you're doing
- **Attachment**: File path if you created/modified a file
</communication>

<team_structure>
...
```

### 示例 2：Search Agent（建议使用）

**位置**: `agent.py:918-1010` (system_message 变量)

**添加到 system message 中**:

```python
system_message = f"""
<role>
You are a Senior Research Analyst...
</role>

<communication>
Use the `send_message_to_user` tool to share your progress:
- When starting a search: "Starting Search" / "Searching for information about X"
- When finding results: "Search Complete" / "Found 15 relevant results"
- When encountering issues: "Search Issue" / "Unable to access source, trying alternative"

This helps the user understand your research process.
</communication>

<capabilities>
...
```

### 示例 3：完整示例（Social Media Agent 的方式）

**参考**: `agent.py:1436-1440`

```python
You MUST use the `send_message_to_user` tool to inform the user of every
decision and action you take. Your message must include a short title and
a one-sentence description. This is a mandatory part of your workflow.
```

---

## 🎯 推荐的使用场景

### 1. 长时间运行的任务
```python
send_message_to_user(
    message_title="Task Progress",
    message_description="Completed 50 out of 100 data processing tasks."
)
```

### 2. 文件创建
```python
send_message_to_user(
    message_title="File Created",
    message_description="Generated the analysis report.",
    message_attachment="/path/to/report.pdf"
)
```

### 3. 决策点
```python
send_message_to_user(
    message_title="Approach Decided",
    message_description="Using pandas instead of raw CSV parsing for better performance."
)
```

### 4. 遇到问题
```python
send_message_to_user(
    message_title="Issue Encountered",
    message_description="API rate limit reached, waiting 60 seconds before retry."
)
```

### 5. 任务阶段
```python
send_message_to_user(
    message_title="Phase 1 Complete",
    message_description="Data collection finished, starting analysis phase."
)
```

---

## 💡 Prompt 模板

### 强制模板（适合需要频繁更新的 agent）

```
<communication_requirement>
MANDATORY: Use `send_message_to_user` for EVERY significant action:

1. **Before** starting a task
   - Title: What you're about to do
   - Description: Why you're doing it

2. **After** completing a step
   - Title: What you completed
   - Description: The result or outcome

3. **During** long operations
   - Title: Current progress
   - Description: What's happening now

Format:
- Title: 2-5 words, action-oriented
- Description: One clear sentence
- Attachment: File path if relevant

Example:
send_message_to_user(
    message_title="Starting Code Analysis",
    message_description="Analyzing the authentication module to identify security issues."
)
</communication_requirement>
```

### 建议模板（适合不需要频繁更新的 agent）

```
<communication_guideline>
Use `send_message_to_user` to keep the user informed at key moments:
- Major milestones
- File creation
- Important decisions
- Issues or blockers

This is optional but recommended for better user experience.
</communication_guideline>
```

---

## 🔧 修改步骤

### 1. 找到对应的 Agent

**Developer Agent**: `agent.py:663-795`
**Search Agent**: `agent.py:833-1010`
**Document Agent**: `agent.py:1013-1154`
**Multi-modal Agent**: `agent.py:1212-1379`
**Social Media Agent**: `agent.py:1382-1520` (已有示例)

### 2. 在 system_message 中添加要求

找到 `system_message = f"""` 这一行，在合适位置添加 communication 要求。

### 3. 重启后端

```bash
# 重启后端使修改生效
```

### 4. 测试

运行一个任务，观察：
- **后端日志**: 应该看到 "Agent Message:" 输出
- **前端**: 应该在 WorkFlow 面板看到 notice 消息

---

## 📊 预期效果

### 后端日志
```
Agent Message:
Starting Analysis
Analyzing the codebase structure to identify the bug location.

Agent Message:
Analysis Complete
Found the issue in auth.py line 145.

Agent Message:
Fix Applied
Updated the authentication logic to handle edge cases.
```

### 前端显示

在 WorkFlow 面板中，你会看到带有 "notice" 标记的卡片：

```
┌─────────────────────────────────┐
│ 📢 Starting Analysis            │
│ Analyzing the codebase...       │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ ✅ Analysis Complete            │
│ Found the issue in auth.py:145  │
└─────────────────────────────────┘
```

---

## ⚠️ 注意事项

1. **不要过度使用**：太多消息会干扰用户
2. **保持简洁**：每条消息一句话
3. **有意义的标题**：用户一眼就能看懂
4. **使用时机**：关键节点，不是每个小操作

---

## 🎯 推荐配置

| Agent | 使用程度 | 原因 |
|-------|---------|------|
| Developer Agent | 强制 | 任务复杂，用户需要了解进度 |
| Search Agent | 建议 | 搜索时间可能较长 |
| Document Agent | 建议 | 文档生成需要反馈 |
| Multi-modal Agent | 建议 | 媒体处理耗时 |
| Social Media Agent | 强制 | 已有示例，应保持 |

---

**状态**: ✅ 指南完成
**下一步**: 选择一个 agent，在其 system_message 中添加要求，重启后端测试
