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
Uses ChatAgent directly with an extension-specific lightweight TaskLock
context so wrapped toolkits can be reused without the normal SSE workflow.
"""

import asyncio
import logging
import os
import platform
import uuid
from pathlib import Path
from typing import Any

from app.agent.factory.browser import build_browser_agent_tooling
from app.agent.prompt import build_extension_browser_system_prompt
from app.agent.toolkit.hybrid_browser_toolkit import HybridBrowserToolkit
from app.agent.utils import NOW_STR
from app.service.task import (
    delete_task_lock,
    get_or_create_task_lock,
    get_task_lock_if_exists,
)
from camel.agents import ChatAgent
from camel.messages import BaseMessage
from camel.models import ModelFactory

logger = logging.getLogger("extension_chat_service")

_chat_agent: ChatAgent | None = None
_chat_loop_task: asyncio.Task | None = None
_current_step_task: asyncio.Task | None = None
_model_config: dict | None = None
_current_vision_mode: bool = False
_queue_drain_task: asyncio.Task | None = None

_EXTENSION_TASK_ID = "extension_chat"
_EXTENSION_ROOT = Path.home() / ".eigent" / "extension_chat"
_EXTENSION_WORKSPACE = _EXTENSION_ROOT / "workspace"
_EXTENSION_LOG_DIR = _EXTENSION_ROOT / "camel_logs"


def _normalize_stream_delta(content: object) -> str:
    """Normalize streamed model text for the extension UI."""
    if content is None:
        return ""
    if not isinstance(content, str):
        content = str(content)

    stripped = content.strip()
    if not stripped:
        return ""
    if stripped.lower() == "null":
        return ""
    return content


def _humanize_tool_name(name: str) -> str:
    name = name.strip().replace("_", " ")
    if name.startswith("browser "):
        name = name[len("browser ") :]
    if not name:
        return "Tool Action"
    return name.title()


def _tool_args_to_dict(args: object) -> dict[str, Any]:
    if isinstance(args, dict):
        return args
    if hasattr(args, "model_dump"):
        dumped = args.model_dump()
        if isinstance(dumped, dict):
            return dumped
    if hasattr(args, "dict"):
        dumped = args.dict()
        if isinstance(dumped, dict):
            return dumped
    return {}


import re

# Cache latest ARIA snapshot text for ref → element name lookup
_last_snapshot_text: str = ""


def _resolve_ref_label(ref: str) -> str:
    """Look up a ref like 'e621' in the last ARIA snapshot and return
    a human-readable element description, e.g. 'button "Submit"'."""
    if not _last_snapshot_text or not ref:
        return ""
    pattern = rf'-\s+(.+?)\s+\[ref={re.escape(ref)}\]'
    m = re.search(pattern, _last_snapshot_text)
    if m:
        label = m.group(1).strip()
        if len(label) > 50:
            label = label[:47] + "..."
        return label
    return ""


def _build_action_payload(tool_call: object) -> dict[str, str]:
    tool_name = getattr(tool_call, "func_name", str(tool_call))
    args = _tool_args_to_dict(getattr(tool_call, "args", {}))

    title = (
        args.get("message_title")
        or args.get("title")
        or _humanize_tool_name(tool_name)
    )
    detail = (
        args.get("message_description")
        or args.get("description")
        or args.get("detail")
        or ""
    )

    if not detail:
        # If args has a ref, resolve it to element name from snapshot
        ref = args.get("ref", "")
        if ref:
            ref_label = _resolve_ref_label(ref)
            if ref_label:
                detail = ref_label

        if not detail:
            fallback_parts: list[str] = []
            # Prefer human-readable fields; skip internal ref IDs
            for key in (
                "url", "text", "value", "query", "command", "code",
            ):
                value = args.get(key)
                if value:
                    fallback_parts.append(str(value).strip())
                if len(" | ".join(fallback_parts)) >= 140:
                    break
            detail = " | ".join(fallback_parts)

    detail = detail.strip()
    if len(detail) > 180:
        detail = detail[:177].rstrip() + "..."

    return {
        "action": str(title).strip() or _humanize_tool_name(tool_name),
        "detail": detail,
        "toolName": tool_name,
    }


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


async def _drain_extension_task_queue():
    """Discard TaskLock queue events emitted by auto_listen toolkits."""
    task_lock = get_or_create_task_lock(_EXTENSION_TASK_ID)
    while True:
        try:
            await task_lock.get_queue()
        except asyncio.CancelledError:
            logger.info("Extension task queue drain cancelled")
            break
        except Exception as e:
            logger.warning(f"Extension task queue drain stopped: {e}")
            break


def _ensure_extension_task_context() -> None:
    """Ensure extension chat has a lightweight TaskLock for wrapped toolkits."""
    get_or_create_task_lock(_EXTENSION_TASK_ID)

    global _queue_drain_task
    if _queue_drain_task is None or _queue_drain_task.done():
        _queue_drain_task = asyncio.create_task(_drain_extension_task_queue())


def _create_chat_agent(wrapper, full_visual_mode: bool = False) -> ChatAgent:
    """Create a browser ChatAgent using the shared wrapper."""
    if not _model_config:
        raise ValueError(
            "Extension chat not configured. "
            "Pass model_config when starting extension proxy."
        )

    # Setup extension workspace and CAMEL logging.
    _EXTENSION_WORKSPACE.mkdir(parents=True, exist_ok=True)
    _EXTENSION_LOG_DIR.mkdir(parents=True, exist_ok=True)
    os.environ["CAMEL_LOG_DIR"] = str(_EXTENSION_LOG_DIR)
    os.environ["CAMEL_MODEL_LOG_ENABLED"] = "true"
    os.environ["file_save_path"] = str(_EXTENSION_WORKSPACE)
    logger.info(f"CAMEL_LOG_DIR set to {_EXTENSION_LOG_DIR}")

    _ensure_extension_task_context()

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
        _EXTENSION_TASK_ID,
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

    tooling = build_browser_agent_tooling(
        api_task_id=_EXTENSION_TASK_ID,
        working_directory=str(_EXTENSION_WORKSPACE),
        user_id=None,
        web_toolkit_custom=browser_toolkit,
        include_human_toolkit=False,
        include_note_toolkit=False,
        include_search_toolkit=False,
        include_terminal_toolkit=False,
    )

    system_message = build_extension_browser_system_prompt(
        platform_system=platform.system(),
        platform_machine=platform.machine(),
        working_directory=str(_EXTENSION_WORKSPACE),
        now_str=NOW_STR,
        external_browser_notice=(
            "\n<external_browser_connection>\n"
            "You are connected to the user's current Chrome browser via the "
            "extension. Work with the current browser state and open pages when "
            "relevant.\n"
            "</external_browser_connection>\n"
            "\n<trigger_capability>\n"
            "You have a browser_set_trigger tool. When the user asks you to "
            "wait for a condition (e.g., 'click the buy button when it becomes "
            "available', 'do something at 12:00'), call browser_set_trigger "
            "with a JavaScript function that returns true when the condition "
            "is met. You will be notified when it is time to continue.\n"
            "</trigger_capability>\n"
        ),
    )

    agent = ChatAgent(
        system_message=BaseMessage.make_assistant_message(
            role_name="Browser Agent",
            content=system_message,
        ),
        model=model,
        tools=tooling.tools,
        toolkits_to_register_agent=tooling.toolkits_to_register_agent,
        message_window_size=None,
        step_timeout=None,
        # Clean up tool call messages (assistant tool_calls + tool responses)
        # after each step to prevent context bloat from accumulated page
        # snapshots. Keeps user messages and agent text replies intact.
        prune_tool_calls_from_memory=True,
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
        had_tool_calls = False

        async for chunk in response:
            # Notify frontend immediately when a tool starts executing
            tool_start = chunk.info.get("tool_call_start")
            if tool_start:
                start_name = tool_start.get("name", "")
                start_args = tool_start.get("args", {})
                if isinstance(start_args, dict):
                    start_title = (
                        start_args.get("message_title")
                        or _humanize_tool_name(start_name)
                    )
                    start_detail = (
                        start_args.get("message_description") or ""
                    )
                else:
                    start_title = _humanize_tool_name(start_name)
                    start_detail = ""
                await wrapper.send_chat_response(
                    "ACTION",
                    {
                        "action": start_title,
                        "detail": start_detail,
                        "toolName": start_name,
                    },
                )

            # Send text delta
            delta = _normalize_stream_delta(
                chunk.msg.content if chunk.msg else ""
            )
            if delta:
                # Insert paragraph break between text from different
                # tool-call rounds so the UI renders them separately.
                if had_tool_calls and full_text:
                    await wrapper.send_chat_response(
                        "STREAM_TEXT", {"text": "\n\n"}
                    )
                    full_text += "\n\n"
                    had_tool_calls = False
                full_text += delta
                await wrapper.send_chat_response(
                    "STREAM_TEXT", {"text": delta}
                )

            # Send tool call info as actions (deduplicate)
            global _last_snapshot_text
            tool_calls = chunk.info.get("tool_calls", [])
            for tc in tool_calls:
                tc_id = id(tc)
                if tc_id in seen_tool_calls:
                    continue
                seen_tool_calls.add(tc_id)
                had_tool_calls = True

                # Cache snapshot text for ref label resolution
                tc_result = str(getattr(tc, "result", ""))
                if "[ref=" in tc_result:
                    _last_snapshot_text = tc_result

                await wrapper.send_chat_response(
                    "ACTION",
                    _build_action_payload(tc),
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


async def _run_step_as_task(wrapper, message, full_vision_mode):
    """Run _process_chat_message as a cancellable asyncio.Task."""
    global _current_step_task
    task = asyncio.create_task(
        _process_chat_message(
            wrapper, message, full_vision_mode=full_vision_mode
        )
    )
    _current_step_task = task
    try:
        await task
    except asyncio.CancelledError:
        logger.info("Current agent step cancelled by STOP_TASK")
        await wrapper.send_chat_response("STREAM_END", {})
        await wrapper.send_chat_response(
            "TASK_COMPLETE", {"result": "Task stopped by user."}
        )
    finally:
        _current_step_task = None


async def stop_current_task(wrapper):
    """Cancel the currently running agent step."""
    global _current_step_task
    if _current_step_task is not None and not _current_step_task.done():
        logger.info("Stopping current agent task")
        _current_step_task.cancel()
    else:
        # No task running, still notify frontend
        await wrapper.send_chat_response(
            "TASK_COMPLETE", {"result": "No task running."}
        )


async def _stop_listener(wrapper):
    """Listen for STOP_TASK messages while agent is running."""
    while True:
        try:
            msg_data = await wrapper.wait_for_stop_signal()
            if msg_data is None:
                continue
            await stop_current_task(wrapper)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Stop listener error: {e}")
            break


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
                await _run_step_as_task(
                    wrapper,
                    trigger_msg,
                    full_vision_mode=_current_vision_mode,
                )
                continue

            message = msg_data.get("message", "")
            full_vision = msg_data.get("fullVisionMode", False)

            # Update wrapper's default tab to match the tab the
            # extension attached the debugger to, so CDP commands
            # target the correct tab.
            msg_tab_id = msg_data.get("tabId")
            if msg_tab_id:
                wrapper._default_tab_id = msg_tab_id
                if msg_tab_id not in wrapper._tabs:
                    wrapper._tabs[msg_tab_id] = {
                        "url": msg_data.get("url", ""),
                        "title": msg_data.get("pageTitle", ""),
                        "aria_initialized": False,
                    }

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
                await _run_step_as_task(
                    wrapper, message, full_vision_mode=full_vision
                )

        except asyncio.CancelledError:
            logger.info("Extension chat loop cancelled")
            break
        except Exception as e:
            logger.error(f"Chat loop error: {e}", exc_info=True)
            await asyncio.sleep(1)


_stop_listener_task: asyncio.Task | None = None


async def start_chat_loop(wrapper):
    """Start the chat processing loop."""
    global _chat_loop_task, _stop_listener_task
    if _chat_loop_task is not None and not _chat_loop_task.done():
        logger.info("Chat loop already running")
        return
    _chat_loop_task = asyncio.create_task(_chat_loop(wrapper))
    _stop_listener_task = asyncio.create_task(_stop_listener(wrapper))


async def stop_chat_loop():
    """Stop the chat loop and clear the agent."""
    global _chat_loop_task, _chat_agent, _queue_drain_task
    global _stop_listener_task, _current_step_task
    if _current_step_task is not None and not _current_step_task.done():
        _current_step_task.cancel()
        try:
            await _current_step_task
        except asyncio.CancelledError:
            pass
        _current_step_task = None

    if _chat_loop_task is not None:
        _chat_loop_task.cancel()
        try:
            await _chat_loop_task
        except asyncio.CancelledError:
            pass
        _chat_loop_task = None

    if _stop_listener_task is not None:
        _stop_listener_task.cancel()
        try:
            await _stop_listener_task
        except asyncio.CancelledError:
            pass
        _stop_listener_task = None

    if _queue_drain_task is not None:
        _queue_drain_task.cancel()
        try:
            await _queue_drain_task
        except asyncio.CancelledError:
            pass
        _queue_drain_task = None

    _chat_agent = None
    task_lock = get_task_lock_if_exists(_EXTENSION_TASK_ID)
    if task_lock is not None:
        await delete_task_lock(_EXTENSION_TASK_ID)
    logger.info("Extension chat loop stopped")


async def clear_chat_context():
    """Reset the agent (destroy and recreate on next message)."""
    global _chat_agent
    if _chat_agent is not None:
        _chat_agent = None
        logger.info(
            "Extension chat agent destroyed, will recreate on next message"
        )
