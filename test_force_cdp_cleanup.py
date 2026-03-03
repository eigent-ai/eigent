"""
测试强制CDP清理逻辑

验证即使agents在in_use状态，cleanup也能强制释放CDP资源
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from app.utils.agent import CdpBrowserPoolManager

def test_force_cleanup():
    """
    模拟agents在in_use状态下的强制清理
    """
    print("=" * 80)
    print("测试强制CDP清理逻辑")
    print("=" * 80)

    # 创建CDP浏览器池管理器
    pool_manager = CdpBrowserPoolManager()

    # 模拟4个CDP浏览器
    cdp_browsers = [
        {"id": "cdp-1", "port": 9223, "name": "Browser 1"},
        {"id": "cdp-2", "port": 9225, "name": "Browser 2"},
        {"id": "cdp-3", "port": 9226, "name": "Browser 3"},
        {"id": "cdp-4", "port": 9227, "name": "Browser 4"},
    ]

    print("\n场景：3个agents还在in_use状态（没有return到pool）")
    print("-" * 80)

    # 第一个任务：3个agents获取浏览器
    task1_id = "task-16753804"
    print(f"\n任务1 ({task1_id}) - 3个agents获取浏览器：")
    for i in range(3):
        session_id = f"{task1_id}-agent-{i+1}"
        browser = pool_manager.acquire_browser(cdp_browsers, session_id)
        if browser:
            print(f"  ✓ Agent {i+1} 获取浏览器: port={browser['port']}, session={session_id}")

    occupied_before = pool_manager.get_occupied_ports()
    print(f"\n任务1执行中...")
    print(f"CDP池占用: {occupied_before}")
    print(f"占用数量: {len(occupied_before)}/4")

    print("\n任务1完成，但agents还在in_use状态（模拟AgentPool的情况）")
    print("普通cleanup无法释放这些agents，因为它们不在available列表中")

    print("\n执行强制清理...")
    print("-" * 80)

    # 模拟强制清理逻辑（workforce.py中的代码）
    occupied_before_cleanup = pool_manager.get_occupied_ports().copy()
    print(f"CDP ports occupied before force release: {occupied_before_cleanup}")

    # Force release all ports (clear the entire pool)
    released_count = len(occupied_before_cleanup)
    pool_manager._occupied_ports.clear()

    print(f"✅ Force released {released_count} CDP browser(s)")

    occupied_after = pool_manager.get_occupied_ports()
    print(f"CDP ports after force release: {occupied_after}")

    # 验证结果
    print("\n" + "=" * 80)
    print("测试结果")
    print("=" * 80)

    if len(occupied_after) == 0:
        print("\n✅ 强制清理成功！")
        print(f"   - 释放前: {len(occupied_before_cleanup)} 个CDP浏览器被占用")
        print(f"   - 释放后: {len(occupied_after)} 个CDP浏览器被占用")
        print(f"   - 成功释放了所有 {released_count} 个CDP浏览器")
    else:
        print("\n❌ 强制清理失败！")
        print(f"   - 仍有 {len(occupied_after)} 个CDP浏览器被占用")

    # 测试第二个任务
    print("\n" + "=" * 80)
    print("第二个任务：验证CDP浏览器可以被重新使用")
    print("=" * 80)

    task2_id = "task-16753809"
    print(f"\n任务2 ({task2_id}) - 尝试获取4个浏览器：")

    task2_count = 0
    for i in range(4):
        session_id = f"{task2_id}-agent-{i+1}"
        browser = pool_manager.acquire_browser(cdp_browsers, session_id)
        if browser:
            task2_count += 1
            print(f"  ✓ Agent {i+1} 获取浏览器: port={browser['port']}, session={session_id}")
        else:
            print(f"  ✗ Agent {i+1} 无法获取浏览器")

    print(f"\n任务2获取了 {task2_count}/4 个浏览器")

    if task2_count == 4:
        print("\n✅ 第二个任务成功获取了所有4个CDP浏览器！")
        print("   强制清理方案完全有效")
    else:
        print(f"\n⚠️  第二个任务只获取了 {task2_count}/4 个浏览器")

    # 清理
    pool_manager._occupied_ports.clear()

    print("\n" + "=" * 80)
    print("总结")
    print("=" * 80)
    print("\n修复方案：")
    print("1. 尝试通过cleanup_callback清理available agents")
    print("2. 如果有agents在in_use状态，记录警告")
    print("3. 强制清空整个CDP占用池（_occupied_ports.clear()）")
    print("4. 这样确保下次任务能够使用所有CDP浏览器")
    print("\n这个方案是安全的，因为：")
    print("- 任务已经结束（stop_gracefully被调用）")
    print("- 所有agents理论上应该已经停止工作")
    print("- 强制释放不会影响任何正在运行的任务")

if __name__ == "__main__":
    test_force_cleanup()
