"""
Test script to verify the external CDP browser notice in system message
This simulates the logic from search_agent function
"""


def generate_external_browser_notice(selected_is_external):
    """Simulate the logic from search_agent function"""
    external_browser_notice = ""
    if selected_is_external:
        external_browser_notice = """
<external_browser_connection>
**IMPORTANT**: You are connected to an external browser instance. The browser may already be open with active sessions and logged-in websites. When you use `browser_open`, you will connect to this existing browser and can immediately access its current state and pages. The user may have already logged into required websites, so you can leverage these authenticated sessions.
</external_browser_connection>
"""
    return external_browser_notice


def test_system_message_with_external_browser():
    """Test that external browser notice is included when appropriate"""

    # Test Case 1: External browser
    print("=" * 80)
    print("Test Case 1: External Browser (selected_is_external=True)")
    print("=" * 80)
    selected_is_external = True
    external_browser_notice = generate_external_browser_notice(selected_is_external)

    system_message_fragment = f"""
<web_search_workflow>
Your approach depends on available search tools:
{external_browser_notice}
**Common Browser Operations (both scenarios):**
- **Navigation and Exploration**: Use `browser_visit_page` to open URLs.
</web_search_workflow>
"""

    print(system_message_fragment)
    assert "<external_browser_connection>" in system_message_fragment
    assert "external browser instance" in system_message_fragment
    print("✓ External browser notice correctly included\n")

    # Test Case 2: Internal browser
    print("=" * 80)
    print("Test Case 2: Internal Browser (selected_is_external=False)")
    print("=" * 80)
    selected_is_external = False
    external_browser_notice = generate_external_browser_notice(selected_is_external)

    system_message_fragment = f"""
<web_search_workflow>
Your approach depends on available search tools:
{external_browser_notice}
**Common Browser Operations (both scenarios):**
- **Navigation and Exploration**: Use `browser_visit_page` to open URLs.
</web_search_workflow>
"""

    print(system_message_fragment)
    assert "<external_browser_connection>" not in system_message_fragment
    assert "external browser instance" not in system_message_fragment
    print("✓ External browser notice correctly excluded\n")

    print("=" * 80)
    print("All tests passed! ✓")
    print("=" * 80)


if __name__ == "__main__":
    test_system_message_with_external_browser()
