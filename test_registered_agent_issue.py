#!/usr/bin/env python3
"""
Test to check if the _agent property on toolkit is causing the issue.
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


async def test_registered_agent_issue():
    """Test if toolkit._agent is causing clone issues."""
    print("=" * 80)
    print("TESTING REGISTERED AGENT TOOLKIT ISSUE")
    print("=" * 80)

    cdp_browsers = [
        {"port": 9223, "isExternal": False, "name": "Browser 1", "id": "test-1"},
        {"port": 9225, "isExternal": False, "name": "Browser 2", "id": "test-2"},
    ]

    options = Chat(
        task_id="registered-agent-test-001",
        project_id="registered-agent-test-001",
        question="Test registered agent",
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

        print(f"   Original Agent ID: {original.agent_id}")
        print(f"   Original Toolkit ID: {id(original_toolkit)}")
        print(f"   Original Toolkit Session: {original_toolkit._session_id}")

        # Check if toolkit has _agent property
        if hasattr(original_toolkit, '_agent'):
            original_toolkit_agent = original_toolkit._agent
            print(f"   Original Toolkit._agent: {original_toolkit_agent.agent_id if original_toolkit_agent else 'None'}")
        else:
            print(f"   Original Toolkit has no _agent property")

        print(f"\n2️⃣  Cloning agent...")
        clone = original.clone(with_memory=False)
        clone_toolkit = clone._browser_toolkit

        print(f"   Clone Agent ID: {clone.agent_id}")
        print(f"   Clone Toolkit ID: {id(clone_toolkit)}")
        print(f"   Clone Toolkit Session: {clone_toolkit._session_id}")

        # Check if cloned toolkit has _agent property
        if hasattr(clone_toolkit, '_agent'):
            clone_toolkit_agent = clone_toolkit._agent
            print(f"   Clone Toolkit._agent: {clone_toolkit_agent.agent_id if clone_toolkit_agent else 'None'}")

            print(f"\n3️⃣  Analysis:")
            print(f"   Clone toolkit is new instance: {id(clone_toolkit) != id(original_toolkit)}")

            if clone_toolkit_agent is None:
                print(f"   Clone toolkit._agent is None: ✅ (will be registered later)")
            elif clone_toolkit_agent.agent_id == clone.agent_id:
                print(f"   Clone toolkit._agent points to CLONE agent: ✅ CORRECT")
            elif clone_toolkit_agent.agent_id == original.agent_id:
                print(f"   Clone toolkit._agent points to ORIGINAL agent: ❌ PROBLEM!")
                print(f"")
                print(f"   This could cause clone to use original agent's resources!")
                return False
            else:
                print(f"   Clone toolkit._agent points to DIFFERENT agent: ⚠️  UNEXPECTED")

        else:
            print(f"   Clone Toolkit has no _agent property")

        return True

    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = asyncio.run(test_registered_agent_issue())
    sys.exit(0 if success else 1)
