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

"""Pure local token budgeting over an authenticated Journal capture.

No SDK, provider client, network, credential resolution or dispatch lives here.
Selection returns the existing derived projection value; it never modifies the
caller's conversation or persists raw history. Actual request wiring is separate.
"""

from __future__ import annotations

import hashlib
import json

from .context_projection import ExecutionContextProjection
from .managed_context_projection import ContextSourceUnavailable

MAX_INPUT_TOKENS = 64 * 1024
MAX_HISTORY_TOKENS = 8192
MAX_INPUT_BYTES = 1024 * 1024
MAX_MESSAGES = 512
PROTOCOL_RESERVE = 256
HISTORY_TITLE = "Canonical Session execution history (data)"


def _json(value):
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def _snapshot(value):
    # Bound both traversal and allocation before serialization/tokenization.
    stack, nodes, text_bytes = [(value, 0)], 0, 0
    while stack:
        item, depth = stack.pop()
        nodes += 1
        if nodes > 16384 or depth > 32:
            raise ContextSourceUnavailable("context_input_too_large")
        if isinstance(item, str):
            if len(item) > MAX_INPUT_BYTES:
                raise ContextSourceUnavailable("context_input_too_large")
            text_bytes += len(item.encode())
            if text_bytes > MAX_INPUT_BYTES:
                raise ContextSourceUnavailable("context_input_too_large")
        elif isinstance(item, dict):
            if len(item) > 2048 or any(
                not isinstance(key, str) for key in item
            ):
                raise ContextSourceUnavailable("context_schema_unsupported")
            stack.extend(
                (child, depth + 1) for pair in item.items() for child in pair
            )
        elif isinstance(item, (list, tuple)):
            if len(item) > 2048:
                raise ContextSourceUnavailable("context_input_too_large")
            stack.extend((child, depth + 1) for child in item)
        elif item is not None and type(item) not in {int, float, bool}:
            raise ContextSourceUnavailable("context_schema_unsupported")
    try:
        encoded = _json(value)
        if len(encoded.encode()) > MAX_INPUT_BYTES:
            raise ContextSourceUnavailable("context_input_too_large")
        return json.loads(encoded)
    except (TypeError, ValueError, RecursionError):
        raise ContextSourceUnavailable("context_schema_unsupported") from None


def count_context_input_tokens(
    counter, messages, tools=None, response_format=None
):
    """Use the loaded model tokenizer for text, tool arguments and schemas.

    CAMEL treats list-valued fields as image parts. Serialize tool_calls first
    so function arguments are counted rather than silently ignored. The fixed
    framing reserve is conservative local admission, not provider usage data.
    """
    data = _snapshot(
        {
            "messages": messages,
            "tools": tools,
            "response_format": response_format,
        }
    )
    messages = data["messages"]
    if (
        not isinstance(messages, list)
        or not 1 <= len(messages) <= MAX_MESSAGES
    ):
        raise ContextSourceUnavailable("context_message_schema_unsupported")
    normalized = []
    for message in messages:
        if (
            not isinstance(message, dict)
            or set(message)
            - {"role", "content", "name", "tool_calls", "tool_call_id"}
            or message.get("role")
            not in {"system", "developer", "user", "assistant", "tool"}
        ):
            raise ContextSourceUnavailable(
                "context_message_schema_unsupported"
            )
        if message.get("content") is not None and not isinstance(
            message["content"], str
        ):
            raise ContextSourceUnavailable(
                "context_message_schema_unsupported"
            )
        if "tool_calls" in message:
            message["tool_calls"] = _json(message["tool_calls"])
        if any(
            value is not None and not isinstance(value, str)
            for value in message.values()
        ):
            raise ContextSourceUnavailable(
                "context_message_schema_unsupported"
            )
        normalized.append(message)
    structured = _json(
        {"tools": data["tools"], "response_format": data["response_format"]}
    )
    return (
        counter.count_tokens_from_messages(normalized)
        + len(counter.encode(structured))
        + PROTOCOL_RESERVE
    )


def _history(source, selected):
    return (
        HISTORY_TITLE
        + "\n"
        + _json(
            {
                "coverage": "Recent authenticated managed Runs only; legacy or unverifiable history is unavailable.",
                "omitted_runs_at_least": source.omitted_runs
                + len(source.runs)
                - len(selected),
                "runs": [json.loads(run.text) for run in selected],
            }
        )
    )


class ManagedContextBudget:
    """One Agent's deterministic selection from a Run's immutable capture."""

    def __init__(self, source, counter, model_window):
        self.source = source
        self.counter = counter
        self.model_window = model_window
        self.projection = None

    def project(
        self, messages, *, output_tokens, tools=None, response_format=None
    ):
        if (
            type(self.model_window) is not int
            or type(output_tokens) is not int
            or not 0 < output_tokens < self.model_window
        ):
            raise ContextSourceUnavailable("context_output_budget_invalid")
        budget = min(MAX_INPUT_TOKENS, self.model_window - output_tokens)
        if (
            count_context_input_tokens(
                self.counter, messages, tools, response_format
            )
            > budget
        ):
            raise ContextSourceUnavailable("context_current_input_over_budget")
        if messages[0]["role"] not in {"system", "developer"}:
            raise ContextSourceUnavailable("context_system_message_required")

        def fits(text):
            with_history = [
                messages[0],
                {"role": "user", "content": text},
                *messages[1:],
            ]
            return (
                count_context_input_tokens(
                    self.counter, with_history, tools, response_format
                )
                <= budget
            )

        projection = self.projection
        if projection is None:
            selected = []
            text = _history(self.source, selected)
            for run in reversed(self.source.runs):
                candidate = [run, *selected]
                candidate_text = _history(self.source, candidate)
                if len(
                    self.counter.encode(candidate_text)
                ) > MAX_HISTORY_TOKENS or not fits(candidate_text):
                    break
                selected, text = candidate, candidate_text
            projection = ExecutionContextProjection(
                text=text,
                source_event_ids=tuple(
                    dict.fromkeys(
                        event_id
                        for run in selected
                        for event_id in run.source_event_ids
                    )
                ),
                projection_digest=hashlib.sha256(text.encode()).hexdigest(),
                token_count=len(self.counter.encode(text)),
            )
        if not fits(projection.text):
            # Never silently change an established selection in a later turn.
            raise ContextSourceUnavailable("context_input_over_budget")
        self.projection = projection
        return projection

    def persist_diagnostic(self, journal):
        """Write only derived metadata to the existing diagnostic table.

        Async owners must call this through run_owned_thread and drain it;
        cancellation of a waiter is not evidence that SQLite work has ended.
        """
        projection = self.projection
        if projection is None:
            raise ContextSourceUnavailable("context_projection_not_selected")
        source = self.source
        identity = hashlib.sha256(
            f"{source.project_id}\0{source.run_id}\0{projection.projection_digest}".encode()
        ).hexdigest()[:32]
        return journal.put_context_projection_diagnostic(
            projection_id=f"ctxproj_{identity}",
            project_id=source.project_id,
            run_id=source.run_id,
            source_event_ids=projection.source_event_ids,
            source_memory_ids=(),
            project_state_version=source.project_state_version,
            projection_digest=projection.projection_digest,
            token_count=projection.token_count,
        )
