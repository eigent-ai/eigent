"""
测试脚本：检查Workforce的结构和children管理

目的：找出为什么cleanup时找不到children和coordinator_agent
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

print("建议添加以下调试日志到 workforce.py 的 _cleanup_all_agents() 方法：")
print("=" * 80)
print("""
def _cleanup_all_agents(self) -> None:
    \"\"\"Call cleanup callbacks for all agents to release resources (e.g., CDP browsers).\"\"\"
    logger.info(f"[WF-CLEANUP] Starting cleanup for all agents in workforce {id(self)}")

    # 添加调试信息
    logger.info(f"[WF-CLEANUP-DEBUG] hasattr(self, 'children'): {hasattr(self, 'children')}")
    if hasattr(self, 'children'):
        logger.info(f"[WF-CLEANUP-DEBUG] self.children is None: {self.children is None}")
        logger.info(f"[WF-CLEANUP-DEBUG] self.children: {self.children}")
        if self.children:
            logger.info(f"[WF-CLEANUP-DEBUG] len(self.children): {len(self.children)}")
            for i, child in enumerate(self.children):
                logger.info(f"[WF-CLEANUP-DEBUG] child[{i}]: {child}")
                logger.info(f"[WF-CLEANUP-DEBUG] child[{i}] type: {type(child).__name__}")
                logger.info(f"[WF-CLEANUP-DEBUG] hasattr(child, 'worker_agent'): {hasattr(child, 'worker_agent')}")
                logger.info(f"[WF-CLEANUP-DEBUG] hasattr(child, 'agent_pool'): {hasattr(child, 'agent_pool')}")

    logger.info(f"[WF-CLEANUP-DEBUG] hasattr(self, 'coordinator_agent'): {hasattr(self, 'coordinator_agent')}")
    if hasattr(self, 'coordinator_agent'):
        logger.info(f"[WF-CLEANUP-DEBUG] self.coordinator_agent is None: {self.coordinator_agent is None}")
        logger.info(f"[WF-CLEANUP-DEBUG] self.coordinator_agent: {self.coordinator_agent}")

    cleanup_count = 0
    # ... rest of the cleanup logic ...
""")
print("=" * 80)

print("\n然后重新运行测试，查看日志中的 [WF-CLEANUP-DEBUG] 信息")
print("\n关键问题：")
print("1. self.children 是 None 还是空列表 []？")
print("2. self.coordinator_agent 是 None 吗？")
print("3. 如果children存在，它们有 worker_agent 或 agent_pool 属性吗？")

print("\n可能的原因：")
print("1. Workforce.reset() 或其他方法清空了 children")
print("2. children 从来没有被正确设置")
print("3. 使用了不同的workforce模式（没有children）")
print("4. coordinator_agent 没有 cleanup_callback")

print("\n\n另一个快速检查方法：")
print("在 backend/app/utils/workforce.py 中搜索所有对 self.children 的赋值操作")
print("特别关注 reset() 方法和任务完成后的清理逻辑")
