#!/usr/bin/env python3
"""
Test that actually calls browser tools to see which toolkit session gets used.
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


async def test_actual_browser_call():
    """Test actual browser tool calls to verify toolkit usage."""
    print("=" * 80)
    print("TESTING ACTUAL BROWSER TOOL CALLS")
    print("=" * 80)

    cdp_browsers = [
        {"port": 9223, "isExternal": False, "name": "Browser 1", "id": "test-1"},
        {"port": 9225, "isExternal": False, "name": "Browser 2", "id": "test-2"},
    ]

    options = Chat(
        task_id="browser-call-test-001",
        project_id="browser-call-test-001",
        question="Test browser calls",
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
        original_toolkit = original._browser_toolkit
        original_session = original_toolkit._session_id

        print(f"   Original Agent: {original.agent_id}")
        print(f"   Original Toolkit Session: {original_session}")
        print(f"   Original Toolkit ID: {id(original_toolkit)}")

        print(f"\n2️⃣  Cloning agent...")
        clone = original.clone(with_memory=False)
        clone_toolkit = clone._browser_toolkit
        clone_session = clone_toolkit._session_id

        print(f"   Clone Agent: {clone.agent_id}")
        print(f"   Clone Toolkit Session: {clone_session}")
        print(f"   Clone Toolkit ID: {id(clone_toolkit)}")

        # Find browser tool in clone
        clone_browser_tool = None
        for tool in clone._internal_tools.values():
            if 'browser_open' in tool.func.__name__:
                clone_browser_tool = tool
                break

        if not clone_browser_tool:
            print("❌ No browser_open tool found")
            return False

        print(f"   Clone Tool's Toolkit ID: {id(clone_browser_tool.func.__self__)}")
        print(f"   Tool binds to cloned toolkit: {id(clone_browser_tool.func.__self__) == id(clone_toolkit)}")

        print(f"\n3️⃣  Calling browser tool on CLONE agent...")
        print(f"   Expected: Should use toolkit session {clone_session} with CDP http://localhost:9225")
        print(f"   Watch for [TOOLKIT SESSION {clone_session}] logs")
        print(f"")

        # Actually call the tool - this should trigger _ensure_ws_wrapper
        try:
            # Call the browser_open tool through the func directly
            result = await clone_browser_tool.func("https://www.google.com")
            print(f"\n   ✅ Tool call succeeded")
            print(f"   Result: {result[:100] if result else 'None'}...")
        except Exception as e:
            print(f"\n   Tool call had error (expected if no browser running): {type(e).__name__}: {e}")

        print(f"\n4️⃣  Check logs above!")
        print(f"   Look for: [TOOLKIT SESSION {clone_session}] Connecting to browser via CDP at http://localhost:9225")
        print(f"   If you see [TOOLKIT SESSION {original_session}] instead, that's the bug!")

        return True

    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = asyncio.run(test_actual_browser_call())
    sys.exit(0 if success else 1)
