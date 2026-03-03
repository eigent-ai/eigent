#!/usr/bin/env python3
"""
Test to verify that cloned tools are bound to cloned toolkits.
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


async def test_tool_binding():
    """Test that cloned agent's tools are bound to cloned toolkit."""
    print("=" * 80)
    print("TESTING TOOL BINDING")
    print("=" * 80)

    cdp_browsers = [
        {"port": 9223, "isExternal": False, "name": "Browser 1", "id": "test-1"},
        {"port": 9225, "isExternal": False, "name": "Browser 2", "id": "test-2"},
    ]

    options = Chat(
        task_id="binding-test-001",
        project_id="binding-test-001",
        question="Test tool binding",
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

        # Find browser tool
        browser_open_tool = None
        for tool in original._internal_tools.values():
            if 'browser_open' in tool.func.__name__:
                browser_open_tool = tool
                break

        if not browser_open_tool:
            print("❌ No browser_open tool found")
            return False

        original_toolkit = browser_open_tool.func.__self__
        original_session = original_toolkit._session_id if hasattr(original_toolkit, '_session_id') else 'UNKNOWN'

        print(f"   Original agent:")
        print(f"      Agent ID: {original.agent_id}")
        print(f"      Browser tool bound to toolkit session: {original_session}")
        print(f"      Toolkit instance ID: {id(original_toolkit)}")

        print(f"\n2️⃣  Cloning agent...")
        clone = original.clone()

        # Find browser tool in clone
        clone_browser_open_tool = None
        for tool in clone._internal_tools.values():
            if 'browser_open' in tool.func.__name__:
                clone_browser_open_tool = tool
                break

        if not clone_browser_open_tool:
            print("❌ Clone has no browser_open tool")
            return False

        clone_toolkit = clone_browser_open_tool.func.__self__
        clone_session = clone_toolkit._session_id if hasattr(clone_toolkit, '_session_id') else 'UNKNOWN'

        print(f"   Clone agent:")
        print(f"      Agent ID: {clone.agent_id}")
        print(f"      Browser tool bound to toolkit session: {clone_session}")
        print(f"      Toolkit instance ID: {id(clone_toolkit)}")

        print(f"\n📊 Comparison:")
        print(f"   Original toolkit session: {original_session}")
        print(f"   Clone toolkit session:    {clone_session}")
        print(f"   Toolkit instances same:   {id(original_toolkit) == id(clone_toolkit)}")

        if id(original_toolkit) == id(clone_toolkit):
            print(f"\n❌ PROBLEM FOUND!")
            print(f"   Clone's browser tool is STILL bound to the original toolkit!")
            print(f"   This is why all clones use the same CDP session!")
            return False
        elif original_session == clone_session:
            print(f"\n❌ PROBLEM FOUND!")
            print(f"   Clone's toolkit has the SAME session as original!")
            return False
        else:
            print(f"\n✅ SUCCESS!")
            print(f"   Clone's browser tool is bound to a NEW toolkit instance")
            print(f"   with a different session ID")
            return True

    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = asyncio.run(test_tool_binding())
    sys.exit(0 if success else 1)
