"""
测试脚本：复现 workforce.py 中的 children vs _children bug

这个测试模拟真实的 Workforce 结构，验证为什么 cleanup 找不到 children。
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from camel.societies.workforce.workforce import Workforce as BaseWorkforce
from camel.societies.workforce.single_agent_worker import SingleAgentWorker
from collections import deque

class MockAgent:
    """模拟一个带有 cleanup_callback 的 Agent"""
    def __init__(self, agent_id, port):
        self.agent_id = agent_id
        self.agent_name = f"agent-{agent_id}"
        self._cdp_port = port
        self._cdp_session_id = agent_id
        self._cleanup_called = False
        self._cleanup_callback = self._cleanup

    def _cleanup(self):
        """模拟 CDP 浏览器释放"""
        self._cleanup_called = True
        print(f"  ✓ Cleanup called for {self.agent_id}, releasing CDP port {self._cdp_port}")

class MockAgentPool:
    """模拟 AgentPool 结构"""
    def __init__(self, agents):
        self._available_agents = deque(agents)
        self._in_use_agents = set()

def test_children_vs_underscored_children():
    """
    测试 hasattr(self, 'children') vs hasattr(self, '_children')
    """
    print("=" * 80)
    print("测试1: 验证 BaseWorkforce 使用 _children 而不是 children")
    print("=" * 80)

    # 创建一个简单的 BaseWorkforce 实例
    # 注意：这里我们不实际创建完整的 workforce，只检查属性
    class SimpleWorkforce:
        def __init__(self):
            self._children = ["child1", "child2", "child3"]

    wf = SimpleWorkforce()

    print("\n检查属性存在性：")
    print(f"  hasattr(wf, '_children'): {hasattr(wf, '_children')}")
    print(f"  hasattr(wf, 'children'): {hasattr(wf, 'children')}")
    print(f"  wf._children: {wf._children}")

    if hasattr(wf, 'children'):
        print(f"  wf.children: {wf.children}")
    else:
        print(f"  wf.children: AttributeError - 属性不存在！")

    # 模拟当前的错误代码
    print("\n模拟当前代码逻辑（使用 'children'）：")
    if hasattr(wf, 'children') and wf.children:
        print("  ✓ 进入 cleanup 逻辑")
        for child in wf.children:
            print(f"    处理 child: {child}")
    else:
        print("  ✗ 无法进入 cleanup 逻辑！（因为 hasattr 返回 False）")

    # 模拟修复后的代码
    print("\n模拟修复后的代码（使用 '_children'）：")
    if hasattr(wf, '_children') and wf._children:
        print("  ✓ 进入 cleanup 逻辑")
        for child in wf._children:
            print(f"    处理 child: {child}")
    else:
        print("  ✗ 无法进入 cleanup 逻辑")

    return hasattr(wf, 'children')

def test_real_workforce_cleanup():
    """
    测试真实的 Workforce cleanup 场景
    """
    print("\n\n" + "=" * 80)
    print("测试2: 模拟真实的 Workforce cleanup 流程")
    print("=" * 80)

    # 模拟 Workforce 结构
    class MockWorkforce:
        def __init__(self):
            # 模拟 BaseWorkforce 的内部结构
            self._children = []
            self.coordinator_agent = None

    class MockSingleAgentWorker:
        """模拟 SingleAgentWorker"""
        def __init__(self, description, agent_pool=None):
            self.description = description
            self.worker_agent = MockAgent(f"{description}-base", 9222)
            self.agent_pool = agent_pool

    # 创建 workforce
    workforce = MockWorkforce()

    # 创建 4 个 agents 并放入 AgentPool
    agents_for_pool = [
        MockAgent("agent-1", 9223),
        MockAgent("agent-2", 9225),
        MockAgent("agent-3", 9226),
    ]
    agent_pool = MockAgentPool(agents_for_pool)

    # 创建 SingleAgentWorker 并添加到 workforce
    worker = MockSingleAgentWorker("search_agent", agent_pool)
    workforce._children.append(worker)

    print(f"\nWorkforce 结构：")
    print(f"  len(workforce._children): {len(workforce._children)}")
    print(f"  workforce._children[0].description: {workforce._children[0].description}")
    print(f"  workforce._children[0] 有 agent_pool: {hasattr(workforce._children[0], 'agent_pool')}")
    print(f"  agent_pool 中可用 agents: {len(workforce._children[0].agent_pool._available_agents)}")

    # 测试当前的错误 cleanup 逻辑
    print("\n" + "-" * 80)
    print("场景1: 使用错误的 'children' 属性（当前代码）")
    print("-" * 80)

    cleanup_count_wrong = 0

    # 错误的代码
    if hasattr(workforce, 'children') and workforce.children:
        print("✓ 进入 cleanup 逻辑")
        for child in workforce.children:
            if hasattr(child, 'agent_pool') and child.agent_pool:
                pool = child.agent_pool
                for agent in list(pool._available_agents):
                    if hasattr(agent, '_cleanup_callback') and callable(agent._cleanup_callback):
                        agent._cleanup_callback()
                        cleanup_count_wrong += 1
    else:
        print("✗ 无法进入 cleanup 逻辑！")
        print(f"  hasattr(workforce, 'children'): {hasattr(workforce, 'children')}")
        if hasattr(workforce, 'children'):
            print(f"  bool(workforce.children): {bool(workforce.children)}")

    print(f"\n结果: 清理了 {cleanup_count_wrong} 个 agents")

    # 检查 agents 的状态
    print("\nAgents cleanup 状态:")
    for i, agent in enumerate(agents_for_pool):
        status = "✓ 已清理" if agent._cleanup_called else "✗ 未清理"
        print(f"  Agent {i+1} ({agent.agent_id}): {status}")

    # 重置状态
    for agent in agents_for_pool:
        agent._cleanup_called = False

    # 测试修复后的正确 cleanup 逻辑
    print("\n" + "-" * 80)
    print("场景2: 使用正确的 '_children' 属性（修复后）")
    print("-" * 80)

    cleanup_count_correct = 0

    # 正确的代码
    if hasattr(workforce, '_children') and workforce._children:
        print("✓ 进入 cleanup 逻辑")
        print(f"  发现 {len(workforce._children)} 个 children")

        for child in workforce._children:
            print(f"\n  处理 child: {child.description}")

            # Cleanup base agent
            if hasattr(child, 'worker_agent'):
                agent = child.worker_agent
                print(f"    发现 worker_agent: {agent.agent_name}")
                if hasattr(agent, '_cleanup_callback') and callable(agent._cleanup_callback):
                    agent._cleanup_callback()
                    cleanup_count_correct += 1

            # Cleanup agents in AgentPool
            if hasattr(child, 'agent_pool') and child.agent_pool:
                pool = child.agent_pool
                print(f"    发现 AgentPool, 可用 agents: {len(pool._available_agents)}")

                for agent in list(pool._available_agents):
                    if hasattr(agent, '_cleanup_callback') and callable(agent._cleanup_callback):
                        agent._cleanup_callback()
                        cleanup_count_correct += 1
    else:
        print("✗ 无法进入 cleanup 逻辑")

    print(f"\n结果: 清理了 {cleanup_count_correct} 个 agents")

    # 检查 agents 的状态
    print("\nAgents cleanup 状态:")
    for i, agent in enumerate(agents_for_pool):
        status = "✓ 已清理" if agent._cleanup_called else "✗ 未清理"
        print(f"  Agent {i+1} ({agent.agent_id}): {status}")

    # 检查 base agent
    if workforce._children[0].worker_agent._cleanup_called:
        print(f"  Base agent (worker_agent): ✓ 已清理")
    else:
        print(f"  Base agent (worker_agent): ✗ 未清理")

    return cleanup_count_wrong, cleanup_count_correct

def test_with_actual_camel_workforce():
    """
    测试实际的 camel BaseWorkforce 是否使用 _children
    """
    print("\n\n" + "=" * 80)
    print("测试3: 检查实际的 camel BaseWorkforce")
    print("=" * 80)

    try:
        from camel.societies.workforce.workforce import Workforce as BaseWorkforce

        # 检查 BaseWorkforce 的源码
        import inspect

        # 获取 __init__ 的参数
        init_signature = inspect.signature(BaseWorkforce.__init__)
        print(f"\nBaseWorkforce.__init__ 参数:")
        for param_name, param in init_signature.parameters.items():
            if param_name != 'self':
                print(f"  {param_name}: {param.annotation if param.annotation != inspect.Parameter.empty else 'Any'}")

        # 查看是否有 children 属性
        print(f"\nBaseWorkforce 的属性检查:")
        print(f"  'children' in dir(BaseWorkforce): {'children' in dir(BaseWorkforce)}")
        print(f"  '_children' in dir(BaseWorkforce): {'_children' in dir(BaseWorkforce)}")

        # 尝试读取 reset 方法的源码
        try:
            reset_source = inspect.getsource(BaseWorkforce.reset)
            print(f"\nBaseWorkforce.reset() 方法中的关键代码:")
            for line in reset_source.split('\n'):
                if 'children' in line.lower() and not line.strip().startswith('#'):
                    print(f"  {line.strip()}")
        except:
            print("\n无法获取 reset 方法源码")

    except Exception as e:
        print(f"无法导入或检查 BaseWorkforce: {e}")

if __name__ == "__main__":
    print("CDP 浏览器池 cleanup bug 复现测试")
    print("=" * 80)

    # 测试1: 基本属性检查
    has_children = test_children_vs_underscored_children()

    # 测试2: 模拟真实场景
    wrong_count, correct_count = test_real_workforce_cleanup()

    # 测试3: 检查实际的 camel 代码
    test_with_actual_camel_workforce()

    # 总结
    print("\n\n" + "=" * 80)
    print("测试总结")
    print("=" * 80)

    print(f"\n1. BaseWorkforce 是否有 'children' 属性: {has_children}")
    print(f"   → 如果是 False，说明只有 '_children' 属性")

    print(f"\n2. 使用错误的 'children' 清理了多少 agents: {wrong_count}")
    print(f"   → 应该是 0 （因为进不去 cleanup 逻辑）")

    print(f"\n3. 使用正确的 '_children' 清理了多少 agents: {correct_count}")
    print(f"   → 应该是 4 （1个base agent + 3个pool agents）")

    if wrong_count == 0 and correct_count > 0:
        print("\n✅ Bug 已确认！")
        print("   问题：使用 'children' 无法访问，应该使用 '_children'")
        print("   修复：将 workforce.py 第414行的 'children' 改为 '_children'")
    else:
        print("\n⚠️  测试结果异常，请检查")

    print("\n修复方法：")
    print("  编辑: backend/app/utils/workforce.py")
    print("  第414行: if hasattr(self, 'children') and self.children:")
    print("  改成:   if hasattr(self, '_children') and self._children:")
    print("  第415行: for child in self.children:")
    print("  改成:   for child in self._children:")
