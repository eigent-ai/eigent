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

"""Runtime gate between durable tool preparation and dispatch."""

from __future__ import annotations

import asyncio
import time
from typing import Any

from app.permission_policy.models import PolicyDecision, PolicyEffect
from app.permission_policy.service import PermissionPolicyService
from app.permission_policy.tool_actions import build_tool_action_descriptor
from app.run_context import get_current_run_context
from app.run_journal import (
    InvalidRunTransitionError,
    SQLiteRunJournal,
    get_default_run_journal,
)
from app.run_policy import TimeoutOutcome, TimeoutScope
from app.run_runtime.active_timeout import pause_active_execution_timeout
from app.run_runtime.tool_checkpoint import ToolCheckpointContext
from app.service.task import TASK_LOCK_CLEANUP_SENTINEL, Action, ActionAskData


class ToolPermissionRejectedError(RuntimeError):
    """The action was denied before dispatch, so its outcome is known."""


async def authorize_tool_checkpoint(
    checkpoint: ToolCheckpointContext | None,
    *,
    arguments: dict[str, Any],
    toolkit_name: str | None,
    agent_name: str,
    task_lock: Any,
    journal: SQLiteRunJournal | None = None,
) -> PolicyDecision | None:
    if checkpoint is None:
        raise ToolPermissionRejectedError(
            "tool execution requires a durable checkpoint"
        )
    run_context = get_current_run_context()
    if run_context is None:
        raise ToolPermissionRejectedError(
            "tool execution requires an admitted RunContext"
        )
    store = journal or get_default_run_journal()
    attempt = store.get_run_attempt(checkpoint.attempt_id)
    environment_digest = (
        attempt.environment_spec_digest
        if attempt is not None and attempt.environment_spec_digest
        else f"legacy-unbound:{checkpoint.run_id}"
    )
    descriptor = build_tool_action_descriptor(
        action_id=checkpoint.tool_call_id,
        tool_name=checkpoint.tool_name,
        toolkit_name=toolkit_name,
        safety_class=checkpoint.safety_class,
        # Policy and the action digest bind to the complete trusted call. The
        # checkpoint request is only a bounded persistence/display record.
        arguments=arguments,
        run_id=checkpoint.run_id,
        attempt_id=checkpoint.attempt_id,
        environment_spec_digest=environment_digest,
        idempotency_key=checkpoint.idempotency_key,
        workspace_root=run_context.working_directory,
    )
    result = PermissionPolicyService(store).evaluate_and_request_approval(
        descriptor,
        space_id=run_context.space_id,
        step_id=checkpoint.step_id,
        prompt={
            "title": f"Allow {checkpoint.tool_name}?",
            "question": (
                f"The agent wants to run {checkpoint.tool_name} "
                f"({descriptor.operation})."
            ),
            "agent": agent_name,
            "tool_name": checkpoint.tool_name,
            "operation": descriptor.operation,
            "target_resources": list(descriptor.target_resources),
        },
        approval_id=f"approval:{checkpoint.tool_call_id}",
        permission_profile_revision=(
            attempt.permission_profile_revision
            if attempt is not None
            else None
        ),
    )
    if result.decision.effect is PolicyEffect.DENY:
        raise ToolPermissionRejectedError(
            f"permission denied for {descriptor.operation}: "
            f"{result.decision.reason}"
        )
    if result.approval is None:
        return result.decision

    task_lock.add_human_input_listen(agent_name)
    human_input_task = asyncio.create_task(
        task_lock.get_human_input(agent_name)
    )
    # Register the waiter before publishing the card. A fast local renderer
    # can otherwise decide before get_human_input has appended its Future.
    await asyncio.sleep(0)
    pause_context = pause_active_execution_timeout(task_lock)
    await pause_context.__aenter__()
    try:
        await task_lock.put_queue(
            ActionAskData(
                action=Action.ask,
                data={
                    "interaction_id": result.approval.approval_id,
                    "interaction_type": "approval",
                    "run_id": checkpoint.run_id,
                    "version": result.approval.version,
                    "approval_id": result.approval.approval_id,
                    "question": result.approval.prompt.get("question", ""),
                    "title": result.approval.prompt.get(
                        "title", "Approval required"
                    ),
                    "agent": agent_name,
                    "action_digest": result.approval.action_digest,
                    "safety_class": result.approval.safety_class,
                    "decision_scope": result.approval.decision_scope,
                    "allowed_scopes": result.approval.prompt.get(
                        "allowed_scopes", ["once"]
                    ),
                    "rule_matcher": result.approval.prompt.get("rule_matcher"),
                    "operation": descriptor.operation,
                    "target_resources": list(descriptor.target_resources),
                    "display_arguments": result.approval.prompt.get(
                        "action", {}
                    ).get("normalized_arguments", {}),
                },
            )
        )
    except BaseException:
        await pause_context.__aexit__(None, None, None)
        human_input_task.cancel()
        raise
    approval_expires_at = result.approval.expires_at
    try:
        if approval_expires_at is None:
            raise ToolPermissionRejectedError(
                "approval has no persisted expiry; refusing tool dispatch"
            )
        try:
            # The persisted approval expiry owns this wait. Human decision
            # latency must not consume CAMEL's model/tool execution timeout;
            # otherwise every valid 24-hour Approval is cancelled at the
            # default 30-minute Agent step deadline.
            reply = await asyncio.wait_for(
                human_input_task,
                timeout=max(0.0, approval_expires_at - time.time()),
            )
        except TimeoutError:
            run = store.get_run(checkpoint.run_id)
            try:
                store.record_timeout_outcome(
                    TimeoutOutcome(
                        scope=TimeoutScope.APPROVAL_EXPIRY,
                        policy_version=(
                            run.timeout_policy_version
                            if run is not None
                            else "v1"
                        ),
                        reason="tool_approval_expired",
                        started_at=result.approval.created_at,
                        ended_at=approval_expires_at,
                        run_id=checkpoint.run_id,
                        attempt_id=checkpoint.attempt_id,
                        approval_id=result.approval.approval_id,
                    )
                )
            except InvalidRunTransitionError:
                # A concurrent decision won the durable CAS. The dispatch check
                # below still requires a live-process approval attestation.
                pass
            reply = None
        if reply == TASK_LOCK_CLEANUP_SENTINEL:
            raise ToolPermissionRejectedError(
                "approval wait was interrupted before tool dispatch"
            )
        approval = next(
            (
                item
                for item in store.list_approvals(checkpoint.run_id)
                if item.approval_id == result.approval.approval_id
            ),
            None,
        )
        if (
            approval is None
            or approval.action_digest != descriptor.action_digest
            or approval.status != "approved"
            or not store.approval_decision_is_trusted(
                approval.approval_id,
                version=approval.version,
                action_digest=descriptor.action_digest,
            )
        ):
            raise ToolPermissionRejectedError(
                "tool action was not approved for the current action digest"
            )
        return result.decision
    finally:
        await pause_context.__aexit__(None, None, None)
        if not human_input_task.done():
            human_input_task.cancel()
            await asyncio.gather(human_input_task, return_exceptions=True)
