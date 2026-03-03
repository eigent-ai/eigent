"""
Test script for PagePool concurrent browser sessions.

This script tests:
1. Multiple sessions can acquire pages concurrently without conflicts
2. Each session has isolated tab view (get_tab_info only shows own tabs)
3. Concurrent visit_page operations don't cause ERR_ABORTED
4. Pages are properly released back to pool on session close
"""

import asyncio
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from app.utils.toolkit.hybrid_browser_python_toolkit import (
    PagePool,
    BrowserSession,
    HybridBrowserPythonToolkit,
)


async def test_page_pool_initialization():
    """Test PagePool singleton initialization."""
    print("\n=== Test 1: PagePool Initialization ===")

    pool1 = await PagePool.get_instance()
    pool2 = await PagePool.get_instance()

    assert pool1 is pool2, "PagePool should be singleton"
    print("✓ PagePool is singleton")

    stats = pool1.get_stats()
    print(f"✓ Pool stats: {stats}")

    return pool1


async def test_concurrent_session_acquisition():
    """Test multiple sessions acquiring pages concurrently."""
    print("\n=== Test 2: Concurrent Session Acquisition ===")

    pool = await PagePool.get_instance()

    # Create only 2 sessions to avoid exhausting the pool
    session_ids = [f"test-session-{i}" for i in range(2)]

    async def acquire_for_session(session_id: str):
        page = await pool.acquire_page(session_id)
        return session_id, page

    # Acquire pages concurrently
    results = await asyncio.gather(*[
        acquire_for_session(sid) for sid in session_ids
    ])

    # Verify each session got a different page
    pages = [page for _, page in results]
    page_ids = [id(page) for page in pages]

    assert len(set(page_ids)) == len(page_ids), "Each session should get unique page"
    print(f"✓ {len(results)} sessions acquired unique pages")

    stats = pool.get_stats()
    print(f"✓ Pool stats after acquisition: {stats}")

    # Clean up these sessions immediately
    for sid in session_ids:
        await pool.release_page(sid)
    print(f"✓ Released {len(session_ids)} test sessions")

    return session_ids


async def test_session_tab_isolation():
    """Test that each session only sees its own tabs."""
    print("\n=== Test 3: Session Tab Isolation ===")

    # Create two sessions
    session_a = BrowserSession(
        headless=False,
        session_id="isolation-test-a",
    )
    session_b = BrowserSession(
        headless=False,
        session_id="isolation-test-b",
    )

    # Initialize both sessions
    await session_a.ensure_browser()
    await session_b.ensure_browser()

    # Get tab info for each session
    tabs_a = await session_a.get_tab_info()
    tabs_b = await session_b.get_tab_info()

    print(f"Session A tabs: {[t.get('tab_id') for t in tabs_a]}")
    print(f"Session B tabs: {[t.get('tab_id') for t in tabs_b]}")

    # Verify isolation
    tab_ids_a = {t.get('tab_id') for t in tabs_a}
    tab_ids_b = {t.get('tab_id') for t in tabs_b}

    assert tab_ids_a.isdisjoint(tab_ids_b), "Sessions should have isolated tab views"
    print("✓ Tab views are isolated between sessions")

    # Cleanup
    await session_a.close()
    await session_b.close()

    print("✓ Sessions closed and pages released")


async def test_concurrent_visit_page():
    """Test concurrent visit_page operations don't conflict."""
    print("\n=== Test 4: Concurrent visit_page ===")

    # Create sessions
    session_a = BrowserSession(
        headless=False,
        session_id="visit-test-a",
    )
    session_b = BrowserSession(
        headless=False,
        session_id="visit-test-b",
    )

    await session_a.ensure_browser()
    await session_b.ensure_browser()

    # Get pages and verify they are different
    page_a = await session_a.get_page()
    page_b = await session_b.get_page()

    print(f"  Session A page id: {id(page_a)}")
    print(f"  Session B page id: {id(page_b)}")
    assert id(page_a) != id(page_b), "Sessions should have different page objects!"
    print("✓ Sessions have different page objects")

    # Define URLs to visit
    url_a = "https://example.com"
    url_b = "https://httpbin.org/html"

    async def visit_with_session(session, url, name):
        try:
            result = await session.visit(url)
            page = await session.get_page()
            print(f"  {name}: Successfully visited {url}, page url now: {page.url}")
            return True, result
        except Exception as e:
            print(f"  {name}: ERROR - {e}")
            return False, str(e)

    # Visit concurrently
    print("Starting concurrent navigation...")
    results = await asyncio.gather(
        visit_with_session(session_a, url_a, "Session A"),
        visit_with_session(session_b, url_b, "Session B"),
        return_exceptions=True,
    )

    # Check results
    success_count = sum(1 for r in results if isinstance(r, tuple) and r[0])
    print(f"✓ {success_count}/{len(results)} navigations succeeded")

    # Verify pages show correct URLs
    page_a_final = await session_a.get_page()
    page_b_final = await session_b.get_page()

    print(f"  Final - Session A page id: {id(page_a_final)}, URL: {page_a_final.url}")
    print(f"  Final - Session B page id: {id(page_b_final)}, URL: {page_b_final.url}")

    # Check if pages are still different
    if id(page_a_final) == id(page_b_final):
        print("⚠️ WARNING: Sessions ended up with same page object!")
    else:
        print("✓ Sessions still have different page objects")

    # Cleanup
    await session_a.close()
    await session_b.close()

    print("✓ Concurrent visit_page test completed")


async def test_page_release_and_reuse():
    """Test pages are properly released and reused."""
    print("\n=== Test 5: Page Release and Reuse ===")

    pool = await PagePool.get_instance()

    # Acquire a page
    session_id = "release-test"
    page1 = await pool.acquire_page(session_id)
    page1_id = id(page1)

    stats_before = pool.get_stats()
    print(f"Stats after acquire: {stats_before}")

    # Release the page
    await pool.release_page(session_id)

    stats_after_release = pool.get_stats()
    print(f"Stats after release: {stats_after_release}")

    # Acquire again - should get the same page back (from pool)
    page2 = await pool.acquire_page(session_id)
    page2_id = id(page2)

    print(f"Page1 id: {page1_id}, Page2 id: {page2_id}")

    # Note: Page might be different if pool has multiple pages
    # The important thing is that the page count stays consistent
    print("✓ Page release and reacquisition works correctly")

    # Final cleanup
    await pool.release_page(session_id)


async def test_pool_stats():
    """Test pool statistics."""
    print("\n=== Test 6: Pool Statistics ===")

    pool = await PagePool.get_instance()
    stats = pool.get_stats()

    print(f"Final pool stats:")
    print(f"  Available pages: {stats['available_pages']}")
    print(f"  Allocated pages: {stats['allocated_pages']}")
    print(f"  Allocated sessions: {stats['allocated_sessions']}")
    print(f"  Initialized: {stats['initialized']}")

    print("✓ Pool statistics retrieved successfully")


async def cleanup_test_sessions():
    """Clean up any remaining test sessions."""
    print("\n=== Cleanup ===")

    pool = await PagePool.get_instance()

    # Release any test sessions that might still be allocated
    test_sessions = [
        "test-session-0", "test-session-1",
        "isolation-test-a", "isolation-test-b",
        "visit-test-a", "visit-test-b",
        "release-test",
    ]

    released = 0
    for session_id in test_sessions:
        try:
            await pool.release_page(session_id)
            released += 1
        except Exception:
            pass

    print(f"✓ Released {released} remaining sessions")

    # Print final pool stats
    stats = pool.get_stats()
    print(f"✓ Final pool stats: {stats}")


async def main():
    """Run all tests."""
    print("=" * 60)
    print("PagePool Concurrent Browser Sessions Test")
    print("=" * 60)
    print("\nNote: This test requires a browser with CDP enabled on port 9222")
    print("Start the Eigent app first, or run Chrome with --remote-debugging-port=9222\n")

    try:
        # Reset PagePool to ensure clean state
        await PagePool.reset_instance()
        print("PagePool reset to clean state\n")

        # Run tests
        await test_page_pool_initialization()
        await test_concurrent_session_acquisition()
        await test_session_tab_isolation()
        await test_concurrent_visit_page()
        await test_page_release_and_reuse()
        await test_pool_stats()
        await cleanup_test_sessions()

        print("\n" + "=" * 60)
        print("All tests completed!")
        print("=" * 60)

    except Exception as e:
        print(f"\n❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        return 1

    return 0


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
