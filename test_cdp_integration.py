#!/usr/bin/env python3
"""
CDP Pool Integration Test

This script tests CDP pool functionality in a realistic workflow scenario:
1. Creates multiple search agents (simulating parallel tasks)
2. Verifies each agent gets a different CDP browser from the pool
3. Simulates project end and verifies all CDP browsers are released

Usage:
    python test_cdp_integration.py
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add backend to path
backend_path = Path(__file__).parent / "backend"
sys.path.insert(0, str(backend_path))

from app.utils.agent import _cdp_pool_manager, search_agent
from app.model.chat import Chat
from app.utils.workforce import Workforce


def test_search_agent_pool_integration():
    """Test that search agents correctly acquire and release CDP browsers."""
    print("=" * 80)
    print("INTEGRATION TEST: Search Agent CDP Pool")
    print("=" * 80)

    # Setup: Mock CDP browsers
    cdp_browsers = [
        {"port": 9222, "isExternal": True, "name": "Browser 1"},
        {"port": 9223, "isExternal": True, "name": "Browser 2"},
        {"port": 9224, "isExternal": True, "name": "Browser 3"},
    ]

    # Create mock Chat options
    options = Chat(
        task_id="test-task-001",
        project_id="test-project-001",
        question="Test question",
        email="test@example.com",
        model_platform="openai",
        model_type="gpt-4o-mini",
        api_key="test-key",
        cdp_browsers=cdp_browsers,
    )

    print(f"\n1. Creating 3 search agents (simulating parallel tasks)...")
    print(f"   Available CDP browsers: {len(cdp_browsers)}")

    agents = []
    acquired_ports = []

    # Mock all dependencies to avoid actual initialization
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

        # Create 3 search agents
        for i in range(3):
            print(f"\n   Creating search agent {i+1}...")
            agent = search_agent(options)

            # Verify the agent has cleanup callback
            assert hasattr(agent, '_cleanup_callback'), f"Agent {i+1} missing cleanup callback"
            print(f"   ✅ Agent {i+1} created with cleanup callback")

            agents.append(agent)

            # Check occupied ports after each agent creation
            occupied = _cdp_pool_manager.get_occupied_ports()
            print(f"   Occupied ports after agent {i+1}: {occupied}")
            acquired_ports.append(occupied[-1] if occupied else None)

    # Verify all agents got different ports
    print(f"\n2. Verifying all agents got different CDP browsers...")
    print(f"   Acquired ports: {acquired_ports}")
    assert len(set(acquired_ports)) == 3, f"Agents should use different ports, got: {acquired_ports}"
    assert set(acquired_ports) == {9222, 9223, 9224}, f"Unexpected ports: {acquired_ports}"
    print(f"   ✅ All 3 agents acquired different browsers")

    # Verify pool is fully occupied
    occupied = _cdp_pool_manager.get_occupied_ports()
    print(f"\n3. Verifying pool is fully occupied...")
    print(f"   Occupied ports: {occupied}")
    assert len(occupied) == 3, f"Expected 3 occupied ports, got {len(occupied)}"
    print(f"   ✅ Pool is fully occupied")

    # Simulate project end - call cleanup callbacks
    print(f"\n4. Simulating project end (calling cleanup callbacks)...")
    for i, agent in enumerate(agents):
        print(f"   Calling cleanup for agent {i+1}...")
        if hasattr(agent, '_cleanup_callback') and callable(agent._cleanup_callback):
            agent._cleanup_callback()
            occupied_after = _cdp_pool_manager.get_occupied_ports()
            print(f"   Occupied ports after cleanup {i+1}: {occupied_after}")

    # Verify all ports are released
    occupied_final = _cdp_pool_manager.get_occupied_ports()
    print(f"\n5. Verifying all CDP browsers are released...")
    print(f"   Final occupied ports: {occupied_final}")
    assert len(occupied_final) == 0, f"All ports should be released, but {occupied_final} still occupied"
    print(f"   ✅ All CDP browsers released correctly")

    print("\n✅ INTEGRATION TEST PASSED: Search Agent CDP Pool\n")


def test_workforce_cleanup():
    """Test that workforce correctly cleans up all agents on stop."""
    print("=" * 80)
    print("INTEGRATION TEST: Workforce Cleanup")
    print("=" * 80)

    cdp_browsers = [
        {"port": 9222, "isExternal": True, "name": "Browser 1"},
        {"port": 9223, "isExternal": True, "name": "Browser 2"},
    ]

    options = Chat(
        task_id="test-task-002",
        project_id="test-project-002",
        question="Test question",
        email="test@example.com",
        model_platform="openai",
        model_type="gpt-4o-mini",
        api_key="test-key",
        cdp_browsers=cdp_browsers,
    )

    print(f"\n1. Creating workforce with search agents...")

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

        # Create search agents
        agent1 = search_agent(options)
        agent2 = search_agent(options)

        print(f"   Created 2 search agents")

    # Verify both ports are occupied
    occupied = _cdp_pool_manager.get_occupied_ports()
    print(f"\n2. Occupied ports after creating agents: {occupied}")
    assert len(occupied) == 2, f"Expected 2 occupied ports, got {len(occupied)}"
    print(f"   ✅ Both agents acquired browsers")

    # Create a mock workforce and add agents as workers
    print(f"\n3. Creating workforce and adding agents as workers...")
    workforce = Workforce(
        api_task_id="test-project-002",
        description="Test workforce",
    )

    # Mock worker nodes with the agents
    from app.utils.single_agent_worker import SingleAgentWorker
    worker1 = SingleAgentWorker(worker_agent=agent1, description="Search Agent 1")
    worker2 = SingleAgentWorker(worker_agent=agent2, description="Search Agent 2")

    workforce.children = [worker1, worker2]
    print(f"   ✅ Workforce created with 2 workers")

    # Call stop_gracefully to trigger cleanup
    print(f"\n4. Calling workforce.stop_gracefully() to trigger cleanup...")
    workforce.stop_gracefully()

    # Verify all ports are released
    occupied_final = _cdp_pool_manager.get_occupied_ports()
    print(f"\n5. Occupied ports after workforce.stop_gracefully(): {occupied_final}")
    assert len(occupied_final) == 0, f"All ports should be released after stop_gracefully, but {occupied_final} still occupied"
    print(f"   ✅ All CDP browsers released by workforce cleanup")

    print("\n✅ INTEGRATION TEST PASSED: Workforce Cleanup\n")


def run_all_integration_tests():
    """Run all integration tests."""
    print("\n" + "=" * 80)
    print("CDP POOL INTEGRATION TEST SUITE")
    print("=" * 80 + "\n")

    tests = [
        test_search_agent_pool_integration,
        test_workforce_cleanup,
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
    print("INTEGRATION TEST SUMMARY")
    print("=" * 80)
    print(f"Total tests: {len(tests)}")
    print(f"Passed: {passed} ✅")
    print(f"Failed: {failed} {'❌' if failed > 0 else ''}")
    print("=" * 80 + "\n")

    return failed == 0


if __name__ == "__main__":
    success = run_all_integration_tests()
    sys.exit(0 if success else 1)
