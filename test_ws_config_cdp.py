#!/usr/bin/env python3
"""
Test that cloned agents' browser toolkits have correct _ws_config CDP URLs.
This is what actually gets used when connecting to the browser!
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


async def test_ws_config_cdp():
    """Test that _ws_config has correct CDP URL."""
    print("=" * 80)
    print("WS CONFIG CDP URL TEST")
    print("=" * 80)

    cdp_browsers = [
        {"port": 9223, "isExternal": False, "name": "Browser 1", "id": "test-1"},
        {"port": 9225, "isExternal": False, "name": "Browser 2", "id": "test-2"},
        {"port": 9226, "isExternal": False, "name": "Browser 3", "id": "test-3"},
    ]

    options = Chat(
        task_id="ws-config-test-001",
        project_id="ws-config-test-001",
        question="Test ws_config CDP",
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

        if not hasattr(original, '_browser_toolkit'):
            print("❌ No _browser_toolkit")
            return False

        tk_orig = original._browser_toolkit
        config_url_orig = tk_orig.config_loader.get_browser_config().cdp_url
        ws_url_orig = tk_orig._ws_config.get('cdpUrl')

        print(f"   Original Agent:")
        print(f"      Agent CDP Port: {original._cdp_port}")
        print(f"      Config CDP URL: {config_url_orig}")
        print(f"      WS Config CDP URL: {ws_url_orig}")

        print(f"\n2️⃣  Cloning agent 1...")
        clone1 = original.clone()

        if not hasattr(clone1, '_browser_toolkit'):
            print("❌ Clone 1 no _browser_toolkit")
            return False

        tk_clone1 = clone1._browser_toolkit
        config_url_clone1 = tk_clone1.config_loader.get_browser_config().cdp_url
        ws_url_clone1 = tk_clone1._ws_config.get('cdpUrl')

        print(f"   Clone 1:")
        print(f"      Agent CDP Port: {clone1._cdp_port}")
        print(f"      Config CDP URL: {config_url_clone1}")
        print(f"      WS Config CDP URL: {ws_url_clone1}")

        print(f"\n3️⃣  Cloning agent 2...")
        clone2 = original.clone()

        if not hasattr(clone2, '_browser_toolkit'):
            print("❌ Clone 2 no _browser_toolkit")
            return False

        tk_clone2 = clone2._browser_toolkit
        config_url_clone2 = tk_clone2.config_loader.get_browser_config().cdp_url
        ws_url_clone2 = tk_clone2._ws_config.get('cdpUrl')

        print(f"   Clone 2:")
        print(f"      Agent CDP Port: {clone2._cdp_port}")
        print(f"      Config CDP URL: {config_url_clone2}")
        print(f"      WS Config CDP URL: {ws_url_clone2}")

        print(f"\n📊 WS Config CDP URL Comparison:")
        print(f"   Original: {ws_url_orig}")
        print(f"   Clone 1:  {ws_url_clone1}")
        print(f"   Clone 2:  {ws_url_clone2}")

        all_ws_urls = [ws_url_orig, ws_url_clone1, ws_url_clone2]
        unique_ws_urls = set(all_ws_urls)

        if len(unique_ws_urls) != 3:
            print(f"\n❌ PROBLEM!")
            print(f"   WS Config URLs are NOT all different!")
            print(f"   Only {len(unique_ws_urls)} unique URL(s): {unique_ws_urls}")
            print(f"   This is the REAL issue - browser connections will use the same CDP!")
            return False
        else:
            print(f"\n✅ SUCCESS!")
            print(f"   All 3 toolkits have different WS Config CDP URLs")
            print(f"   Browser connections will use different CDP ports!")
            return True

    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        _cdp_pool_manager._occupied_ports.clear()


if __name__ == "__main__":
    success = asyncio.run(test_ws_config_cdp())
    sys.exit(0 if success else 1)
