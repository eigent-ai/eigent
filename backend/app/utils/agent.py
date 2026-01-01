import asyncio
import json
import os
import platform
import threading
from threading import Event
import traceback
from typing import Any, Callable, Dict, List, Tuple
import uuid
from utils import traceroot_wrapper as traceroot
from camel.agents import ChatAgent
from camel.agents.chat_agent import StreamingChatAgentResponse, AsyncStreamingChatAgentResponse
from camel.agents._types import ToolCallRequest
from camel.memories import AgentMemory
from camel.messages import BaseMessage
from camel.models import BaseModelBackend, ModelFactory, ModelManager, OpenAIAudioModels, ModelProcessingError
from camel.responses import ChatAgentResponse
from camel.terminators import ResponseTerminator
from camel.toolkits import FunctionTool, RegisteredAgentToolkit
from camel.types.agents import ToolCallingRecord
from app.component.environment import env
from app.utils.file_utils import get_working_directory
from app.utils.toolkit.abstract_toolkit import AbstractToolkit
from app.utils.toolkit.hybrid_browser_toolkit import HybridBrowserToolkit
from app.utils.toolkit.excel_toolkit import ExcelToolkit
from app.utils.toolkit.file_write_toolkit import FileToolkit
from app.utils.toolkit.google_calendar_toolkit import GoogleCalendarToolkit
from app.utils.toolkit.google_drive_mcp_toolkit import GoogleDriveMCPToolkit
from app.utils.toolkit.google_gmail_mcp_toolkit import GoogleGmailMCPToolkit
from app.utils.toolkit.human_toolkit import HumanToolkit
from app.utils.toolkit.markitdown_toolkit import MarkItDownToolkit
from app.utils.toolkit.mcp_search_toolkit import McpSearchToolkit
from app.utils.toolkit.note_taking_toolkit import NoteTakingToolkit
from app.utils.toolkit.notion_mcp_toolkit import NotionMCPToolkit
from app.utils.toolkit.pptx_toolkit import PPTXToolkit
from app.utils.toolkit.screenshot_toolkit import ScreenshotToolkit
from app.utils.toolkit.terminal_toolkit import TerminalToolkit
from app.utils.toolkit.github_toolkit import GithubToolkit
from app.utils.toolkit.search_toolkit import SearchToolkit
from app.utils.toolkit.video_download_toolkit import VideoDownloaderToolkit
from app.utils.toolkit.audio_analysis_toolkit import AudioAnalysisToolkit
from app.utils.toolkit.video_analysis_toolkit import VideoAnalysisToolkit
from app.utils.toolkit.image_analysis_toolkit import ImageAnalysisToolkit
from app.utils.toolkit.openai_image_toolkit import OpenAIImageToolkit
from app.utils.toolkit.web_deploy_toolkit import WebDeployToolkit
from app.utils.toolkit.whatsapp_toolkit import WhatsAppToolkit
from app.utils.toolkit.twitter_toolkit import TwitterToolkit
from app.utils.toolkit.linkedin_toolkit import LinkedInToolkit
from app.utils.toolkit.reddit_toolkit import RedditToolkit
from app.utils.toolkit.slack_toolkit import SlackToolkit
from camel.types import ModelPlatformType, ModelType
from camel.toolkits import MCPToolkit, ToolkitMessageIntegration
import datetime
from pydantic import BaseModel
from app.model.chat import Chat, McpServers

# Create traceroot logger for agent tracking
traceroot_logger = traceroot.get_logger("agent")
from app.service.task import (
    Action,
    ActionActivateAgentData,
    ActionActivateToolkitData,
    ActionBudgetNotEnough,
    ActionCreateAgentData,
    ActionDeactivateAgentData,
    ActionDeactivateToolkitData,
    Agents,
    get_task_lock,
)
from app.service.task import set_process_task

NOW_STR = datetime.datetime.now().strftime("%Y-%m-%d %H:00:00")

# Global counter for round-robin browser selection from pool
_browser_selection_counter = 0

# CDP Browser occupation management
class CdpBrowserPoolManager:
    """Manages CDP browser pool occupation to ensure parallel tasks use different browsers."""

    def __init__(self):
        self._occupied_ports = {}  # port -> session_id mapping
        self._lock = threading.Lock()

    def acquire_browser(self, cdp_browsers: list[dict], session_id: str) -> dict | None:
        """
        Acquire an available browser from the pool.

        Args:
            cdp_browsers: List of browser configurations
            session_id: Unique session identifier for this toolkit instance

        Returns:
            Browser configuration dict or None if no browsers available
        """
        with self._lock:
            # Find first unoccupied browser
            for browser in cdp_browsers:
                port = browser.get('port')
                if port and port not in self._occupied_ports:
                    self._occupied_ports[port] = session_id
                    traceroot_logger.info(
                        f"Acquired browser on port {port} for session {session_id}. "
                        f"Occupied: {list(self._occupied_ports.keys())}"
                    )
                    return browser

            traceroot_logger.warning(
                f"No available browsers in pool for session {session_id}. "
                f"All occupied: {list(self._occupied_ports.keys())}"
            )
            return None

    def release_browser(self, port: int, session_id: str):
        """
        Release a browser back to the pool.

        Args:
            port: Browser port to release
            session_id: Session identifier
        """
        with self._lock:
            if port in self._occupied_ports and self._occupied_ports[port] == session_id:
                del self._occupied_ports[port]
                traceroot_logger.info(
                    f"Released browser on port {port} from session {session_id}. "
                    f"Occupied: {list(self._occupied_ports.keys())}"
                )
            else:
                traceroot_logger.warning(
                    f"Attempted to release browser on port {port} but it was not occupied by {session_id}"
                )

    def get_occupied_ports(self) -> list[int]:
        """Get list of currently occupied ports."""
        with self._lock:
            return list(self._occupied_ports.keys())

# Global CDP browser pool manager instance
_cdp_pool_manager = CdpBrowserPoolManager()


class ListenChatAgent(ChatAgent):
    @traceroot.trace()
    def __init__(
        self,
        api_task_id: str,
        agent_name: str,
        system_message: BaseMessage | str | None = None,
        model: BaseModelBackend
        | ModelManager
        | Tuple[str, str]
        | str
        | ModelType
        | Tuple[ModelPlatformType, ModelType]
        | List[BaseModelBackend]
        | List[str]
        | List[ModelType]
        | List[Tuple[str, str]]
        | List[Tuple[ModelPlatformType, ModelType]]
        | None = None,
        memory: AgentMemory | None = None,
        message_window_size: int | None = None,
        token_limit: int | None = None,
        output_language: str | None = None,
        tools: List[FunctionTool | Callable[..., Any]] | None = None,
        toolkits_to_register_agent: List[RegisteredAgentToolkit] | None = None,
        external_tools: List[FunctionTool | Callable[..., Any] | Dict[str, Any]] | None = None,
        response_terminators: List[ResponseTerminator] | None = None,
        scheduling_strategy: str = "round_robin",
        max_iteration: int | None = None,
        agent_id: str | None = None,
        stop_event: Event | None = None,
        tool_execution_timeout: float | None = None,
        mask_tool_output: bool = False,
        pause_event: asyncio.Event | None = None,
        prune_tool_calls_from_memory: bool = False,
        enable_snapshot_clean: bool = False,
        step_timeout: float | None = 900,
    ) -> None:
        super().__init__(
            system_message=system_message,
            model=model,
            memory=memory,
            message_window_size=message_window_size,
            token_limit=token_limit,
            output_language=output_language,
            tools=tools,
            toolkits_to_register_agent=toolkits_to_register_agent,
            external_tools=external_tools,
            response_terminators=response_terminators,
            scheduling_strategy=scheduling_strategy,
            max_iteration=max_iteration,
            agent_id=agent_id,
            stop_event=stop_event,
            tool_execution_timeout=tool_execution_timeout,
            mask_tool_output=mask_tool_output,
            pause_event=pause_event,
            prune_tool_calls_from_memory=prune_tool_calls_from_memory,
            enable_snapshot_clean=enable_snapshot_clean,
            step_timeout=step_timeout,
        )
        self.api_task_id = api_task_id
        self.agent_name = agent_name

        # CDP management callbacks (set by search_agent)
        self._cdp_acquire_callback = None  # Called when cloning to acquire new CDP browser
        self._cdp_release_callback = None  # Called when agent is destroyed to release CDP browser

    process_task_id: str = ""

    @traceroot.trace()
    def step(
        self,
        input_message: BaseMessage | str,
        response_format: type[BaseModel] | None = None,
    ) -> ChatAgentResponse | StreamingChatAgentResponse:
        task_lock = get_task_lock(self.api_task_id)
        asyncio.create_task(
            task_lock.put_queue(
                ActionActivateAgentData(
                    data={
                        "agent_name": self.agent_name,
                        "process_task_id": self.process_task_id,
                        "agent_id": self.agent_id,
                        "message": input_message.content if isinstance(input_message, BaseMessage) else input_message,
                    },
                )
            )
        )
        error_info = None
        message = None
        res = None
        traceroot_logger.info(
            f"Agent {self.agent_name} starting step with message: {input_message.content if isinstance(input_message, BaseMessage) else input_message}"
        )
        try:
            res = super().step(input_message, response_format)
        except ModelProcessingError as e:
            res = None
            error_info = e
            if "Budget has been exceeded" in str(e):
                message = "Budget has been exceeded"
                traceroot_logger.warning(f"Agent {self.agent_name} budget exceeded")
                asyncio.create_task(task_lock.put_queue(ActionBudgetNotEnough()))
            else:
                message = str(e)
                traceroot_logger.error(f"Agent {self.agent_name} model processing error: {e}")
            total_tokens = 0
        except Exception as e:
            res = None
            error_info = e
            traceroot_logger.error(f"Agent {self.agent_name} unexpected error in step: {e}", exc_info=True)
            message = f"Error processing message: {e!s}"
            total_tokens = 0

        if res is not None:
            message = res.msg.content if res.msg else ""
            total_tokens = res.info["usage"]["total_tokens"]
            traceroot_logger.info(f"Agent {self.agent_name} completed step, tokens used: {total_tokens}")

        assert message is not None

        asyncio.create_task(
            task_lock.put_queue(
                ActionDeactivateAgentData(
                    data={
                        "agent_name": self.agent_name,
                        "process_task_id": self.process_task_id,
                        "agent_id": self.agent_id,
                        "message": message,
                        "tokens": total_tokens,
                    },
                )
            )
        )

        if error_info is not None:
            raise error_info
        assert res is not None
        return res

    @traceroot.trace()
    async def astep(
        self,
        input_message: BaseMessage | str,
        response_format: type[BaseModel] | None = None,
    ) -> ChatAgentResponse | AsyncStreamingChatAgentResponse:
        task_lock = get_task_lock(self.api_task_id)
        await task_lock.put_queue(
            ActionActivateAgentData(
                action=Action.activate_agent,
                data={
                    "agent_name": self.agent_name,
                    "process_task_id": self.process_task_id,
                    "agent_id": self.agent_id,
                    "message": input_message.content if isinstance(input_message, BaseMessage) else input_message,
                },
            )
        )

        error_info = None
        message = None
        res = None
        traceroot_logger.debug(
            f"Agent {self.agent_name} starting async step with message: {input_message.content if isinstance(input_message, BaseMessage) else input_message}"
        )

        try:
            res = await super().astep(input_message, response_format)
            if isinstance(res, AsyncStreamingChatAgentResponse):
                res = await res._get_final_response()
        except ModelProcessingError as e:
            res = None
            error_info = e
            if "Budget has been exceeded" in str(e):
                message = "Budget has been exceeded"
                traceroot_logger.warning(f"Agent {self.agent_name} budget exceeded")
                asyncio.create_task(task_lock.put_queue(ActionBudgetNotEnough()))
            else:
                message = str(e)
                traceroot_logger.error(f"Agent {self.agent_name} model processing error: {e}")
            total_tokens = 0
        except Exception as e:
            res = None
            error_info = e
            traceroot_logger.error(f"Agent {self.agent_name} unexpected error in async step: {e}", exc_info=True)
            message = f"Error processing message: {e!s}"
            total_tokens = 0

        if res is not None:
            message = res.msg.content if res.msg else ""
            total_tokens = res.info["usage"]["total_tokens"]
            traceroot_logger.info(f"Agent {self.agent_name} completed step, tokens used: {total_tokens}")

        assert message is not None

        asyncio.create_task(
            task_lock.put_queue(
                ActionDeactivateAgentData(
                    data={
                        "agent_name": self.agent_name,
                        "process_task_id": self.process_task_id,
                        "agent_id": self.agent_id,
                        "message": message,
                        "tokens": total_tokens,
                    },
                )
            )
        )

        if error_info is not None:
            raise error_info
        assert res is not None
        return res

    @traceroot.trace()
    def _execute_tool(self, tool_call_request: ToolCallRequest) -> ToolCallingRecord:
        func_name = tool_call_request.tool_name
        tool: FunctionTool = self._internal_tools[func_name]
        # Route async functions to async execution even if they have __wrapped__
        if asyncio.iscoroutinefunction(tool.func):
            # For async functions, we need to use the async execution path
            return asyncio.run(self._aexecute_tool(tool_call_request))

        # Handle all sync tools ourselves to maintain ContextVar context
        args = tool_call_request.args
        tool_call_id = tool_call_request.tool_call_id

        # Check if tool is wrapped by @listen_toolkit decorator
        # If so, the decorator will handle activate/deactivate events
        has_listen_decorator = hasattr(tool.func, "__wrapped__")

        try:
            task_lock = get_task_lock(self.api_task_id)

            toolkit_name = getattr(tool, "_toolkit_name") if hasattr(tool, "_toolkit_name") else "mcp_toolkit"
            traceroot_logger.debug(
                f"Agent {self.agent_name} executing tool: {func_name} from toolkit: {toolkit_name} with args: {json.dumps(args, ensure_ascii=False)}"
            )

            # Only send activate event if tool is NOT wrapped by @listen_toolkit
            if not has_listen_decorator:
                asyncio.create_task(
                    task_lock.put_queue(
                        ActionActivateToolkitData(
                            data={
                                "agent_name": self.agent_name,
                                "process_task_id": self.process_task_id,
                                "toolkit_name": toolkit_name,
                                "method_name": func_name,
                                "message": json.dumps(args, ensure_ascii=False),
                            },
                        )
                    )
                )
            # Set process_task context for all tool executions
            with set_process_task(self.process_task_id):
                raw_result = tool(**args)
            traceroot_logger.debug(f"Tool {func_name} executed successfully")
            if self.mask_tool_output:
                self._secure_result_store[tool_call_id] = raw_result
                result = (
                    "[The tool has been executed successfully, but the output"
                    " from the tool is masked. You can move forward]"
                )
                mask_flag = True
            else:
                result = raw_result
                mask_flag = False
            # Prepare result message with truncation
            if isinstance(result, str):
                result_msg = result
            else:
                result_str = repr(result)
                MAX_RESULT_LENGTH = 500
                if len(result_str) > MAX_RESULT_LENGTH:
                    result_msg = result_str[:MAX_RESULT_LENGTH] + f"... (truncated, total length: {len(result_str)} chars)"
                else:
                    result_msg = result_str

            # Only send deactivate event if tool is NOT wrapped by @listen_toolkit
            if not has_listen_decorator:
                asyncio.create_task(
                    task_lock.put_queue(
                        ActionDeactivateToolkitData(
                            data={
                                "agent_name": self.agent_name,
                                "process_task_id": self.process_task_id,
                                "toolkit_name": toolkit_name,
                                "method_name": func_name,
                                "message": result_msg,
                            },
                        )
                    )
                )
        except Exception as e:
            # Capture the error message to prevent framework crash
            error_msg = f"Error executing tool '{func_name}': {e!s}"
            result = f"Tool execution failed: {error_msg}"
            mask_flag = False
            traceroot_logger.error(f"Tool execution failed for {func_name}: {e}", exc_info=True)

        return self._record_tool_calling(
            func_name, args, result, tool_call_id,
            mask_output=mask_flag,
            extra_content=tool_call_request.extra_content,
        )

    @traceroot.trace()
    async def _aexecute_tool(self, tool_call_request: ToolCallRequest) -> ToolCallingRecord:
        func_name = tool_call_request.tool_name
        tool: FunctionTool = self._internal_tools[func_name]

        # Always handle tool execution ourselves to maintain ContextVar context
        args = tool_call_request.args
        tool_call_id = tool_call_request.tool_call_id
        task_lock = get_task_lock(self.api_task_id)

        # Check if tool is wrapped by @listen_toolkit decorator
        # If so, the decorator will handle activate/deactivate events
        has_listen_decorator = hasattr(tool.func, "__wrapped__")

        toolkit_name = getattr(tool, "_toolkit_name") if hasattr(tool, "_toolkit_name") else "mcp_toolkit"
        traceroot_logger.info(
            f"Agent {self.agent_name} executing async tool: {func_name} from toolkit: {toolkit_name} with args: {json.dumps(args, ensure_ascii=False)}"
        )

        # Only send activate event if tool is NOT wrapped by @listen_toolkit
        if not has_listen_decorator:
            await task_lock.put_queue(
                ActionActivateToolkitData(
                    data={
                        "agent_name": self.agent_name,
                        "process_task_id": self.process_task_id,
                        "toolkit_name": toolkit_name,
                        "method_name": func_name,
                        "message": json.dumps(args, ensure_ascii=False),
                    },
                )
            )
        try:
            # Set process_task context for all tool executions
            with set_process_task(self.process_task_id):
                # Try different invocation paths in order of preference
                if hasattr(tool, "func") and hasattr(tool.func, "async_call"):
                    # Case: FunctionTool wrapping an MCP tool
                    result = await tool.func.async_call(**args)

                elif hasattr(tool, "async_call") and callable(tool.async_call):
                    # Case: tool itself has async_call
                    result = await tool.async_call(**args)

                elif hasattr(tool, "func") and asyncio.iscoroutinefunction(tool.func):
                    # Case: tool wraps a direct async function
                    result = await tool.func(**args)

                elif asyncio.iscoroutinefunction(tool):
                    # Case: tool is itself a coroutine function
                    result = await tool(**args)

                else:
                    # Fallback: synchronous call - call directly in current context
                    # DO NOT use run_in_executor to preserve ContextVar
                    result = tool(**args)
                    # Handle case where synchronous call returns a coroutine
                    if asyncio.iscoroutine(result):
                        result = await result

        except Exception as e:
            # Capture the error message to prevent framework crash
            error_msg = f"Error executing async tool '{func_name}': {e!s}"
            result = {"error": error_msg}
            traceroot_logger.error(f"Async tool execution failed for {func_name}: {e}", exc_info=True)

        # Prepare result message with truncation
        if isinstance(result, str):
            result_msg = result
        else:
            result_str = repr(result)
            MAX_RESULT_LENGTH = 500
            if len(result_str) > MAX_RESULT_LENGTH:
                result_msg = result_str[:MAX_RESULT_LENGTH] + f"... (truncated, total length: {len(result_str)} chars)"
            else:
                result_msg = result_str

        # Only send deactivate event if tool is NOT wrapped by @listen_toolkit
        if not has_listen_decorator:
            await task_lock.put_queue(
                ActionDeactivateToolkitData(
                    data={
                        "agent_name": self.agent_name,
                        "process_task_id": self.process_task_id,
                        "toolkit_name": toolkit_name,
                        "method_name": func_name,
                        "message": result_msg,
                    },
                )
            )
        return self._record_tool_calling(
            func_name, args, result, tool_call_id,
            extra_content=tool_call_request.extra_content,
        )

    @traceroot.trace()
    def clone(self, with_memory: bool = False) -> ChatAgent:
        """Please see super.clone()"""
        import uuid

        # Generate unique clone ID for tracking
        clone_id = str(uuid.uuid4())[:8]

        # Get clone context (task info if available)
        task_context = "UNKNOWN"
        if hasattr(self, 'process_task_id') and self.process_task_id:
            task_context = f"task_id={self.process_task_id}"

        traceroot_logger.info(
            f"[CLONE START] Clone ID: {clone_id}, "
            f"Parent Agent: {self.agent_id}, "
            f"Agent Name: {self.agent_name}, "
            f"Context: {task_context}"
        )

        system_message = None if with_memory else self._original_system_message

        # If this agent has CDP acquire callback, acquire CDP BEFORE cloning tools
        # This ensures HybridBrowserToolkit clones with the correct CDP port
        new_cdp_port = None
        new_cdp_session = None

        if hasattr(self, '_cdp_acquire_callback') and callable(self._cdp_acquire_callback):
            # Temporarily store this for use during toolkit cloning
            import uuid
            new_cdp_session = str(uuid.uuid4())[:8]

            # Get the options from the parent agent (stored during agent creation)
            if hasattr(self, '_cdp_options'):
                options = self._cdp_options
                cdp_browsers = options.cdp_browsers if hasattr(options, 'cdp_browsers') else []

                if cdp_browsers:
                    from app.component.environment import env
                    selected_browser = _cdp_pool_manager.acquire_browser(cdp_browsers, new_cdp_session)

                    if selected_browser:
                        new_cdp_port = selected_browser.get('port', env('browser_port', '9222'))
                        traceroot_logger.info(
                            f"[CLONE {clone_id}] Pre-acquired CDP browser port={new_cdp_port} for session={new_cdp_session}"
                        )
                    else:
                        new_cdp_port = cdp_browsers[0].get('port', env('browser_port', '9222'))
                        traceroot_logger.warning(
                            f"[CLONE {clone_id}] No available browsers, using first: port={new_cdp_port}"
                        )

                    # Temporarily modify HybridBrowserToolkit's CDP config for cloning
                    if hasattr(self, '_browser_toolkit'):
                        toolkit = self._browser_toolkit
                        # Temporarily override the CDP URL for cloning
                        original_cdp_url = toolkit.config_loader.get_browser_config().cdp_url
                        original_ws_config_cdp = toolkit._ws_config.get('cdpUrl') if hasattr(toolkit, '_ws_config') else None

                        # Update both config_loader and _ws_config
                        toolkit.config_loader.get_browser_config().cdp_url = f"http://localhost:{new_cdp_port}"
                        if hasattr(toolkit, '_ws_config') and toolkit._ws_config:
                            toolkit._ws_config['cdpUrl'] = f"http://localhost:{new_cdp_port}"

                        # Store originals for restoration
                        toolkit._temp_original_cdp_url = original_cdp_url
                        toolkit._temp_original_ws_config_cdp = original_ws_config_cdp

                        traceroot_logger.info(
                            f"[CLONE {clone_id}] Temporarily set CDP URL to http://localhost:{new_cdp_port} for cloning "
                            f"(parent config was {original_cdp_url}, parent ws_config was {original_ws_config_cdp})"
                        )
                    else:
                        traceroot_logger.warning(f"[CLONE {clone_id}] No _browser_toolkit found on agent, CDP URL not modified")

        # Clone tools and collect toolkits that need registration
        traceroot_logger.info(f"[CLONE {clone_id}] Calling _clone_tools()...")
        cloned_tools, toolkits_to_register = self._clone_tools()
        traceroot_logger.info(f"[CLONE {clone_id}] _clone_tools returned {len(cloned_tools)} tools, {len(toolkits_to_register)} toolkits to register")
        for idx, tk in enumerate(toolkits_to_register):
            traceroot_logger.info(f"[CLONE {clone_id}] Toolkit {idx}: {tk.__class__.__name__}, session={getattr(tk, '_session_id', 'N/A')}")

        # Restore original CDP URL in parent toolkit
        if new_cdp_port is not None and hasattr(self, '_browser_toolkit'):
            toolkit = self._browser_toolkit
            if hasattr(toolkit, '_temp_original_cdp_url'):
                toolkit.config_loader.get_browser_config().cdp_url = toolkit._temp_original_cdp_url
                delattr(toolkit, '_temp_original_cdp_url')
            if hasattr(toolkit, '_temp_original_ws_config_cdp'):
                if toolkit._temp_original_ws_config_cdp and hasattr(toolkit, '_ws_config') and toolkit._ws_config:
                    toolkit._ws_config['cdpUrl'] = toolkit._temp_original_ws_config_cdp
                delattr(toolkit, '_temp_original_ws_config_cdp')
            traceroot_logger.info(f"[CLONE {clone_id}] Restored original CDP URL in parent toolkit")

        new_agent = ListenChatAgent(
            api_task_id=self.api_task_id,
            agent_name=self.agent_name,
            system_message=system_message,
            model=self.model_backend.models,  # Pass the existing model_backend
            memory=None,  # clone memory later
            message_window_size=getattr(self.memory, "window_size", None),
            token_limit=getattr(self.memory.get_context_creator(), "token_limit", None),
            output_language=self._output_language,
            tools=cloned_tools,
            toolkits_to_register_agent=toolkits_to_register,
            external_tools=[schema for schema in self._external_tool_schemas.values()],
            response_terminators=self.response_terminators,
            scheduling_strategy=self.model_backend.scheduling_strategy.__name__,
            max_iteration=self.max_iteration,
            stop_event=self.stop_event,
            tool_execution_timeout=self.tool_execution_timeout,
            mask_tool_output=self.mask_tool_output,
            pause_event=self.pause_event,
            prune_tool_calls_from_memory=self.prune_tool_calls_from_memory,
            step_timeout=self.step_timeout,
        )

        new_agent.process_task_id = self.process_task_id

        # Copy CDP management data to cloned agent
        new_agent._cdp_acquire_callback = self._cdp_acquire_callback
        new_agent._cdp_release_callback = self._cdp_release_callback
        if hasattr(self, '_cdp_options'):
            new_agent._cdp_options = self._cdp_options

        # Find and store the cloned browser toolkit on the new agent
        if toolkits_to_register:
            traceroot_logger.info(f"[CLONE {clone_id}] toolkits_to_register has {len(toolkits_to_register)} items")
            for toolkit in toolkits_to_register:
                toolkit_class_name = toolkit.__class__.__name__ if hasattr(toolkit, '__class__') else 'UNKNOWN'
                traceroot_logger.info(f"[CLONE {clone_id}] Checking toolkit: {toolkit_class_name}")
                if hasattr(toolkit, '__class__') and toolkit.__class__.__name__ == 'HybridBrowserToolkit':
                    new_agent._browser_toolkit = toolkit
                    traceroot_logger.info(f"[CLONE {clone_id}] Set _browser_toolkit to cloned HybridBrowserToolkit")
                    break
        else:
            traceroot_logger.warning(f"[CLONE {clone_id}] toolkits_to_register is empty!")

        # Set CDP info on cloned agent if we pre-acquired it
        if new_cdp_port is not None and new_cdp_session is not None:
            new_agent._cdp_port = new_cdp_port
            new_agent._cdp_session_id = new_cdp_session
            traceroot_logger.info(
                f"[CLONE {clone_id}] Set CDP info on new agent {new_agent.agent_id}: "
                f"port={new_cdp_port}, session={new_cdp_session}"
            )

            # Attach cleanup callback
            if hasattr(new_agent, '_cdp_release_callback') and callable(new_agent._cdp_release_callback):
                new_agent._cleanup_callback = lambda: new_agent._cdp_release_callback(new_agent)
        else:
            # If no CDP pre-acquisition, copy from parent
            if hasattr(self, '_cdp_port'):
                new_agent._cdp_port = self._cdp_port
            if hasattr(self, '_cdp_session_id'):
                new_agent._cdp_session_id = self._cdp_session_id

        # Copy memory if requested
        if with_memory:
            # Get all records from the current memory
            context_records = self.memory.retrieve()
            # Write them to the new agent's memory
            for context_record in context_records:
                new_agent.memory.write_record(context_record.memory_record)

        traceroot_logger.info(
            f"[CLONE COMPLETE] Clone ID: {clone_id}, "
            f"New Agent ID: {new_agent.agent_id}, "
            f"CDP Port: {new_cdp_port if new_cdp_port else 'N/A'}"
        )

        return new_agent


@traceroot.trace()
def agent_model(
    agent_name: str,
    system_message: str | BaseMessage,
    options: Chat,
    tools: list[FunctionTool | Callable] | None = None,
    prune_tool_calls_from_memory: bool = False,
    tool_names: list[str] | None = None,
    toolkits_to_register_agent: list[RegisteredAgentToolkit] | None = None,
    enable_snapshot_clean: bool = False,
    cleanup_callback: Callable[[], None] | None = None,
):
    task_lock = get_task_lock(options.project_id)
    agent_id = str(uuid.uuid4())
    traceroot_logger.info(f"Creating agent: {agent_name} with id: {agent_id} for project: {options.project_id}")
    asyncio.create_task(
        task_lock.put_queue(
            ActionCreateAgentData(data={"agent_name": agent_name, "agent_id": agent_id, "tools": tool_names or []})
        )
    )

    agent = ListenChatAgent(
        options.project_id,
        agent_name,
        system_message,
        model=ModelFactory.create(
            model_platform=options.model_platform,
            model_type=options.model_type,
            api_key=options.api_key,
            url=options.api_url,
            model_config_dict={
                "user": str(options.project_id),
                "parallel_tool_calls": False,
            }
            if options.is_cloud()
            else {
                "parallel_tool_calls": False,
            },
            **{
                k: v
                for k, v in (options.extra_params or {}).items()
                if k not in ["model_platform", "model_type", "api_key", "url"]
            },
        ),
        # output_language=options.language,
        tools=tools,
        agent_id=agent_id,
        prune_tool_calls_from_memory=prune_tool_calls_from_memory,
        toolkits_to_register_agent=toolkits_to_register_agent,
        enable_snapshot_clean=enable_snapshot_clean,
    )

    # Attach cleanup callback if provided
    if cleanup_callback:
        agent._cleanup_callback = cleanup_callback

    return agent


@traceroot.trace()
def question_confirm_agent(options: Chat):
    return agent_model(
        "question_confirm_agent",
        f"You are a highly capable agent. Your primary function is to analyze a user's request and determine the appropriate course of action. The current date is {NOW_STR}(Accurate to the hour). For any date-related tasks, you MUST use this as the current date.",
        options,
    )


@traceroot.trace()
def task_summary_agent(options: Chat):
    return agent_model(
        "task_summary_agent",
        "You are a helpful task assistant that can help users summarize the content of their tasks",
        options,
    )


@traceroot.trace()
async def developer_agent(options: Chat):
    working_directory = get_working_directory(options)
    traceroot_logger.info(f"Creating developer agent for project: {options.project_id} in directory: {working_directory}")
    message_integration = ToolkitMessageIntegration(
        message_handler=HumanToolkit(options.project_id, Agents.developer_agent).send_message_to_user
    )
    note_toolkit = NoteTakingToolkit(
        api_task_id=options.project_id, agent_name=Agents.developer_agent, working_directory=working_directory
    )
    note_toolkit = message_integration.register_toolkits(note_toolkit)
    web_deploy_toolkit = WebDeployToolkit(api_task_id=options.project_id)
    web_deploy_toolkit = message_integration.register_toolkits(web_deploy_toolkit)
    screenshot_toolkit = ScreenshotToolkit(options.project_id, working_directory=working_directory)
    screenshot_toolkit = message_integration.register_toolkits(screenshot_toolkit)

    terminal_toolkit = TerminalToolkit(options.project_id, Agents.document_agent, safe_mode=True, clone_current_env=False)
    terminal_toolkit = message_integration.register_toolkits(terminal_toolkit)
    tools = [
        *HumanToolkit.get_can_use_tools(options.project_id, Agents.developer_agent),
        *note_toolkit.get_tools(),
        *web_deploy_toolkit.get_tools(),
        *terminal_toolkit.get_tools(),
        *screenshot_toolkit.get_tools(),
    ]
    system_message = f"""
<role>
You are a Lead Software Engineer, a master-level coding assistant with a 
powerful and unrestricted terminal. Your primary role is to solve any 
technical task by writing and executing code, installing necessary libraries, 
interacting with the operating system, and deploying applications. You are the 
team's go-to expert for all technical implementation.
</role>

<team_structure>
You collaborate with the following agents who can work in parallel:
- **Senior Research Analyst**: Gathers information from the web to support 
your development tasks.
- **Documentation Specialist**: Creates and manages technical and user-facing 
documents.
- **Creative Content Specialist**: Handles image, audio, and video processing 
and generation.
</team_structure>

<operating_environment>
- **System**: {platform.system()} ({platform.machine()})
- **Working Directory**: `{working_directory}`. All local file operations must 
occur here, but you can access files from any place in the file system. For all file system operations, you MUST use absolute paths to ensure precision and avoid ambiguity.
The current date is {NOW_STR}(Accurate to the hour). For any date-related tasks, you MUST use this as the current date.
</operating_environment>

<mandatory_instructions>
- You MUST use the `read_note` tool to read the ALL notes from other agents.

- When you complete your task, your final response must be a comprehensive
summary of your work and the outcome, presented in a clear, detailed, and
easy-to-read format. Avoid using markdown tables for presenting data; use
plain text formatting instead.
<mandatory_instructions>

<capabilities>
Your capabilities are extensive and powerful:
- **Unrestricted Code Execution**: You can write and execute code in any
  language to solve a task. You MUST first save your code to a file (e.g.,
  `script.py`) and then run it from the terminal (e.g.,
  `python script.py`).
- **Full Terminal Control**: You have root-level access to the terminal. You
  can run any command-line tool, manage files, and interact with the OS. If
  a tool is missing, you MUST install it with the appropriate package manager
  (e.g., `pip3`, `uv`, or `apt-get`). Your capabilities include:
    - **Text & Data Processing**: `awk`, `sed`, `grep`, `jq`.
    - **File System & Execution**: `find`, `xargs`, `tar`, `zip`, `unzip`,
      `chmod`.
    - **Networking & Web**: `curl`, `wget` for web requests; `ssh` for
      remote access.
- **Screen Observation**: You can take screenshots to analyze GUIs and visual
  context, enabling you to perform tasks that require sight.
- **Desktop Automation**: You can control desktop applications
  programmatically.
  - **On macOS**, you MUST prioritize using **AppleScript** for its robust
    control over native applications. Execute simple commands with
    `osascript -e '...'` or run complex scripts from a `.scpt` file.
  - **On other systems**, use **pyautogui** for cross-platform GUI
    automation.
  - **IMPORTANT**: Always complete the full automation workflow—do not just
    prepare or suggest actions. Execute them to completion.
- **Solution Verification**: You can immediately test and verify your
  solutions by executing them in the terminal.
- **Web Deployment**: You can deploy web applications and content, serve
  files, and manage deployments.
- **Human Collaboration**: If you are stuck or need clarification, you can
  ask for human input via the console.
- **Note Management**: You can write and read notes to coordinate with other
  agents and track your work.
</capabilities>

<philosophy>
- **Bias for Action**: Your purpose is to take action. Don't just suggest
solutions—implement them. Write code, run commands, and build things.
- **Complete the Full Task**: When automating GUI applications, always finish
what you start. If the task involves sending something, send it. If it
involves submitting data, submit it. Never stop at just preparing or
drafting—execute the complete workflow to achieve the desired outcome.
- **Embrace Challenges**: Never say "I can't." If you
encounter a limitation, find a way to overcome it.
- **Resourcefulness**: If a tool is missing, install it. If information is
lacking, find it. You have the full power of a terminal to acquire any
resource you need.
- **Think Like an Engineer**: Approach problems methodically. Analyze
requirements, execute it, and verify the results. Your
strength lies in your ability to engineer solutions.
</philosophy>

<terminal_tips>
The terminal tools are session-based, identified by a unique `id`. Master
these tips to maximize your effectiveness:

- **GUI Automation Strategy**:
  - **AppleScript (macOS Priority)**: For robust control of macOS apps, use
    `osascript`.
    - Example (open Slack):
      `osascript -e 'tell application "Slack" to activate'`
    - Example (run script file): `osascript my_script.scpt`
  - **pyautogui (Cross-Platform)**: For other OSes or simple automation.
    - Key functions: `pyautogui.click(x, y)`, `pyautogui.typewrite("text")`,
      `pyautogui.hotkey('ctrl', 'c')`, `pyautogui.press('enter')`.
    - Safety: Always use `time.sleep()` between actions to ensure stability
      and add `pyautogui.FAILSAFE = True` to your scripts.
    - Workflow: Your scripts MUST complete the entire task, from start to
      final submission.

- **Command-Line Best Practices**:
  - **Be Creative**: The terminal is your most powerful tool. Use it boldly.
  - **Automate Confirmation**: Use `-y` or `-f` flags to avoid interactive
    prompts.
  - **Manage Output**: Redirect long outputs to a file (e.g., `> output.txt`).
  - **Chain Commands**: Use `&&` to link commands for sequential execution.
  - **Piping**: Use `|` to pass output from one command to another.
  - **Permissions**: Use `ls -F` to check file permissions.
  - **Installation**: Use `pip3 install` or `apt-get install` for new
    packages.

- Stop a Process: If a process needs to be terminated, use
    `shell_kill_process(id="...")`.
</terminal_tips>

<collaboration_and_assistance>
- If you get stuck, encounter an issue you cannot solve (like a CAPTCHA),
    or need clarification, use the `ask_human_via_console` tool.
- Document your progress and findings in notes so other agents can build
    upon your work.
</collaboration_and_assistance>
"""

    return agent_model(
        Agents.developer_agent,
        BaseMessage.make_assistant_message(
            role_name="Developer Agent",
            content=system_message,
        ),
        options,
        tools,
        tool_names=[
            HumanToolkit.toolkit_name(),
            TerminalToolkit.toolkit_name(),
            NoteTakingToolkit.toolkit_name(),
            WebDeployToolkit.toolkit_name(),
        ],
    )


@traceroot.trace()
def search_agent(options: Chat):
    working_directory = get_working_directory(options)
    traceroot_logger.info(f"Creating search agent for project: {options.project_id} in directory: {working_directory}")
    message_integration = ToolkitMessageIntegration(
        message_handler=HumanToolkit(options.project_id, Agents.search_agent).send_message_to_user
    )

    # Build task-specific log directory path for browser logs
    import re
    from pathlib import Path
    email_sanitized = re.sub(r'[\\/*?:"<>|\s]', "_", options.email.split("@")[0]).strip(".")
    task_log_dir = (
        Path.home()
        / ".eigent"
        / email_sanitized
        / f"project_{options.project_id}"
        / f"task_{options.task_id}"
    )

    # Define CDP acquire callback for cloning
    def acquire_cdp_for_agent(agent):
        """Acquire a CDP browser from pool and create new toolkit for the agent."""
        # Generate unique session ID for this agent clone
        session_id = str(uuid.uuid4())[:8]

        selected_port = None
        selected_is_external = False

        if hasattr(options, 'cdp_browsers') and options.cdp_browsers and len(options.cdp_browsers) > 0:
            # Try to acquire an available browser from the pool
            selected_browser = _cdp_pool_manager.acquire_browser(options.cdp_browsers, session_id)

            if selected_browser:
                selected_port = selected_browser.get('port', env('browser_port', '9222'))
                selected_is_external = selected_browser.get('isExternal', False)
                traceroot_logger.info(
                    f"Acquired CDP browser from pool for agent {agent.agent_id}: "
                    f"port={selected_port}, isExternal={selected_is_external}, "
                    f"name={selected_browser.get('name', 'Unnamed')}, session_id={session_id}"
                )
            else:
                # No available browsers in pool, fall back to first browser
                selected_port = options.cdp_browsers[0].get('port', env('browser_port', '9222'))
                selected_is_external = options.cdp_browsers[0].get('isExternal', False)
                traceroot_logger.warning(
                    f"No available browsers in pool for agent {agent.agent_id}, "
                    f"using first browser: port={selected_port}, session_id={session_id}"
                )
        else:
            # Use default port from environment
            selected_port = env('browser_port', '9222')
            selected_is_external = False
            traceroot_logger.info(
                f"Using default CDP port for agent {agent.agent_id}: "
                f"{selected_port}, session_id={session_id}"
            )

        # Create new HybridBrowserToolkit with the acquired CDP port
        use_keep_current_page = True
        default_url = None

        new_toolkit = HybridBrowserToolkit(
            options.project_id,
            headless=False,
            browser_log_to_file=True,
            stealth=True,
            session_id=session_id,
            log_dir=str(task_log_dir),
            default_start_url=default_url,
            connect_over_cdp=True,
            cdp_url=f"http://localhost:{selected_port}",
            cdp_keep_current_page=use_keep_current_page,
            enabled_tools=[
                "browser_open",
                "browser_click",
                "browser_type",
                "browser_back",
                "browser_forward",
                "browser_switch_tab",
                "browser_enter",
                "browser_visit_page",
                "browser_get_page_snapshot"
            ],
        )

        # Store CDP info on toolkit
        new_toolkit._cdp_port = selected_port
        new_toolkit._cdp_session_id = session_id

        # Replace the old toolkit in agent's registered toolkits
        if hasattr(agent, '_toolkits_to_register_agent') and agent._toolkits_to_register_agent:
            for i, toolkit in enumerate(agent._toolkits_to_register_agent):
                if hasattr(toolkit, '__class__') and toolkit.__class__.__name__ == 'HybridBrowserToolkit':
                    agent._toolkits_to_register_agent[i] = new_toolkit
                    traceroot_logger.info(
                        f"Replaced HybridBrowserToolkit for agent {agent.agent_id}: "
                        f"new port={selected_port}, session_id={session_id}"
                    )
                    break

        # Update agent's tools to use the new toolkit
        new_tools = new_toolkit.get_tools()
        if hasattr(agent, '_tools') and agent._tools:
            # Replace browser tools in agent's tool list
            agent._tools = [
                tool for tool in agent._tools
                if not any(name in tool.get_function_name() for name in [
                    'browser_open', 'browser_click', 'browser_type', 'browser_back',
                    'browser_forward', 'browser_switch_tab', 'browser_enter',
                    'browser_visit_page', 'browser_get_page_snapshot'
                ])
            ]
            agent._tools.extend(new_tools)
            traceroot_logger.info(f"Updated agent {agent.agent_id} tools with new browser toolkit")

        # Store CDP info on agent for cleanup
        agent._cdp_port = selected_port
        agent._cdp_session_id = session_id

    # Define CDP release callback
    def release_cdp_from_agent(agent):
        """Release CDP browser back to pool."""
        if hasattr(agent, '_cdp_port') and hasattr(agent, '_cdp_session_id'):
            port = agent._cdp_port
            session_id = agent._cdp_session_id
            _cdp_pool_manager.release_browser(port, session_id)
            traceroot_logger.info(
                f"Released CDP browser for agent {agent.agent_id}: "
                f"port={port}, session_id={session_id}"
            )

    # Acquire CDP for initial agent
    toolkit_session_id = str(uuid.uuid4())[:8]
    selected_port = None
    selected_is_external = False

    if hasattr(options, 'cdp_browsers') and options.cdp_browsers and len(options.cdp_browsers) > 0:
        selected_browser = _cdp_pool_manager.acquire_browser(options.cdp_browsers, toolkit_session_id)
        if selected_browser:
            selected_port = selected_browser.get('port', env('browser_port', '9222'))
            selected_is_external = selected_browser.get('isExternal', False)
            traceroot_logger.info(
                f"Acquired CDP browser from pool (initial): port={selected_port}, "
                f"isExternal={selected_is_external}, "
                f"name={selected_browser.get('name', 'Unnamed')}, session_id={toolkit_session_id}"
            )
        else:
            selected_port = options.cdp_browsers[0].get('port', env('browser_port', '9222'))
            selected_is_external = options.cdp_browsers[0].get('isExternal', False)
            traceroot_logger.warning(
                f"No available browsers in pool (initial), using first browser: "
                f"port={selected_port}, session_id={toolkit_session_id}"
            )
    else:
        selected_port = env('browser_port', '9222')
        selected_is_external = False
        traceroot_logger.info(f"Using default CDP port (initial): {selected_port}, session_id={toolkit_session_id}")

    # IMPORTANT: Always use cdp_keep_current_page=True to preserve browser state
    # across tasks (both internal and external browsers)
    use_keep_current_page = True

    # When cdp_keep_current_page=True, don't set default_start_url to avoid
    # opening a new page and conflicting with keeping the current page
    default_url = None

    web_toolkit_custom = HybridBrowserToolkit(
        options.project_id,
        headless=False,
        browser_log_to_file=True,
        stealth=True,
        session_id=toolkit_session_id,  # Use the session ID for pool management
        log_dir=str(task_log_dir),
        default_start_url=default_url,
        connect_over_cdp=True,
        cdp_url=f"http://localhost:{selected_port}",
        cdp_keep_current_page=use_keep_current_page,
        enabled_tools=[
            "browser_open",
            "browser_click",
            "browser_type",
            "browser_back",
            "browser_forward",
            "browser_switch_tab",
            "browser_enter",
            "browser_visit_page",
            "browser_get_page_snapshot"
            # "browser_scroll",
            # "browser_get_page_snapshot",
        ],
    )

    # Store CDP port and session ID on the toolkit for cleanup
    web_toolkit_custom._cdp_port = selected_port
    web_toolkit_custom._cdp_session_id = toolkit_session_id

    # Register toolkit with message_integration
    # DISABLED: message_integration causes parameter mismatch errors after fixing clone
    # The wrapper is lost during toolkit cloning, causing tools to reject message_title parameter
    # web_toolkit_custom = message_integration.register_toolkits(web_toolkit_custom)
    # Use the registered (wrapped) toolkit for both tools and agent registration
    web_toolkit_for_agent_registration = web_toolkit_custom
    terminal_toolkit = TerminalToolkit(options.project_id, Agents.search_agent, safe_mode=True, clone_current_env=False)
    terminal_toolkit = message_integration.register_functions([terminal_toolkit.shell_exec])
    note_toolkit = NoteTakingToolkit(options.project_id, Agents.search_agent, working_directory=working_directory)
    note_toolkit = message_integration.register_toolkits(note_toolkit)
    search_tools = SearchToolkit.get_can_use_tools(options.project_id)
    # Only register search tools if any are available
    if search_tools:
        search_tools = message_integration.register_functions(search_tools)
    else:
        search_tools = []

    tools = [
        *HumanToolkit.get_can_use_tools(options.project_id, Agents.search_agent),
        *web_toolkit_custom.get_tools(),
        *terminal_toolkit,
        *note_toolkit.get_tools(),
        *search_tools,
    ]

    # Build external browser connection notice if using external CDP
    external_browser_notice = ""
    if selected_is_external:
        external_browser_notice = """
<external_browser_connection>
**IMPORTANT**: You are connected to an external browser instance. The browser may already be open with active sessions and logged-in websites. When you use `browser_open`, you will connect to this existing browser and can immediately access its current state and pages. The user may have already logged into required websites, so you can leverage these authenticated sessions.
</external_browser_connection>
"""

    system_message = f"""
<role>
You are a Senior Research Analyst, a key member of a multi-agent team. Your
primary responsibility is to conduct expert-level web research to gather,
analyze, and document information required to solve the user's task. You
operate with precision, efficiency, and a commitment to data quality.
You must use the search/browser tools to get the information you need.
</role>

<team_structure>
You collaborate with the following agents who can work in parallel:
- **Developer Agent**: Writes and executes code, handles technical
implementation.
- **Document Agent**: Creates and manages documents and presentations.
- **Multi-Modal Agent**: Processes and generates images and audio.
Your research is the foundation of the team's work. Provide them with
comprehensive and well-documented information.
</team_structure>

<operating_environment>
- **System**: {platform.system()} ({platform.machine()})
- **Working Directory**: `{working_directory}`. All local file operations must
occur here, but you can access files from any place in the file system. For all file system operations, you MUST use absolute paths to ensure precision and avoid ambiguity.
The current date is {NOW_STR}(Accurate to the hour). For any date-related tasks, you MUST use this as the current date.
</operating_environment>

<mandatory_instructions>
- You MUST use the note-taking tools to record your findings. This is a
    critical part of your role. Your notes are the primary source of
    information for your teammates. To avoid information loss, you must not
    summarize your findings. Instead, record all information in detail.
    For every piece of information you gather, you must:
    1.  **Extract ALL relevant details**: Quote all important sentences,
        statistics, or data points. Your goal is to capture the information
        as completely as possible.
    2.  **Cite your source**: Include the exact URL where you found the
        information.
    Your notes should be a detailed and complete record of the information
    you have discovered. High-quality, detailed notes are essential for the
    team's success.

- **CRITICAL URL POLICY**: You are STRICTLY FORBIDDEN from inventing,
    guessing, or constructing URLs yourself. You MUST only use URLs from
    trusted sources:
    1. URLs returned by search tools (`search_google`)
    2. URLs found on webpages you have visited through browser tools
    3. URLs provided by the user in their request
    Fabricating or guessing URLs is considered a critical error and must
    never be done under any circumstances.

- You MUST NOT answer from your own knowledge. All information
    MUST be sourced from the web using the available tools. If you don't know
    something, find it out using your tools.

- When you complete your task, your final response must be a comprehensive
    summary of your findings, presented in a clear, detailed, and
    easy-to-read format. Avoid using markdown tables for presenting data;
    use plain text formatting instead.
<mandatory_instructions>

<capabilities>
Your capabilities include:
- Search and get information from the web using the search tools.
- Use the rich browser related toolset to investigate websites.
- Use the terminal tools to perform local operations. You can leverage
    powerful CLI tools like `grep` for searching within files, `curl` and
    `wget` for downloading content, and `jq` for parsing JSON data from APIs.
- Use the note-taking tools to record your findings.
- Use the human toolkit to ask for help when you are stuck.
</capabilities>

<web_search_workflow>
Your approach depends on available search tools:
{external_browser_notice}
**Common Browser Operations (both scenarios):**
- **Navigation and Exploration**: Use `browser_visit_page` to open URLs.
    `browser_visit_page` provides a snapshot of currently visible
    interactive elements, not the full page text. To see more content on
    long pages, Navigate with `browser_click`, `browser_back`, and
    `browser_forward`. Manage multiple pages with `browser_switch_tab`.

- **Analysis**: Use `browser_get_page_snapshot` to understand the page
    layout and identify interactive elements. Since this is a heavy
    operation, only use it when visual analysis is necessary.

- **Interaction**: Use `browser_type` to fill out forms and
    `browser_enter` to submit or confirm search.

- In your response, you should mention the URLs you have visited and processed.

- When encountering verification challenges (like login, CAPTCHAs or
    robot checks), you MUST request help using the human toolkit.
</web_search_workflow>
<Details in interaction>
When you select name in salesforce new event, please select the corresponding option after input to confirm, If you only input the name, it would not been confirmed.
</Details in interaction>rest    """

    # Define cleanup callback to release CDP browser back to pool
    def cleanup_cdp_browser():
        if hasattr(web_toolkit_custom, '_cdp_port') and hasattr(web_toolkit_custom, '_cdp_session_id'):
            port = web_toolkit_custom._cdp_port
            session_id = web_toolkit_custom._cdp_session_id
            _cdp_pool_manager.release_browser(port, session_id)
            traceroot_logger.info(
                f"Cleanup: Released CDP browser on port {port} for session {session_id}"
            )

    agent = agent_model(
        Agents.search_agent,
        BaseMessage.make_assistant_message(
            role_name="Search Agent",
            content=system_message,
        ),
        options,
        tools,
        prune_tool_calls_from_memory=True,
        tool_names=[
            SearchToolkit.toolkit_name(),
            HybridBrowserToolkit.toolkit_name(),
            HumanToolkit.toolkit_name(),
            NoteTakingToolkit.toolkit_name(),
            TerminalToolkit.toolkit_name(),
        ],
        toolkits_to_register_agent=[web_toolkit_for_agent_registration],
        enable_snapshot_clean=True,
        cleanup_callback=cleanup_cdp_browser,
    )

    # Attach CDP management callbacks to the agent for clone support
    agent._cdp_acquire_callback = acquire_cdp_for_agent
    agent._cdp_release_callback = release_cdp_from_agent
    agent._cdp_port = selected_port
    agent._cdp_session_id = toolkit_session_id
    # Store options for use during cloning
    agent._cdp_options = options
    # Store browser toolkit reference for CDP URL modification during cloning
    agent._browser_toolkit = web_toolkit_for_agent_registration

    return agent


@traceroot.trace()
async def document_agent(options: Chat):
    working_directory = get_working_directory(options)
    traceroot_logger.info(f"Creating document agent for project: {options.project_id} in directory: {working_directory}")
    message_integration = ToolkitMessageIntegration(
        message_handler=HumanToolkit(options.project_id, Agents.task_agent).send_message_to_user
    )
    file_write_toolkit = FileToolkit(options.project_id, working_directory=working_directory)
    pptx_toolkit = PPTXToolkit(options.project_id, working_directory=working_directory)
    pptx_toolkit = message_integration.register_toolkits(pptx_toolkit)
    mark_it_down_toolkit = MarkItDownToolkit(options.project_id)
    mark_it_down_toolkit = message_integration.register_toolkits(mark_it_down_toolkit)
    excel_toolkit = ExcelToolkit(options.project_id, working_directory=working_directory)
    excel_toolkit = message_integration.register_toolkits(excel_toolkit)
    note_toolkit = NoteTakingToolkit(options.project_id, Agents.document_agent, working_directory=working_directory)
    note_toolkit = message_integration.register_toolkits(note_toolkit)
    terminal_toolkit = TerminalToolkit(options.project_id, Agents.document_agent, safe_mode=True, clone_current_env=False)
    terminal_toolkit = message_integration.register_toolkits(terminal_toolkit)
    tools = [
        *file_write_toolkit.get_tools(),
        *pptx_toolkit.get_tools(),
        *HumanToolkit.get_can_use_tools(options.project_id, Agents.document_agent),
        *mark_it_down_toolkit.get_tools(),
        *excel_toolkit.get_tools(),
        *note_toolkit.get_tools(),
        *terminal_toolkit.get_tools(),
        *await GoogleDriveMCPToolkit.get_can_use_tools(options.project_id, options.get_bun_env()),
    ]
    # if env("EXA_API_KEY") or options.is_cloud():
    #     search_toolkit = SearchToolkit(options.project_id, Agents.document_agent).search_exa
    #     search_toolkit = message_integration.register_functions([search_toolkit])
    #     tools.extend(search_toolkit)
    system_message = f"""
<role>
You are a Documentation Specialist, responsible for creating, modifying, and 
managing a wide range of documents. Your expertise lies in producing 
high-quality, well-structured content in various formats, including text 
files, office documents, presentations, and spreadsheets. You are the team's 
authority on all things related to documentation.
</role>

<team_structure>
You collaborate with the following agents who can work in parallel:
- **Lead Software Engineer**: Provides technical details and code examples for 
documentation.
- **Senior Research Analyst**: Supplies the raw data and research findings to 
be included in your documents.
- **Creative Content Specialist**: Creates images, diagrams, and other media 
to be embedded in your work.
</team_structure>

<operating_environment>
- **System**: {platform.system()} ({platform.machine()})
- **Working Directory**: `{working_directory}`. All local file operations must 
occur here, but you can access files from any place in the file system. For all file system operations, you MUST use absolute paths to ensure precision and avoid ambiguity.
The current date is {NOW_STR}(Accurate to the hour). For any date-related tasks, you MUST use this as the current date.
</operating_environment>

<mandatory_instructions>
- Before creating any document, you MUST use the `read_note` tool to gather
    all information collected by other team members by reading ALL notes.

- You MUST use the available tools to create or modify documents (e.g.,
    `write_to_file`, `create_presentation`). Your primary output should be
    a file, not just content within your response.

- If there's no specified format for the document/report/paper, you should use 
    the `write_to_file` tool to create a HTML file.

- If the document has many data, you MUST use the terminal tool to
    generate charts and graphs and add them to the document.

- When you complete your task, your final response must be a summary of
    your work and the path to the final document, presented in a clear,
    detailed, and easy-to-read format. Avoid using markdown tables for
    presenting data; use plain text formatting instead.
</mandatory_instructions>

<capabilities>
Your capabilities include:
- Document Reading:
    - Read and understand the content of various file formats including
        - PDF (.pdf)
        - Microsoft Office: Word (.doc, .docx), Excel (.xls, .xlsx),
          PowerPoint (.ppt, .pptx)
        - EPUB (.epub)
        - HTML (.html, .htm)
        - Images (.jpg, .jpeg, .png) for OCR
        - Audio (.mp3, .wav) for transcription
        - Text-based formats (.csv, .json, .xml, .txt)
        - ZIP archives (.zip) using the `read_files` tool.

- Document Creation & Editing:
    - Create and write to various file formats including Markdown (.md),
    Word documents (.docx), PDFs, CSV files, JSON, YAML, and HTML using
    UTF-8 encoding for default.
    - Apply formatting options including custom encoding, font styles, and
    layout settings
    - Modify existing files with automatic backup functionality
    - Support for mathematical expressions in PDF documents through LaTeX
    rendering

- PowerPoint Presentation Creation:
    - Create professional PowerPoint presentations with title slides and
    content slides
    - Format text with bold and italic styling
    - Create bullet point lists with proper hierarchical structure
    - Support for step-by-step process slides with visual indicators
    - Create tables with headers and rows of data
    - Support for custom templates and slide layouts
    - IMPORTANT: The `create_presentation` tool requires content to be a JSON
    string, not plain text. You must format your content as a JSON array of
    slide objects, then use `json.dumps()` to convert it to a string. Example:
      ```python
      import json
      slides = [
          {{"title": "Main Title", "subtitle": "Subtitle"}},
          {{"heading": "Slide Title", "bullet_points": ["Point 1", "Point 2"]}},
          {{"heading": "Data", "table": {{"headers": ["Col1", "Col2"], "rows": [["A", "B"]]}}}}
      ]
      content_json = json.dumps(slides)
      create_presentation(content=content_json, filename="presentation.pptx")
      ```

- Excel Spreadsheet Management:
    - Extract and analyze content from Excel files (.xlsx, .xls, .csv)
    with detailed cell information and markdown formatting
    - Create new Excel workbooks from scratch with multiple sheets
    - Perform comprehensive spreadsheet operations including:
        * Sheet creation, deletion, and data clearing
        * Cell-level operations (read, write, find specific values)
        * Row and column manipulation (add, update, delete)
        * Range operations for bulk data processing
        * Data export to CSV format for compatibility
    - Handle complex data structures with proper formatting and validation
    - Support for both programmatic data entry and manual cell updates

- Terminal and File System:
    - You have access to a full suite of terminal tools to interact with
    the file system within your working directory (`{working_directory}`).
    - You can execute shell commands (`shell_exec`), list files, and manage
    your workspace as needed to support your document creation tasks. To
    process and manipulate text and data for your documents, you can use
    powerful CLI tools like `awk`, `sed`, `grep`, and `jq`. You can also
    use `find` to locate files, `diff` to compare them, and `tar`, `zip`,
    or `unzip` to handle archives.
    - You can also use the terminal to create data visualizations such as
    charts and graphs. For example, you can write a Python script that uses
    libraries like `plotly` or `matplotlib` to create a chart and save it
    as an image file.

- Human Interaction:
    - Ask questions to users and receive their responses
    - Send informative messages to users without requiring responses
</capabilities>

<document_creation_workflow>
When working with documents, you should:
- Suggest appropriate file formats based on content requirements
- Maintain proper formatting and structure in all created documents
- Provide clear feedback about document creation and modification processes
- Ask clarifying questions when user requirements are ambiguous
- Recommend best practices for document organization and presentation
- For PowerPoint presentations, ALWAYS convert your slide content to JSON
  format before calling `create_presentation`. Never pass plain text or
  instructions - only properly formatted JSON strings as shown in the
  capabilities section
- For Excel files, always provide clear data structure and organization
- When creating spreadsheets, consider data relationships and use
appropriate sheet naming conventions
- To include data visualizations, write and execute Python scripts using
  the terminal. Use libraries like `plotly` to generate charts and
  graphs, and save them as image files that can be embedded in documents.
</document_creation_workflow>

Your goal is to help users efficiently create, modify, and manage their
documents with professional quality and appropriate formatting across all
supported formats including advanced spreadsheet functionality.
"""

    return agent_model(
        Agents.document_agent,
        BaseMessage.make_assistant_message(
            role_name="Document Agent",
            content=system_message,
        ),
        options,
        tools,
        tool_names=[
            FileToolkit.toolkit_name(),
            PPTXToolkit.toolkit_name(),
            HumanToolkit.toolkit_name(),
            MarkItDownToolkit.toolkit_name(),
            ExcelToolkit.toolkit_name(),
            NoteTakingToolkit.toolkit_name(),
            TerminalToolkit.toolkit_name(),
            GoogleDriveMCPToolkit.toolkit_name(),
        ],
    )


@traceroot.trace()
def multi_modal_agent(options: Chat):
    working_directory = get_working_directory(options)
    traceroot_logger.info(f"Creating multi-modal agent for project: {options.project_id} in directory: {working_directory}")
    message_integration = ToolkitMessageIntegration(
        message_handler=HumanToolkit(options.project_id, Agents.multi_modal_agent).send_message_to_user
    )
    video_download_toolkit = VideoDownloaderToolkit(options.project_id, working_directory=working_directory)
    video_download_toolkit = message_integration.register_toolkits(video_download_toolkit)
    image_analysis_toolkit = ImageAnalysisToolkit(options.project_id)
    image_analysis_toolkit = message_integration.register_toolkits(image_analysis_toolkit)

    terminal_toolkit = TerminalToolkit(
        options.project_id, agent_name=Agents.multi_modal_agent, safe_mode=True, clone_current_env=False
    )
    terminal_toolkit = message_integration.register_toolkits(terminal_toolkit)
    note_toolkit = NoteTakingToolkit(options.project_id, Agents.multi_modal_agent, working_directory=working_directory)
    note_toolkit = message_integration.register_toolkits(note_toolkit)
    tools = [
        *video_download_toolkit.get_tools(),
        *image_analysis_toolkit.get_tools(),
        *HumanToolkit.get_can_use_tools(options.project_id, Agents.multi_modal_agent),
        *terminal_toolkit.get_tools(),
        *note_toolkit.get_tools(),
    ]
    if options.is_cloud():
        open_ai_image_toolkit = OpenAIImageToolkit(  # todo check llm has this model
            options.project_id,
            model="dall-e-3",
            response_format="b64_json",
            size="1024x1024",
            quality="standard",
            working_directory=working_directory,
            api_key=options.api_key,
            url=options.api_url,
        )
        open_ai_image_toolkit = message_integration.register_toolkits(open_ai_image_toolkit)
        tools = [
            *tools,
            *open_ai_image_toolkit.get_tools(),
        ]
    # Convert string model_platform to enum for comparison
    try:
        model_platform_enum = ModelPlatformType(options.model_platform.lower())
    except (ValueError, AttributeError):
        model_platform_enum = None

    if model_platform_enum == ModelPlatformType.OPENAI:
        audio_analysis_toolkit = AudioAnalysisToolkit(
            options.project_id,
            working_directory,
            OpenAIAudioModels(
                api_key=options.api_key,
                url=options.api_url,
            ),
        )
        audio_analysis_toolkit = message_integration.register_toolkits(audio_analysis_toolkit)
        tools.extend(audio_analysis_toolkit.get_tools())

    # if env("EXA_API_KEY") or options.is_cloud():
    #     search_toolkit = SearchToolkit(options.project_id, Agents.multi_modal_agent).search_exa
    #     search_toolkit = message_integration.register_functions([search_toolkit])
    #     tools.extend(search_toolkit)

    system_message = f"""
<role>
You are a Creative Content Specialist, specializing in analyzing and 
generating various types of media content. Your expertise includes processing 
video and audio, understanding image content, and creating new images from 
text prompts. You are the team's expert for all multi-modal tasks.
</role>

<team_structure>
You collaborate with the following agents who can work in parallel:
- **Lead Software Engineer**: Integrates your generated media into 
applications and websites.
- **Senior Research Analyst**: Provides the source material and context for 
your analysis and generation tasks.
- **Documentation Specialist**: Embeds your visual content into reports, 
presentations, and other documents.
</team_structure>

<operating_environment>
- **System**: {platform.system()} ({platform.machine()})
- **Working Directory**: `{working_directory}`. All local file operations must 
occur here, but you can access files from any place in the file system. For all file system operations, you MUST use absolute paths to ensure precision and avoid ambiguity.
The current date is {NOW_STR}(Accurate to the hour). For any date-related tasks, you MUST use this as the current date.
</operating_environment>

<mandatory_instructions>
- You MUST use the `read_note` tool to to gather all information collected
    by other team members by reading ALL notes and write down your findings in 
    the notes.

- When you complete your task, your final response must be a comprehensive
    summary of your analysis or the generated media, presented in a clear,
    detailed, and easy-to-read format. Avoid using markdown tables for
    presenting data; use plain text formatting instead.
<mandatory_instructions>

<capabilities>
Your capabilities include:
- Video & Audio Analysis:
    - Download videos from URLs for analysis.
    - Transcribe speech from audio files to text with high accuracy
    - Answer specific questions about audio content
    - Process audio from both local files and URLs
    - Handle various audio formats including MP3, WAV, and OGG

- Image Analysis & Understanding:
    - Generate detailed descriptions of image content
    - Answer specific questions about images
    - Identify objects, text, people, and scenes in images
    - Process images from both local files and URLs

- Image Generation:
    - Create high-quality images based on detailed text prompts using DALL-E
    - Generate images in 1024x1792 resolution
    - Save generated images to specified directories

- Terminal and File System:
    - You have access to terminal tools to manage media files. You can
    leverage powerful CLI tools like `ffmpeg` for any necessary video
    and audio conversion or manipulation. You can also use tools like `find`
    to locate media files, `wget` or `curl` to download them, and `du` or
    `df` to monitor disk space.

- Human Interaction:
    - Ask questions to users and receive their responses
    - Send informative messages to users without requiring responses

</capabilities>

<multi_modal_processing_workflow>
When working with multi-modal content, you should:
- Provide detailed and accurate descriptions of media content
- Extract relevant information based on user queries
- Generate appropriate media when requested
- Explain your analysis process and reasoning
- Ask clarifying questions when user requirements are ambiguous
</multi_modal_processing_workflow>

Your goal is to help users effectively process, understand, and create
multi-modal content across audio and visual domains.
"""

    return agent_model(
        Agents.multi_modal_agent,
        BaseMessage.make_assistant_message(
            role_name="Multi Modal Agent",
            content=system_message,
        ),
        options,
        tools,
        tool_names=[
            VideoDownloaderToolkit.toolkit_name(),
            AudioAnalysisToolkit.toolkit_name(),
            ImageAnalysisToolkit.toolkit_name(),
            OpenAIImageToolkit.toolkit_name(),
            HumanToolkit.toolkit_name(),
            TerminalToolkit.toolkit_name(),
            NoteTakingToolkit.toolkit_name(),
            SearchToolkit.toolkit_name(),
        ],
    )


@traceroot.trace()
async def social_medium_agent(options: Chat):
    """
    Agent to handling tasks related to social media:
    include toolkits: WhatsApp, Twitter, LinkedIn, Reddit, Notion, Slack, Discord and Google Suite.
    """
    working_directory = get_working_directory(options)
    traceroot_logger.info(f"Creating social medium agent for project: {options.project_id} in directory: {working_directory}")
    tools = [
        *WhatsAppToolkit.get_can_use_tools(options.project_id),
        *TwitterToolkit.get_can_use_tools(options.project_id),
        *LinkedInToolkit.get_can_use_tools(options.project_id),
        *RedditToolkit.get_can_use_tools(options.project_id),
        *await NotionMCPToolkit.get_can_use_tools(options.project_id),
        # *SlackToolkit.get_can_use_tools(options.project_id),
        *await GoogleGmailMCPToolkit.get_can_use_tools(options.project_id, options.get_bun_env()),
        *GoogleCalendarToolkit.get_can_use_tools(options.project_id),
        *HumanToolkit.get_can_use_tools(options.project_id, Agents.social_medium_agent),
        *TerminalToolkit(options.project_id, agent_name=Agents.social_medium_agent, clone_current_env=False).get_tools(),
        *NoteTakingToolkit(
            options.project_id, Agents.social_medium_agent, working_directory=working_directory
        ).get_tools(),
        # *DiscordToolkit(options.project_id).get_tools(),  # Not supported temporarily
        # *GoogleSuiteToolkit(options.project_id).get_tools(),  # Not supported temporarily
    ]
    # if env("EXA_API_KEY") or options.is_cloud():
    #     tools.append(FunctionTool(SearchToolkit(options.project_id, Agents.social_medium_agent).search_exa))
    return agent_model(
        Agents.social_medium_agent,
        BaseMessage.make_assistant_message(
            role_name="Social Medium Agent",
            content=f"""
You are a Social Media Management Assistant with comprehensive capabilities
across multiple platforms. You MUST use the `send_message_to_user` tool to
inform the user of every decision and action you take. Your message must
include a short title and a one-sentence description. This is a mandatory
part of your workflow. When you complete your task, your final response must
be a comprehensive summary of your actions, presented in a clear, detailed,
and easy-to-read format. Avoid using markdown tables for presenting data;
use plain text formatting instead.

- **Working Directory**: `{working_directory}`. All local file operations must 
occur here, but you can access files from any place in the file system. For all file system operations, you MUST use absolute paths to ensure precision and avoid ambiguity.
The current date is {NOW_STR}(Accurate to the hour). For any date-related tasks, you MUST use this as the current date.

Your integrated toolkits enable you to:

1. WhatsApp Business Management (WhatsAppToolkit):
   - Send text and template messages to customers via the WhatsApp Business
   API.
   - Retrieve business profile information.

2. Twitter Account Management (TwitterToolkit):
   - Create tweets with text content, polls, or as quote tweets.
   - Delete existing tweets.
   - Retrieve user profile information.

3. LinkedIn Professional Networking (LinkedInToolkit):
   - Create posts on LinkedIn.
   - Delete existing posts.
   - Retrieve authenticated user's profile information.

4. Reddit Content Analysis (RedditToolkit):
   - Collect top posts and comments from specified subreddits.
   - Perform sentiment analysis on Reddit comments.
   - Track keyword discussions across multiple subreddits.

5. Notion Workspace Management (NotionToolkit):
   - List all pages and users in a Notion workspace.
   - Retrieve and extract text content from Notion blocks.

6. Slack Workspace Interaction (SlackToolkit):
   - Create new Slack channels (public or private).
   - Join or leave existing channels.
   - Send and delete messages in channels.
   - Retrieve channel information and message history.

7. Human Interaction (HumanToolkit):
   - Ask questions to users and send messages via console.

8. Agent Communication:
   - Communicate with other agents using messaging tools when collaboration
   is needed. Use `list_available_agents` to see available team members and
   `send_message` to coordinate with them, especially when you need content
   from document agents or research from search agents.

9. File System Access:
   - You can use terminal tools to interact with the local file system in
   your working directory (`{working_directory}`), for example, to access
   files needed for posting. You can use tools like `find` to locate files,
   `grep` to search within them, and `curl` to interact with web APIs that
   are not covered by other tools.

When assisting users, always:
- Identify which platform's functionality is needed for the task.
- Check if required API credentials are available before attempting
operations.
- Provide clear explanations of what actions you're taking.
- Handle rate limits and API restrictions appropriately.
- Ask clarifying questions when user requests are ambiguous.
""",
        ),
        options,
        tools,
        tool_names=[
            WhatsAppToolkit.toolkit_name(),
            TwitterToolkit.toolkit_name(),
            LinkedInToolkit.toolkit_name(),
            RedditToolkit.toolkit_name(),
            NotionMCPToolkit.toolkit_name(),
            GoogleGmailMCPToolkit.toolkit_name(),
            GoogleCalendarToolkit.toolkit_name(),
            HumanToolkit.toolkit_name(),
            TerminalToolkit.toolkit_name(),
            NoteTakingToolkit.toolkit_name(),
        ],
    )


@traceroot.trace()
async def mcp_agent(options: Chat):
    traceroot_logger.info(
        f"Creating MCP agent for project: {options.project_id} with {len(options.installed_mcp['mcpServers'])} MCP servers"
    )
    tools = [
        # *HumanToolkit.get_can_use_tools(options.project_id, Agents.mcp_agent),
        *McpSearchToolkit(options.project_id).get_tools(),
    ]
    if len(options.installed_mcp["mcpServers"]) > 0:
        try:
            mcp_tools = await get_mcp_tools(options.installed_mcp)
            traceroot_logger.info(f"Retrieved {len(mcp_tools)} MCP tools for task {options.project_id}")
            if mcp_tools:
                tool_names = [tool.get_function_name() if hasattr(tool, 'get_function_name') else str(tool) for tool in mcp_tools]
                traceroot_logger.debug(f"MCP tools: {tool_names}")
            tools = [*tools, *mcp_tools]
        except Exception as e:
            traceroot_logger.debug(repr(e))

    task_lock = get_task_lock(options.project_id)
    agent_id = str(uuid.uuid4())
    traceroot_logger.info(f"Creating MCP agent: {Agents.mcp_agent} with id: {agent_id} for task: {options.project_id}")
    asyncio.create_task(
        task_lock.put_queue(
            ActionCreateAgentData(
                data={
                    "agent_name": Agents.mcp_agent,
                    "agent_id": agent_id,
                    "tools": [key for key in options.installed_mcp["mcpServers"].keys()],
                }
            )
        )
    )
    return ListenChatAgent(
        options.project_id,
        Agents.mcp_agent,
        system_message="You are a helpful assistant that can help users search mcp servers. The found mcp services will be returned to the user, and you will ask the user via ask_human_via_gui whether they want to install these mcp services.",
        model=ModelFactory.create(
            model_platform=options.model_platform,
            model_type=options.model_type,
            api_key=options.api_key,
            url=options.api_url,
            model_config_dict={
                "user": str(options.project_id),
                "parallel_tool_calls": False,
            }
            if options.is_cloud()
            else {
                "parallel_tool_calls": False,
            },
            **{
                k: v
                for k, v in (options.extra_params or {}).items()
                if k not in ["model_platform", "model_type", "api_key", "url"]
            },
        ),
        # output_language=options.language,
        tools=tools,
        agent_id=agent_id,
    )


@traceroot.trace()
async def get_toolkits(tools: list[str], agent_name: str, api_task_id: str):
    traceroot_logger.info(f"Getting toolkits for agent: {agent_name}, task: {api_task_id}, tools: {tools}")
    toolkits = {
        "audio_analysis_toolkit": AudioAnalysisToolkit,
        "openai_image_toolkit": OpenAIImageToolkit,
        "excel_toolkit": ExcelToolkit,
        "file_write_toolkit": FileToolkit,
        "github_toolkit": GithubToolkit,
        "google_calendar_toolkit": GoogleCalendarToolkit,
        "google_drive_mcp_toolkit": GoogleDriveMCPToolkit,
        "google_gmail_mcp_toolkit": GoogleGmailMCPToolkit,
        "image_analysis_toolkit": ImageAnalysisToolkit,
        "linkedin_toolkit": LinkedInToolkit,
        "mcp_search_toolkit": McpSearchToolkit,
        "notion_mcp_toolkit": NotionMCPToolkit,
        "pptx_toolkit": PPTXToolkit,
        "reddit_toolkit": RedditToolkit,
        "search_toolkit": SearchToolkit,
        "slack_toolkit": SlackToolkit,
        "terminal_toolkit": TerminalToolkit,
        "twitter_toolkit": TwitterToolkit,
        "video_analysis_toolkit": VideoAnalysisToolkit,
        "video_download_toolkit": VideoDownloaderToolkit,
        "whatsapp_toolkit": WhatsAppToolkit,
    }
    res = []
    for item in tools:
        if item in toolkits:
            toolkit: AbstractToolkit = toolkits[item]
            toolkit.agent_name = agent_name
            toolkit_tools = toolkit.get_can_use_tools(api_task_id)
            toolkit_tools = await toolkit_tools if asyncio.iscoroutine(toolkit_tools) else toolkit_tools
            res.extend(toolkit_tools)
        else:
            traceroot_logger.warning(f"Toolkit {item} not found for agent {agent_name}")
    return res


@traceroot.trace()
async def get_mcp_tools(mcp_server: McpServers):
    traceroot_logger.info(f"Getting MCP tools for {len(mcp_server['mcpServers'])} servers")
    if len(mcp_server["mcpServers"]) == 0:
        return []
    
    # Ensure unified auth directory for all mcp-remote servers to avoid re-authentication on each task
    config_dict = {**mcp_server}
    for server_config in config_dict["mcpServers"].values():
        if "env" not in server_config:
            server_config["env"] = {}
        # Set global auth directory to persist authentication across tasks
        if "MCP_REMOTE_CONFIG_DIR" not in server_config["env"]:
            server_config["env"]["MCP_REMOTE_CONFIG_DIR"] = env("MCP_REMOTE_CONFIG_DIR", os.path.expanduser("~/.mcp-auth"))

    mcp_toolkit = None
    try:
        mcp_toolkit = MCPToolkit(config_dict=config_dict, timeout=180)
        await mcp_toolkit.connect()

        traceroot_logger.info(f"Successfully connected to MCP toolkit with {len(mcp_server['mcpServers'])} servers")
        tools = mcp_toolkit.get_tools()
        if tools:
            tool_names = [tool.get_function_name() if hasattr(tool, 'get_function_name') else str(tool) for tool in tools]
            traceroot_logger.debug(f"MCP tool names: {tool_names}")
        return tools
    except asyncio.CancelledError:
        traceroot_logger.info("MCP connection cancelled during get_mcp_tools")
        return []
    except Exception as e:
        traceroot_logger.error(f"Failed to connect MCP toolkit: {e}", exc_info=True)
        return []
