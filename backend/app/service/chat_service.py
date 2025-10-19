import asyncio
import datetime
from pathlib import Path
import platform
from typing import Literal
from fastapi import Request
from inflection import titleize
from pydash import chain
from app.component.debug import dump_class
from app.component.environment import env
from app.service.task import (
    ActionImproveData,
    ActionInstallMcpData,
    ActionNewAgent,
    TaskLock,
    delete_task_lock,
)
from camel.toolkits import AgentCommunicationToolkit, ToolkitMessageIntegration
from app.utils.toolkit.human_toolkit import HumanToolkit
from app.utils.toolkit.note_taking_toolkit import NoteTakingToolkit
from app.utils.workforce import Workforce
from loguru import logger
from app.model.chat import Chat, NewAgent, Status, sse_json, TaskContent
from camel.tasks import Task
from app.utils.agent import (
    ListenChatAgent,
    agent_model,
    get_mcp_tools,
    get_toolkits,
    mcp_agent,
    developer_agent,
    document_agent,
    multi_modal_agent,
    search_agent,
    social_medium_agent,
    task_summary_agent,
    question_confirm_agent,
)
from app.service.task import Action, Agents
from app.utils.server.sync_step import sync_step
from camel.types import ModelPlatformType
from camel.models import ModelProcessingError
import os


def collect_previous_task_context(working_directory: str, previous_task_content: str, previous_task_result: str, previous_summary: str = "") -> str:
    """
    Collect context from previous task including content, result, summary, and generated files.

    Args:
        working_directory: The working directory to scan for generated files
        previous_task_content: The content of the previous task
        previous_task_result: The result/output of the previous task
        previous_summary: The summary of the previous task

    Returns:
        Formatted context string to prepend to new task
    """

    context_parts = []

    # Add previous task information
    context_parts.append("=== CONTEXT FROM PREVIOUS TASK ===\n")

    # Add previous task content
    if previous_task_content:
        context_parts.append(f"Previous Task:\n{previous_task_content}\n")

    # Add previous task summary
    if previous_summary:
        context_parts.append(f"Previous Task Summary:\n{previous_summary}\n")

    # Add previous task result
    if previous_task_result:
        context_parts.append(f"Previous Task Result:\n{previous_task_result}\n")

    # Collect generated files from working directory
    try:
        if os.path.exists(working_directory):
            generated_files = []
            for root, dirs, files in os.walk(working_directory):
                # Skip hidden directories and common cache directories
                dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ['node_modules', '__pycache__', 'venv']]

                for file in files:
                    # Skip hidden files and common temporary files
                    if not file.startswith('.') and not file.endswith(('.pyc', '.tmp')):
                        file_path = os.path.join(root, file)
                        relative_path = os.path.relpath(file_path, working_directory)
                        generated_files.append(relative_path)

            if generated_files:
                context_parts.append("Generated Files from Previous Task:")
                for file_path in sorted(generated_files):
                    context_parts.append(f"  - {file_path}")
                context_parts.append("")
    except Exception as e:
        logger.warning(f"Failed to collect generated files: {e}")

    context_parts.append("=== END OF PREVIOUS TASK CONTEXT ===\n")
    context_parts.append("=== NEW TASK ===\n")

    return "\n".join(context_parts)


def build_context_for_workforce(task_lock: TaskLock, options: Chat) -> str:
    """Build context information for workforce"""
    context = ""

    # Add conversation history (includes complete task results)
    if task_lock.conversation_history:
        context = "=== CONVERSATION HISTORY ===\n"

        # Include all conversations - task_result entries already contain full context
        for entry in task_lock.conversation_history:
            if entry['role'] == 'task_result':
                # Use the complete task context stored in conversation_history
                context += entry['content'] + "\n"
            else:
                context += f"{entry['role']}: {entry['content']}\n"

        context += "\n"


    return context


@sync_step
async def step_solve(options: Chat, request: Request, task_lock: TaskLock):
    # if True:
    #     import faulthandler

    #     faulthandler.enable()
    #     for second in [5, 10, 20, 30, 60, 120, 240]:
    #         faulthandler.dump_traceback_later(second)

    start_event_loop = True

    # ========== Initialize context management ==========
    # Initialize context fields if they don't exist
    if not hasattr(task_lock, 'conversation_history'):
        task_lock.conversation_history = []
    if not hasattr(task_lock, 'last_task_result'):
        task_lock.last_task_result = ""
    if not hasattr(task_lock, 'last_task_summary'):
        task_lock.last_task_summary = ""
    if not hasattr(task_lock, 'question_agent'):
        task_lock.question_agent = None

    # Create or reuse persistent question_agent
    if task_lock.question_agent is None:
        task_lock.question_agent = question_confirm_agent(options)
    else:
        pass

    question_agent = task_lock.question_agent

    # Other variables
    camel_task = None
    workforce = None
    last_completed_task_result = ""  # Track the last completed task result
    summary_task_content = ""  # Track task summary
    loop_iteration = 0


    while True:
        loop_iteration += 1

        if await request.is_disconnected():
            logger.warning(f"Client disconnected for project {options.project_id}")
            if workforce is not None:
                if workforce._running:
                    workforce.stop()
                workforce.stop_gracefully()
            task_lock.status = Status.done
            try:
                await delete_task_lock(task_lock.id)
            except Exception as e:
                logger.error(f"Error deleting task lock on disconnect: {e}")
            break
        try:
            item = await task_lock.get_queue()
        except Exception as e:
            logger.error(f"Error getting item from queue: {e}")
            # Continue waiting instead of breaking on queue error
            continue

        try:
            if item.action == Action.improve or start_event_loop:
                # from viztracer import VizTracer

                # tracer = VizTracer()
                # tracer.start()
                if start_event_loop is True:
                    question = options.question
                    start_event_loop = False
                else:
                    assert isinstance(item, ActionImproveData)
                    question = item.data


                # Save user question to history
                task_lock.add_conversation('user', question)

                # Simplified logic: attachments mean workforce, otherwise let agent decide
                if len(options.attaches) > 0:
                    # Questions with attachments always need workforce
                    confirm = True
                else:
                    # No attachments - let agent decide based on question content and context
                    confirm = await question_confirm(question_agent, question, task_lock)

                if confirm is not True:

                    # Extract and save assistant response to history
                    try:
                        import json
                        response_data = json.loads(confirm.split("data: ")[1].strip())
                        response_content = response_data['data']['content']
                        task_lock.add_conversation('assistant', response_content)
                    except Exception as e:
                        logger.error(f"[CONTEXT] Failed to save response to history: {e}")

                    yield confirm
                    # After sending simple response, continue waiting for next action
                else:
                    yield sse_json("confirmed", {"question": question})

                    # ========== Prepare context for workforce ==========
                    context_for_task = build_context_for_workforce(task_lock, options)

                    (workforce, mcp) = await construct_workforce(options)
                    for new_agent in options.new_agents:
                        workforce.add_single_agent_worker(
                            format_agent_description(new_agent), await new_agent_model(new_agent, options)
                        )
                    summary_task_agent = task_summary_agent(options)
                    task_lock.status = Status.confirmed

                    # Add context to task content
                    question_with_context = context_for_task
                    if context_for_task:
                        question_with_context += "\n=== CURRENT TASK ===\n"
                    question_with_context += question + options.summary_prompt


                    # Keep the task id consistent
                    camel_task = Task(content=question_with_context, id=options.task_id)
                    if len(options.attaches) > 0:
                        camel_task.additional_info = {Path(file_path).name: file_path for file_path in options.attaches}

                    sub_tasks = await asyncio.to_thread(workforce.eigent_make_sub_tasks, camel_task)

                    # Generate task summary
                    summary_task_content = await summary_task(summary_task_agent, camel_task)

                    # Save task summary for future reference
                    task_lock.last_task_summary = summary_task_content

                    yield to_sub_tasks(camel_task, summary_task_content)
                    # tracer.stop()
                    # tracer.save("trace.json")

                    # Only auto-start in debug mode
                    if env("debug") == "on":
                        logger.info(f"[DEBUG] Auto-starting workforce in debug mode")
                        task_lock.status = Status.processing
                        task = asyncio.create_task(workforce.eigent_start(sub_tasks))
                        task_lock.add_background_task(task)

            elif item.action == Action.update_task:
                assert camel_task is not None
                update_tasks = {item.id: item for item in item.data.task}
                sub_tasks = update_sub_tasks(sub_tasks, update_tasks)
                add_sub_tasks(camel_task, item.data.task)
                yield to_sub_tasks(camel_task, summary_task_content)
            elif item.action == Action.add_task:

                # Check if this might be a misrouted second question
                if camel_task is None and workforce is None:
                    continue

                assert camel_task is not None
                if workforce is None:
                    logger.error(f"Cannot add task: workforce not initialized for project {options.project_id}")
                    yield sse_json("error", {"message": "Workforce not initialized. Please start the task first."})
                    continue

                # Add task to the workforce queue
                workforce.add_task(
                    item.content,
                    item.task_id,
                    item.additional_info
                )

                returnData = {
                    "project_id": item.project_id,
                    "task_id": item.task_id or (len(camel_task.subtasks) + 1)
                }
                yield sse_json("add_task", returnData)
            elif item.action == Action.remove_task:
                assert camel_task is not None
                if workforce is None:
                    logger.error(f"Cannot remove task: workforce not initialized for project {options.project_id}")
                    yield sse_json("error", {"message": "Workforce not initialized. Please start the task first."})
                    continue

                workforce.remove_task(item.task_id)
                returnData = {
                    "project_id": item.project_id,
                    "task_id": item.task_id
                }
                yield sse_json("remove_task", returnData)
            elif item.action == Action.skip_task:
                if workforce is not None and item.project_id == options.project_id:
                    if workforce._state.name == 'PAUSED':
                        # Resume paused workforce to skip the task
                        workforce.resume()
                    workforce.skip_gracefully()
            elif item.action == Action.start:
                if workforce is not None:
                    if workforce._state.name == 'PAUSED':
                        # Resume paused workforce - subtasks should already be loaded
                        workforce.resume()
                        continue
                else:
                    continue

                task_lock.status = Status.processing
                task = asyncio.create_task(workforce.eigent_start(sub_tasks))
                task_lock.add_background_task(task)
            elif item.action == Action.task_state:
                # Track completed task results for the end event
                task_id = item.data.get('task_id', 'unknown')
                task_state = item.data.get('state', 'unknown')
                task_result = item.data.get('result', '')


                if task_state == 'DONE' and task_result:
                    last_completed_task_result = task_result

                yield sse_json("task_state", item.data)
            elif item.action == Action.new_task_state:

                # Log new task state details
                new_task_id = item.data.get('task_id', 'unknown')
                new_task_state = item.data.get('state', 'unknown')
                new_task_result = item.data.get('result', '')


                assert camel_task is not None

                # Store the old task information before updating camel_task
                old_task_content = camel_task.content
                old_task_result = str(camel_task.result)
                old_task_summary = summary_task_content if 'summary_task_content' in locals() else ""

                # Save old task to conversation_history (for multi-turn intermediate tasks)
                # Extract actual task content (remove context prefix)
                old_task_content_clean = old_task_content
                if "=== CURRENT TASK ===" in old_task_content_clean:
                    old_task_content_clean = old_task_content_clean.split("=== CURRENT TASK ===")[-1].strip()

                # Generate and save old task context
                old_task_context = collect_previous_task_context(
                    working_directory=options.file_save_path(),
                    previous_task_content=old_task_content_clean,
                    previous_task_result=old_task_result,
                    previous_summary=old_task_summary
                )
                task_lock.add_conversation('task_result', old_task_context)

                # Extract task content from the new task data immediately
                # Don't return question field for new_tasks
                new_task_content = item.data.get('content', '')

                # Get context from conversation_history (includes all previous tasks)
                if new_task_content:
                    # Read the last task_result from conversation_history
                    previous_context = ""
                    for entry in reversed(task_lock.conversation_history):
                        if entry['role'] == 'task_result':
                            previous_context = entry['content']
                            break

                    # Prepend context to new task content
                    new_task_content_with_context = previous_context + new_task_content if previous_context else new_task_content
                else:
                    new_task_content_with_context = new_task_content

                # Update camel_task to the new task right away
                if new_task_content:
                    import time
                    # Generate unique task ID
                    task_id = item.data.get('task_id', f"{int(time.time() * 1000)}-multi")
                    # Create and assign new task immediately with context
                    new_camel_task = Task(content=new_task_content_with_context, id=task_id)
                    # Preserve additional_info from the previous task if it exists
                    if hasattr(camel_task, 'additional_info') and camel_task.additional_info:
                        new_camel_task.additional_info = camel_task.additional_info
                    camel_task = new_camel_task

                # Now trigger end of previous task using stored result
                yield sse_json("end", old_task_result)
                # Always yield new_task_state first - this is not optional
                yield sse_json("new_task_state", item.data)
                # Trigger Queue Removal
                yield sse_json("remove_task", {"task_id": item.data.get("task_id")})

                # Then handle multi-turn processing
                if workforce is not None and new_task_content:
                    task_lock.status = Status.confirming
                    workforce.pause()

                    try:
                        multi_turn_confirm = await question_confirm(question_agent, new_task_content, task_lock)

                        if multi_turn_confirm is not True:
                            # Still need to send appropriate responses
                            yield sse_json("confirmed", {"question": new_task_content})
                            yield multi_turn_confirm
                            workforce.resume()
                            continue  # This continues the main while loop, waiting for next action

                        yield sse_json("confirmed", {"question": new_task_content})
                        task_lock.status = Status.confirmed

                        # Use existing workforce to decompose (without creating new one)
                        # Append to _pending_tasks
                        new_sub_tasks = await workforce.handle_decompose_append_task(
                            camel_task,  # Use the updated camel_task
                            reset=False  # Keep existing agents and context
                        )

                        # Generate summary using existing agents
                        summary_task_agent_instance = task_summary_agent(options)
                        new_summary_content = await summary_task(summary_task_agent_instance, camel_task)

                        # Send the extracted events
                        yield to_sub_tasks(camel_task, new_summary_content)

                        # Update the context with new task data
                        sub_tasks = new_sub_tasks
                        summary_task_content = new_summary_content


                    except Exception as e:
                        import traceback
                        logger.error(f"[TRACE] Traceback: {traceback.format_exc()}")
                        # Continue with existing context if decomposition fails
                        yield sse_json("error", {"message": f"Failed to process task: {str(e)}"})
                else:
                    if workforce is None:
                        logger.warning(f"[TRACE] Workforce is None - this might be the issue")
                    if not new_task_content:
                        logger.warning(f"[TRACE] No new task content provided")
            elif item.action == Action.create_agent:
                yield sse_json("create_agent", item.data)
            elif item.action == Action.activate_agent:
                yield sse_json("activate_agent", item.data)
            elif item.action == Action.deactivate_agent:
                yield sse_json("deactivate_agent", dict(item.data))
            elif item.action == Action.assign_task:
                yield sse_json("assign_task", item.data)
            elif item.action == Action.activate_toolkit:
                yield sse_json("activate_toolkit", item.data)
            elif item.action == Action.deactivate_toolkit:
                yield sse_json("deactivate_toolkit", item.data)
            elif item.action == Action.write_file:
                yield sse_json(
                    "write_file",
                    {"file_path": item.data, "process_task_id": item.process_task_id},
                )
            elif item.action == Action.ask:
                yield sse_json("ask", item.data)
            elif item.action == Action.notice:
                yield sse_json(
                    "notice",
                    {"notice": item.data, "process_task_id": item.process_task_id},
                )
            elif item.action == Action.search_mcp:
                yield sse_json("search_mcp", item.data)
            elif item.action == Action.install_mcp:
                task = asyncio.create_task(install_mcp(mcp, item))
                task_lock.add_background_task(task)
            elif item.action == Action.terminal:
                yield sse_json(
                    "terminal",
                    {"output": item.data, "process_task_id": item.process_task_id},
                )
            elif item.action == Action.pause:
                if workforce is not None:
                    workforce.pause()
                else:
                    pass
            elif item.action == Action.resume:
                if workforce is not None:
                    workforce.resume()
                else:
                    pass
            elif item.action == Action.new_agent:
                if workforce is not None:
                    workforce.pause()
                    workforce.add_single_agent_worker(
                        format_agent_description(item), await new_agent_model(item, options)
                    )
                    workforce.resume()
            elif item.action == Action.end:
                assert camel_task is not None
                task_lock.status = Status.done

                # Log main task and available results

                # Get the final result from the main task
                final_result = str(camel_task.result or "")


                # ========== Save task result to task_lock ==========
                task_lock.last_task_result = final_result

                # Extract actual task content (remove context prefix)
                task_content = camel_task.content
                if "=== CURRENT TASK ===" in task_content:
                    task_content = task_content.split("=== CURRENT TASK ===")[-1].strip()

                # Collect full task context
                full_task_context = collect_previous_task_context(
                    working_directory=options.file_save_path(),
                    previous_task_content=task_content,
                    previous_task_result=final_result,
                    previous_summary=task_lock.last_task_summary
                )

                # Save task result to conversation history (special type)
                task_lock.add_conversation('task_result', full_task_context)


                yield sse_json("end", final_result)

                if workforce is not None:
                    workforce.stop_gracefully()
                    # Reset workforce to None after stopping
                    workforce = None
                else:
                    pass

                # Reset camel_task to None for next task
                camel_task = None

                # Continue the loop to wait for next message instead of breaking
                # Don't break here - continue waiting for next action
            elif item.action == Action.supplement:

                # Check if this might be a misrouted second question
                if camel_task is None:
                    pass
                else:
                    assert camel_task is not None
                    task_lock.status = Status.processing
                    camel_task.add_subtask(
                        Task(
                            content=item.data.question,
                            id=f"{camel_task.id}.{len(camel_task.subtasks)}",
                        )
                    )
                    task = asyncio.create_task(workforce.eigent_start(camel_task.subtasks))
                    task_lock.add_background_task(task)
            elif item.action == Action.budget_not_enough:
                if workforce is not None:
                    workforce.pause()
                yield sse_json(Action.budget_not_enough, {"message": "budget not enouth"})
            elif item.action == Action.stop:
                if workforce is not None:
                    if workforce._running:
                        workforce.stop()
                    workforce.stop_gracefully()
                else:
                    pass
                await delete_task_lock(task_lock.id)
                break
            else:
                pass
        except ModelProcessingError as e:
            if "Budget has been exceeded" in str(e):
                # workforce decompose task don't use ListenAgent, this need return sse
                if "workforce" in locals() and workforce is not None:
                    workforce.pause()
                yield sse_json(Action.budget_not_enough, {"message": "budget not enouth"})
            else:
                logger.error(f"Error processing action {item.action}: {e}")
                yield sse_json("error", {"message": str(e)})
                if "workforce" in locals() and workforce is not None and workforce._running:
                    workforce.stop()
        except Exception as e:
            logger.error(f"Error processing action {item.action}: {e}")
            yield sse_json("error", {"message": str(e)})
            # Continue processing other items instead of breaking


async def install_mcp(
    mcp: ListenChatAgent,
    install_mcp: ActionInstallMcpData,
):
    mcp.add_tools(await get_mcp_tools(install_mcp.data))


def to_sub_tasks(task: Task, summary_task_content: str):
    return sse_json(
        "to_sub_tasks",
        {
            "summary_task": summary_task_content,
            "sub_tasks": tree_sub_tasks(task.subtasks),
        },
    )


def tree_sub_tasks(sub_tasks: list[Task], depth: int = 0):
    if depth > 5:
        return []
    return (
        chain(sub_tasks)
        .filter(lambda x: x.content != "")
        .map(
            lambda x: {
                "id": x.id,
                "content": x.content,
                "state": x.state,
                "subtasks": tree_sub_tasks(x.subtasks, depth + 1),
            }
        )
        .value()
    )


def update_sub_tasks(sub_tasks: list[Task], update_tasks: dict[str, TaskContent], depth: int = 0):
    if depth > 5:  # limit the depth of the recursion
        return []

    i = 0
    while i < len(sub_tasks):
        item = sub_tasks[i]
        if item.id in update_tasks:
            item.content = update_tasks[item.id].content
            update_sub_tasks(item.subtasks, update_tasks, depth + 1)
            i += 1
        else:
            sub_tasks.pop(i)
    return sub_tasks


def add_sub_tasks(camel_task: Task, update_tasks: list[TaskContent]):
    for item in update_tasks:
        if item.id == "":  #
            camel_task.add_subtask(
                Task(
                    content=item.content,
                    id=f"{camel_task.id}.{len(camel_task.subtasks) + 1}",
                )
            )


async def question_confirm(agent: ListenChatAgent, prompt: str, task_lock: TaskLock = None) -> str | Literal[True]:
    """
    Unified question confirmation that can work with or without context.

    Args:
        agent: The agent to perform the confirmation
        prompt: The user's question/query
        task_lock: Optional TaskLock containing conversation history and previous results

    Returns:
        Either the answer for simple queries or True for complex tasks
    """

    # Build context if available
    context_prompt = ""

    if task_lock and task_lock.conversation_history:
        context_prompt = "=== Previous Conversation ===\n"

        for entry in task_lock.conversation_history:
            role = entry['role']
            content = entry['content']

            if role == 'task_result':
                # Include full task result context
                context_prompt += f"[Task Completed]:\n{content}\n"
            else:
                context_prompt += f"{role.capitalize()}: {content}\n"

        context_prompt += "\n"

    if task_lock and task_lock.last_task_result:
        context_prompt += f"=== Last Task Result ===\n{task_lock.last_task_result}\n\n"

    # Build unified prompt
    full_prompt = f"""{context_prompt}User Query: {prompt}

Determine if this is:
- A simple question/greeting that can be answered directly → Provide a direct response
- A complex task requiring tools, code execution, or multiple steps → Respond with only "yes"

Note: If you can answer using the conversation history or previous results, provide the answer directly.
"""


    # Execute agent
    resp = agent.step(full_prompt)

    is_complex = resp.msgs[0].content.lower() == "yes"

    if not is_complex:
        return sse_json("wait_confirm", {"content": resp.msgs[0].content})
    else:
        return True


async def summary_task(agent: ListenChatAgent, task: Task) -> str:
    prompt = f"""The user's task is:
---
{task.to_string()}
---
Your instructions are:
1.  Come up with a short and descriptive name for this task.
2.  Create a concise summary of the task's main points and objectives.
3.  Return the task name and the summary, separated by a vertical bar (|).

Example format: "Task Name|This is the summary of the task."
Do not include any other text or formatting.
"""

    res = agent.step(prompt)
    summary = res.msgs[0].content


    # Parse the summary to show title and subtitle separately
    if '|' in summary:
        parts = summary.split('|', 1)

    return summary


async def construct_workforce(options: Chat) -> tuple[Workforce, ListenChatAgent]:
    working_directory = options.file_save_path()
    [coordinator_agent, task_agent] = [
        agent_model(
            key,
            prompt,
            options,
            [
                *(
                    ToolkitMessageIntegration(
                        message_handler=HumanToolkit(options.project_id, key).send_message_to_user
                    ).register_toolkits(NoteTakingToolkit(options.project_id, working_directory=working_directory))
                ).get_tools()
            ],
        )
        for key, prompt in {
            Agents.coordinator_agent: f"""
You are a helpful coordinator.
- You are now working in system {platform.system()} with architecture
{platform.machine()} at working directory `{working_directory}`. All local file operations must occur here, but you can access files from any place in the file system. For all file system operations, you MUST use absolute paths to ensure precision and avoid ambiguity.
The current date is {datetime.date.today()}. For any date-related tasks, you MUST use this as the current date.

- If a task assigned to another agent fails, you should re-assign it to the 
`Developer_Agent`. The `Developer_Agent` is a powerful agent with terminal 
access and can resolve a wide range of issues. 
            """,
            Agents.task_agent: f"""
You are a helpful task planner.
- You are now working in system {platform.system()} with architecture
{platform.machine()} at working directory `{working_directory}`. All local file operations must occur here, but you can access files from any place in the file system. For all file system operations, you MUST use absolute paths to ensure precision and avoid ambiguity.
The current date is {datetime.date.today()}. For any date-related tasks, you MUST use this as the current date.
        """,
        }.items()
    ]
    new_worker_agent = agent_model(
        Agents.new_worker_agent,
        f"""
        You are a helpful assistant.
- You are now working in system {platform.system()} with architecture
{platform.machine()} at working directory `{working_directory}`. All local file operations must occur here, but you can access files from any place in the file system. For all file system operations, you MUST use absolute paths to ensure precision and avoid ambiguity.
The current date is {datetime.date.today()}. For any date-related tasks, you MUST use this as the current date.
        """,
        options,
        [
            *HumanToolkit.get_can_use_tools(options.project_id, Agents.new_worker_agent),
            *(
                ToolkitMessageIntegration(
                    message_handler=HumanToolkit(options.project_id, Agents.new_worker_agent).send_message_to_user
                ).register_toolkits(NoteTakingToolkit(options.project_id, working_directory=working_directory))
            ).get_tools(),
        ],
    )
    # msg_toolkit = AgentCommunicationToolkit(max_message_history=100)

    searcher = search_agent(options)
    developer = await developer_agent(options)
    documenter = await document_agent(options)
    multi_modaler = multi_modal_agent(options)

    # msg_toolkit.register_agent("Worker", new_worker_agent)
    # msg_toolkit.register_agent("Search_Agent", searcher)
    # msg_toolkit.register_agent("Developer_Agent", developer)
    # msg_toolkit.register_agent("Document_Agent", documenter)
    # msg_toolkit.register_agent("Multi_Modal_Agent", multi_modaler)

    # Convert string model_platform to enum for comparison
    try:
        model_platform_enum = ModelPlatformType(options.model_platform.lower())
    except (ValueError, AttributeError):
        # If conversion fails, default to non-OpenAI behavior
        model_platform_enum = None

    workforce = Workforce(
        options.project_id,
        "A workforce",
        graceful_shutdown_timeout=3,  # 30 seconds for debugging
        share_memory=False,
        coordinator_agent=coordinator_agent,
        task_agent=task_agent,
        new_worker_agent=new_worker_agent,
        use_structured_output_handler=False if model_platform_enum == ModelPlatformType.OPENAI else True,
    )
    workforce.add_single_agent_worker(
        "Developer Agent: A master-level coding assistant with a powerful "
        "terminal. It can write and execute code, manage files, automate "
        "desktop tasks, and deploy web applications to solve complex "
        "technical challenges.",
        developer,
    )
    workforce.add_single_agent_worker(
        "Search Agent: Can search the web, extract webpage content, "
        "simulate browser actions, and provide relevant information to "
        "solve the given task.",
        searcher,
    )
    workforce.add_single_agent_worker(
        "Document Agent: A document processing assistant skilled in creating "
        "and modifying a wide range of file formats. It can generate "
        "text-based files/reports (Markdown, JSON, YAML, HTML), "
        "office documents (Word, PDF), presentations (PowerPoint), and "
        "data files (Excel, CSV).",
        documenter,
    )
    workforce.add_single_agent_worker(
        "Multi-Modal Agent: A specialist in media processing. It can "
        "analyze images and audio, transcribe speech, download videos, and "
        "generate new images from text prompts.",
        multi_modaler,
    )
    # workforce.add_single_agent_worker(
    #     "Social Media Agent: A social media management assistant for "
    #     "handling tasks related to WhatsApp, Twitter, LinkedIn, Reddit, "
    #     "Notion, Slack, and other social platforms.",
    #     await social_medium_agent(options),
    # )
    mcp = await mcp_agent(options)
    # workforce.add_single_agent_worker(
    #     "MCP Agent: A Model Context Protocol agent that provides access "
    #     "to external tools and services through MCP integrations.",
    #     mcp,
    # )
    return workforce, mcp


def format_agent_description(agent_data: NewAgent | ActionNewAgent) -> str:
    r"""Format a comprehensive agent description including name, tools, and
    description.
    """
    description_parts = [f"{agent_data.name}:"]

    # Add description if available
    if hasattr(agent_data, "description") and agent_data.description:
        description_parts.append(agent_data.description.strip())
    else:
        description_parts.append("A specialized agent")

    # Add tools information
    tool_names = []
    if hasattr(agent_data, "tools") and agent_data.tools:
        for tool in agent_data.tools:
            tool_names.append(titleize(tool))

    if hasattr(agent_data, "mcp_tools") and agent_data.mcp_tools:
        for mcp_server in agent_data.mcp_tools.get("mcpServers", {}).keys():
            tool_names.append(titleize(mcp_server))

    if tool_names:
        description_parts.append(f"with access to {', '.join(tool_names)} tools : <{tool_names}>")

    return " ".join(description_parts)


async def new_agent_model(data: NewAgent | ActionNewAgent, options: Chat):
    working_directory = options.file_save_path()
    tool_names = []
    tools = [*await get_toolkits(data.tools, data.name, options.project_id)]
    for item in data.tools:
        tool_names.append(titleize(item))
    if data.mcp_tools is not None:
        tools = [*tools, *await get_mcp_tools(data.mcp_tools)]
        for item in data.mcp_tools["mcpServers"].keys():
            tool_names.append(titleize(item))
    for item in tools:
        logger.debug(f"new agent function tool  ====== {item.func.__name__}")
    # Enhanced system message with platform information
    enhanced_description = f"""{data.description}
- You are now working in system {platform.system()} with architecture
{platform.machine()} at working directory `{working_directory}`. All local file operations must occur here, but you can access files from any place in the file system. For all file system operations, you MUST use absolute paths to ensure precision and avoid ambiguity.
The current date is {datetime.date.today()}. For any date-related tasks, you 
MUST use this as the current date.
"""

    return agent_model(data.name, enhanced_description, options, tools, tool_names=tool_names)
