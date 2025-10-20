import datetime
from camel.agents.chat_agent import AsyncStreamingChatAgentResponse
from camel.societies.workforce.single_agent_worker import SingleAgentWorker as BaseSingleAgentWorker
from camel.tasks.task import Task, TaskState, is_task_result_insufficient
from utils import traceroot_wrapper as traceroot

from app.utils.agent import ListenChatAgent
from camel.societies.workforce.prompts import PROCESS_TASK_PROMPT
from colorama import Fore
from camel.societies.workforce.utils import TaskResult
from camel.utils.context_utils import ContextUtility

logger = traceroot.get_logger("single_agent_worker")


class SingleAgentWorker(BaseSingleAgentWorker):
    def __init__(
        self,
        description: str,
        worker: ListenChatAgent,
        use_agent_pool: bool = True,
        pool_initial_size: int = 1,
        pool_max_size: int = 10,
        auto_scale_pool: bool = True,
        use_structured_output_handler: bool = True,
        context_utility: ContextUtility | None = None,
        enable_workflow_memory: bool = False,
    ) -> None:
        super().__init__(
            description=description,
            worker=worker,
            use_agent_pool=use_agent_pool,
            pool_initial_size=pool_initial_size,
            pool_max_size=pool_max_size,
            auto_scale_pool=auto_scale_pool,
            use_structured_output_handler=use_structured_output_handler,
            context_utility=context_utility,
            enable_workflow_memory=enable_workflow_memory,
        )
        self.worker = worker  # change type hint

    async def _process_task(self, task: Task, dependencies: list[Task]) -> TaskState:
        r"""Processes a task with its dependencies using an efficient agent
        management system.

        This method asynchronously processes a given task, considering its
        dependencies, by sending a generated prompt to a worker agent.
        Uses an agent pool for efficiency when enabled, or falls back to
        cloning when pool is disabled.

        Args:
            task (Task): The task to process, which includes necessary details
                like content and type.
            dependencies (List[Task]): Tasks that the given task depends on.

        Returns:
            TaskState: `TaskState.DONE` if processed successfully, otherwise
                `TaskState.FAILED`.
        """
        # Get agent efficiently (from pool or by cloning)
        worker_agent = await self._get_worker_agent()
        worker_agent.process_task_id = task.id  # type: ignore  rewrite line

        response_content = ""
        final_response = None
        try:
            dependency_tasks_info = self._get_dep_tasks_info(dependencies)
            prompt = PROCESS_TASK_PROMPT.format(
                content=task.content,
                parent_task_content=task.parent.content if task.parent else "",
                dependency_tasks_info=dependency_tasks_info,
                additional_info=task.additional_info,
            )

            if self.use_structured_output_handler and self.structured_handler:
                # Use structured output handler for prompt-based extraction
                enhanced_prompt = self.structured_handler.generate_structured_prompt(
                    base_prompt=prompt,
                    schema=TaskResult,
                    examples=[
                        {
                            "content": "I have successfully completed the task...",
                            "failed": False,
                        }
                    ],
                    additional_instructions="Ensure you provide a clear "
                    "description of what was done and whether the task "
                    "succeeded or failed.",
                )
                response = await worker_agent.astep(enhanced_prompt)

                # Handle streaming response
                if isinstance(response, AsyncStreamingChatAgentResponse):
                    content = ""
                    async for chunk in response:
                        if chunk.msg:
                            content = chunk.msg.content
                    response_content = content
                else:
                    # Regular ChatAgentResponse
                    response_content = response.msg.content if response.msg else ""

                task_result = self.structured_handler.parse_structured_response(
                    response_text=response_content,
                    schema=TaskResult,
                    fallback_values={
                        "content": "Task processing failed",
                        "failed": True,
                    },
                )
            else:
                # Use native structured output if supported
                response = await worker_agent.astep(prompt, response_format=TaskResult)

                # Handle streaming response for native output
                if isinstance(response, AsyncStreamingChatAgentResponse):
                    task_result = None
                    async for chunk in response:
                        if chunk.msg and chunk.msg.parsed:
                            task_result = chunk.msg.parsed
                            response_content = chunk.msg.content
                    # If no parsed result found in streaming, create fallback
                    if task_result is None:
                        task_result = TaskResult(
                            content="Failed to parse streaming response",
                            failed=True,
                        )
                else:
                    # Regular ChatAgentResponse
                    task_result = response.msg.parsed
                    response_content = response.msg.content if response.msg else ""

            # Get token usage from the response
            if isinstance(response, AsyncStreamingChatAgentResponse):
                # For streaming responses, get the final response info
                final_response = await response
                usage_info = final_response.info.get("usage") or final_response.info.get("token_usage")
            else:
                usage_info = response.info.get("usage") or response.info.get("token_usage")
            total_tokens = usage_info.get("total_tokens", 0) if usage_info else 0

            # collect conversation from working agent to
            # accumulator for workflow memory
            # Only transfer memory if workflow memory is enabled
            if self.enable_workflow_memory:
                accumulator = self._get_conversation_accumulator()

                # transfer all memory records from working agent to accumulator
                try:
                    # retrieve all context records from the working agent
                    work_records = worker_agent.memory.retrieve()

                    # write these records to the accumulator's memory
                    memory_records = [record.memory_record for record in work_records]
                    accumulator.memory.write_records(memory_records)

                    logger.debug(f"Transferred {len(memory_records)} memory records to accumulator")

                except Exception as e:
                    logger.warning(f"Failed to transfer conversation to accumulator: {e}")

        except Exception as e:
            logger.error(f"Error processing task {task.id}: {type(e).__name__}: {e}")
            # Store error information in task result
            task.result = f"{type(e).__name__}: {e!s}"
            return TaskState.FAILED
        finally:
            # Return agent to pool or let it be garbage collected
            await self._return_worker_agent(worker_agent)

        # Populate additional_info with worker attempt details
        if task.additional_info is None:
            task.additional_info = {}

        # Create worker attempt details with descriptive keys
        # Use final_response if available (streaming), otherwise use response
        response_for_info = final_response if final_response is not None else response
        worker_attempt_details = {
            "agent_id": getattr(worker_agent, "agent_id", worker_agent.role_name),
            "original_worker_id": getattr(self.worker, "agent_id", self.worker.role_name),
            "timestamp": str(datetime.datetime.now()),
            "description": f"Attempt by "
            f"{getattr(worker_agent, 'agent_id', worker_agent.role_name)} "
            f"(from pool/clone of "
            f"{getattr(self.worker, 'agent_id', self.worker.role_name)}) "
            f"to process task: {task.content}",
            "response_content": response_content[:50],
            "tool_calls": str(response_for_info.info.get("tool_calls", []) if response_for_info and hasattr(response_for_info, 'info') else [])[:50],
            "total_tokens": total_tokens,
        }

        # Store the worker attempt in additional_info
        if "worker_attempts" not in task.additional_info:
            task.additional_info["worker_attempts"] = []
        task.additional_info["worker_attempts"].append(worker_attempt_details)

        # Store the actual token usage for this specific task
        task.additional_info["token_usage"] = {"total_tokens": total_tokens}

        print(f"======\n{Fore.GREEN}Response from {self}:{Fore.RESET}")

        logger.info(f"Response from {self}:")

        if not self.use_structured_output_handler:
            # Handle native structured output parsing
            if task_result is None:
                logger.error("Error in worker step execution: Invalid task result")
                print(f"{Fore.RED}Error in worker step execution: Invalid task result{Fore.RESET}")
                task_result = TaskResult(
                    content="Failed to generate valid task result.",
                    failed=True,
                )

        color = Fore.RED if task_result.failed else Fore.GREEN  # type: ignore[union-attr]
        print(
            f"\n{color}{task_result.content}{Fore.RESET}\n======",  # type: ignore[union-attr]
        )

        if task_result.failed:  # type: ignore[union-attr]
            logger.error(f"{task_result.content}")  # type: ignore[union-attr]
        else:
            logger.info(f"{task_result.content}")  # type: ignore[union-attr]

        task.result = task_result.content  # type: ignore[union-attr]

        if task_result.failed:  # type: ignore[union-attr]
            return TaskState.FAILED

        if is_task_result_insufficient(task):
            logger.warning(f"Task {task.id}: Content validation failed - task marked as failed")
            return TaskState.FAILED
        return TaskState.DONE
