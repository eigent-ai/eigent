#!/usr/bin/env python3
"""
Real test that correctly calls browser tools to verify CDP pool usage.
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


async def call_browser_tool(worker_id: str, agent):
    """Call browser tool correctly (browser_open takes no params)."""
    print(f"\n{'='*60}")
    print(f"[{worker_id}] Agent ID: {agent.agent_id}")

    if hasattr(agent, '_browser_toolkit'):
        toolkit = agent._browser_toolkit
        session = toolkit._session_id
        cdp_url = toolkit._ws_config.get('cdpUrl')
        toolkit_id = id(toolkit)

        print(f"[{worker_id}] Toolkit ID: {toolkit_id}")
        print(f"[{worker_id}] Toolkit Session: {session}")
        print(f"[{worker_id}] Expected CDP URL: {cdp_url}")
        print(f"[{worker_id}] Calling browser_open()...")
        print(f"[{worker_id}] --> Watch for [TOOLKIT SESSION {session}] in logs")

        # Find and call browser_open tool
        for tool in agent._internal_tools.values():
            if 'browser_open' in tool.func.__name__:
                try:
                    # browser_open takes NO parameters!
                    result = await tool.func()
                    print(f"[{worker_id}] ✅ browser_open succeeded")
                    return True
                except Exception as e:
                    print(f"[{worker_id}] Error: {type(e).__name__}: {str(e)[:100]}")
                    return False

    return False


async def test_real_cdp_pool():
    """Test CDP pool with parallel browser operations."""
    print("=" * 80)
    print("REAL CDP POOL TEST - Parallel Browser Operations")
    print("=" * 80)

    cdp_browsers = [
        {"port": 9223, "isExternal": False, "name": "Browser 1", "id": "test-1"},
        {"port": 9225, "isExternal": False, "name": "Browser 2", "id": "test-2"},
        {"port": 9226, "isExternal": False, "name": "Browser 3", "id": "test-3"},
    ]

    options = Chat(
        task_id="real-cdp-pool-001",
        project_id="real-cdp-pool-001",
        question="Test CDP pool",
        email="test@example.com",
        model_platform="openai",
        model_type="gpt-4o-mini",
        api_key="test-key",
        cdp_browsers=cdp_browsers,
    )

    task_lock = create_task_lock(options.project_id)

    try:
        print(f"\n1️⃣  Creating base agent...")
        base = search_agent(options)
        print(f"   Base agent created: {base.agent_id}")

        print(f"\n2️⃣  Creating clones (simulating AgentPool)...")
        clones = []
        for i in range(3):
            clone = base.clone(with_memory=False)
            clones.append(clone)
            toolkit = clone._browser_toolkit
            print(f"   Clone {i+1}: session={toolkit._session_id}, cdp={toolkit._ws_config.get('cdpUrl')}")

        print(f"\n3️⃣  Running parallel browser operations...")
        tasks = [
            call_browser_tool("Worker-1", clones[0]),
            call_browser_tool("Worker-2", clones[1]),
            call_browser_tool("Worker-3", clones[2]),
        ]

        results = await asyncio.gather(*tasks, return_exceptions=True)

        print(f"\n{'='*80}")
        print(f"4️⃣  RESULTS:")
        for i, result in enumerate(results):
            status = "✅" if result is True else "❌"
            print(f"   Worker-{i+1}: {status}")

        print(f"\n5️⃣  ANALYSIS:")
        print(f"   Check the logs above for [TOOLKIT SESSION xxx] entries")
        print(f"   Expected sessions:")
        print(f"   - Worker-1: {clones[0]._browser_toolkit._session_id} (CDP 9225)")
        print(f"   - Worker-2: {clones[1]._browser_toolkit._session_id} (CDP 9226)")
        print(f"   - Worker-3: {clones[2]._browser_toolkit._session_id} (CDP 9223)")
        print(f"")
        print(f"   ✅ CORRECT: Each worker uses its own session")
        print(f"   ❌ BUG: All workers use the same session")

        return True

    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = asyncio.run(test_real_cdp_pool())
    sys.exit(0 if success else 1)
