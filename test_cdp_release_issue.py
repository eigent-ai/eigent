"""
测试脚本：复现CDP浏览器池在第二次运行时只使用一个浏览器的问题

这个脚本模拟真实的任务执行流程：
1. 第一次运行任务 -> 使用多个CDP浏览器（正常）
2. 任务完成，触发end action
3. 第二次运行任务 -> 只使用一个CDP浏览器（问题）

关键发现：
- cleanup_callback只在stop_gracefully()时被调用
- stop_gracefully()在两种情况下被调用：
  1. Action.end时 (任务正常完成)
  2. Action.stop时 (用户点击stop按钮)
- 但是，如果用户没有点击"End Project"按钮，而是直接开始第二次任务，
  cleanup_callback不会被调用，CDP浏览器不会被释放
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from app.utils.agent import CdpBrowserPoolManager

def test_cdp_pool_release_issue():
    """
    测试场景：模拟真实的任务执行流程
    """
    print("=" * 80)
    print("测试CDP浏览器池释放问题")
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

    print("\n" + "=" * 80)
    print("第一次任务运行 - 模拟4个agent并行工作")
    print("=" * 80)

    # 第一次任务：4个agent获取浏览器
    task1_sessions = []
    task1_ports = []
    for i in range(4):
        session_id = f"task1-agent-{i+1}"
        browser = pool_manager.acquire_browser(cdp_browsers, session_id)
        if browser:
            task1_sessions.append(session_id)
            task1_ports.append(browser['port'])
            print(f"✓ Agent {i+1} 获取浏览器: port={browser['port']}, session={session_id}")
        else:
            print(f"✗ Agent {i+1} 无法获取浏览器（池已满）")

    print(f"\n当前占用的端口: {pool_manager.get_occupied_ports()}")
    print(f"占用的端口数量: {len(pool_manager.get_occupied_ports())}")

    print("\n" + "-" * 80)
    print("第一次任务完成 - 触发Action.end")
    print("此时应该调用stop_gracefully() -> cleanup_callback -> release_browser")
    print("-" * 80)

    # 模拟cleanup：释放所有浏览器
    for i, (session_id, port) in enumerate(zip(task1_sessions, task1_ports)):
        pool_manager.release_browser(port, session_id)
        print(f"✓ 释放浏览器: port={port}, session={session_id}")

    print(f"\n任务1结束后占用的端口: {pool_manager.get_occupied_ports()}")
    print(f"占用的端口数量: {len(pool_manager.get_occupied_ports())}")

    print("\n" + "=" * 80)
    print("正常场景：所有浏览器已释放，第二次任务可以正常使用多个浏览器")
    print("=" * 80)

    # 第二次任务：应该能获取4个浏览器
    task2_sessions = []
    task2_ports = []
    for i in range(4):
        session_id = f"task2-agent-{i+1}"
        browser = pool_manager.acquire_browser(cdp_browsers, session_id)
        if browser:
            task2_sessions.append(session_id)
            task2_ports.append(browser['port'])
            print(f"✓ Agent {i+1} 获取浏览器: port={browser['port']}, session={session_id}")
        else:
            print(f"✗ Agent {i+1} 无法获取浏览器（池已满）")

    print(f"\n当前占用的端口: {pool_manager.get_occupied_ports()}")
    print(f"占用的端口数量: {len(pool_manager.get_occupied_ports())}")

    # 清理
    for session_id, port in zip(task2_sessions, task2_ports):
        pool_manager.release_browser(port, session_id)

    print("\n" + "=" * 80)
    print("异常场景：模拟没有调用cleanup_callback的情况")
    print("这可能发生在：任务完成但用户没点'End Project'，直接开始新任务")
    print("=" * 80)

    # 第一次任务（异常场景）：4个agent获取浏览器
    task3_sessions = []
    task3_ports = []
    for i in range(4):
        session_id = f"task3-agent-{i+1}"
        browser = pool_manager.acquire_browser(cdp_browsers, session_id)
        if browser:
            task3_sessions.append(session_id)
            task3_ports.append(browser['port'])
            print(f"✓ Agent {i+1} 获取浏览器: port={browser['port']}, session={session_id}")

    print(f"\n第一次任务后占用的端口: {pool_manager.get_occupied_ports()}")

    print("\n⚠️  任务完成，但是 cleanup_callback 没有被调用！")
    print("   （用户可能没有点击'End Project'按钮，或者cleanup逻辑有问题）")
    print("   浏览器没有被释放，池中的浏览器仍然被占用")

    print("\n现在启动第二次任务...")

    # 第二次任务（异常场景）：尝试获取浏览器
    task4_sessions = []
    task4_ports = []
    print(f"\n当前占用情况（任务2开始前）: {pool_manager.get_occupied_ports()}")

    for i in range(4):
        session_id = f"task4-agent-{i+1}"
        browser = pool_manager.acquire_browser(cdp_browsers, session_id)
        if browser:
            task4_sessions.append(session_id)
            task4_ports.append(browser['port'])
            print(f"✓ Agent {i+1} 获取浏览器: port={browser['port']}, session={session_id}")
        else:
            print(f"✗ Agent {i+1} 无法获取浏览器（所有浏览器都被占用！）")

    print(f"\n⚠️  问题复现！第二次任务只能获取 {len(task4_ports)} 个浏览器（期望4个）")
    print(f"   当前占用的端口: {pool_manager.get_occupied_ports()}")
    print(f"   这导致所有agent只能使用同一个浏览器（如果有fallback逻辑）")

    # 清理
    for session_id, port in zip(task3_sessions, task3_ports):
        pool_manager.release_browser(port, session_id)
    for session_id, port in zip(task4_sessions, task4_ports):
        pool_manager.release_browser(port, session_id)

    print("\n" + "=" * 80)
    print("测试总结")
    print("=" * 80)
    print("✓ 问题根因：cleanup_callback只在stop_gracefully()中调用")
    print("✓ stop_gracefully()在Action.end和Action.stop时调用")
    print("✗ 如果任务完成后没有触发这两个action，浏览器不会被释放")
    print("✗ 第二次任务启动时，所有浏览器仍被占用，导致只能使用一个浏览器")
    print("\n建议修复方案：")
    print("1. 在每次任务开始前，清理之前任务遗留的占用状态")
    print("2. 或者在任务结束时确保cleanup_callback总是被调用")
    print("3. 或者添加超时机制，自动释放长时间未使用的浏览器")

if __name__ == "__main__":
    test_cdp_pool_release_issue()
