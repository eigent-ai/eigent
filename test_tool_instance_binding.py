#!/usr/bin/env python3
"""
Test to verify which toolkit instance the cloned agent's tools are actually bound to.
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


async def test_tool_instance_binding():
    """Test which toolkit instance cloned agent tools are bound to."""
    print("=" * 80)
    print("TESTING TOOL INSTANCE BINDING")
    print("=" * 80)

    cdp_browsers = [
        {"port": 9223, "isExternal": False, "name": "Browser 1", "id": "test-1"},
        {"port": 9225, "isExternal": False, "name": "Browser 2", "id": "test-2"},
    ]

    options = Chat(
        task_id="binding-test-002",
        project_id="binding-test-002",
        question="Test tool instance binding",
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

        # Get the original toolkit instance
        original_toolkit = original._browser_toolkit if hasattr(original, '_browser_toolkit') else None
        if not original_toolkit:
            print("❌ Original agent has no _browser_toolkit")
            return False

        original_session = original_toolkit._session_id if hasattr(original_toolkit, '_session_id') else 'UNKNOWN'
        original_cdp = original_toolkit._ws_config.get('cdpUrl') if hasattr(original_toolkit, '_ws_config') else 'UNKNOWN'

        print(f"   Original agent: {original.agent_id}")
        print(f"   Original toolkit session: {original_session}")
        print(f"   Original toolkit CDP: {original_cdp}")
        print(f"   Original toolkit instance ID: {id(original_toolkit)}")

        # Find browser tool in original
        original_browser_tool = None
        for tool in original._internal_tools.values():
            if 'browser_open' in tool.func.__name__:
                original_browser_tool = tool
                break

        if not original_browser_tool:
            print("❌ No browser_open tool found in original")
            return False

        original_tool_toolkit = original_browser_tool.func.__self__
        print(f"   Original tool bound to toolkit ID: {id(original_tool_toolkit)}")
        print(f"   Tool binding matches toolkit: {id(original_tool_toolkit) == id(original_toolkit)}")

        print(f"\n2️⃣  Cloning agent...")
        clone = original.clone()

        # Get the cloned toolkit instance
        clone_toolkit = clone._browser_toolkit if hasattr(clone, '_browser_toolkit') else None
        if not clone_toolkit:
            print("❌ Clone has no _browser_toolkit")
            return False

        clone_session = clone_toolkit._session_id if hasattr(clone_toolkit, '_session_id') else 'UNKNOWN'
        clone_cdp = clone_toolkit._ws_config.get('cdpUrl') if hasattr(clone_toolkit, '_ws_config') else 'UNKNOWN'

        print(f"   Clone agent: {clone.agent_id}")
        print(f"   Clone toolkit session: {clone_session}")
        print(f"   Clone toolkit CDP: {clone_cdp}")
        print(f"   Clone toolkit instance ID: {id(clone_toolkit)}")

        # Find browser tool in clone
        clone_browser_tool = None
        for tool in clone._internal_tools.values():
            if 'browser_open' in tool.func.__name__:
                clone_browser_tool = tool
                break

        if not clone_browser_tool:
            print("❌ No browser_open tool found in clone")
            return False

        clone_tool_toolkit = clone_browser_tool.func.__self__
        print(f"   Clone tool bound to toolkit ID: {id(clone_tool_toolkit)}")
        print(f"   Tool binding matches clone toolkit: {id(clone_tool_toolkit) == id(clone_toolkit)}")
        print(f"   Tool binding matches ORIGINAL toolkit: {id(clone_tool_toolkit) == id(original_toolkit)}")

        print(f"\n📊 Analysis:")
        print(f"   Original toolkit ID: {id(original_toolkit)}")
        print(f"   Clone toolkit ID:    {id(clone_toolkit)}")
        print(f"   Clone tool uses:     {id(clone_tool_toolkit)}")
        print(f"")
        print(f"   Original toolkit session: {original_session}")
        print(f"   Clone toolkit session:    {clone_session}")
        print(f"   Clone tool toolkit session: {clone_tool_toolkit._session_id if hasattr(clone_tool_toolkit, '_session_id') else 'UNKNOWN'}")

        if id(clone_tool_toolkit) == id(original_toolkit):
            print(f"\n❌ CRITICAL PROBLEM FOUND!")
            print(f"   Clone's browser tool is STILL BOUND to the ORIGINAL toolkit instance!")
            print(f"   This is why all clones use the same CDP session!")
            print(f"   The clone._browser_toolkit exists but the tools aren't using it!")
            return False
        elif id(clone_tool_toolkit) == id(clone_toolkit):
            print(f"\n✅ SUCCESS!")
            print(f"   Clone's browser tool is correctly bound to the NEW cloned toolkit")
            return True
        else:
            print(f"\n⚠️  UNEXPECTED SITUATION!")
            print(f"   Clone's tool is bound to a DIFFERENT toolkit than both original and clone._browser_toolkit")
            return False

    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = asyncio.run(test_tool_instance_binding())
    sys.exit(0 if success else 1)
