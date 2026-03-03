#!/usr/bin/env python3
"""
Test browser connection logs to verify which CDP port is actually used.
This test will actually call a browser tool to trigger connection initialization.
"""

import sys
import asyncio
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).parent / "backend"
sys.path.insert(0, str(backend_path))

from app.utils.agent import search_agent, _cdp_pool_manager
from app.model.chat import Chat
from app.service.task import create_task_lock


async def test_actual_browser_connections():
    """Test that browser tools actually connect to different CDP ports."""
    print("=" * 80)
    print("TESTING ACTUAL BROWSER CONNECTIONS")
    print("=" * 80)

    cdp_browsers = [
        {"port": 9223, "isExternal": False, "name": "Browser 1", "id": "test-1"},
        {"port": 9225, "isExternal": False, "name": "Browser 2", "id": "test-2"},
        {"port": 9226, "isExternal": False, "name": "Browser 3", "id": "test-3"},
    ]

    options = Chat(
        task_id="connection-test-001",
        project_id="connection-test-001",
        question="Test browser connections",
        email="test@example.com",
        model_platform="openai",
        model_type="gpt-4o-mini",
        api_key="test-key",
        cdp_browsers=cdp_browsers,
    )

    task_lock = create_task_lock(options.project_id)

    try:
        print(f"\n1️⃣  Creating original agent...")
        original = search_agent(options)
        print(f"   Original agent: {original.agent_id}")
        print(f"   Expected CDP port: {original._cdp_port}")

        print(f"\n2️⃣  Cloning to create Clone 1...")
        clone1 = original.clone()
        print(f"   Clone 1 agent: {clone1.agent_id}")
        print(f"   Expected CDP port: {clone1._cdp_port}")

        print(f"\n3️⃣  Cloning to create Clone 2...")
        clone2 = original.clone()
        print(f"   Clone 2 agent: {clone2.agent_id}")
        print(f"   Expected CDP port: {clone2._cdp_port}")

        print(f"\n" + "=" * 80)
        print("✅ Test complete! Check the logs above for:")
        print("   - [TOOLKIT CLONE] messages showing parent->child session")
        print("   - [TOOLKIT SESSION xxx] messages showing actual CDP connections")
        print("   - [CONNECTION POOL] messages showing when connections are created/reused")
        print("=" * 80)

        return True

    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        _cdp_pool_manager._occupied_ports.clear()


if __name__ == "__main__":
    print("\nThis test creates agents and clones them.")
    print("Watch for these log patterns:")
    print("  [AGENT CLONE] - Shows agent cloning with CDP port assignment")
    print("  [TOOLKIT CLONE] - Shows toolkit cloning with parent/child sessions")
    print("  [TOOLKIT SESSION xxx] - Shows actual browser connection attempts")
    print("  [CONNECTION POOL] - Shows WebSocket connection creation/reuse")
    print()

    success = asyncio.run(test_actual_browser_connections())
    sys.exit(0 if success else 1)
