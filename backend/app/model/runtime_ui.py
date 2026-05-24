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

from __future__ import annotations

from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

ArtifactType = Literal["dashboard", "approval", "selection"]
InteractionMode = Literal["view_only", "editable", "approval_required"]
SectionType = Literal[
    "markdown",
    "kpi_row",
    "table",
    "progress_list",
    "action_row",
    "approval_panel",
    "chart_placeholder",
    "line_chart",
    "bar_chart",
    "area_chart",
    "pie_chart",
    "selection_list",
    "trigger_card",
    "status_tile",
    "timeline",
    "compare_card",
]
ActionType = Literal["agent_action", "approval", "reject", "edit"]
Tone = Literal["neutral", "success", "warning", "error", "information"]

UNSAFE_KEYS = {
    "html",
    "rawhtml",
    "raw_html",
    "script",
    "javascript",
    "css",
    "style",
    "jsx",
    "react",
    "dangerouslysetinnerhtml",
    "component",
    "components",
}


def reject_unsafe_keys(value: Any, path: str = "data") -> Any:
    if isinstance(value, dict):
        for key, item in value.items():
            normalized_key = str(key).replace("_", "").lower()
            if normalized_key in UNSAFE_KEYS:
                raise ValueError(
                    f"Unsafe generated UI/code field is not allowed: "
                    f"{path}.{key}"
                )
            reject_unsafe_keys(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            reject_unsafe_keys(item, f"{path}[{index}]")
    return value


class RuntimeUiAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    label: str
    type: ActionType = "agent_action"
    tone: Tone = "neutral"
    payload: dict[str, Any] = Field(default_factory=dict)

    @field_validator("payload")
    @classmethod
    def validate_payload(cls, value: dict[str, Any]) -> dict[str, Any]:
        return reject_unsafe_keys(value, "action.payload")


class RuntimeUiLayout(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["stack", "grid"] = "stack"
    columns: int = Field(default=1, ge=1, le=12)


class RuntimeUiSection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    type: SectionType
    title: str | None = None
    content: str | None = None
    data_source: str | None = None
    columns: list[str] | None = None
    actions: list[RuntimeUiAction] = Field(default_factory=list)
    tone: Tone = "neutral"
    x_field: str | None = None
    y_fields: list[str] | None = None
    options: list[dict[str, Any]] | None = None
    # Chart display options (Phase 3)
    stacked: bool | None = None
    smooth: bool | None = None
    show_legend: bool | None = None
    # status_tile fields (Phase 2)
    icon: str | None = None
    value: str | None = None
    caption: str | None = None
    delta: str | None = None


class RuntimeUiArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    type: ArtifactType
    title: str
    prompt: str
    interaction_mode: InteractionMode = "view_only"
    layout: RuntimeUiLayout = Field(default_factory=RuntimeUiLayout)
    sections: list[RuntimeUiSection]
    actions: list[RuntimeUiAction] = Field(default_factory=list)


class RuntimeUiArtifactPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    artifact: RuntimeUiArtifact
    data: dict[str, Any] = Field(default_factory=dict)
    state: dict[str, Any] = Field(default_factory=dict)

    @field_validator("data", "state")
    @classmethod
    def validate_safe_payload(cls, value: dict[str, Any]) -> dict[str, Any]:
        return reject_unsafe_keys(value)


def coerce_mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {"value": value}


def first_list_of_dicts(data: dict[str, Any]) -> tuple[str, list[dict]] | None:
    for key, value in data.items():
        if (
            isinstance(value, list)
            and value
            and all(isinstance(item, dict) for item in value)
        ):
            return key, value
    return None


def first_list(data: dict[str, Any]) -> tuple[str, list] | None:
    for key, value in data.items():
        if isinstance(value, list) and value:
            return key, value
    return None


def default_actions(
    artifact_type: ArtifactType,
    interaction_mode: InteractionMode,
    actions: list[RuntimeUiAction],
) -> list[RuntimeUiAction]:
    if actions:
        return actions
    if artifact_type == "approval" or interaction_mode == "approval_required":
        return [
            RuntimeUiAction(
                id="approve",
                label="Approve",
                type="approval",
                tone="success",
            ),
            RuntimeUiAction(
                id="reject",
                label="Reject",
                type="reject",
                tone="error",
            ),
            RuntimeUiAction(
                id="request_edit",
                label="Request edit",
                type="edit",
                tone="warning",
            ),
        ]
    if artifact_type == "selection":
        return [
            RuntimeUiAction(
                id="submit",
                label="Submit",
                type="agent_action",
                tone="information",
            ),
        ]
    return []


def build_runtime_ui_artifact(
    *,
    artifact_type: ArtifactType,
    title: str,
    prompt: str,
    data: Any,
    interaction_mode: InteractionMode = "view_only",
    context: dict[str, Any] | None = None,
    actions: list[dict[str, Any]] | None = None,
    include_trigger_card: bool = False,
    trigger_card_title: str = "Want to automate this?",
    trigger_card_subtitle: str = "Set up a trigger to run this task automatically",
) -> RuntimeUiArtifactPayload:
    safe_data = reject_unsafe_keys(coerce_mapping(data))
    safe_context = reject_unsafe_keys(context or {}, "context")
    parsed_actions = [
        RuntimeUiAction.model_validate(action) for action in (actions or [])
    ]
    resolved_actions = default_actions(
        artifact_type, interaction_mode, parsed_actions
    )

    sections: list[RuntimeUiSection] = [
        RuntimeUiSection(
            id="summary",
            type="markdown",
            title="Summary",
            content=prompt,
        )
    ]

    if artifact_type == "selection":
        options_data = safe_data.get("options")
        if isinstance(options_data, list):
            sections.append(
                RuntimeUiSection(
                    id="selection",
                    type="selection_list",
                    title=title,
                    options=options_data,
                    actions=resolved_actions,
                )
            )
        else:
            sections.append(
                RuntimeUiSection(
                    id="selection",
                    type="selection_list",
                    title=title,
                    options=[],
                    actions=resolved_actions,
                )
            )
    elif artifact_type == "dashboard":
        if isinstance(safe_data.get("metrics"), dict):
            sections.append(
                RuntimeUiSection(
                    id="metrics",
                    type="kpi_row",
                    title="Metrics",
                    data_source="metrics",
                )
            )

        chart_spec = safe_data.get("chart")
        if isinstance(chart_spec, dict) and isinstance(
            chart_spec.get("points"), list
        ):
            chart_kind = chart_spec.get("type", "line")
            _CHART_TYPE_MAP = {
                "bar": "bar_chart",
                "area": "area_chart",
                "pie": "pie_chart",
            }
            section_type = _CHART_TYPE_MAP.get(chart_kind, "line_chart")
            sections.append(
                RuntimeUiSection(
                    id="chart",
                    type=section_type,
                    title=chart_spec.get("title") or "Chart",
                    data_source="chart",
                    x_field=chart_spec.get("x_field") or "x",
                    y_fields=chart_spec.get("y_fields") or ["y"],
                    stacked=chart_spec.get("stacked"),
                    smooth=chart_spec.get("smooth"),
                    show_legend=chart_spec.get("show_legend"),
                )
            )

        # status_tile — a single large status indicator
        status_spec = safe_data.get("status")
        if isinstance(status_spec, dict):
            sections.append(
                RuntimeUiSection(
                    id="status_tile",
                    type="status_tile",
                    title=status_spec.get("title") or "Status",
                    tone=status_spec.get("tone", "neutral"),
                    icon=status_spec.get("icon"),
                    value=str(status_spec["value"])
                    if "value" in status_spec
                    else None,
                    caption=status_spec.get("caption"),
                    delta=status_spec.get("delta"),
                )
            )

        # timeline — vertical event log
        timeline_spec = safe_data.get("timeline")
        if isinstance(timeline_spec, list) and timeline_spec:
            sections.append(
                RuntimeUiSection(
                    id="timeline",
                    type="timeline",
                    title="Timeline",
                    data_source="timeline",
                )
            )

        # compare_card — side-by-side options grid
        compare_spec = safe_data.get("compare")
        if isinstance(compare_spec, list) and compare_spec:
            sections.append(
                RuntimeUiSection(
                    id="compare",
                    type="compare_card",
                    title="Compare Options",
                    data_source="compare",
                )
            )

        _HANDLED_KEYS = {"metrics", "chart", "status", "timeline", "compare"}
        data_without_chart = {
            k: v for k, v in safe_data.items() if k not in _HANDLED_KEYS
        }
        table_source = first_list_of_dicts(data_without_chart)
        if table_source:
            key, rows = table_source
            columns = [str(col) for col in list(rows[0].keys())[:6]]
            sections.append(
                RuntimeUiSection(
                    id=f"{key}_table",
                    type="table",
                    title=key.replace("_", " ").title(),
                    data_source=key,
                    columns=columns,
                )
            )
        elif (list_source := first_list(data_without_chart)) is not None:
            key, _ = list_source
            sections.append(
                RuntimeUiSection(
                    id=f"{key}_list",
                    type="progress_list",
                    title=key.replace("_", " ").title(),
                    data_source=key,
                )
            )

        if resolved_actions:
            sections.append(
                RuntimeUiSection(
                    id="actions",
                    type="action_row",
                    title="Actions",
                    actions=resolved_actions,
                )
            )
    else:
        sections.append(
            RuntimeUiSection(
                id="approval",
                type="approval_panel",
                title=title,
                content=prompt,
                actions=resolved_actions,
            )
        )

    if include_trigger_card:
        sections.append(
            RuntimeUiSection(
                id="trigger_card",
                type="trigger_card",
                title=trigger_card_title,
                content=trigger_card_subtitle,
            )
        )

    artifact = RuntimeUiArtifact(
        id=f"artifact_{uuid4().hex[:12]}",
        type=artifact_type,
        title=title,
        prompt=prompt,
        interaction_mode=interaction_mode,
        layout=RuntimeUiLayout(type="stack", columns=1),
        sections=sections,
        actions=resolved_actions,
    )
    return RuntimeUiArtifactPayload(
        artifact=artifact,
        data=safe_data,
        state={
            "selectedRows": [],
            "note": "",
            "context": safe_context,
        },
    )
