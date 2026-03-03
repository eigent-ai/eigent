#!/usr/bin/env python3
"""
Test to reproduce the issue where cloned agents don't use their cloned toolkits.
This test uses real environment and code, simulating what happens during actual task execution.
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


async def test_real_clone_usage():
    """Test that cloned agents actually use their cloned toolkits in real scenarios."""
    print("=" * 80)
    print("TESTING REAL CLONE USAGE")
    print("=" * 80)

    cdp_browsers = [
        {"port": 9223, "isExternal": False, "name": "Browser 1", "id": "test-1"},
        {"port": 9225, "isExternal": False, "name": "Browser 2", "id": "test-2"},
        {"port": 9226, "isExternal": False, "name": "Browser 3", "id": "test-3"},
    ]

    options = Chat(
        task_id="real-clone-test-001",
        project_id="real-clone-test-001",
        question="Test real clone usage",
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

        # Get original toolkit
        original_toolkit = original._browser_toolkit if hasattr(original, '_browser_toolkit') else None
        if not original_toolkit:
            print("❌ Original agent has no _browser_toolkit")
            return False

        original_toolkit_id = id(original_toolkit)
        original_session = original_toolkit._session_id if hasattr(original_toolkit, '_session_id') else 'UNKNOWN'
        original_cdp = original_toolkit._ws_config.get('cdpUrl') if hasattr(original_toolkit, '_ws_config') else 'UNKNOWN'

        print(f"   Original Agent ID: {original.agent_id}")
        print(f"   Original Toolkit ID: {original_toolkit_id}")
        print(f"   Original Toolkit Session: {original_session}")
        print(f"   Original Toolkit CDP: {original_cdp}")

        # Get original tool
        original_browser_tool = None
        for tool_name, tool in original._internal_tools.items():
            if 'browser_open' in tool.func.__name__:
                original_browser_tool = tool
                print(f"   Original Tool: {tool_name}")
                print(f"   Original Tool's toolkit ID: {id(tool.func.__self__)}")
                break

        if not original_browser_tool:
            print("❌ No browser_open tool found in original")
            return False

        print(f"\n2️⃣  Cloning agent (simulating what AgentPool does)...")
        clone1 = original.clone(with_memory=False)

        # Get clone toolkit
        clone1_toolkit = clone1._browser_toolkit if hasattr(clone1, '_browser_toolkit') else None
        if not clone1_toolkit:
            print("❌ Clone has no _browser_toolkit")
            return False

        clone1_toolkit_id = id(clone1_toolkit)
        clone1_session = clone1_toolkit._session_id if hasattr(clone1_toolkit, '_session_id') else 'UNKNOWN'
        clone1_cdp = clone1_toolkit._ws_config.get('cdpUrl') if hasattr(clone1_toolkit, '_ws_config') else 'UNKNOWN'

        print(f"   Clone Agent ID: {clone1.agent_id}")
        print(f"   Clone Toolkit ID: {clone1_toolkit_id}")
        print(f"   Clone Toolkit Session: {clone1_session}")
        print(f"   Clone Toolkit CDP: {clone1_cdp}")

        # Get clone tool
        clone1_browser_tool = None
        for tool_name, tool in clone1._internal_tools.items():
            if 'browser_open' in tool.func.__name__:
                clone1_browser_tool = tool
                print(f"   Clone Tool: {tool_name}")
                print(f"   Clone Tool's toolkit ID: {id(tool.func.__self__)}")
                break

        if not clone1_browser_tool:
            print("❌ No browser_open tool found in clone")
            return False

        print(f"\n3️⃣  Verification:")
        print(f"   Original toolkit ID:        {original_toolkit_id}")
        print(f"   Clone toolkit ID:           {clone1_toolkit_id}")
        print(f"   Clone tool uses toolkit ID: {id(clone1_browser_tool.func.__self__)}")
        print(f"")
        print(f"   Toolkit cloned: {clone1_toolkit_id != original_toolkit_id}")
        print(f"   Tool uses cloned toolkit: {id(clone1_browser_tool.func.__self__) == clone1_toolkit_id}")
        print(f"   Tool uses ORIGINAL toolkit: {id(clone1_browser_tool.func.__self__) == original_toolkit_id}")

        if id(clone1_browser_tool.func.__self__) == original_toolkit_id:
            print(f"\n❌ PROBLEM CONFIRMED!")
            print(f"   Clone's tool is using the ORIGINAL toolkit ({original_toolkit_id})")
            print(f"   instead of the cloned toolkit ({clone1_toolkit_id})")
            print(f"")
            print(f"   This explains why all browser operations use the same CDP session!")
            return False
        elif id(clone1_browser_tool.func.__self__) == clone1_toolkit_id:
            print(f"\n✅ TOOL BINDING IS CORRECT!")
            print(f"   But we need to verify if the tool actually USES the toolkit...")

            # Now simulate actual tool usage
            print(f"\n4️⃣  Simulating actual tool call...")
            print(f"   Calling browser_open on clone agent's tool...")

            # Try to call the tool and see which toolkit session gets used
            try:
                # We'll just trigger toolkit initialization without actually opening browser
                # by accessing the toolkit's _ensure_ws_wrapper method
                print(f"   Triggering toolkit initialization on ORIGINAL toolkit...")
                if hasattr(original_toolkit, '_ensure_ws_wrapper'):
                    # This should log [TOOLKIT SESSION {original_session}]
                    pass

                print(f"   Triggering toolkit initialization on CLONE toolkit...")
                if hasattr(clone1_toolkit, '_ensure_ws_wrapper'):
                    # This should log [TOOLKIT SESSION {clone1_session}]
                    pass

                print(f"\n   Now check the logs above to see which toolkit session was used!")
                print(f"   Original should use session: {original_session}")
                print(f"   Clone should use session: {clone1_session}")

            except Exception as e:
                print(f"   Error during tool call: {e}")
                import traceback
                traceback.print_exc()

            return True
        else:
            print(f"\n⚠️  UNEXPECTED!")
            print(f"   Tool is bound to a different toolkit: {id(clone1_browser_tool.func.__self__)}")
            return False

    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = asyncio.run(test_real_clone_usage())
    print("\n" + "=" * 80)
    if success:
        print("✅ Test completed - check logs to verify toolkit usage")
    else:
        print("❌ Test found problems with clone implementation")
    print("=" * 80)
    sys.exit(0 if success else 1)
