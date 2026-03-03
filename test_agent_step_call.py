#!/usr/bin/env python3
"""
Test using agent.astep() which is how tools are actually called in production.
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


async def test_agent_step_call():
    """Test tool calls via agent.astep() to simulate real usage."""
    print("=" * 80)
    print("TESTING AGENT STEP CALLS (Real Production Scenario)")
    print("=" * 80)

    cdp_browsers = [
        {"port": 9223, "isExternal": False, "name": "Browser 1", "id": "test-1"},
        {"port": 9225, "isExternal": False, "name": "Browser 2", "id": "test-2"},
    ]

    options = Chat(
        task_id="agent-step-test-001",
        project_id="agent-step-test-001",
        question="Test agent step",
        email="test@example.com",
        model_platform="openai",
        model_type="gpt-4o-mini",
        api_key="sk-test",  # Dummy key for testing
        cdp_browsers=cdp_browsers,
    )

    task_lock = create_task_lock(options.project_id)

    try:
        print(f"\n1️⃣  Creating original agent...")
        original = search_agent(options)
        original_toolkit = original._browser_toolkit
        original_session = original_toolkit._session_id
        original_cdp = original_toolkit._ws_config.get('cdpUrl')

        print(f"   Original Agent: {original.agent_id}")
        print(f"   Original Toolkit Session: {original_session}")
        print(f"   Original Toolkit CDP: {original_cdp}")

        print(f"\n2️⃣  Cloning agent (simulating AgentPool behavior)...")
        clone = original.clone(with_memory=False)
        clone_toolkit = clone._browser_toolkit
        clone_session = clone_toolkit._session_id
        clone_cdp = clone_toolkit._ws_config.get('cdpUrl')

        print(f"   Clone Agent: {clone.agent_id}")
        print(f"   Clone Toolkit Session: {clone_session}")
        print(f"   Clone Toolkit CDP: {clone_cdp}")

        print(f"\n3️⃣  Calling astep() on CLONE (this is what happens in real tasks)...")
        print(f"   Expected: [TOOLKIT SESSION {clone_session}] with CDP {clone_cdp}")
        print(f"")

        # Call astep with a simple prompt that should trigger browser tool
        # We expect this to fail since we don't have a real API key, but we should see
        # the toolkit session logs if the agent tries to use browser
        try:
            response = await clone.astep("Open google.com in the browser")
            print(f"   Response: {response}")
        except Exception as e:
            print(f"   Error (expected): {type(e).__name__}")
            # Even if it errors, we should have seen toolkit session logs

        print(f"\n4️⃣  Analysis:")
        print(f"   Check logs above for [TOOLKIT SESSION] entries")
        print(f"   - If you see [TOOLKIT SESSION {clone_session}]: ✅ Clone uses cloned toolkit")
        print(f"   - If you see [TOOLKIT SESSION {original_session}]: ❌ Clone uses ORIGINAL toolkit")

        return True

    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = asyncio.run(test_agent_step_call())
    sys.exit(0 if success else 1)
