#!/usr/bin/env python3
"""
Simple Clone CDP Test

Tests clone functionality directly without full agent initialization.
"""

import sys
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).parent / "backend"
sys.path.insert(0, str(backend_path))

from app.utils.agent import _cdp_pool_manager


def test_clone_simulation():
    """Simulate what happens when agents are cloned."""
    print("=" * 80)
    print("TEST: Simulating Agent Clone CDP Acquisition")
    print("=" * 80)

    cdp_browsers = [
        {"port": 9222, "isExternal": True, "name": "Browser 1"},
        {"port": 9223, "isExternal": True, "name": "Browser 2"},
        {"port": 9224, "isExternal": True, "name": "Browser 3"},
    ]

    print(f"\n1. Simulating original agent creation...")
    original_session = "original-agent"
    original_browser = _cdp_pool_manager.acquire_browser(cdp_browsers, original_session)
    assert original_browser is not None
    original_port = original_browser['port']
    print(f"   ✅ Original agent acquired: port={original_port}, session={original_session}")

    occupied = _cdp_pool_manager.get_occupied_ports()
    print(f"   Occupied: {occupied}")
    assert len(occupied) == 1

    print(f"\n2. Simulating first clone...")
    clone1_session = "clone-1-agent"
    clone1_browser = _cdp_pool_manager.acquire_browser(cdp_browsers, clone1_session)
    assert clone1_browser is not None
    clone1_port = clone1_browser['port']
    print(f"   ✅ Clone 1 acquired: port={clone1_port}, session={clone1_session}")
    assert clone1_port != original_port, f"Clone should get different port!"

    occupied = _cdp_pool_manager.get_occupied_ports()
    print(f"   Occupied: {occupied}")
    assert len(occupied) == 2

    print(f"\n3. Simulating second clone...")
    clone2_session = "clone-2-agent"
    clone2_browser = _cdp_pool_manager.acquire_browser(cdp_browsers, clone2_session)
    assert clone2_browser is not None
    clone2_port = clone2_browser['port']
    print(f"   ✅ Clone 2 acquired: port={clone2_port}, session={clone2_session}")
    assert clone2_port != original_port and clone2_port != clone1_port

    occupied = _cdp_pool_manager.get_occupied_ports()
    print(f"   Occupied: {occupied}")
    assert len(occupied) == 3
    assert set(occupied) == {9222, 9223, 9224}

    print(f"\n4. Simulating cleanup of clone 1...")
    _cdp_pool_manager.release_browser(clone1_port, clone1_session)
    occupied = _cdp_pool_manager.get_occupied_ports()
    print(f"   ✅ Clone 1 released")
    print(f"   Occupied: {occupied}")
    assert clone1_port not in occupied
    assert len(occupied) == 2

    print(f"\n5. Simulating fourth clone (reusing released port)...")
    clone3_session = "clone-3-agent"
    clone3_browser = _cdp_pool_manager.acquire_browser(cdp_browsers, clone3_session)
    assert clone3_browser is not None
    clone3_port = clone3_browser['port']
    print(f"   ✅ Clone 3 acquired: port={clone3_port}, session={clone3_session}")
    print(f"   Note: Clone 3 got port {clone3_port} (released from clone 1)")
    assert clone3_port == clone1_port, "Should reuse the released port"

    occupied = _cdp_pool_manager.get_occupied_ports()
    print(f"   Occupied: {occupied}")
    assert len(occupied) == 3

    print(f"\n6. Cleanup all...")
    _cdp_pool_manager.release_browser(original_port, original_session)
    _cdp_pool_manager.release_browser(clone2_port, clone2_session)
    _cdp_pool_manager.release_browser(clone3_port, clone3_session)

    occupied = _cdp_pool_manager.get_occupied_ports()
    print(f"   ✅ All released")
    print(f"   Occupied: {occupied}")
    assert len(occupied) == 0

    print("\n✅ TEST PASSED: Clone CDP Acquisition Simulation\n")


if __name__ == "__main__":
    try:
        test_clone_simulation()
        print("=" * 80)
        print("All tests passed! ✅")
        print("=" * 80)
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
