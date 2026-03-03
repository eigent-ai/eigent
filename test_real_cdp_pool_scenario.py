"""
真实场景测试：验证CDP池在实际任务流程中的表现

这个测试模拟真实的UI操作流程：
1. 启动第一个任务
2. 任务完成，调用cleanup
3. 启动第二个任务
4. 验证是否能使用多个浏览器
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from app.utils.agent import CdpBrowserPoolManager

def simulate_real_task_workflow():
    """
    模拟真实的任务工作流程
    """
    print("=" * 80)
    print("真实场景测试：模拟完整的任务生命周期")
    print("=" * 80)

    # 创建全局CDP浏览器池管理器（模拟实际的_cdp_pool_manager）
    pool_manager = CdpBrowserPoolManager()

    # 模拟4个CDP浏览器
    cdp_browsers = [
        {"id": "cdp-1", "port": 9223, "name": "Browser 1"},
        {"id": "cdp-2", "port": 9225, "name": "Browser 2"},
        {"id": "cdp-3", "port": 9226, "name": "Browser 3"},
        {"id": "cdp-4", "port": 9227, "name": "Browser 4"},
    ]

    print("\n" + "=" * 80)
    print("任务1：用户启动第一个任务")
    print("=" * 80)

    # 模拟创建4个search agents
    task1_id = "task-1765379266183"
    agents_task1 = []

    for i in range(4):
        # 模拟每个agent获取CDP浏览器
        session_id = f"{task1_id}-agent-{i+1}"
        browser = pool_manager.acquire_browser(cdp_browsers, session_id)

        if browser:
            agent_info = {
                'session_id': session_id,
                'port': browser['port'],
                'cleanup_callback': lambda port=browser['port'], sid=session_id: pool_manager.release_browser(port, sid)
            }
            agents_task1.append(agent_info)
            print(f"✓ Search Agent {i+1} 获取浏览器: port={browser['port']}, session={session_id}")
        else:
            print(f"✗ Search Agent {i+1} 无法获取浏览器")

    print(f"\n任务1正在执行...")
    print(f"当前CDP池占用: {pool_manager.get_occupied_ports()}")
    print(f"占用数量: {len(pool_manager.get_occupied_ports())}/4")

    print("\n" + "-" * 80)
    print("任务1完成：用户点击'End Project'或任务自然结束")
    print("触发 Action.end -> stop_gracefully() -> _cleanup_all_agents()")
    print("-" * 80)

    # 模拟cleanup过程
    cleanup_count = 0
    for agent in agents_task1:
        if 'cleanup_callback' in agent and callable(agent['cleanup_callback']):
            agent['cleanup_callback']()
            cleanup_count += 1
            print(f"✓ 清理agent: session={agent['session_id']}, port={agent['port']}")

    print(f"\n清理完成: {cleanup_count} 个agent被清理")
    print(f"任务1结束后CDP池占用: {pool_manager.get_occupied_ports()}")
    print(f"占用数量: {len(pool_manager.get_occupied_ports())}/4")

    if len(pool_manager.get_occupied_ports()) > 0:
        print("\n⚠️  警告：任务结束后仍有浏览器被占用！")
        return False
    else:
        print("\n✓ 成功：所有浏览器已释放")

    print("\n" + "=" * 80)
    print("任务2：用户启动第二个任务（不重启应用）")
    print("=" * 80)

    # 模拟创建4个新的search agents
    task2_id = "task-1765379478692"
    agents_task2 = []

    for i in range(4):
        session_id = f"{task2_id}-agent-{i+1}"
        browser = pool_manager.acquire_browser(cdp_browsers, session_id)

        if browser:
            agent_info = {
                'session_id': session_id,
                'port': browser['port'],
                'cleanup_callback': lambda port=browser['port'], sid=session_id: pool_manager.release_browser(port, sid)
            }
            agents_task2.append(agent_info)
            print(f"✓ Search Agent {i+1} 获取浏览器: port={browser['port']}, session={session_id}")
        else:
            print(f"✗ Search Agent {i+1} 无法获取浏览器（池已满）")

    print(f"\n任务2正在执行...")
    print(f"当前CDP池占用: {pool_manager.get_occupied_ports()}")
    print(f"占用数量: {len(pool_manager.get_occupied_ports())}/4")

    # 验证结果
    success = len(agents_task2) == 4
    if success:
        print("\n" + "=" * 80)
        print("✅ 测试通过！第二次任务成功获取了4个CDP浏览器")
        print("=" * 80)
    else:
        print("\n" + "=" * 80)
        print(f"❌ 测试失败！第二次任务只获取了 {len(agents_task2)}/4 个CDP浏览器")
        print("=" * 80)

    # 清理任务2
    print("\n清理任务2...")
    for agent in agents_task2:
        if 'cleanup_callback' in agent:
            agent['cleanup_callback']()

    print(f"最终CDP池占用: {pool_manager.get_occupied_ports()}")

    return success

def test_with_missing_cleanup():
    """
    测试修复方案：即使cleanup失败，任务开始时也应该清理遗留占用
    """
    print("\n\n" + "=" * 80)
    print("测试修复方案：任务开始时清理遗留占用")
    print("=" * 80)

    pool_manager = CdpBrowserPoolManager()
    cdp_browsers = [
        {"id": "cdp-1", "port": 9223, "name": "Browser 1"},
        {"id": "cdp-2", "port": 9225, "name": "Browser 2"},
        {"id": "cdp-3", "port": 9226, "name": "Browser 3"},
        {"id": "cdp-4", "port": 9227, "name": "Browser 4"},
    ]

    print("\n任务1：故意不调用cleanup（模拟cleanup失败）")
    task1_sessions = []
    for i in range(4):
        session_id = f"task1-agent-{i+1}"
        browser = pool_manager.acquire_browser(cdp_browsers, session_id)
        if browser:
            task1_sessions.append((browser['port'], session_id))
            print(f"✓ Agent {i+1} 获取浏览器: port={browser['port']}")

    print(f"\n任务1结束，但cleanup未调用")
    print(f"遗留占用: {pool_manager.get_occupied_ports()}")

    print("\n" + "-" * 80)
    print("任务2开始：检查是否有修复逻辑")
    print("-" * 80)

    # 检查是否实现了任务开始时的清理逻辑
    # 这需要查看实际代码中是否有类似逻辑
    print("\n如果你的修改包含了'任务开始时清理'逻辑，")
    print("那么即使任务1没有cleanup，任务2也应该能正常获取浏览器")

    # 手动测试清理所有占用（模拟修复方案1）
    print("\n模拟修复方案1：在任务开始时强制清理所有占用")
    pool_manager._occupied_ports.clear()
    print(f"清理后占用: {pool_manager.get_occupied_ports()}")

    # 现在任务2应该能获取所有浏览器
    task2_count = 0
    for i in range(4):
        session_id = f"task2-agent-{i+1}"
        browser = pool_manager.acquire_browser(cdp_browsers, session_id)
        if browser:
            task2_count += 1
            print(f"✓ Agent {i+1} 获取浏览器: port={browser['port']}")

    if task2_count == 4:
        print("\n✅ 修复方案1有效：强制清理后可以正常获取浏览器")
    else:
        print(f"\n❌ 修复方案1无效：只获取了 {task2_count}/4 个浏览器")

    # 清理
    pool_manager._occupied_ports.clear()

if __name__ == "__main__":
    print("测试1: 正常的任务生命周期（有cleanup）")
    result1 = simulate_real_task_workflow()

    print("\n\n")
    print("测试2: 异常情况（cleanup失败）")
    test_with_missing_cleanup()

    print("\n\n" + "=" * 80)
    print("测试总结")
    print("=" * 80)
    if result1:
        print("✓ 正常流程测试通过")
    else:
        print("✗ 正常流程测试失败")

    print("\n请检查你的修改是否包含：")
    print("1. 确保cleanup_callback正确调用（修复workforce的agent管理）")
    print("2. 或者在任务开始时清理遗留占用（更安全的方案）")
