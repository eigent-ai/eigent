#!/usr/bin/env python3
"""
CDP Pool Test Script

This script tests the CDP browser pool functionality:
1. Tests that browsers are acquired from the pool correctly
2. Tests that multiple parallel tasks use different CDP ports
3. Tests that CDP browsers are released when project ends
4. Tests that the pool manager correctly tracks occupied ports

Usage:
    python test_cdp_pool.py
"""

import sys
import time
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).parent / "backend"
sys.path.insert(0, str(backend_path))

from app.utils.agent import _cdp_pool_manager


def test_acquire_and_release():
    """Test basic acquire and release functionality."""
    print("=" * 80)
    print("TEST 1: Basic Acquire and Release")
    print("=" * 80)

    # Mock CDP browsers
    cdp_browsers = [
        {"port": 9222, "isExternal": True, "name": "Browser 1"},
        {"port": 9223, "isExternal": True, "name": "Browser 2"},
        {"port": 9224, "isExternal": True, "name": "Browser 3"},
    ]

    # Test acquisition
    session1 = "session-001"
    session2 = "session-002"
    session3 = "session-003"

    print(f"\n1. Acquiring browser for {session1}...")
    browser1 = _cdp_pool_manager.acquire_browser(cdp_browsers, session1)
    assert browser1 is not None, "Failed to acquire first browser"
    assert browser1["port"] == 9222, f"Expected port 9222, got {browser1['port']}"
    print(f"   ✅ Acquired: {browser1['name']} on port {browser1['port']}")

    print(f"\n2. Acquiring browser for {session2}...")
    browser2 = _cdp_pool_manager.acquire_browser(cdp_browsers, session2)
    assert browser2 is not None, "Failed to acquire second browser"
    assert browser2["port"] == 9223, f"Expected port 9223, got {browser2['port']}"
    print(f"   ✅ Acquired: {browser2['name']} on port {browser2['port']}")

    print(f"\n3. Acquiring browser for {session3}...")
    browser3 = _cdp_pool_manager.acquire_browser(cdp_browsers, session3)
    assert browser3 is not None, "Failed to acquire third browser"
    assert browser3["port"] == 9224, f"Expected port 9224, got {browser3['port']}"
    print(f"   ✅ Acquired: {browser3['name']} on port {browser3['port']}")

    # All browsers should be occupied now
    occupied = _cdp_pool_manager.get_occupied_ports()
    print(f"\n4. Occupied ports: {occupied}")
    assert len(occupied) == 3, f"Expected 3 occupied ports, got {len(occupied)}"
    assert set(occupied) == {9222, 9223, 9224}, f"Unexpected occupied ports: {occupied}"
    print(f"   ✅ All 3 browsers occupied correctly")

    # Try to acquire when all are occupied
    print(f"\n5. Trying to acquire when pool is full...")
    session4 = "session-004"
    browser4 = _cdp_pool_manager.acquire_browser(cdp_browsers, session4)
    assert browser4 is None, "Should return None when pool is full"
    print(f"   ✅ Correctly returned None when pool is full")

    # Release browsers
    print(f"\n6. Releasing browser from {session1}...")
    _cdp_pool_manager.release_browser(9222, session1)
    occupied = _cdp_pool_manager.get_occupied_ports()
    assert 9222 not in occupied, "Port 9222 should be released"
    print(f"   ✅ Released port 9222, occupied: {occupied}")

    print(f"\n7. Releasing browser from {session2}...")
    _cdp_pool_manager.release_browser(9223, session2)
    occupied = _cdp_pool_manager.get_occupied_ports()
    assert 9223 not in occupied, "Port 9223 should be released"
    print(f"   ✅ Released port 9223, occupied: {occupied}")

    print(f"\n8. Releasing browser from {session3}...")
    _cdp_pool_manager.release_browser(9224, session3)
    occupied = _cdp_pool_manager.get_occupied_ports()
    assert len(occupied) == 0, "All ports should be released"
    print(f"   ✅ Released port 9224, occupied: {occupied}")

    print("\n✅ TEST 1 PASSED: Basic Acquire and Release\n")


def test_parallel_acquisition():
    """Test that parallel sessions get different browsers."""
    print("=" * 80)
    print("TEST 2: Parallel Session Acquisition")
    print("=" * 80)

    cdp_browsers = [
        {"port": 9222, "isExternal": True, "name": "Browser 1"},
        {"port": 9223, "isExternal": True, "name": "Browser 2"},
    ]

    # Simulate parallel task execution
    sessions = ["parallel-1", "parallel-2"]
    acquired_browsers = []

    print(f"\n1. Acquiring browsers for {len(sessions)} parallel sessions...")
    for session_id in sessions:
        browser = _cdp_pool_manager.acquire_browser(cdp_browsers, session_id)
        assert browser is not None, f"Failed to acquire browser for {session_id}"
        acquired_browsers.append(browser)
        print(f"   Session {session_id}: {browser['name']} on port {browser['port']}")

    # Check that different ports were assigned
    ports = [b["port"] for b in acquired_browsers]
    print(f"\n2. Checking that different ports were assigned...")
    assert len(set(ports)) == len(ports), f"Duplicate ports assigned: {ports}"
    print(f"   ✅ All sessions got different browsers: {ports}")

    # Cleanup
    print(f"\n3. Cleaning up...")
    for i, session_id in enumerate(sessions):
        _cdp_pool_manager.release_browser(acquired_browsers[i]["port"], session_id)
        print(f"   Released port {acquired_browsers[i]['port']} from {session_id}")

    occupied = _cdp_pool_manager.get_occupied_ports()
    assert len(occupied) == 0, "All ports should be released"
    print(f"   ✅ All ports released: {occupied}")

    print("\n✅ TEST 2 PASSED: Parallel Session Acquisition\n")


def test_release_wrong_session():
    """Test that releasing with wrong session ID doesn't work."""
    print("=" * 80)
    print("TEST 3: Release with Wrong Session ID")
    print("=" * 80)

    cdp_browsers = [
        {"port": 9222, "isExternal": True, "name": "Browser 1"},
    ]

    session1 = "correct-session"
    session2 = "wrong-session"

    print(f"\n1. Acquiring browser for {session1}...")
    browser = _cdp_pool_manager.acquire_browser(cdp_browsers, session1)
    assert browser is not None, "Failed to acquire browser"
    print(f"   ✅ Acquired: {browser['name']} on port {browser['port']}")

    occupied = _cdp_pool_manager.get_occupied_ports()
    assert 9222 in occupied, "Port 9222 should be occupied"
    print(f"   Occupied ports: {occupied}")

    print(f"\n2. Trying to release with wrong session ID ({session2})...")
    _cdp_pool_manager.release_browser(9222, session2)
    occupied = _cdp_pool_manager.get_occupied_ports()
    assert 9222 in occupied, "Port should still be occupied after wrong session release"
    print(f"   ✅ Port still occupied (correct behavior): {occupied}")

    print(f"\n3. Releasing with correct session ID ({session1})...")
    _cdp_pool_manager.release_browser(9222, session1)
    occupied = _cdp_pool_manager.get_occupied_ports()
    assert 9222 not in occupied, "Port should be released"
    print(f"   ✅ Port released correctly: {occupied}")

    print("\n✅ TEST 3 PASSED: Release with Wrong Session ID\n")


def test_pool_exhaustion_and_recovery():
    """Test behavior when pool is exhausted and then recovered."""
    print("=" * 80)
    print("TEST 4: Pool Exhaustion and Recovery")
    print("=" * 80)

    cdp_browsers = [
        {"port": 9222, "isExternal": True, "name": "Browser 1"},
        {"port": 9223, "isExternal": True, "name": "Browser 2"},
    ]

    print(f"\n1. Exhausting the pool (2 browsers)...")
    sessions = ["exhaust-1", "exhaust-2"]
    browsers = []
    for session_id in sessions:
        browser = _cdp_pool_manager.acquire_browser(cdp_browsers, session_id)
        browsers.append(browser)
        print(f"   Acquired {browser['name']} for {session_id}")

    occupied = _cdp_pool_manager.get_occupied_ports()
    print(f"   Occupied ports: {occupied}")
    assert len(occupied) == 2, "Pool should be fully occupied"

    print(f"\n2. Trying to acquire when pool is exhausted...")
    browser_fail = _cdp_pool_manager.acquire_browser(cdp_browsers, "exhaust-3")
    assert browser_fail is None, "Should return None when pool is exhausted"
    print(f"   ✅ Correctly returned None")

    print(f"\n3. Releasing one browser ({sessions[0]})...")
    _cdp_pool_manager.release_browser(browsers[0]["port"], sessions[0])
    occupied = _cdp_pool_manager.get_occupied_ports()
    print(f"   Occupied ports after release: {occupied}")
    assert len(occupied) == 1, "One port should be released"

    print(f"\n4. Acquiring should now work again...")
    browser_new = _cdp_pool_manager.acquire_browser(cdp_browsers, "exhaust-3")
    assert browser_new is not None, "Should successfully acquire after release"
    print(f"   ✅ Acquired {browser_new['name']} on port {browser_new['port']}")

    # Cleanup
    print(f"\n5. Cleaning up...")
    _cdp_pool_manager.release_browser(browsers[1]["port"], sessions[1])
    _cdp_pool_manager.release_browser(browser_new["port"], "exhaust-3")
    occupied = _cdp_pool_manager.get_occupied_ports()
    assert len(occupied) == 0, "All ports should be released"
    print(f"   ✅ All ports released: {occupied}")

    print("\n✅ TEST 4 PASSED: Pool Exhaustion and Recovery\n")


def run_all_tests():
    """Run all CDP pool tests."""
    print("\n" + "=" * 80)
    print("CDP POOL TEST SUITE")
    print("=" * 80 + "\n")

    tests = [
        test_acquire_and_release,
        test_parallel_acquisition,
        test_release_wrong_session,
        test_pool_exhaustion_and_recovery,
    ]

    passed = 0
    failed = 0

    for test_func in tests:
        try:
            test_func()
            passed += 1
        except AssertionError as e:
            print(f"\n❌ TEST FAILED: {test_func.__name__}")
            print(f"   Error: {e}\n")
            failed += 1
        except Exception as e:
            print(f"\n❌ TEST ERROR: {test_func.__name__}")
            print(f"   Unexpected error: {e}\n")
            import traceback
            traceback.print_exc()
            failed += 1

    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"Total tests: {len(tests)}")
    print(f"Passed: {passed} ✅")
    print(f"Failed: {failed} {'❌' if failed > 0 else ''}")
    print("=" * 80 + "\n")

    return failed == 0


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
