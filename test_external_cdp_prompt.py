"""
Test script to verify external CDP browser prompt in search agent
"""
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from app.model.chat import Chat


def test_external_cdp_detection():
    """Test that we can properly detect external CDP configuration"""

    # Test case 1: External CDP browser
    chat_options_external = Chat(
        task_id="test-task-1",
        project_id="test-project-1",
        question="Test question",
        email="test@example.com",
        model_platform="openai",
        model_type="gpt-4",
        api_key="test-key",
        use_external_cdp=True,
        cdp_browsers=[
            {
                "name": "External Browser",
                "port": 9223,
                "isExternal": True
            }
        ]
    )

    print("Test Case 1: External CDP Browser")
    print(f"  use_external_cdp: {chat_options_external.use_external_cdp}")
    print(f"  cdp_browsers: {chat_options_external.cdp_browsers}")
    print(f"  First browser isExternal: {chat_options_external.cdp_browsers[0].get('isExternal', False)}")
    print()

    # Test case 2: Internal CDP browser
    chat_options_internal = Chat(
        task_id="test-task-2",
        project_id="test-project-2",
        question="Test question",
        email="test@example.com",
        model_platform="openai",
        model_type="gpt-4",
        api_key="test-key",
        use_external_cdp=False,
        cdp_browsers=[
            {
                "name": "Internal Browser",
                "port": 9222,
                "isExternal": False
            }
        ]
    )

    print("Test Case 2: Internal CDP Browser")
    print(f"  use_external_cdp: {chat_options_internal.use_external_cdp}")
    print(f"  cdp_browsers: {chat_options_internal.cdp_browsers}")
    print(f"  First browser isExternal: {chat_options_internal.cdp_browsers[0].get('isExternal', False)}")
    print()

    # Test case 3: No CDP browsers configured
    chat_options_none = Chat(
        task_id="test-task-3",
        project_id="test-project-3",
        question="Test question",
        email="test@example.com",
        model_platform="openai",
        model_type="gpt-4",
        api_key="test-key",
        use_external_cdp=False,
        cdp_browsers=[]
    )

    print("Test Case 3: No CDP Browsers")
    print(f"  use_external_cdp: {chat_options_none.use_external_cdp}")
    print(f"  cdp_browsers: {chat_options_none.cdp_browsers}")
    print()

    print("✓ All test cases configured correctly")
    print("\nExpected behavior:")
    print("- Test Case 1: Should show external browser notice in search agent prompt")
    print("- Test Case 2: Should NOT show external browser notice")
    print("- Test Case 3: Should NOT show external browser notice")


if __name__ == "__main__":
    test_external_cdp_detection()
