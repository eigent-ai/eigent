# Task ID 修复测试指南

## 🎯 测试目标

验证后端日志中的 Task ID 是否不再为空。

---

## 📋 测试步骤

### 1. 重启后端服务

```bash
cd /Users/puzhen/Desktop/pre/camel_project/eigent/backend
# 停止当前运行的后端
# 然后重新启动
python -m app.main  # 或者你使用的启动命令
```

### 2. 运行一个测试任务

在前端执行任何包含文件操作的任务，例如：
```
创建一个CSV文件，包含10行数据，然后读取并分析这个文件
```

### 3. 检查后端日志

```bash
tail -f /Users/puzhen/Desktop/pre/camel_project/eigent/action.log | grep "TOOLKIT"
```

---

## ✅ 预期结果

### 修复前（旧日志）
```
[TOOLKIT ACTIVATE] Toolkit: File Toolkit | Method: write to file | Task ID:  | Agent: document_agent | Timestamp: ...
                                                                            ↑ 空的
```

### 修复后（新日志）

#### 场景 A: ContextVar 工作正常 ✨ 最佳情况
```
[TOOLKIT ACTIVATE] Toolkit: File Toolkit | Method: write to file | Task ID: 1767280785344-3154.2 | Agent: document_agent | Timestamp: ...
                                                                            ↑ 完整的子任务 ID
```

#### 场景 B: ContextVar 仍然为空，使用回退方案 ✅ 预期情况
```
[toolkit_listen] ContextVar process_task is empty, using toolkit.api_task_id: 1767280785344-3154
[TOOLKIT ACTIVATE] Toolkit: File Toolkit | Method: write to file | Task ID: 1767280785344-3154 | Agent: document_agent | Timestamp: ...
                                                                            ↑ 主任务 ID（比空白好）
```

#### 场景 C: 两者都为空 ❌ 不应该出现
```
[toolkit_listen] Both ContextVar process_task and toolkit.api_task_id are empty for File Toolkit.write to file
[TOOLKIT ACTIVATE] Toolkit: File Toolkit | Method: write to file | Task ID:  | Agent: document_agent | Timestamp: ...
                                                                            ↑ 仍然为空（需要深入调查）
```

---

## 📊 验证清单

### 必须满足 ✅
- [ ] 后端日志中**不再出现完全空白的 Task ID**
- [ ] 至少有**主任务 ID**可追溯
- [ ] 日志中有**完整的时间戳**
- [ ] 前端日志中的 Task ID 仍然正常

### 可选改进 🎯
- [ ] ContextVar 正常工作，获取到**子任务 ID**
- [ ] **没有警告日志**（说明 ContextVar 工作正常）
- [ ] 前后端日志的 Task ID **完全一致**

---

## 🔍 分析日志

### 查看特定任务的所有工具调用

```bash
# 替换为实际的任务 ID
TASK_ID="1767280785344-3154"

# 查看后端日志
grep "Task ID: $TASK_ID" action.log | grep "TOOLKIT"

# 查看前端日志
grep "Task ID: $TASK_ID" /Users/puzhen/Documents/localhost-*.log | grep "FRONTEND TOOLKIT"
```

### 对比前后端 Task ID

```bash
# 提取后端的 Task ID
grep "\[TOOLKIT ACTIVATE\]" action.log | grep "File Toolkit" | sed 's/.*Task ID: \([^ ]*\) .*/\1/' | sort | uniq

# 提取前端的 Task ID
grep "\[FRONTEND TOOLKIT ACTIVATE\]" /Users/puzhen/Documents/localhost-*.log | grep "File Toolkit" | sed 's/.*Task ID: \([^ ]*\) .*/\1/' | sort | uniq
```

### 检查警告日志

```bash
# 查看是否使用了回退方案
grep "ContextVar process_task is empty" action.log

# 如果有输出，说明 ContextVar 仍然为空，使用了 api_task_id 作为回退
```

---

## 📈 成功标准

### 最低标准（必须达到）✅
1. 后端日志中有 Task ID（即使是主任务 ID）
2. 可以通过 Task ID 追溯到具体任务
3. 功能正常运行

### 理想标准（继续努力）🎯
1. 后端日志包含**子任务 ID**（与前端一致）
2. **无警告日志**（ContextVar 正常工作）
3. 完整的端到端追溯能力

---

## 🐛 如果测试失败

### 情况 1: 后端日志仍然完全为空

**可能原因**:
- toolkit 实例没有 `api_task_id` 属性
- 修改的代码未生效（未重启后端）

**排查步骤**:
```bash
# 1. 确认代码修改已保存
grep "Multi-layer fallback" backend/app/utils/listen/toolkit_listen.py

# 2. 确认后端已重启
ps aux | grep "python.*app.main"

# 3. 查看是否有错误日志
grep "ERROR" action.log | tail -20
```

### 情况 2: 有警告但仍然为空

**可能原因**:
- toolkit 实例确实没有 `api_task_id` 属性

**排查步骤**:
```bash
# 查看具体的警告信息
grep "Both ContextVar process_task and toolkit.api_task_id are empty" action.log

# 检查是哪个 toolkit
# 可能需要为特定 toolkit 添加 api_task_id 属性
```

### 情况 3: 前端日志异常

**可能原因**:
- 前端的推断逻辑受到影响
- SSE 数据传输异常

**排查步骤**:
```bash
# 检查前端是否仍能推断 Task ID
grep "FRONTEND TOOLKIT ACTIVATE" /Users/puzhen/Documents/localhost-*.log | tail -10
```

---

## 📝 测试报告模板

测试完成后，填写以下信息：

```
### 测试环境
- 测试时间: ___________
- 后端版本: ___________
- 前端版本: ___________

### 测试结果
- [ ] 后端日志有 Task ID
- [ ] Task ID 类型: [ ] 子任务ID [ ] 主任务ID [ ] 空
- [ ] 是否有警告日志: [ ] 是 [ ] 否
- [ ] 前端日志正常: [ ] 是 [ ] 否

### 日志示例
后端日志:
```
[粘贴后端日志示例]
```

前端日志:
```
[粘贴前端日志示例]
```

### 结论
- [ ] 修复成功 - Task ID 不再为空
- [ ] 部分成功 - 有主任务ID但无子任务ID
- [ ] 修复失败 - Task ID 仍然为空

### 后续行动
[记录需要进一步调查或修复的问题]
```

---

## 🎓 额外验证

### 性能测试
```bash
# 修复前后的工具执行时间对比
# 确保添加回退逻辑不会影响性能
```

### 压力测试
```bash
# 运行多个任务，确保所有工具调用都能正确记录 Task ID
```

### 边界测试
```bash
# 测试各种 toolkit 类型
# 测试同步和异步工具
# 测试嵌套任务
```

---

## 🆘 获取帮助

如果遇到问题，请提供：
1. 完整的后端日志（包含错误和警告）
2. 前端日志对应部分
3. 测试任务的具体内容
4. 预期结果 vs 实际结果

---

**测试准备完成** ✅
**可以开始测试了！**
