#!/usr/bin/env python3
"""
Test if cloned agents' browser toolkits actually use different CDP ports.

This test verifies that when browser tools are called, they connect to
the correct CDP browser port, not just checking agent attributes.
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


async def test_browser_toolkit_cdp_usage():
    """Test that browser toolkits actually connect to different CDP ports."""
    print("=" * 80)
    print("BROWSER TOOLKIT CDP PORT TEST")
    print("=" * 80)

    # Setup
    cdp_browsers = [
        {"port": 9223, "isExternal": False, "name": "Browser 1", "id": "test-1"},
        {"port": 9225, "isExternal": False, "name": "Browser 2", "id": "test-2"},
        {"port": 9226, "isExternal": False, "name": "Browser 3", "id": "test-3"},
    ]

    options = Chat(
        task_id="toolkit-test-task-001",
        project_id="toolkit-test-project-001",
        question="Test browser toolkit CDP usage",
        email="test@example.com",
        model_platform="openai",
        model_type="gpt-4o-mini",
        api_key="test-key-not-used",
        cdp_browsers=cdp_browsers,
    )

    print(f"\n📋 Test Configuration:")
    print(f"   Available CDP browsers: {len(cdp_browsers)}")
    for browser in cdp_browsers:
        print(f"   - Port {browser['port']}: {browser['name']}")

    # Initialize task lock
    task_lock = create_task_lock(options.project_id)
    print(f"\n🔧 Initialized task lock for project: {options.project_id}")

    try:
        print(f"\n1️⃣  Creating original search agent...")
        original_agent = search_agent(options)

        print(f"   ✅ Original agent: {original_agent.agent_id}")
        print(f"      Agent CDP Port: {original_agent._cdp_port}")

        # Debug: Check where toolkits are stored
        print(f"\n   🔍 Debugging toolkit storage:")
        print(f"      Has _browser_toolkit: {hasattr(original_agent, '_browser_toolkit')}")

        # Get the browser toolkit from the original agent
        if not hasattr(original_agent, '_browser_toolkit'):
            print(f"   ❌ Original agent has no _browser_toolkit attribute!")
            print(f"   ℹ️  This means toolkit reference was not saved during agent creation")
            return False

        browser_toolkit_original = original_agent._browser_toolkit

        # Check the toolkit's CDP configuration
        original_toolkit_cdp = browser_toolkit_original.config_loader.get_browser_config().cdp_url
        print(f"      Toolkit CDP URL: {original_toolkit_cdp}")

        print(f"\n2️⃣  Cloning agent 1...")
        clone1 = original_agent.clone()

        print(f"   ✅ Clone 1: {clone1.agent_id}")
        print(f"      Agent CDP Port: {clone1._cdp_port}")

        # Get the browser toolkit from clone 1
        if not hasattr(clone1, '_browser_toolkit'):
            print(f"   ❌ Clone 1 has no _browser_toolkit attribute!")
            return False

        browser_toolkit_clone1 = clone1._browser_toolkit
        clone1_toolkit_cdp = browser_toolkit_clone1.config_loader.get_browser_config().cdp_url
        print(f"      Toolkit CDP URL: {clone1_toolkit_cdp}")

        print(f"\n3️⃣  Cloning agent 2...")
        clone2 = original_agent.clone()

        print(f"   ✅ Clone 2: {clone2.agent_id}")
        print(f"      Agent CDP Port: {clone2._cdp_port}")

        # Get the browser toolkit from clone 2
        if not hasattr(clone2, '_browser_toolkit'):
            print(f"   ❌ Clone 2 has no _browser_toolkit attribute!")
            return False

        browser_toolkit_clone2 = clone2._browser_toolkit
        clone2_toolkit_cdp = browser_toolkit_clone2.config_loader.get_browser_config().cdp_url
        print(f"      Toolkit CDP URL: {clone2_toolkit_cdp}")

        # Verify the toolkits have different CDP URLs
        print(f"\n📊 CDP URL Comparison:")
        print(f"   Original: {original_toolkit_cdp}")
        print(f"   Clone 1:  {clone1_toolkit_cdp}")
        print(f"   Clone 2:  {clone2_toolkit_cdp}")

        all_urls = [original_toolkit_cdp, clone1_toolkit_cdp, clone2_toolkit_cdp]
        unique_urls = set(all_urls)

        if len(unique_urls) != 3:
            print(f"\n❌ PROBLEM FOUND!")
            print(f"   Browser toolkits are NOT using different CDP URLs!")
            print(f"   All toolkits have {len(unique_urls)} unique URL(s): {unique_urls}")
            print(f"   This means parallel tasks WILL use the same browser!")
            return False
        else:
            print(f"\n✅ SUCCESS!")
            print(f"   All 3 browser toolkits have different CDP URLs")
            print(f"   Parallel tasks will use different browsers")
            return True

    except Exception as e:
        print(f"\n❌ TEST FAILED with exception:")
        print(f"   {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        # Cleanup
        _cdp_pool_manager._occupied_ports.clear()


if __name__ == "__main__":
    print("\n" + "=" * 80)
    print("TESTING: Do cloned agents' browser toolkits use different CDP ports?")
    print("=" * 80)
    print("\nThis is the REAL test that checks if parallel tasks will actually")
    print("use different browsers, not just checking agent attributes.")
    print("\n" + "=" * 80 + "\n")

    success = asyncio.run(test_browser_toolkit_cdp_usage())

    if success:
        print("\n✅ Test passed - browser toolkits use different CDP ports!")
        sys.exit(0)
    else:
        print("\n❌ Test failed - browser toolkits use the SAME CDP port!")
        print("   This is why parallel tasks were using the same browser!")
        sys.exit(1)
