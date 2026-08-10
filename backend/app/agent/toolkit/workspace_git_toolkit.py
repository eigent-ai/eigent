# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

"""Read-oriented, structured Git capability surface for Eigent agents."""

from __future__ import annotations

import json
import uuid

from camel.toolkits.base import BaseToolkit
from camel.toolkits.function_tool import FunctionTool

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.utils.listen.toolkit_listen import auto_listen_toolkit
from app.utils.space_overlay_client import run_context_for_task
from app.workspace_git import (
    AdvancedGitCommandRejected,
    get_default_advanced_git_service,
)


@auto_listen_toolkit(BaseToolkit)
class WorkspaceGitToolkit(BaseToolkit, AbstractToolkit):
    """Inspect the Run's local Content Repository without invoking a shell.

    Mutating Git operations remain behind typed file/checkpoint flows or the
    policy-gated Desktop Advanced Git panel. This toolkit can classify an
    advanced argv request, but cannot treat model output as user approval.
    """

    agent_name: str = "agent"

    def __init__(
        self,
        api_task_id: str,
        agent_name: str | None = None,
        timeout: float | None = None,
    ) -> None:
        super().__init__(timeout)
        self.api_task_id = api_task_id
        if agent_name is not None:
            self.agent_name = agent_name

    def git_capabilities(self) -> str:
        """Return structured Git availability and allowed Agent actions."""

        context, service, repository = self._scope()
        if repository is None:
            return json.dumps(
                {"available": False, "reason": "content_repository_disabled"}
            )
        probe = service.git.probe(context.working_directory)
        return json.dumps(
            {
                "available": True,
                "repository_id": repository.repository_id,
                "logical_root": ".",
                "current_branch": probe.branch,
                "base_commit": probe.head_oid,
                "version_coverage": repository.version_coverage,
                "allowed_actions": [
                    "status",
                    "log",
                    "branch_list",
                    "advanced_preview",
                    "checkpoint_via_file_tools",
                    "merge_request_via_coordinator",
                ],
                "advanced_execution": "requires_user_review_in_desktop",
                "model_guidance": (
                    "Do not use Git options that launch editors, hooks, "
                    "pagers, filters, helpers, signers, or other external "
                    "programs. Request a HumanInteraction before dangerous "
                    "or destructive Git work. A preview is never approval."
                ),
            },
            sort_keys=True,
        )

    def git_status(self) -> str:
        """Return repository health and pending managed-file counts."""

        _, service, repository = self._scope()
        if repository is None:
            return json.dumps({"available": False})
        status = service.content.status(repository.repository_id)
        return json.dumps(
            {
                "available": True,
                "state": status.repository.state,
                "healthy": status.diagnostics.healthy,
                "issues": list(status.diagnostics.issues),
                "branch": status.diagnostics.state_token.branch_or_detached_head,
                "head_oid": status.diagnostics.state_token.head_oid,
                "repo_state_digest": status.diagnostics.state_token.digest,
                "pending_managed_paths": list(status.pending_managed_paths),
                "pending_managed_paths_truncated": (
                    status.pending_managed_paths_truncated
                ),
            },
            sort_keys=True,
        )

    def git_log(self, limit: int = 20) -> str:
        """Return bounded commit metadata; file content is never embedded.

        Args:
            limit: Maximum number of recent commits to return, from 1 to 100.
        """

        _, service, repository = self._scope()
        if repository is None:
            return json.dumps({"available": False})
        history = service.history(
            repository_id=repository.repository_id,
            limit=max(1, min(limit, 100)),
        )
        return json.dumps(
            {"available": True, "commits": history["commits"]},
            sort_keys=True,
        )

    def git_branches(self) -> str:
        """Return active and archived branch metadata for this repository."""

        _, service, repository = self._scope()
        if repository is None:
            return json.dumps({"available": False})
        history = service.history(repository_id=repository.repository_id)
        return json.dumps(
            {
                "available": True,
                "branches": history["branches"],
                "remotes": history["remotes"],
            },
            sort_keys=True,
        )

    def advanced_git_preview(
        self,
        argv: list[str],
        operation_request_id: str = "",
    ) -> str:
        """Classify argv without executing it.

        Use this to explain the required permission class. A write preview is
        not approval and cannot be executed by this read-only Agent surface.

        Args:
            argv: Git arguments excluding the ``git`` executable, as an array.
            operation_request_id: Stable retry identifier for this preview.
        """

        context, service, repository = self._scope()
        if repository is None:
            return json.dumps({"available": False})
        request_id = (
            operation_request_id.strip() or f"agent-preview-{uuid.uuid4().hex}"
        )
        try:
            preview = service.preview(
                space_id=context.space_id,
                repository_id=repository.repository_id,
                argv=tuple(argv),
                operation_request_id=request_id,
            )
        except AdvancedGitCommandRejected as exc:
            return json.dumps(
                {
                    "accepted": False,
                    "rejection": {
                        "code": exc.reason_code,
                        "reason": str(exc),
                        "remediation": exc.remediation,
                        "human_interaction_required": (
                            exc.human_interaction_required
                        ),
                    },
                },
                sort_keys=True,
            )
        return json.dumps(
            {
                "accepted": True,
                "classification": preview.classification.operation,
                "safety_class": preview.classification.safety_class.value,
                "external_side_effect": (
                    preview.classification.external_side_effect
                ),
                "requires_user_confirmation": preview.requires_confirmation,
                "display_argv": list(preview.display_argv),
                "action_digest": preview.action_digest,
                "execution": (
                    "request HumanInteraction when confirmation is required; "
                    "then open Desktop Version history to review"
                ),
            },
            sort_keys=True,
        )

    def _scope(self):
        context = run_context_for_task(self.api_task_id)
        if context is None:
            raise RuntimeError(
                "WorkspaceGitToolkit requires a durable RunContext"
            )
        service = get_default_advanced_git_service()
        repository = service.journal.get_space_git_repository(
            space_id=context.space_id
        )
        return context, service, repository

    def get_tools(self) -> list[FunctionTool]:
        return [
            FunctionTool(self.git_capabilities),
            FunctionTool(self.git_status),
            FunctionTool(self.git_log),
            FunctionTool(self.git_branches),
            FunctionTool(self.advanced_git_preview),
        ]
