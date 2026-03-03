#!/usr/bin/env python3
"""
Clone CDP Test Script

This script tests that cloned agents acquire different CDP browsers from the pool.

Usage:
    python test_clone_cdp.py
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add backend to path
backend_path = Path(__file__).parent / "backend"
sys.path.insert(0, str(backend_path))

from app.utils.agent import _cdp_pool_manager, search_agent
from app.model.chat import Chat


def test_clone_acquires_different_cdp():
    """Test that cloning an agent acquires a different CDP browser."""
    print("=" * 80)
    print("TEST: Clone Acquires Different CDP Browser")
    print("=" * 80)

    # Mock CDP browsers
    cdp_browsers = [
        {"port": 9222, "isExternal": True, "name": "Browser 1"},
        {"port": 9223, "isExternal": True, "name": "Browser 2"},
        {"port": 9224, "isExternal": True, "name": "Browser 3"},
    ]

    # Create mock Chat options
    options = Chat(
        task_id="test-task-clone",
        project_id="test-project-clone",
        question="Test question",
        email="test@example.com",
        model_platform="openai",
        model_type="gpt-4o-mini",
        api_key="test-key",
        cdp_browsers=cdp_browsers,
    )

    print(f"\n1. Creating original search agent...")
    print(f"   Available CDP browsers: {len(cdp_browsers)}")

    # Mock all dependencies
    with patch('app.utils.agent.get_task_lock') as mock_get_task_lock, \
         patch('app.service.task.get_task_lock') as mock_service_task_lock, \
         patch('app.utils.agent.HybridBrowserToolkit') as MockBrowserToolkit, \
         patch('app.utils.agent.TerminalToolkit') as MockTerminalToolkit, \
         patch('app.utils.agent.NoteTakingToolkit') as MockNoteTakingToolkit, \
         patch('app.utils.agent.SearchToolkit') as MockSearchToolkit, \
         patch('app.utils.agent.HumanToolkit') as MockHumanToolkit, \
         patch('app.utils.agent.ToolkitMessageIntegration') as MockMessageIntegration:

        # Setup mocks
        mock_task_lock = MagicMock()
        mock_get_task_lock.return_value = mock_task_lock
        mock_service_task_lock.return_value = mock_task_lock

        mock_toolkit_instance = MagicMock()
        MockBrowserToolkit.return_value = mock_toolkit_instance

        mock_terminal = MagicMock()
        mock_terminal.shell_exec = MagicMock()
        MockTerminalToolkit.return_value = mock_terminal

        mock_note = MagicMock()
        mock_note.get_tools.return_value = []
        MockNoteTakingToolkit.return_value = mock_note

        mock_search = MagicMock()
        mock_search.get_can_use_tools.return_value = []
        MockSearchToolkit.return_value = mock_search

        mock_human = MagicMock()
        mock_human.get_can_use_tools.return_value = []
        MockHumanToolkit.return_value = mock_human

        mock_msg_integration = MagicMock()
        mock_msg_integration.register_toolkits.return_value = mock_toolkit_instance
        mock_msg_integration.register_functions.return_value = []
        MockMessageIntegration.return_value = mock_msg_integration

        # Create original agent
        original_agent = search_agent(options)

        # Check original agent has CDP info
        assert hasattr(original_agent, '_cdp_port'), "Original agent missing _cdp_port"
        assert hasattr(original_agent, '_cdp_session_id'), "Original agent missing _cdp_session_id"
        assert hasattr(original_agent, '_cdp_acquire_callback'), "Original agent missing _cdp_acquire_callback"
        assert hasattr(original_agent, '_cdp_release_callback'), "Original agent missing _cdp_release_callback"

        original_port = original_agent._cdp_port
        original_session = original_agent._cdp_session_id

        print(f"   ✅ Original agent created")
        print(f"   Original agent CDP: port={original_port}, session={original_session}")

        # Check pool occupation
        occupied = _cdp_pool_manager.get_occupied_ports()
        print(f"\n2. Occupied ports after original agent: {occupied}")
        assert original_port in occupied, f"Original port {original_port} should be occupied"
        assert len(occupied) == 1, f"Should have 1 occupied port, got {len(occupied)}"
        print(f"   ✅ Pool correctly shows 1 occupied port")

        # Clone the agent
        print(f"\n3. Cloning agent...")
        cloned_agent1 = original_agent.clone()

        # Check cloned agent has CDP info
        assert hasattr(cloned_agent1, '_cdp_port'), "Cloned agent missing _cdp_port"
        assert hasattr(cloned_agent1, '_cdp_session_id'), "Cloned agent missing _cdp_session_id"
        assert hasattr(cloned_agent1, '_cdp_acquire_callback'), "Cloned agent missing _cdp_acquire_callback"
        assert hasattr(cloned_agent1, '_cdp_release_callback'), "Cloned agent missing _cdp_release_callback"
        assert hasattr(cloned_agent1, '_cleanup_callback'), "Cloned agent missing _cleanup_callback"

        clone1_port = cloned_agent1._cdp_port
        clone1_session = cloned_agent1._cdp_session_id

        print(f"   ✅ Clone 1 created")
        print(f"   Clone 1 CDP: port={clone1_port}, session={clone1_session}")

        # Check that clone has different port
        assert clone1_port != original_port, f"Clone should have different port! Original: {original_port}, Clone: {clone1_port}"
        print(f"   ✅ Clone 1 has different port than original")

        # Check pool occupation after first clone
        occupied = _cdp_pool_manager.get_occupied_ports()
        print(f"\n4. Occupied ports after clone 1: {occupied}")
        assert len(occupied) == 2, f"Should have 2 occupied ports, got {len(occupied)}"
        assert original_port in occupied and clone1_port in occupied
        print(f"   ✅ Pool correctly shows 2 occupied ports")

        # Clone again
        print(f"\n5. Cloning agent again...")
        cloned_agent2 = original_agent.clone()

        clone2_port = cloned_agent2._cdp_port
        clone2_session = cloned_agent2._cdp_session_id

        print(f"   ✅ Clone 2 created")
        print(f"   Clone 2 CDP: port={clone2_port}, session={clone2_session}")

        # Check that second clone has different port from both original and first clone
        assert clone2_port != original_port, f"Clone 2 should differ from original"
        assert clone2_port != clone1_port, f"Clone 2 should differ from clone 1"
        print(f"   ✅ Clone 2 has different port than original and clone 1")

        # Check pool occupation
        occupied = _cdp_pool_manager.get_occupied_ports()
        print(f"\n6. Occupied ports after clone 2: {occupied}")
        assert len(occupied) == 3, f"Should have 3 occupied ports, got {len(occupied)}"
        assert set(occupied) == {original_port, clone1_port, clone2_port}
        print(f"   ✅ Pool correctly shows 3 occupied ports")

        # Test cleanup of clone 1
        print(f"\n7. Testing cleanup callback for clone 1...")
        if hasattr(cloned_agent1, '_cleanup_callback') and callable(cloned_agent1._cleanup_callback):
            cloned_agent1._cleanup_callback()
            print(f"   ✅ Called cleanup for clone 1")

        occupied = _cdp_pool_manager.get_occupied_ports()
        print(f"   Occupied ports after cleanup: {occupied}")
        assert clone1_port not in occupied, f"Clone 1 port should be released"
        assert len(occupied) == 2, f"Should have 2 occupied ports after cleanup, got {len(occupied)}"
        print(f"   ✅ Clone 1 port released correctly")

        # Cleanup remaining agents
        print(f"\n8. Cleaning up all agents...")
        if hasattr(cloned_agent2, '_cleanup_callback') and callable(cloned_agent2._cleanup_callback):
            cloned_agent2._cleanup_callback()
        if hasattr(original_agent, '_cleanup_callback') and callable(original_agent._cleanup_callback):
            original_agent._cleanup_callback()

        occupied = _cdp_pool_manager.get_occupied_ports()
        print(f"   Final occupied ports: {occupied}")
        assert len(occupied) == 0, f"All ports should be released, but {occupied} still occupied"
        print(f"   ✅ All ports released")

    print("\n✅ TEST PASSED: Clone Acquires Different CDP Browser\n")


def run_test():
    """Run the clone CDP test."""
    print("\n" + "=" * 80)
    print("CLONE CDP TEST SUITE")
    print("=" * 80 + "\n")

    try:
        test_clone_acquires_different_cdp()
        print("\n" + "=" * 80)
        print("TEST SUMMARY")
        print("=" * 80)
        print("Total tests: 1")
        print("Passed: 1 ✅")
        print("Failed: 0")
        print("=" * 80 + "\n")
        return True
    except AssertionError as e:
        print(f"\n❌ TEST FAILED")
        print(f"   Error: {e}\n")
        print("\n" + "=" * 80)
        print("TEST SUMMARY")
        print("=" * 80)
        print("Total tests: 1")
        print("Passed: 0")
        print("Failed: 1 ❌")
        print("=" * 80 + "\n")
        return False
    except Exception as e:
        print(f"\n❌ TEST ERROR")
        print(f"   Unexpected error: {e}\n")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = run_test()
    sys.exit(0 if success else 1)
