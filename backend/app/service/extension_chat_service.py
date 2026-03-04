# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

"""Lightweight chat service for Chrome extension.

Runs a persistent browser agent that processes chat messages
received via the ExtensionProxyWrapper WebSocket.
Uses ChatAgent directly — no TaskLock, no SSE, no project infrastructure.
"""

import asyncio
import logging
import os
from pathlib import Path
import platform
import uuid

from camel.agents import ChatAgent
from camel.messages import BaseMessage
from camel.models import ModelFactory
from camel.toolkits.hybrid_browser_toolkit.hybrid_browser_toolkit_ts import (
    HybridBrowserToolkit,
)

from app.agent.prompt import BROWSER_SYS_PROMPT
from app.agent.utils import NOW_STR

logger = logging.getLogger("extension_chat_service")

_chat_agent: ChatAgent | None = None
_chat_loop_task: asyncio.Task | None = None
_model_config: dict | None = None
_current_vision_mode: bool = False


def configure_model(config: dict):
    """Store model config for agent creation.

    config keys: model_platform, model_type, api_key, api_url (optional),
                 extra_params (optional)
    """
    global _model_config
    _model_config = config
    logger.info(
        f"Extension chat model configured: "
        f"{config.get('model_platform')}/{config.get('model_type')}"
    )


def _create_chat_agent(wrapper, full_visual_mode: bool = False) -> ChatAgent:
    """Create a browser ChatAgent using the shared wrapper."""
    if not _model_config:
        raise ValueError(
            "Extension chat not configured. "
            "Pass model_config when starting extension proxy."
        )

    # Setup camel LLM logging (same pattern as chat_controller)
    log_dir = (
        Path.home() / ".eigent" / "qwe" / "extension_chat" / "camel_logs"
    )
    log_dir.mkdir(parents=True, exist_ok=True)
    os.environ["CAMEL_LOG_DIR"] = str(log_dir)
    os.environ["CAMEL_MODEL_LOG_ENABLED"] = "true"
    logger.info(f"CAMEL_LOG_DIR set to {log_dir}")

    extra_params = _model_config.get("extra_params", {})
    model_config_dict = {}
    if extra_params:
        model_config_dict.update(extra_params)
    # Disable parallel tool calls for browser agent
    model_config_dict["parallel_tool_calls"] = False
    # Enable streaming for real-time token output
    model_config_dict["stream"] = True

    model = ModelFactory.create(
        model_platform=_model_config["model_platform"],
        model_type=_model_config["model_type"],
        api_key=_model_config["api_key"],
        url=_model_config.get("api_url"),
        model_config_dict=model_config_dict or None,
        timeout=600,
    )

    # Use camel's HybridBrowserToolkit directly (not eigent's)
    # to avoid @listen_toolkit / TaskLock dependency
    session_id = str(uuid.uuid4())[:8]

    enabled_tools = [
        "browser_click",
        "browser_type",
        "browser_back",
        "browser_forward",
        "browser_console_exec",
        "browser_console_view",
        "browser_switch_tab",
        "browser_enter",
        "browser_visit_page",
        "browser_scroll",
        "browser_set_trigger",
    ]
    if full_visual_mode:
        enabled_tools.append("browser_get_screenshot")
    else:
        enabled_tools.extend(
            [
                "browser_select",
                "browser_get_page_snapshot",
            ]
        )

    browser_toolkit = HybridBrowserToolkit(
        headless=False,
        stealth=True,
        session_id=session_id,
        extension_proxy_mode=True,
        extension_proxy_host=wrapper.host,
        extension_proxy_port=wrapper.port,
        full_visual_mode=full_visual_mode,
        enabled_tools=enabled_tools,
    )
    # Inject the shared wrapper
    browser_toolkit._extension_proxy_wrapper = wrapper

    tools = browser_toolkit.get_tools()

    system_message = BROWSER_SYS_PROMPT.format(
        platform_system=platform.system(),
        platform_machine=platform.machine(),
        working_directory="~",
        now_str=NOW_STR,
        external_browser_notice=(
            "\n<external_browser_connection>\n"
            "You are connected to the user's Chrome browser via extension. "
            "The browser is already open with active sessions and logged-in "
            "websites.\n"
            "</external_browser_connection>\n"
            "\n<trigger_capability>\n"
            "You have a browser_set_trigger tool. When the user asks you to "
            "wait for a condition (e.g., 'click the buy button when it becomes "
            "available', 'do something at 12:00'), write a JavaScript arrow "
            "function that returns true when the condition is met, and call "
            "browser_set_trigger. You will be automatically notified when the "
            "condition is met, then proceed with the requested action.\n"
            "</trigger_capability>\n"
        ),
    )

    agent = ChatAgent(
        system_message=BaseMessage.make_assistant_message(
            role_name="Browser Agent",
            content=system_message,
        ),
        model=model,
        tools=tools,
        message_window_size=20,
        step_timeout=None,
    )
    logger.info(
        f"Extension chat agent created (full_visual_mode={full_visual_mode})"
    )
    return agent


async def _process_chat_message(
    wrapper, message: str, full_vision_mode: bool = False
):
    """Run one agent turn and stream results back via WebSocket."""
    global _chat_agent, _current_vision_mode

    # Recreate agent if vision mode changed
    if _chat_agent is not None and full_vision_mode != _current_vision_mode:
        logger.info(
            f"Vision mode changed to {full_vision_mode}, recreating agent"
        )
        _chat_agent = None

    if _chat_agent is None:
        try:
            _chat_agent = _create_chat_agent(
                wrapper, full_visual_mode=full_vision_mode
            )
            _current_vision_mode = full_vision_mode
        except Exception as e:
            logger.error(f"Failed to create chat agent: {e}")
            await wrapper.send_chat_response("TASK_ERROR", {"error": str(e)})
            return

    await wrapper.send_chat_response("STREAM_START", {})

    try:
        user_msg = BaseMessage.make_user_message(
            role_name="User", content=message
        )
        response = await _chat_agent.astep(user_msg)

        # Stream mode: async iterate over partial responses
        full_text = ""
        seen_tool_calls = set()

        async for chunk in response:
            # Send text delta
            delta = chunk.msg.content if chunk.msg else ""
            if delta:
                full_text += delta
                await wrapper.send_chat_response(
                    "STREAM_TEXT", {"text": delta}
                )

            # Send tool call info as actions (deduplicate)
            tool_calls = chunk.info.get("tool_calls", [])
            for tc in tool_calls:
                tc_id = id(tc)
                if tc_id in seen_tool_calls:
                    continue
                seen_tool_calls.add(tc_id)
                func_name = getattr(tc, "func_name", str(tc))
                await wrapper.send_chat_response(
                    "ACTION",
                    {
                        "action": func_name,
                        "detail": str(getattr(tc, "args", {}))[:200],
                    },
                )
                result = getattr(tc, "result", "")
                success = not str(result).startswith("Error")
                await wrapper.send_chat_response(
                    "ACTION_COMPLETE",
                    {
                        "success": success,
                        "result": str(result)[:500],
                    },
                )

        await wrapper.send_chat_response("STREAM_END", {})
        # Don't re-send full_text — it was already streamed via
        # STREAM_TEXT chunks. Sending it again in TASK_COMPLETE causes
        # duplicate text in the UI.
        await wrapper.send_chat_response("TASK_COMPLETE", {})

    except Exception as e:
        logger.error(f"Chat agent error: {e}", exc_info=True)
        await wrapper.send_chat_response("TASK_ERROR", {"error": str(e)})


async def _chat_loop(wrapper):
    """Main loop: wait for chat messages, process them."""
    logger.info("Extension chat loop started")
    while True:
        try:
            msg_data = await wrapper.wait_for_chat_message()
            if msg_data is None:
                continue

            msg_type = msg_data.get("type", "CHAT_MESSAGE")

            if msg_type == "CLEAR_CONTEXT":
                await clear_chat_context()
                continue

            if msg_type == "TRIGGER_FIRED":
                description = msg_data.get("description", "unknown")
                trigger_msg = (
                    f"[TRIGGER FIRED] Your trigger has been activated: "
                    f"{description}. Please proceed with the next action."
                )
                logger.info(f"Trigger fired: {description}")
                await _process_chat_message(
                    wrapper,
                    trigger_msg,
                    full_vision_mode=_current_vision_mode,
                )
                continue

            message = msg_data.get("message", "")
            full_vision = msg_data.get("fullVisionMode", False)
            if message.strip():
                # Prepend current page context
                page_url = msg_data.get("url", "")
                page_title = msg_data.get("pageTitle", "")
                if page_url:
                    context = (
                        f"[Current page: {page_title} | {page_url}]\n"
                        if page_title
                        else f"[Current page: {page_url}]\n"
                    )
                    message = context + message

                logger.info(
                    f"Processing chat message "
                    f"(vision={full_vision}): {message[:100]}"
                )
                await _process_chat_message(
                    wrapper, message, full_vision_mode=full_vision
                )

        except asyncio.CancelledError:
            logger.info("Extension chat loop cancelled")
            break
        except Exception as e:
            logger.error(f"Chat loop error: {e}", exc_info=True)
            await asyncio.sleep(1)


async def start_chat_loop(wrapper):
    """Start the chat processing loop."""
    global _chat_loop_task
    if _chat_loop_task is not None and not _chat_loop_task.done():
        logger.info("Chat loop already running")
        return
    _chat_loop_task = asyncio.create_task(_chat_loop(wrapper))


async def stop_chat_loop():
    """Stop the chat loop and clear the agent."""
    global _chat_loop_task, _chat_agent
    if _chat_loop_task is not None:
        _chat_loop_task.cancel()
        try:
            await _chat_loop_task
        except asyncio.CancelledError:
            pass
        _chat_loop_task = None
    _chat_agent = None
    logger.info("Extension chat loop stopped")


async def clear_chat_context():
    """Reset the agent (clear conversation history)."""
    global _chat_agent
    if _chat_agent is not None:
        _chat_agent.reset()
        logger.info("Extension chat agent context cleared")
