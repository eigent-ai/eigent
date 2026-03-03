# 手动测试指南：验证CDP池修复

## 测试目的
验证你的修改是否解决了"第二次运行任务只使用一个浏览器"的问题。

## 测试准备

1. **启动4个CDP浏览器**
   - 确保在设置中配置了4个CDP浏览器（端口9223, 9225, 9226, 9227）
   - 或者在前端启动4个CDP浏览器实例

2. **清空之前的日志**
   ```bash
   rm action.log
   ```

## 测试步骤

### 测试1：正常流程（有cleanup）

1. **启动应用**
   ```bash
   npm run dev
   ```

2. **执行第一个任务**
   - 在UI中创建一个需要搜索的任务，例如：
     "Search for the latest news about AI on three different websites"
   - **观察日志**：应该看到4个不同的CDP端口被使用
     ```
     grep "Connecting to browser via CDP" action.log
     ```
   - **预期结果**：应该看到9223, 9225, 9226, 9227都被使用

3. **完成第一个任务**
   - 等待任务完成
   - 点击"End Project"按钮（或让任务自然结束）
   - **观察日志**：
     ```bash
     grep "WF-CLEANUP" action.log
     ```
   - **预期结果**：
     ```
     [WF-CLEANUP] Starting cleanup for all agents
     [WF-CLEANUP] Found AgentPool for worker
     [WF-CLEANUP] Called cleanup for pooled agent (available)
     [WF-CLEANUP] ✅ Cleanup completed, N agent(s) cleaned up
     ```
   - **关键检查**：`N agent(s) cleaned up` 的N应该 > 0（而不是之前的0）

4. **执行第二个任务**
   - 在同一个会话中（不重启应用），创建第二个搜索任务
   - **观察日志**：
     ```bash
     grep "Connecting to browser via CDP" action.log | tail -20
     ```
   - **预期结果**：应该再次看到4个不同的CDP端口被使用（9223, 9225, 9226, 9227）

5. **验证修复**
   - 如果第二次任务使用了4个不同的浏览器，说明修复成功！✅
   - 如果第二次任务只使用了9223，说明问题仍然存在❌

### 测试2：检查日志详情

检查cleanup日志的详细信息：

```bash
# 查看cleanup过程
grep -A5 "WF-CLEANUP" action.log | tail -50

# 查看CDP浏览器分配情况
grep "Acquired browser on port\|Released browser on port" action.log | tail -30

# 查看AgentPool信息
grep "AgentPool" action.log
```

### 测试3：检查占用状态

如果有问题，检查占用状态：

```bash
# 查看是否有"No available browsers"警告
grep "No available browsers" action.log

# 查看占用情况
grep "All occupied" action.log
```

## 预期的修复效果

### 修复前的日志
```
[WF-CLEANUP] Starting cleanup for all agents in workforce 12902385984
[WF-CLEANUP] ✅ Cleanup completed, 0 agent(s) cleaned up  ← 问题：清理了0个
```

### 修复后的日志
```
[WF-CLEANUP] Starting cleanup for all agents in workforce XXXXX
[WF-CLEANUP] Found AgentPool for worker: search_agent, available=3, in_use=1
[WF-CLEANUP] Called cleanup for pooled agent (available): agent-id-1
[WF-CLEANUP] Called cleanup for pooled agent (available): agent-id-2
[WF-CLEANUP] Called cleanup for pooled agent (available): agent-id-3
[WF-CLEANUP] ✅ Cleanup completed, 3 agent(s) cleaned up  ← 成功：清理了3个
```

## 成功标准

✅ **修复成功的标志：**
1. 第一次任务：使用4个不同的CDP浏览器
2. Cleanup日志：显示清理了N个agent（N > 0）
3. 第二次任务：再次使用4个不同的CDP浏览器
4. 没有"No available browsers"警告

❌ **修复失败的标志：**
1. Cleanup日志：仍然是"0 agent(s) cleaned up"
2. 第二次任务：只使用9223端口
3. 日志中有"No available browsers in pool"警告

## 问题排查

如果测试失败，检查以下内容：

1. **AgentPool不存在？**
   - 检查child.agent_pool是否存在
   - 可能使用的不是AgentPool模式

2. **agents没有cleanup_callback？**
   - 检查agent创建时是否正确设置了cleanup_callback
   - 查看agent.py中的cleanup_cdp_browser函数

3. **agents被提前返回到池中？**
   - 检查agents是否在cleanup前就被return_agent()了
   - _available_agents可能为空

## 额外验证

运行单元测试：
```bash
python test_real_cdp_pool_scenario.py
```

这个测试模拟了完整的生命周期，应该全部通过。

## 报告结果

请提供以下信息：

1. **第一次任务的CDP端口使用情况**
   ```
   任务1使用的端口：[    ]
   ```

2. **Cleanup日志**
   ```
   清理的agent数量：[    ]
   ```

3. **第二次任务的CDP端口使用情况**
   ```
   任务2使用的端口：[    ]
   ```

4. **测试结论**
   - [ ] ✅ 修复成功
   - [ ] ❌ 仍有问题
   - [ ] ⚠️ 部分修复（请说明）
