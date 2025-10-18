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

    # Add conversation history
    if task_lock.conversation_history:
        context = "=== CONVERSATION HISTORY ===\n"

        # Only include recent conversations to avoid overly long context
        for entry in task_lock.conversation_history[-10:]:
            if entry['role'] == 'task_result':
                # Simplify task result display
                context += f"[Previous Task Completed]\n"
            else:
                context += f"{entry['role']}: {entry['content'][:200]}\n"

        context += "\n"

    # Add previous task's detailed result
    if task_lock.last_task_result:
        context += collect_previous_task_context(
            working_directory=options.file_save_path(),
            previous_task_content="",
            previous_task_result=task_lock.last_task_result,
            previous_summary=task_lock.last_task_summary
        )

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
        logger.info(f"[CONTEXT] Created new persistent question_agent for project {options.project_id}")
    else:
        logger.info(f"[CONTEXT] Reusing existing question_agent with {len(task_lock.conversation_history)} history entries")

    question_agent = task_lock.question_agent

    # Other variables
    camel_task = None
    workforce = None
    last_completed_task_result = ""  # Track the last completed task result
    summary_task_content = ""  # Track task summary
    loop_iteration = 0

    logger.info(f"[TRACE] === STARTING MAIN LOOP for project {options.project_id} ===")
    logger.info(f"[CONTEXT] Starting with {len(task_lock.conversation_history)} previous conversations")

    while True:
        loop_iteration += 1
        logger.info(f"[TRACE] Main loop iteration {loop_iteration}, waiting for action...")

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
            logger.info(f"[TRACE] Waiting for queue item...")
            item = await task_lock.get_queue()
            logger.info(f"[TRACE] Received action: {item.action}, project_id: {options.project_id}")
            if hasattr(item, 'data'):
                logger.info(f"[TRACE] Action data preview: {str(item.data)[:200]}")
            # logger.info(f"item: {dump_class(item)}")
        except Exception as e:
            logger.error(f"Error getting item from queue: {e}")
            # Continue waiting instead of breaking on queue error
            continue

        try:
            logger.info(f"[TRACE] Processing action: {item.action}, start_event_loop={start_event_loop}")
            if item.action == Action.improve or start_event_loop:
                # from viztracer import VizTracer

                # tracer = VizTracer()
                # tracer.start()
                if start_event_loop is True:
                    question = options.question
                    logger.info(f"[TRACE] Starting event loop with initial question: {question[:100]}...")
                    start_event_loop = False
                else:
                    assert isinstance(item, ActionImproveData)
                    question = item.data
                    logger.info(f"[TRACE] Processing improve action with question: {question[:100]}...")

                logger.info(f"[TRACE] Question length: {len(question)}, Attaches: {len(options.attaches)}")

                # Save user question to history
                task_lock.add_conversation('user', question)

                # For questions that might reference previous context, always use context-aware confirmation
                # This allows the agent to determine if it can answer from context
                if len(options.attaches) == 0 and task_lock.last_task_result:
                    # If there's previous task result, let agent decide based on context
                    logger.info(f"[CONTEXT] Previous task result exists, using context-aware confirmation...")
                    confirm = await question_confirm_with_context(question_agent, question, task_lock)
                    logger.info(f"[CONTEXT] Question confirmation result: {type(confirm)}")
                elif len(question) < 12 and len(options.attaches) == 0:
                    logger.info(f"[CONTEXT] Short question detected, confirming with context-aware agent...")
                    confirm = await question_confirm_with_context(question_agent, question, task_lock)
                    logger.info(f"[CONTEXT] Question confirmation result: {type(confirm)}")
                else:
                    confirm = True
                    logger.info(f"[CONTEXT] Long question with no context or has attachments, treating as complex task")

                if confirm is not True:
                    logger.info(f"[CONTEXT] Question not confirmed as complex task, returning simple response")
                    logger.info(f"[TRACE] SSE Response being sent: {confirm}")

                    # Extract and save assistant response to history
                    try:
                        import json
                        response_data = json.loads(confirm.split("data: ")[1].strip())
                        response_content = response_data['data']['content']
                        task_lock.add_conversation('assistant', response_content)
                        logger.info(f"[CONTEXT] Simple response saved to history, now has {len(task_lock.conversation_history)} entries")
                    except Exception as e:
                        logger.error(f"[CONTEXT] Failed to save response to history: {e}")

                    yield confirm
                    logger.info(f"[TRACE] Simple response sent, continuing main loop to wait for next action...")
                    logger.info(f"[TRACE] Current state after simple response - workforce: {workforce is not None}, camel_task: {camel_task is not None}")
                    logger.info(f"[TRACE] Waiting for next action (should be Action.improve for next question)...")
                    # After sending simple response, continue waiting for next action
                else:
                    logger.info(f"[CONTEXT] Task confirmed as complex, preparing workforce with context")
                    yield sse_json("confirmed", {"question": question})

                    # ========== Prepare context for workforce ==========
                    context_for_task = build_context_for_workforce(task_lock, options)
                    logger.info(f"[CONTEXT] Built context for workforce: {len(context_for_task)} chars")

                    (workforce, mcp) = await construct_workforce(options)
                    logger.info(f"[TRACE] Workforce created, initial state: {workforce._state.name if hasattr(workforce, '_state') else 'unknown'}")
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
                    logger.info(f"[CONTEXT] Created task with context: {options.task_id}")
                    if len(options.attaches) > 0:
                        camel_task.additional_info = {Path(file_path).name: file_path for file_path in options.attaches}

                    logger.info(f"[TRACE] Starting task decomposition for task: {options.task_id}")
                    sub_tasks = await asyncio.to_thread(workforce.eigent_make_sub_tasks, camel_task)
                    logger.info(f"[TRACE] Task decomposed into {len(sub_tasks)} subtasks")
                    summary_task_content = await summary_task(summary_task_agent, camel_task)

                    # Save task summary for future reference
                    task_lock.last_task_summary = summary_task_content
                    logger.info(f"[CONTEXT] Saved task summary for future context")

                    logger.info(f"[TRACE] Sending subtasks to frontend")
                    yield to_sub_tasks(camel_task, summary_task_content)
                    # tracer.stop()
                    # tracer.save("trace.json")

                    # Auto-start workforce in specific scenarios
                    should_auto_start = False

                    # If this is a follow-up question with context, auto-start
                    if task_lock.last_task_result and len(sub_tasks) <= 2:
                        logger.info(f"[CONTEXT] Auto-starting workforce for context-based follow-up task")
                        should_auto_start = True

                    # If debug mode is on, auto-start
                    if env("debug") == "on":
                        logger.info(f"[CONTEXT] Auto-starting workforce in debug mode")
                        should_auto_start = True

                    if should_auto_start:
                        task_lock.status = Status.processing
                        task = asyncio.create_task(workforce.eigent_start(sub_tasks))
                        task_lock.add_background_task(task)
                    else:
                        logger.info(f"[CONTEXT] Waiting for manual start command from frontend")

            elif item.action == Action.update_task:
                assert camel_task is not None
                update_tasks = {item.id: item for item in item.data.task}
                sub_tasks = update_sub_tasks(sub_tasks, update_tasks)
                add_sub_tasks(camel_task, item.data.task)
                yield to_sub_tasks(camel_task, summary_task_content)
            elif item.action == Action.add_task:
                logger.info(f"[TRACE] === ADD_TASK action received ===")
                logger.info(f"[TRACE] Task content: {item.content[:100] if hasattr(item, 'content') else 'N/A'}")
                logger.info(f"[TRACE] Task ID: {item.task_id if hasattr(item, 'task_id') else 'N/A'}")

                # Check if this might be a misrouted second question
                if camel_task is None and workforce is None:
                    logger.warning(f"[TRACE] ADD_TASK received but no active task/workforce - this might be the second question!")
                    logger.warning(f"[TRACE] The frontend might be sending the second question as ADD_TASK instead of IMPROVE")
                    logger.warning(f"[TRACE] Content being added: {item.content if hasattr(item, 'content') else 'N/A'}")
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
                        logger.info(f"[CHAT] Resuming paused workforce to skip task")
                        workforce.resume()
                    workforce.skip_gracefully()
            elif item.action == Action.start:
                logger.info(f"[TRACE] === START action received ===")
                if workforce is not None:
                    logger.info(f"[TRACE] Workforce state: {workforce._state.name if hasattr(workforce, '_state') else 'unknown'}")
                    if workforce._state.name == 'PAUSED':
                        # Resume paused workforce - subtasks should already be loaded
                        logger.info(f"[TRACE] Resuming paused workforce with existing subtasks")
                        workforce.resume()
                        continue
                else:
                    logger.info(f"[TRACE] Workforce is None, cannot start")
                    continue

                logger.info(f"[TRACE] Starting workforce with {len(sub_tasks)} subtasks")
                task_lock.status = Status.processing
                task = asyncio.create_task(workforce.eigent_start(sub_tasks))
                task_lock.add_background_task(task)
            elif item.action == Action.task_state:
                # Track completed task results for the end event
                if item.data.get('state') == 'DONE' and item.data.get('result'):
                    last_completed_task_result = item.data.get('result', '')
                    logger.info(f"[CONTEXT] Task completed with result: {last_completed_task_result[:100]}...")
                yield sse_json("task_state", item.data)
            elif item.action == Action.new_task_state:
                logger.info(f"[TRACE] === NEW_TASK_STATE action received ===")
                logger.info(f"[TRACE] Task data: {item.data}")
                assert camel_task is not None

                # Store the old task information before updating camel_task
                old_task_content = camel_task.content
                old_task_result = str(camel_task.result)
                old_task_summary = summary_task_content if 'summary_task_content' in locals() else ""

                # Extract task content from the new task data immediately
                # Don't return question field for new_tasks
                new_task_content = item.data.get('content', '')
                logger.info(f"[TRACE] New task content: {new_task_content[:100]}...")

                # Collect context from previous task and prepend to new task
                if new_task_content:
                    working_directory = options.file_save_path()
                    previous_context = collect_previous_task_context(
                        working_directory=working_directory,
                        previous_task_content=old_task_content,
                        previous_task_result=old_task_result,
                        previous_summary=old_task_summary
                    )
                    # Prepend context to new task content
                    new_task_content_with_context = previous_context + new_task_content
                    logger.info(f"[CHAT] Added previous task context ({len(previous_context)} chars) to new task")
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
                    logger.info(f"[TRACE] === MULTI-TURN PROCESSING STARTED ===")
                    logger.info(f"[TRACE] Multi-turn task ID: {item.data.get('task_id')}")
                    logger.info(f"[TRACE] Multi-turn content length: {len(new_task_content)}")
                    logger.info(f"[TRACE] Workforce state before pause: {workforce._state if hasattr(workforce, '_state') else 'unknown'}")
                    task_lock.status = Status.confirming
                    workforce.pause()
                    logger.info(f"[TRACE] Workforce paused, state: {workforce._state if hasattr(workforce, '_state') else 'unknown'}")

                    try:
                        # Check if this is a simple query
                        if len(new_task_content) < 12:
                            logger.info(f"[TRACE] Short multi-turn question detected, checking with question_agent")
                            multi_turn_confirm = await question_confirm(question_agent, new_task_content)
                            logger.info(f"[TRACE] Multi-turn question confirmation result: {multi_turn_confirm}")

                            if multi_turn_confirm is not True:
                                logger.info(f"[TRACE] Multi-turn question identified as simple query, not decomposing")
                                # Still need to send appropriate responses
                                yield sse_json("confirmed", {"question": new_task_content})
                                yield multi_turn_confirm
                                logger.info(f"[TRACE] Resuming workforce after simple query response")
                                workforce.resume()
                                logger.info(f"[TRACE] !!! IMPORTANT: Continuing to next iteration after simple query - this skips further processing !!!")
                                continue  # This continues the main while loop, waiting for next action

                        logger.info(f"[TRACE] Proceeding with multi-turn task decomposition")
                        yield sse_json("confirmed", {"question": new_task_content})
                        task_lock.status = Status.confirmed

                        # Use existing workforce to decompose (without creating new one)
                        # Append to _pending_tasks
                        logger.info(f"[TRACE] Calling workforce.handle_decompose_append_task with reset=False")
                        new_sub_tasks = await workforce.handle_decompose_append_task(
                            camel_task,  # Use the updated camel_task
                            reset=False  # Keep existing agents and context
                        )
                        logger.info(f"[TRACE] Decomposition complete, got {len(new_sub_tasks)} subtasks")

                        # Generate summary using existing agents
                        summary_task_agent_instance = task_summary_agent(options)
                        new_summary_content = await summary_task(summary_task_agent_instance, camel_task)
                        logger.info(f"[TRACE] Summary generated for multi-turn task")

                        # Send the extracted events
                        logger.info(f"[TRACE] Sending subtasks to frontend for multi-turn task")
                        yield to_sub_tasks(camel_task, new_summary_content)

                        # Update the context with new task data
                        sub_tasks = new_sub_tasks
                        summary_task_content = new_summary_content

                        logger.info(f"[TRACE] Multi-turn task decomposed successfully into {len(sub_tasks)} subtasks")
                        
                    except Exception as e:
                        logger.error(f"[TRACE] Error processing multi-turn task: {e}")
                        import traceback
                        logger.error(f"[TRACE] Traceback: {traceback.format_exc()}")
                        # Continue with existing context if decomposition fails
                        yield sse_json("error", {"message": f"Failed to process task: {str(e)}"})
                else:
                    logger.warning(f"[TRACE] Multi-turn processing skipped: workforce={workforce is not None}, new_task_content_exists={bool(new_task_content)}")
                    if workforce is None:
                        logger.warning(f"[TRACE] Workforce is None - this might be the issue")
                    if not new_task_content:
                        logger.warning(f"[TRACE] No new task content provided")
            elif item.action == Action.create_agent:
                logger.info(f"[TRACE] Processing create_agent action")
                yield sse_json("create_agent", item.data)
            elif item.action == Action.activate_agent:
                logger.info(f"[TRACE] Processing activate_agent action")
                yield sse_json("activate_agent", item.data)
            elif item.action == Action.deactivate_agent:
                logger.info(f"[TRACE] Processing deactivate_agent action")
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
                logger.info(f"[TRACE] === PAUSE action received ===")
                if workforce is not None:
                    logger.info(f"[TRACE] Pausing workforce, current state: {workforce._state.name if hasattr(workforce, '_state') else 'unknown'}")
                    workforce.pause()
                    logger.info(f"[TRACE] Workforce paused, new state: {workforce._state.name if hasattr(workforce, '_state') else 'unknown'}")
                else:
                    logger.info(f"[TRACE] Workforce is None, cannot pause")
            elif item.action == Action.resume:
                logger.info(f"[TRACE] === RESUME action received ===")
                if workforce is not None:
                    logger.info(f"[TRACE] Resuming workforce, current state: {workforce._state.name if hasattr(workforce, '_state') else 'unknown'}")
                    workforce.resume()
                    logger.info(f"[TRACE] Workforce resumed, new state: {workforce._state.name if hasattr(workforce, '_state') else 'unknown'}")
                else:
                    logger.info(f"[TRACE] Workforce is None, cannot resume")
            elif item.action == Action.new_agent:
                if workforce is not None:
                    workforce.pause()
                    workforce.add_single_agent_worker(
                        format_agent_description(item), await new_agent_model(item, options)
                    )
                    workforce.resume()
            elif item.action == Action.end:
                logger.info(f"[CONTEXT] === END action received, saving context ===")
                assert camel_task is not None
                task_lock.status = Status.done

                # Get the final result from multiple sources in priority order:
                final_result = ""
                if last_completed_task_result:
                    final_result = last_completed_task_result
                else:
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

                logger.info(f"[CONTEXT] Task context saved: {len(full_task_context)} chars")
                logger.info(f"[CONTEXT] Conversation history now has {len(task_lock.conversation_history)} entries")

                logger.info(f"[TRACE] Sending end signal with result: {final_result[:100]}...")
                yield sse_json("end", final_result)

                if workforce is not None:
                    logger.info(f"[TRACE] Stopping workforce gracefully")
                    workforce.stop_gracefully()
                    logger.info(f"[TRACE] Workforce stopped")
                    # Reset workforce to None after stopping
                    workforce = None
                else:
                    logger.warning(f"[TRACE] Workforce is None at end action")

                # Reset camel_task to None for next task
                camel_task = None

                # Continue the loop to wait for next message instead of breaking
                logger.info(f"[CONTEXT] Task ended, continuing main loop to wait for next action...")
                logger.info(f"[CONTEXT] Context preserved for next conversation")
                # Don't break here - continue waiting for next action
            elif item.action == Action.supplement:
                logger.info(f"[TRACE] === SUPPLEMENT action received ===")
                logger.info(f"[TRACE] Supplement question: {item.data.question[:100] if hasattr(item.data, 'question') else 'N/A'}")

                # Check if this might be a misrouted second question
                if camel_task is None:
                    logger.warning(f"[TRACE] SUPPLEMENT received but camel_task is None - this might be a misrouted second question!")
                    logger.warning(f"[TRACE] The frontend might be sending the second question as SUPPLEMENT instead of IMPROVE")
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
                logger.info(f"[TRACE] === STOP action received ===")
                if workforce is not None:
                    logger.info(f"[TRACE] Workforce exists, state: {workforce._state.name if hasattr(workforce, '_state') else 'unknown'}")
                    if workforce._running:
                        logger.info(f"[TRACE] Workforce is running, stopping it")
                        workforce.stop()
                    logger.info(f"[TRACE] Stopping workforce gracefully")
                    workforce.stop_gracefully()
                else:
                    logger.warning(f"[TRACE] Workforce is None at stop action")
                logger.info(f"[TRACE] Deleting task lock")
                await delete_task_lock(task_lock.id)
                logger.info(f"[TRACE] Breaking main loop")
                break
            else:
                logger.warning(f"[TRACE] Unknown/Unhandled action: {item.action}")
                logger.warning(f"[TRACE] Current state - workforce: {workforce is not None}, camel_task: {camel_task is not None}")
                logger.warning(f"[TRACE] Full item data: {dump_class(item) if 'dump_class' in locals() else str(item)}")
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


async def question_confirm(agent: ListenChatAgent, prompt: str) -> str | Literal[True]:
    logger.info(f"[TRACE] === question_confirm called ===")
    logger.info(f"[TRACE] Original prompt: {prompt[:100]}...")

    prompt = f"""
> **Your Role:** You are a highly capable agent. Your primary function is to analyze a user's request and determine the appropriate course of action.
>
> **Your Process:**
>
> 1.  **Analyze the User's Query:** Carefully examine the user's request: `{prompt}`.
>
> 2.  **Categorize the Query:**
>     * **Simple Query:** Is this a simple greeting, a question that can be answered directly, or a conversational interaction (e.g., "hello", "thank you")?
>     * **Complex Task:** Is this a request that requires a series of steps, code execution, or interaction with tools to complete?
>
> 3.  **Execute Your Decision:**
>     * **For a Simple Query:** Provide a direct and helpful response.
>     * **For a Complex Task:** Your *only* response should be "yes". This will trigger a specialized workforce to handle the task. Do not include any other text, punctuation, or pleasantries.
        """
    resp = agent.step(prompt)
    logger.info(f"[TRACE] Agent response: {resp.msgs[0].content[:200]}...")
    logger.info(f"[TRACE] Full chat history: {agent.chat_history}")

    is_complex = resp.msgs[0].content.lower() == "yes"
    logger.info(f"[TRACE] Is complex task? {is_complex}")

    if not is_complex:
        logger.info(f"[TRACE] Returning simple query response")
        return sse_json("wait_confirm", {"content": resp.msgs[0].content})
    else:
        logger.info(f"[TRACE] Confirmed as complex task")
        return True


async def question_confirm_with_context(agent: ListenChatAgent, prompt: str, task_lock: TaskLock) -> str | Literal[True]:
    """Question confirmation with conversation context"""
    logger.info(f"[CONTEXT] === question_confirm with context ===")
    logger.info(f"[CONTEXT] History length: {len(task_lock.conversation_history)}")
    logger.info(f"[CONTEXT] Has previous task result: {bool(task_lock.last_task_result)}")

    # Build context prompt
    context_prompt = ""

    # Add conversation history (last 10 entries)
    if task_lock.conversation_history:
        context_prompt = "=== Previous Conversation ===\n"
        recent_history = task_lock.conversation_history[-10:]

        for entry in recent_history:
            role = entry['role']
            content = entry['content']

            if role == 'task_result':
                # Special handling for task results - show summary only
                context_prompt += f"[Task Completed]: {content[:200]}...\n"
            else:
                # Limit content length to avoid too long context
                context_prompt += f"{role.capitalize()}: {content[:200]}\n"

        context_prompt += "\n"

    # Add last task result if available
    if task_lock.last_task_result:
        context_prompt += f"=== Last Task Result ===\n{task_lock.last_task_result[:500]}...\n\n"

    # Combine full prompt
    full_prompt = f"""{context_prompt}
=== Current Query ===
User: {prompt}

> **Your Role:** You are a highly capable agent with memory of previous conversations.
>
> **Instructions:**
> 1. Consider the conversation history and any previous task results
> 2. Analyze if the current query is:
>    - A simple question that can be answered directly (including referencing previous results)
>    - A complex task requiring multiple steps or tool usage
> 3. Decision:
>    - For simple queries: Provide a helpful response (you may reference previous context)
>    - For complex tasks: Respond with only "yes"
>
> **Important:** If the user asks about something from a previous task, and you can answer based on the context provided, treat it as a simple query.
    """

    # Execute agent
    resp = agent.step(full_prompt)

    is_complex = resp.msgs[0].content.lower() == "yes"

    if not is_complex:
        logger.info(f"[CONTEXT] Simple query, providing direct response")
        return sse_json("wait_confirm", {"content": resp.msgs[0].content})
    else:
        logger.info(f"[CONTEXT] Complex task confirmed")
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
    logger.info(f"summary_task: {res.msgs[0].content}")
    return res.msgs[0].content


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
