# External CDP Browser Prompt Implementation

## Overview
Added dynamic prompt injection to the Search Agent's system message to inform it when connected to an external CDP browser instance.

## Changes Made

### 1. Modified File: `backend/app/utils/agent.py`

**Location**: Lines 1186-1268 (in the `search_agent` function)

**Changes**:
1. Added logic to build an external browser connection notice based on the `selected_is_external` flag
2. Dynamically inject this notice into the search agent's system message when using an external CDP browser

**Code Changes**:

```python
# Build external browser connection notice if using external CDP
external_browser_notice = ""
if selected_is_external:
    external_browser_notice = """
<external_browser_connection>
**IMPORTANT**: You are connected to an external browser instance. The browser may already be open with active sessions and logged-in websites. When you use `browser_open`, you will connect to this existing browser and can immediately access its current state and pages. The user may have already logged into required websites, so you can leverage these authenticated sessions.
</external_browser_connection>
"""

system_message = f"""
...
<web_search_workflow>
Your approach depends on available search tools:
{external_browser_notice}
**Common Browser Operations (both scenarios):**
...
```

## How It Works

1. **Detection**: When creating a search agent, the code checks if the acquired browser has `isExternal: true` in its configuration
2. **Dynamic Prompt**: If external, a special notice is added to the `<web_search_workflow>` section of the system message
3. **Agent Awareness**: The search agent receives this information and knows to:
   - Use `browser_open` to connect to the existing browser
   - Leverage any existing logged-in sessions
   - Access the current state and pages already open

## Configuration

The external CDP browser is configured through the `Chat` model:

```python
Chat(
    ...
    use_external_cdp=True,
    cdp_browsers=[
        {
            "name": "External Browser",
            "port": 9223,
            "isExternal": True  # This flag triggers the prompt
        }
    ]
)
```

## Testing

Two test scripts were created to verify the implementation:

1. **test_external_cdp_prompt.py**: Verifies that the Chat model correctly detects external CDP configuration
2. **test_system_message_generation.py**: Verifies that the system message correctly includes/excludes the external browser notice

Both tests pass successfully.

## Behavior

### When `isExternal: true`:
The search agent will see:
```
<web_search_workflow>
Your approach depends on available search tools:

<external_browser_connection>
**IMPORTANT**: You are connected to an external browser instance. The browser may already be open with active sessions and logged-in websites. When you use `browser_open`, you will connect to this existing browser and can immediately access its current state and pages. The user may have already logged into required websites, so you can leverage these authenticated sessions.
</external_browser_connection>

**Common Browser Operations (both scenarios):**
...
```

### When `isExternal: false` or not set:
The search agent will see:
```
<web_search_workflow>
Your approach depends on available search tools:

**Common Browser Operations (both scenarios):**
...
```

## Notes

- The prompt is in English as requested
- The implementation is minimal and focused on the search agent only
- Clone behavior: Cloned agents inherit the parent agent's system message, so if the initial agent was created with an external browser, all clones will have the same notice
- The `selected_is_external` flag is determined at agent creation time based on the acquired browser from the CDP pool
