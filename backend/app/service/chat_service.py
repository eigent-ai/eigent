import asyncio
import datetime
import json
from pathlib import Path
import platform
from typing import Literal
from fastapi import Request
from inflection import titleize
from pydash import chain
from app.component.debug import dump_class
from app.component.environment import env
from app.utils.file_utils import get_working_directory
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
from utils import traceroot_wrapper as traceroot
import os

logger = traceroot.get_logger("chat_service")


def format_task_context(task_data: dict, seen_files: set | None = None, skip_files: bool = False) -> str:
    """Format structured task data into a readable context string.

    Args:
        task_data: Dictionary containing task content, result, and working directory
        seen_files: Optional set to track already-listed files and avoid duplicates (deprecated, use skip_files instead)
        skip_files: If True, skip the file listing entirely
    """
    context_parts = []

    if task_data.get('task_content'):
        context_parts.append(f"Previous Task: {task_data['task_content']}")

    if task_data.get('task_result'):
        context_parts.append(f"Previous Task Result: {task_data['task_result']}")

    # Skip file listing if requested
    if not skip_files:
        working_directory = task_data.get('working_directory')
        if working_directory:
            try:
                if os.path.exists(working_directory):
                    generated_files = []
                    for root, dirs, files in os.walk(working_directory):
                        dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ['node_modules', '__pycache__', 'venv']]
                        for file in files:
                            if not file.startswith('.') and not file.endswith(('.pyc', '.tmp')):
                                file_path = os.path.join(root, file)
                                absolute_path = os.path.abspath(file_path)

                                # Only add if not seen before (or if we're not tracking seen files)
                                if seen_files is None or absolute_path not in seen_files:
                                    generated_files.append(absolute_path)
                                    if seen_files is not None:
                                        seen_files.add(absolute_path)

                    if generated_files:
                        context_parts.append("Generated Files from Previous Task:")
                        for file_path in sorted(generated_files):
                            context_parts.append(f"  - {file_path}")
            except Exception as e:
                logger.warning(f"Failed to collect generated files: {e}")

    return "\n".join(context_parts)


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
                dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ['node_modules', '__pycache__', 'venv']]
                for file in files:
                    if not file.startswith('.') and not file.endswith(('.pyc', '.tmp')):
                        file_path = os.path.join(root, file)
                        absolute_path = os.path.abspath(file_path)
                        generated_files.append(absolute_path)

            if generated_files:
                context_parts.append("Generated Files from Previous Task:")
                for file_path in sorted(generated_files):
                    context_parts.append(f"  - {file_path}")
                context_parts.append("")
    except Exception as e:
        logger.warning(f"Failed to collect generated files: {e}")

    context_parts.append("=== END OF PREVIOUS TASK CONTEXT ===\n")

    return "\n".join(context_parts)


def check_conversation_history_length(task_lock: TaskLock, max_length: int = 100000) -> tuple[bool, int]:
    """
    Check if conversation history exceeds maximum length

    Returns:
        tuple: (is_exceeded, total_length)
    """
    if not hasattr(task_lock, 'conversation_history') or not task_lock.conversation_history:
        return False, 0

    total_length = 0
    for entry in task_lock.conversation_history:
        total_length += len(entry.get('content', ''))

    is_exceeded = total_length > max_length

    if is_exceeded:
        logger.warning(f"Conversation history length {total_length} exceeds maximum {max_length}")

    return is_exceeded, total_length


def build_conversation_context(task_lock: TaskLock, header: str = "=== CONVERSATION HISTORY ===") -> str:
    """Build conversation context from task_lock history with files listed only once at the end.

    Args:
        task_lock: TaskLock containing conversation history
        header: Header text for the context section

    Returns:
        Formatted context string with task history and files listed once at the end
    """
    context = ""
    working_directories = set()  # Collect all unique working directories

    if task_lock.conversation_history:
        context = f"{header}\n"

        for entry in task_lock.conversation_history:
            if entry['role'] == 'task_result':
                if isinstance(entry['content'], dict):
                    formatted_context = format_task_context(entry['content'], skip_files=True)
                    context += formatted_context + "\n\n"
                    if entry['content'].get('working_directory'):
                        working_directories.add(entry['content']['working_directory'])
                else:
                    context += entry['content'] + "\n"
            elif entry['role'] == 'assistant':
                context += f"Assistant: {entry['content']}\n\n"

        if working_directories:
            all_generated_files = set()  # Use set to avoid duplicates
            for working_directory in working_directories:
                try:
                    if os.path.exists(working_directory):
                        for root, dirs, files in os.walk(working_directory):
                            dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ['node_modules', '__pycache__', 'venv']]
                            for file in files:
                                if not file.startswith('.') and not file.endswith(('.pyc', '.tmp')):
                                    file_path = os.path.join(root, file)
                                    absolute_path = os.path.abspath(file_path)
                                    all_generated_files.add(absolute_path)
                except Exception as e:
                    logger.warning(f"Failed to collect generated files from {working_directory}: {e}")

            if all_generated_files:
                context += "Generated Files from Previous Tasks:\n"
                for file_path in sorted(all_generated_files):
                    context += f"  - {file_path}\n"
                context += "\n"

        context += "\n"

    return context


def build_context_for_workforce(task_lock: TaskLock, options: Chat) -> str:
    """Build context information for workforce."""
    return build_conversation_context(task_lock, header="=== CONVERSATION HISTORY ===")


@sync_step
@traceroot.trace()
async def step_solve(options: Chat, request: Request, task_lock: TaskLock):
    # if True:
    #     import faulthandler

    #     faulthandler.enable()
    #     for second in [5, 10, 20, 30, 60, 120, 240]:
    #         faulthandler.dump_traceback_later(second)

    start_event_loop = True

    if not hasattr(task_lock, 'conversation_history'):
        task_lock.conversation_history = []
    if not hasattr(task_lock, 'last_task_result'):
        task_lock.last_task_result = ""
    if not hasattr(task_lock, 'question_agent'):
        task_lock.question_agent = None
    if not hasattr(task_lock, 'summary_generated'):
        task_lock.summary_generated = False

    # Create or reuse persistent question_agent
    if task_lock.question_agent is None:
        task_lock.question_agent = question_confirm_agent(options)
        logger.info(f"Created new persistent question_agent for project {options.project_id}")
    else:
        logger.info(f"Reusing existing question_agent with {len(task_lock.conversation_history)} history entries")

    question_agent = task_lock.question_agent

    # Other variables
    camel_task = None
    workforce = None
    last_completed_task_result = ""  # Track the last completed task result
    summary_task_content = ""  # Track task summary
    loop_iteration = 0

    logger.info("Starting step_solve", extra={"project_id": options.project_id, "task_id": options.task_id})
    logger.debug("Step solve options", extra={"task_id": options.task_id, "model_platform": options.model_platform})

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
            logger.error("Error getting item from queue", extra={"project_id": options.project_id, "task_id": options.task_id, "error": str(e)}, exc_info=True)
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

                is_exceeded, total_length = check_conversation_history_length(task_lock)
                if is_exceeded:
                    logger.error("Conversation history too long", extra={"project_id": options.project_id, "current_length": total_length, "max_length": 100000})
                    yield sse_json("context_too_long", {
                        "message": "The conversation history is too long. Please create a new project to continue.",
                        "current_length": total_length,
                        "max_length": 100000
                    })
                    continue

                # Simplified logic: attachments mean workforce, otherwise let agent decide
                is_complex_task: bool
                if len(options.attaches) > 0:
                    # Questions with attachments always need workforce
                    is_complex_task = True
                else:
                    is_complex_task = await question_confirm(question_agent, question, task_lock)

                if not is_complex_task:
                    simple_answer_prompt = f"{build_conversation_context(task_lock, header='=== Previous Conversation ===')}User Query: {question}\n\nProvide a direct, helpful answer to this simple question."

                    try:
                        simple_resp = question_agent.step(simple_answer_prompt)
                        answer_content = simple_resp.msgs[0].content if simple_resp and simple_resp.msgs else "I understand your question, but I'm having trouble generating a response right now."

                        task_lock.add_conversation('assistant', answer_content)

                        yield sse_json("wait_confirm", {"content": answer_content, "question": question})
                    except Exception as e:
                        logger.error(f"Error generating simple answer: {e}")
                        yield sse_json("wait_confirm", {"content": "I encountered an error while processing your question.", "question": question})

                    # Clean up empty folder if it was created for this task
                    if hasattr(task_lock, 'new_folder_path') and task_lock.new_folder_path:
                        try:
                            folder_path = Path(task_lock.new_folder_path)
                            if folder_path.exists() and folder_path.is_dir():
                                # Check if folder is empty
                                if not any(folder_path.iterdir()):
                                    folder_path.rmdir()
                                    logger.info(f"Cleaned up empty folder: {folder_path}")
                                    # Also clean up parent project folder if it becomes empty
                                    project_folder = folder_path.parent
                                    if project_folder.exists() and not any(project_folder.iterdir()):
                                        project_folder.rmdir()
                                        logger.info(f"Cleaned up empty project folder: {project_folder}")
                                else:
                                    logger.info(f"Folder not empty, keeping: {folder_path}")
                            # Reset the folder path
                            task_lock.new_folder_path = None
                        except Exception as e:
                            logger.error(f"Error cleaning up folder: {e}")
                else:
                    yield sse_json("confirmed", {"question": question})

                    context_for_coordinator = build_context_for_workforce(task_lock, options)

                    (workforce, mcp) = await construct_workforce(options)
                    for new_agent in options.new_agents:
                        workforce.add_single_agent_worker(
                            format_agent_description(new_agent), await new_agent_model(new_agent, options)
                        )
                    task_lock.status = Status.confirmed

                    clean_task_content = question + options.summary_prompt
                    camel_task = Task(content=clean_task_content, id=options.task_id)
                    if len(options.attaches) > 0:
                        camel_task.additional_info = {Path(file_path).name: file_path for file_path in options.attaches}

                    sub_tasks = await asyncio.to_thread(
                        workforce.eigent_make_sub_tasks,
                        camel_task,
                        context_for_coordinator
                    )

                    if not task_lock.summary_generated:
                        summary_task_agent = task_summary_agent(options)
                        try:
                            summary_task_content = await asyncio.wait_for(
                                summary_task(summary_task_agent, camel_task), timeout=10
                            )
                            task_lock.summary_generated = True
                            logger.info("Generated summary for first task", extra={"project_id": options.project_id})
                        except asyncio.TimeoutError:
                            logger.warning("summary_task timeout", extra={"project_id": options.project_id, "task_id": options.task_id})
                            # Fallback to a minimal summary to unblock UI
                            fallback_name = "Task"
                            content_preview = camel_task.content if hasattr(camel_task, "content") else ""
                            if content_preview is None:
                                content_preview = ""
                            fallback_summary = (
                                (content_preview[:80] + "...") if len(content_preview) > 80 else content_preview
                            )
                            summary_task_content = f"{fallback_name}|{fallback_summary}"
                            task_lock.summary_generated = True
                    else:
                        if len(question) > 100:
                            summary_task_content = f"Task|{question[:97]}..."
                        else:
                            summary_task_content = f"Task|{question}"
                        logger.info("Skipped summary generation for subsequent task", extra={"project_id": options.project_id})

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
                # Check conversation history length before starting task
                is_exceeded, total_length = check_conversation_history_length(task_lock)
                if is_exceeded:
                    logger.error(f"Cannot start task: conversation history too long ({total_length} chars) for project {options.project_id}")
                    yield sse_json("context_too_long", {
                        "message": "The conversation history is too long. Please create a new project to continue.",
                        "current_length": total_length,
                        "max_length": 100000
                    })
                    continue

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

                old_task_content: str = camel_task.content
                old_task_result: str = await get_task_result_with_optional_summary(camel_task, options)

                old_task_content_clean: str = old_task_content
                if "=== CURRENT TASK ===" in old_task_content_clean:
                    old_task_content_clean = old_task_content_clean.split("=== CURRENT TASK ===")[-1].strip()

                task_lock.add_conversation('task_result', {
                    'task_content': old_task_content_clean,
                    'task_result': old_task_result,
                    'working_directory': get_working_directory(options, task_lock)
                })

                new_task_content = item.data.get('content', '')

                if new_task_content:
                    import time
                    task_id = item.data.get('task_id', f"{int(time.time() * 1000)}-multi")
                    new_camel_task = Task(content=new_task_content, id=task_id)
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
                        is_multi_turn_complex = await question_confirm(question_agent, new_task_content, task_lock)

                        if not is_multi_turn_complex:
                            simple_answer_prompt = f"{build_conversation_context(task_lock, header='=== Previous Conversation ===')}User Query: {new_task_content}\n\nProvide a direct, helpful answer to this simple question."

                            try:
                                simple_resp = question_agent.step(simple_answer_prompt)
                                answer_content = simple_resp.msgs[0].content if simple_resp and simple_resp.msgs else "I understand your question, but I'm having trouble generating a response right now."

                                task_lock.add_conversation('assistant', answer_content)

                                # Send response to user
                                yield sse_json("confirmed", {"question": new_task_content})
                                yield sse_json("wait_confirm", {"content": answer_content, "question": new_task_content})
                            except Exception as e:
                                logger.error(f"Error generating simple answer in multi-turn: {e}")
                                yield sse_json("wait_confirm", {"content": "I encountered an error while processing your question.", "question": new_task_content})

                            workforce.resume()
                            continue  # This continues the main while loop, waiting for next action

                        yield sse_json("confirmed", {"question": new_task_content})
                        task_lock.status = Status.confirmed

                        context_for_multi_turn = build_context_for_workforce(task_lock, options)

                        new_sub_tasks = await workforce.handle_decompose_append_task(
                            camel_task,
                            reset=False,
                            coordinator_context=context_for_multi_turn
                        )

                        task_content_for_summary = new_task_content
                        if len(task_content_for_summary) > 100:
                            new_summary_content = f"Follow-up Task|{task_content_for_summary[:97]}..."
                        else:
                            new_summary_content = f"Follow-up Task|{task_content_for_summary}"

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
                    logger.info(f"Workforce paused for project {options.project_id}")
                else:
                    logger.warning(f"Cannot pause: workforce is None for project {options.project_id}")
            elif item.action == Action.resume:
                if workforce is not None:
                    workforce.resume()
                    logger.info(f"Workforce resumed for project {options.project_id}")
                else:
                    logger.warning(f"Cannot resume: workforce is None for project {options.project_id}")
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
                final_result: str = await get_task_result_with_optional_summary(camel_task, options)

                task_lock.last_task_result = final_result

                task_content: str = camel_task.content
                if "=== CURRENT TASK ===" in task_content:
                    task_content = task_content.split("=== CURRENT TASK ===")[-1].strip()

                task_lock.add_conversation('task_result', {
                    'task_content': task_content,
                    'task_result': final_result,
                    'working_directory': get_working_directory(options, task_lock)
                })


                yield sse_json("end", final_result)

                if workforce is not None:
                    workforce.stop_gracefully()
                    logger.info(f"Workforce stopped gracefully for project {options.project_id}")
                    workforce = None
                else:
                    logger.warning(f"Workforce already None at end action for project {options.project_id}")

                camel_task = None

                if question_agent is not None:
                    question_agent.reset()
                    logger.info(f"Reset question_agent for project {options.project_id}")
            elif item.action == Action.supplement:

                # Check if this might be a misrouted second question
                if camel_task is None:
                    logger.warning(f"SUPPLEMENT action received but camel_task is None for project {options.project_id}")
                else:
                    assert camel_task is not None
                    task_lock.status = Status.processing
                    camel_task.add_subtask(
                        Task(
                            content=item.data.question,
                            id=f"{camel_task.id}.{len(camel_task.subtasks)}",
                        )
                    )
                    if workforce is not None:
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
                    logger.info(f"Workforce stopped for project {options.project_id}")
                else:
                    logger.warning(f"Workforce is None at stop action for project {options.project_id}")
                await delete_task_lock(task_lock.id)
                break
            else:
                logger.warning(f"Unknown action: {item.action}")
        except ModelProcessingError as e:
            if "Budget has been exceeded" in str(e):
                logger.warning(f"Budget exceeded for task {options.task_id}, action: {item.action}")
                # workforce decompose task don't use ListenAgent, this need return sse
                if "workforce" in locals() and workforce is not None:
                    workforce.pause()
                yield sse_json(Action.budget_not_enough, {"message": "budget not enouth"})
            else:
                logger.error(f"ModelProcessingError for task {options.task_id}, action {item.action}: {e}", exc_info=True)
                yield sse_json("error", {"message": str(e)})
                if "workforce" in locals() and workforce is not None and workforce._running:
                    workforce.stop()
        except Exception as e:
            logger.error(f"Unhandled exception for task {options.task_id}, action {item.action}: {e}", exc_info=True)
            yield sse_json("error", {"message": str(e)})
            # Continue processing other items instead of breaking


@traceroot.trace()
async def install_mcp(
    mcp: ListenChatAgent,
    install_mcp: ActionInstallMcpData,
):
    logger.info(f"Installing MCP tools: {list(install_mcp.data.get('mcpServers', {}).keys())}")
    try:
        mcp.add_tools(await get_mcp_tools(install_mcp.data))
        logger.info("MCP tools installed successfully")
    except Exception as e:
        logger.error(f"Error installing MCP tools: {e}", exc_info=True)
        raise


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


async def question_confirm(agent: ListenChatAgent, prompt: str, task_lock: TaskLock | None = None) -> bool:
    """Simple question confirmation - returns True for complex tasks, False for simple questions."""

    context_prompt = ""
    if task_lock:
        context_prompt = build_conversation_context(task_lock, header="=== Previous Conversation ===")

    full_prompt = f"""{context_prompt}User Query: {prompt}

Determine if this user query is a complex task or a simple question.

**Complex task** (answer "yes"): Requires tools, code execution, file operations, multi-step planning, or creating/modifying content
- Examples: "create a file", "search for X", "implement feature Y", "write code", "analyze data", "build something"

**Simple question** (answer "no"): Can be answered directly with knowledge or conversation history, no action needed
- Examples: greetings ("hello", "hi"), fact queries ("what is X?"), clarifications ("what did you mean?"), status checks ("how are you?")

Answer only "yes" or "no". Do not provide any explanation.

Is this a complex task? (yes/no):"""

    try:
        resp = agent.step(full_prompt)

        if not resp or not resp.msgs or len(resp.msgs) == 0:
            logger.warning("No response from agent, defaulting to complex task")
            return True

        content = resp.msgs[0].content
        if not content:
            logger.warning("Empty content from agent, defaulting to complex task")
            return True

        normalized = content.strip().lower()
        is_complex = "yes" in normalized

        logger.info(f"Question confirm result: {'complex task' if is_complex else 'simple question'}",
                   extra={"response": content, "is_complex": is_complex})

        return is_complex

    except Exception as e:
        logger.error(f"Error in question_confirm: {e}")
        return True


@traceroot.trace()
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
    logger.debug("Generating task summary", extra={"task_id": task.id})
    try:
        res = agent.step(prompt)
        summary = res.msgs[0].content
        logger.info("Task summary generated", extra={"summary": summary})
        return summary
    except Exception as e:
        logger.error("Error generating task summary", extra={"error": str(e)}, exc_info=True)
        raise


async def summary_subtasks_result(agent: ListenChatAgent, task: Task) -> str:
    """
    Summarize the aggregated results from all subtasks into a concise summary.

    Args:
        agent: The summary agent to use
        task: The main task containing subtasks and their aggregated results

    Returns:
        A concise summary of all subtask results
    """
    subtasks_info = ""
    for i, subtask in enumerate(task.subtasks, 1):
        subtasks_info += f"\n**Subtask {i}**\n"
        subtasks_info += f"Description: {subtask.content}\n"
        subtasks_info += f"Result: {subtask.result or 'No result'}\n"
        subtasks_info += "---\n"

    prompt = f"""You are a professional summarizer. Summarize the results of the following subtasks.

Main Task: {task.content}

Subtasks (with descriptions and results):
---
{subtasks_info}
---

Instructions:
1. Provide a concise summary of what was accomplished
2. Highlight key findings or outputs from each subtask
3. Mention any important files created or actions taken
4. Use bullet points or sections for clarity
5. DO NOT repeat the task name in your summary - go straight to the results
6. Keep it professional but conversational

Summary:
"""

    res = agent.step(prompt)
    summary = res.msgs[0].content

    logger.info(f"Generated subtasks summary for task {task.id} with {len(task.subtasks)} subtasks")

    return summary


async def get_task_result_with_optional_summary(task: Task, options: Chat) -> str:
    """
    Get the task result, with LLM summary if there are multiple subtasks.

    Args:
        task: The task to get result from
        options: Chat options for creating summary agent

    Returns:
        The task result (summarized if multiple subtasks, raw otherwise)
    """
    result = str(task.result or "")

    if task.subtasks and len(task.subtasks) > 1:
        logger.info(f"Task {task.id} has {len(task.subtasks)} subtasks, generating summary")
        try:
            summary_agent = task_summary_agent(options)
            summarized_result = await summary_subtasks_result(summary_agent, task)
            result = summarized_result
            logger.info(f"Successfully generated summary for task {task.id}")
        except Exception as e:
            logger.error(f"Failed to generate summary for task {task.id}: {e}")
    elif task.subtasks and len(task.subtasks) == 1:
        logger.info(f"Task {task.id} has only 1 subtask, skipping LLM summary")
        if result and "--- Subtask" in result and "Result ---" in result:
            parts = result.split("Result ---", 1)
            if len(parts) > 1:
                result = parts[1].strip()

    return result


@traceroot.trace()
async def construct_workforce(options: Chat) -> tuple[Workforce, ListenChatAgent]:
    logger.info("Constructing workforce", extra={"project_id": options.project_id, "task_id": options.task_id})
    working_directory = get_working_directory(options)
    logger.debug("Working directory set", extra={"working_directory": working_directory})
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


@traceroot.trace()
async def new_agent_model(data: NewAgent | ActionNewAgent, options: Chat):
    logger.info("Creating new agent", extra={"agent_name": data.name, "project_id": options.project_id, "task_id": options.task_id})
    logger.debug("New agent data", extra={"agent_data": data.model_dump_json()})
    working_directory = get_working_directory(options)
    tool_names = []
    tools = [*await get_toolkits(data.tools, data.name, options.project_id)]
    for item in data.tools:
        tool_names.append(titleize(item))
    if data.mcp_tools is not None:
        tools = [*tools, *await get_mcp_tools(data.mcp_tools)]
        for item in data.mcp_tools["mcpServers"].keys():
            tool_names.append(titleize(item))
    for item in tools:
        logger.debug(f"Agent {data.name} tool: {item.func.__name__}")
    logger.info(f"Agent {data.name} created with {len(tools)} tools: {tool_names}")
    # Enhanced system message with platform information
    enhanced_description = f"""{data.description}
- You are now working in system {platform.system()} with architecture
{platform.machine()} at working directory `{working_directory}`. All local file operations must occur here, but you can access files from any place in the file system. For all file system operations, you MUST use absolute paths to ensure precision and avoid ambiguity.
The current date is {datetime.date.today()}. For any date-related tasks, you 
MUST use this as the current date.
"""

    return agent_model(data.name, enhanced_description, options, tools, tool_names=tool_names)
