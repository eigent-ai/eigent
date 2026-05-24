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

import asyncio
import logging
from typing import Any, Literal

from camel.toolkits.base import BaseToolkit
from camel.toolkits.function_tool import FunctionTool

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.model.runtime_ui import build_runtime_ui_artifact
from app.service.task import (
    TASK_LOCK_CLEANUP_SENTINEL,
    ActionUiArtifactData,
    get_task_lock,
)
from app.utils.listen.toolkit_listen import listen_toolkit

logger = logging.getLogger("runtime_ui_toolkit")


class RuntimeUIToolkit(BaseToolkit, AbstractToolkit):
    r"""Toolkit for rendering validated Eigent UI artifacts.

    Agents use this tool when an interactive dashboard or approval surface is
    more useful than plain chat text. The tool never emits frontend code; it
    emits a strict schema rendered by approved Eigent components.

    Interactive artifacts (approval / selection / editable) block until the
    user responds. The tool's return value IS the user's answer — do not poll,
    do not re-call.
    """

    def __init__(
        self, api_task_id: str, agent_name: str, timeout: float | None = None
    ):
        super().__init__(timeout)
        self.api_task_id = api_task_id
        self.agent_name = agent_name
        task_lock = get_task_lock(self.api_task_id)
        if self.agent_name not in task_lock.human_input:
            task_lock.add_human_input_listen(self.agent_name)

    @listen_toolkit(
        inputs=lambda _,
        artifact_type,
        title,
        prompt,
        data,
        interaction_mode="view_only",
        context=None,
        actions=None,
        include_trigger_card=False: f"{artifact_type}: {title}"
    )
    async def render_ui_artifact(
        self,
        artifact_type: Literal["dashboard", "approval", "selection"],
        title: str,
        prompt: str,
        data: dict[str, Any],
        interaction_mode: Literal[
            "view_only", "editable", "approval_required"
        ] = "view_only",
        context: dict[str, Any] | None = None,
        actions: list[dict[str, Any]] | None = None,
        include_trigger_card: bool = False,
    ) -> str:
        r"""Render an interactive Eigent UI artifact from intent and data.

        Interactive artifacts (approval / selection / editable) block until
        the user responds. The return value is the user's answer — do not
        poll or re-call after an interactive artifact.

        Args:
            artifact_type: "dashboard", "approval", or "selection".
            title: User-visible artifact title.
            prompt: Concise intent or outcome description for the UI.
            data: Structured JSON data to display. For "selection" type,
                include an "options" key with a list of
                {id, label, description?} dicts. For dashboard charts,
                include a "chart" key with shape
                {points: [{x, y, ...}], type: "line"|"bar",
                x_field: str, y_fields: [str]}.
            interaction_mode: "view_only", "editable", or
                "approval_required".
            context: Optional session/project/user-goal context.
            actions: Optional action definitions with id, label, type, tone,
                and payload.
            include_trigger_card: When True, appends a "Want to automate
                this?" trigger card at the bottom of the artifact. Use when
                the task result is a good candidate for automation.

        Returns:
            For interactive artifacts: the user's response as a JSON string.
            For view-only artifacts: confirmation including the artifact id.
        """
        payload = build_runtime_ui_artifact(
            artifact_type=artifact_type,
            title=title,
            prompt=prompt,
            data=data,
            interaction_mode=interaction_mode,
            context=context,
            actions=actions,
            include_trigger_card=include_trigger_card,
        )
        task_lock = get_task_lock(self.api_task_id)
        await task_lock.put_queue(
            ActionUiArtifactData(data=payload.model_dump(mode="json"))
        )

        is_interactive = bool(payload.artifact.actions)
        if is_interactive:
            logger.info(
                "Awaiting human input for artifact %s",
                payload.artifact.id,
                extra={
                    "task_id": self.api_task_id,
                    "artifact_id": payload.artifact.id,
                },
            )
            reply = await task_lock.get_human_input(self.agent_name)
            if reply == TASK_LOCK_CLEANUP_SENTINEL:
                logger.info(
                    "Human input wait interrupted by task cleanup",
                    extra={
                        "task_id": self.api_task_id,
                        "agent": self.agent_name,
                    },
                )
                raise asyncio.CancelledError(
                    "Task cleanup interrupted human input wait"
                )
            logger.info(
                "Received human input for artifact %s",
                payload.artifact.id,
                extra={
                    "task_id": self.api_task_id,
                    "artifact_id": payload.artifact.id,
                },
            )
            return reply

        return (
            "Rendered Eigent UI artifact "
            f"{payload.artifact.id}: {payload.artifact.title}"
        )

    def get_tools(self) -> list[FunctionTool]:
        return [FunctionTool(self.render_ui_artifact)]

    @classmethod
    def get_can_use_tools(
        cls, api_task_id: str, agent_name: str
    ) -> list[FunctionTool]:
        toolkit = cls(api_task_id, agent_name)
        return [FunctionTool(toolkit.render_ui_artifact)]
