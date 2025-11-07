import asyncio
import json
import os
import platform
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
        )
        self.api_task_id = api_task_id
        self.agent_name = agent_name

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
        elif hasattr(tool.func, "__wrapped__"):
            with set_process_task(self.process_task_id):
                return super()._execute_tool(tool_call_request)
        else:
            args = tool_call_request.args
            tool_call_id = tool_call_request.tool_call_id
            try:
                task_lock = get_task_lock(self.api_task_id)

                toolkit_name = getattr(tool, "_toolkit_name") if hasattr(tool, "_toolkit_name") else "mcp_toolkit"
                traceroot_logger.debug(
                    f"Agent {self.agent_name} executing tool: {func_name} from toolkit: {toolkit_name} with args: {json.dumps(args, ensure_ascii=False)}"
                )
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

        return self._record_tool_calling(func_name, args, result, tool_call_id, mask_output=mask_flag)

    @traceroot.trace()
    async def _aexecute_tool(self, tool_call_request: ToolCallRequest) -> ToolCallingRecord:
        func_name = tool_call_request.tool_name
        tool: FunctionTool = self._internal_tools[func_name]
        if hasattr(tool.func, "__wrapped__"):
            with set_process_task(self.process_task_id):
                return await super()._aexecute_tool(tool_call_request)
        else:
            args = tool_call_request.args
            tool_call_id = tool_call_request.tool_call_id
            task_lock = get_task_lock(self.api_task_id)

            toolkit_name = getattr(tool, "_toolkit_name") if hasattr(tool, "_toolkit_name") else "mcp_toolkit"
            traceroot_logger.info(
                f"Agent {self.agent_name} executing async tool: {func_name} from toolkit: {toolkit_name} with args: {json.dumps(args, ensure_ascii=False)}"
            )
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
                    # Fallback: synchronous call
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
        return self._record_tool_calling(func_name, args, result, tool_call_id)

    @traceroot.trace()
    def clone(self, with_memory: bool = False) -> ChatAgent:
        """Please see super.clone()"""
        system_message = None if with_memory else self._original_system_message

        # Clone tools and collect toolkits that need registration
        cloned_tools, toolkits_to_register = self._clone_tools()
        
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
        )

        new_agent.process_task_id = self.process_task_id

        # Copy memory if requested
        if with_memory:
            # Get all records from the current memory
            context_records = self.memory.retrieve()
            # Write them to the new agent's memory
            for context_record in context_records:
                new_agent.memory.write_record(context_record.memory_record)

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
):
    task_lock = get_task_lock(options.project_id)
    agent_id = str(uuid.uuid4())
    traceroot_logger.info(f"Creating agent: {agent_name} with id: {agent_id} for project: {options.project_id}")
    asyncio.create_task(
        task_lock.put_queue(
            ActionCreateAgentData(data={"agent_name": agent_name, "agent_id": agent_id, "tools": tool_names or []})
        )
    )

    return ListenChatAgent(
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
            }
            if options.is_cloud()
            else None,
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
    )


@traceroot.trace()
def question_confirm_agent(options: Chat):
    return agent_model(
        "question_confirm_agent",
        f"You are a highly capable agent. Your primary function is to analyze a user's request and determine the appropriate course of action. The current date is {datetime.date.today()}. For any date-related tasks, you MUST use this as the current date.",
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
The current date is {datetime.date.today()}. For any date-related tasks, you MUST use this as the current date.
</operating_environment>

<mandatory_instructions>
- You MUST use the `read_note` tool to read the notes from other agents.

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

    web_toolkit_custom = HybridBrowserToolkit(
        options.project_id,
        headless=False,
        browser_log_to_file=True,
        stealth=True,
        session_id=str(uuid.uuid4())[:8],
        default_start_url="about:blank",
        cdp_url=f"http://localhost:{env('browser_port', '9222')}",
        enabled_tools=[
            "browser_click",
            "browser_type",
            "browser_back",
            "browser_forward",
            "browser_switch_tab",
            "browser_enter",
            "browser_visit_page",
            "browser_scroll",
            "browser_get_som_screenshot",
        ],
    )

    # Save reference before registering for toolkits_to_register_agent
    web_toolkit_for_agent_registration = web_toolkit_custom
    web_toolkit_custom = message_integration.register_toolkits(web_toolkit_custom)
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
The current date is {datetime.date.today()}. For any date-related tasks, you MUST use this as the current date.
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

**If Google Search is Available:**
- Initial Search: Start with `search_google` to get a list of relevant URLs
- Browser-Based Exploration: Use the browser tools to investigate the URLs

**If Google Search is NOT Available:**
- **MUST start with direct website search**: Use `browser_visit_page` to go
  directly to popular search engines and informational websites such as:
  * General search: google.com, bing.com, duckduckgo.com
  * Academic: scholar.google.com, pubmed.ncbi.nlm.nih.gov
  * News: news.google.com, bbc.com/news, reuters.com
  * Technical: stackoverflow.com, github.com
  * Reference: wikipedia.org, britannica.com
- **Manual search process**: Type your query into the search boxes on these
  sites using `browser_type` and submit with `browser_enter`
- **Extract URLs from results**: Only use URLs that appear in the search
  results on these websites

**Common Browser Operations (both scenarios):**
- **Navigation and Exploration**: Use `browser_visit_page` to open URLs.
    `browser_visit_page` provides a snapshot of currently visible
    interactive elements, not the full page text. To see more content on
    long pages, Navigate with `browser_click`, `browser_back`, and
    `browser_forward`. Manage multiple pages with `browser_switch_tab`.
- **Analysis**: Use `browser_get_som_screenshot` to understand the page
    layout and identify interactive elements. Since this is a heavy
    operation, only use it when visual analysis is necessary.
- **Interaction**: Use `browser_type` to fill out forms and
    `browser_enter` to submit or confirm search.

- In your response, you should mention the URLs you have visited and processed.

- When encountering verification challenges (like login, CAPTCHAs or
    robot checks), you MUST request help using the human toolkit.
</web_search_workflow>
    """

    return agent_model(
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
    )


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
The current date is {datetime.date.today()}. For any date-related tasks, you MUST use this as the current date.
</operating_environment>

<mandatory_instructions>
- Before creating any document, you MUST use the `read_note` tool to gather
    all information collected by other team members.

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
The current date is {datetime.date.today()}. For any date-related tasks, you MUST use this as the current date.
</operating_environment>

<mandatory_instructions>
- You MUST use the `read_note` tool to to gather all information collected
    by other team members and write down your findings in the notes.

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
The current date is {datetime.date.today()}. For any date-related tasks, you MUST use this as the current date.

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
            }
            if options.is_cloud()
            else None,
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
            logger.warning(f"Toolkit {item} not found, please check your configuration.")
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
