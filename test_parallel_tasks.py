#!/usr/bin/env python3
"""
Test parallel task execution to see which toolkit sessions get used.
Simulates what happens with AgentPool and parallel subtasks.
"""

import sys
import asyncio
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).parent / "backend"
sys.path.insert(0, str(backend_path))

from app.utils.agent import search_agent
from app.model.chat import Chat
from app.service.task import create_task_lock


async def worker_task(worker_id: str, agent, task_description: str):
    """Simulate a worker executing a task."""
    print(f"\n[WORKER {worker_id}] Starting task: {task_description[:50]}...")
    print(f"[WORKER {worker_id}] Agent ID: {agent.agent_id}")

    if hasattr(agent, '_browser_toolkit'):
        toolkit = agent._browser_toolkit
        print(f"[WORKER {worker_id}] Toolkit Session: {toolkit._session_id}")
        print(f"[WORKER {worker_id}] Toolkit CDP: {toolkit._ws_config.get('cdpUrl')}")

        # Simulate calling a browser tool (will fail but should show toolkit session logs)
        try:
            # Find browser tool
            browser_tool = None
            for tool in agent._internal_tools.values():
                if 'browser_open' in tool.func.__name__:
                    browser_tool = tool
                    break

            if browser_tool:
                print(f"[WORKER {worker_id}] Calling browser tool...")
                # Try to call it - will fail but should log toolkit session
                await browser_tool.func("https://www.example.com")
        except Exception as e:
            print(f"[WORKER {worker_id}] Tool error (expected): {type(e).__name__}")

    print(f"[WORKER {worker_id}] Task complete\n")


async def test_parallel_tasks():
    """Test parallel task execution with cloned agents."""
    print("=" * 80)
    print("TESTING PARALLEL TASK EXECUTION")
    print("=" * 80)

    cdp_browsers = [
        {"port": 9223, "isExternal": False, "name": "Browser 1", "id": "test-1"},
        {"port": 9225, "isExternal": False, "name": "Browser 2", "id": "test-2"},
        {"port": 9226, "isExternal": False, "name": "Browser 3", "id": "test-3"},
    ]

    options = Chat(
        task_id="parallel-test-001",
        project_id="parallel-test-001",
        question="Test parallel execution",
        email="test@example.com",
        model_platform="openai",
        model_type="gpt-4o-mini",
        api_key="test-key",
        cdp_browsers=cdp_browsers,
    )

    task_lock = create_task_lock(options.project_id)

    try:
        print(f"\n1️⃣  Creating base agent (simulating SingleAgentWorker.worker)...")
        base_agent = search_agent(options)
        base_toolkit = base_agent._browser_toolkit

        print(f"   Base Agent ID: {base_agent.agent_id}")
        print(f"   Base Toolkit Session: {base_toolkit._session_id}")
        print(f"   Base Toolkit CDP: {base_toolkit._ws_config.get('cdpUrl')}")

        print(f"\n2️⃣  Creating agent pool (simulating AgentPool initialization)...")
        pool = []
        for i in range(3):
            clone = base_agent.clone(with_memory=False)
            pool.append(clone)
            clone_toolkit = clone._browser_toolkit
            print(f"   Clone {i+1}: Agent={clone.agent_id[:8]}, Session={clone_toolkit._session_id}, CDP={clone_toolkit._ws_config.get('cdpUrl')}")

        print(f"\n3️⃣  Executing 3 parallel tasks (simulating Workforce parallel execution)...")
        tasks = [
            worker_task("Worker-1", pool[0], "Search for news article 1"),
            worker_task("Worker-2", pool[1], "Search for news article 2"),
            worker_task("Worker-3", pool[2], "Search for news article 3"),
        ]

        await asyncio.gather(*tasks)

        print(f"\n4️⃣  ANALYSIS - Check logs above:")
        print(f"   Each worker should show different toolkit sessions:")
        print(f"   - Worker-1 should use: {pool[0]._browser_toolkit._session_id}")
        print(f"   - Worker-2 should use: {pool[1]._browser_toolkit._session_id}")
        print(f"   - Worker-3 should use: {pool[2]._browser_toolkit._session_id}")
        print(f"")
        print(f"   Look for [TOOLKIT SESSION xxx] logs to verify!")

        return True

    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = asyncio.run(test_parallel_tasks())
    sys.exit(0 if success else 1)
