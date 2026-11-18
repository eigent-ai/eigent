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

"""Trusted validation failures that prove a tool has not started writing."""

import inspect
import math
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any


class ToolPreWriteValidationError(PermissionError):
    """A recoverable refusal raised only before any mutation is attempted.

    This is a code-owned proof, never a classification inferred from error
    text, tool arguments, or provider output. Do not translate arbitrary
    PermissionError/ValueError exceptions into this type around a write.
    PermissionError inheritance preserves service authorization semantics.
    """

    def __init__(
        self,
        message: str,
        *,
        error_code: str,
        field: str,
        recovery: dict[str, str],
    ) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.field = field
        self.recovery = recovery

    def to_tool_result(self) -> dict[str, Any]:
        return {
            "error": str(self),
            "error_code": self.error_code,
            "field": self.field,
            "outcome_known": True,
            "write_performed": False,
            "retryable": True,
            "recovery": dict(self.recovery),
        }


def prewrite_validation_result(
    error: BaseException | None,
) -> dict[str, Any] | None:
    """Recover typed validation through FunctionTool's ValueError wrappers.

    Follow only the active chain of known framework wrapper frames, with
    cycle protection. Even a later ValueError can inherit an older rejection
    as context; its type or wording alone cannot prove a safe wrapper.
    Unknown wrappers and suppressed contexts deliberately remain fail closed.
    """

    visited: set[int] = set()
    while error is not None and id(error) not in visited:
        visited.add(id(error))
        if isinstance(error, ToolPreWriteValidationError):
            return error.to_tool_result()
        if not _is_function_tool_wrapper(error):
            return None
        error = error.__cause__ or (
            None if error.__suppress_context__ else error.__context__
        )
    return None


def _is_function_tool_wrapper(error: BaseException) -> bool:
    if type(error) is not ValueError or error.__traceback__ is None:
        return False

    # CAMEL currently replaces tool exceptions with ValueError in __call__.
    # Compare the actual raising code, never model-controlled error text.
    # If an upgraded framework uses a different wrapper, fail closed until
    # that adapter has a tested, explicit no-write propagation contract.
    from camel.toolkits import FunctionTool

    traceback = error.__traceback__
    while traceback.tb_next is not None:
        traceback = traceback.tb_next
    return traceback.tb_frame.f_code is getattr(
        FunctionTool.__call__, "__code__", None
    )


# Pre-dispatch argument checks
# ----------------------------
# The model sees a tool's published JSON schema and its arguments are bound
# to the real callable only after the checkpoint has been dispatched. When
# the two disagree, Python raises a binding or type error from inside the
# tool, the failure looks like an ambiguous side effect, and the message
# names no parameter. These checks run on code-owned metadata (the call
# signature and the published schema), never on error text, and only before
# the tool is authorized or dispatched.

_INTEGER_TEXT = re.compile(r"[+-]?[0-9]+")
_NUMBER_TEXT = re.compile(
    r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?"
)
_COERCIBLE_TYPES = frozenset({"integer", "number", "boolean"})
_TYPE_LABELS = {
    frozenset({"integer"}): "an integer",
    frozenset({"number"}): "a number",
    frozenset({"integer", "number"}): "a number",
    frozenset({"boolean"}): "true or false",
}
_KEYWORD_KINDS = (
    inspect.Parameter.POSITIONAL_OR_KEYWORD,
    inspect.Parameter.KEYWORD_ONLY,
)
_UNPARSEABLE = object()
_MAX_VALUE_PREVIEW = 80


@dataclass(frozen=True)
class ToolArgumentCheck:
    """Arguments to journal and run, or a rejection to record instead."""

    arguments: dict[str, Any]
    rejection: ToolPreWriteValidationError | None = None


@dataclass(frozen=True)
class _ArgumentProblem:
    error_code: str
    field: str
    message: str


def check_tool_arguments(
    tool: Any,
    tool_name: str,
    arguments: dict[str, Any],
) -> ToolArgumentCheck:
    """Bind model arguments to a tool before it is authorized or dispatched.

    Missing required parameters and parameters the tool does not accept are
    reported by name; MCP tools forward parameters their schema does not
    list to the server, which validates them, and async toolkit tools drop
    them before they run, so neither is rejected for one. A quoted scalar is
    converted only when the published schema declares exactly an integer,
    number or boolean and the text is an exact spelling of that type;
    anything ambiguous is passed through as is.
    Only CAMEL FunctionTools are checked, because they invoke exactly
    ``tool.func`` with these keyword arguments; other tool objects, and tools
    without introspectable metadata, are left unchanged so this check can
    only turn a doomed call into a named, retryable failure.
    """

    from camel.toolkits import FunctionTool

    if not isinstance(tool, FunctionTool) or not isinstance(arguments, dict):
        return ToolArgumentCheck(arguments)
    properties, additional_allowed = _published_parameters(tool)
    if _forwards_to_mcp_server(tool):
        # The MCP server validates its own arguments, and CAMEL publishes
        # ``additionalProperties: false`` whatever the server's schema says.
        # Keys the schema does not list are forwarded unchanged, as before.
        additional_allowed = True
    if _drops_unknown_arguments(tool):
        # The call is not doomed: the tool runs without the extra keys, as
        # it did before these checks existed. Rejecting it would cost the
        # model a round trip for a call that works.
        additional_allowed = True
    problems = _binding_problems(
        _call_signature(tool),
        arguments,
        additional_allowed=additional_allowed,
        bound_signature=_bound_signature(tool),
    )
    coerced = dict(arguments)
    for name, value in arguments.items():
        if not isinstance(value, str):
            continue
        declared = _declared_scalar_types(properties.get(name))
        if declared is None:
            continue
        parsed = _parse_scalar(value, declared)
        if parsed is _UNPARSEABLE:
            problems.append(
                _ArgumentProblem(
                    error_code="invalid_tool_argument_type",
                    field=name,
                    message=(
                        f"Argument '{name}' must be "
                        f"{_TYPE_LABELS[declared]}, got "
                        f"{_preview(value)}."
                    ),
                )
            )
            continue
        coerced[name] = parsed
    if not problems:
        return ToolArgumentCheck(coerced)
    first = problems[0]
    rejection = ToolPreWriteValidationError(
        f"{tool_name} was not run: "
        + " ".join(problem.message for problem in problems),
        error_code=first.error_code,
        field=first.field,
        recovery={
            "action": (
                f"Call {tool_name} again with the corrected arguments. "
                "Nothing was run, so the call is safe to retry."
            )
        },
    )
    # Journal what the model actually sent; nothing ran with it.
    return ToolArgumentCheck(dict(arguments), rejection)


def _published_parameters(tool: Any) -> tuple[dict[str, Any], bool | None]:
    """Return schema properties and whether extra keys are allowed.

    ``None`` means the schema could not be read, so only the call signature
    decides. JSON Schema allows extra properties unless they are forbidden.
    """

    # Read the stored schema the model was given. The public getter
    # re-validates and warns on every call, which is not needed here.
    schema = getattr(tool, "openai_tool_schema", None)
    function = schema.get("function") if isinstance(schema, Mapping) else None
    parameters = (
        function.get("parameters") if isinstance(function, Mapping) else None
    )
    if not isinstance(parameters, Mapping):
        return {}, None
    properties = parameters.get("properties")
    additional = parameters.get("additionalProperties", True)
    return (
        dict(properties) if isinstance(properties, Mapping) else {},
        additional is not False,
    )


def _call_signature(tool: Any) -> inspect.Signature | None:
    func = getattr(tool, "func", None)
    if func is None or not callable(func):
        return None
    try:
        return inspect.signature(func)
    except (TypeError, ValueError):
        return None


def _forwards_to_mcp_server(tool: Any) -> bool:
    # CAMEL's MCP client functions carry ``async_call``, which sends the
    # keyword arguments to the server; the agent dispatches MCP tools by it.
    return callable(getattr(getattr(tool, "func", None), "async_call", None))


def _drops_unknown_arguments(tool: Any) -> bool:
    # ``listen_toolkit`` marks the async wrapper that filters keyword
    # arguments its tool does not accept. Sync tools are not filtered, so an
    # unknown argument there still fails to bind and is still rejected.
    return (
        getattr(
            getattr(tool, "func", None),
            "__listen_drops_unknown_arguments__",
            False,
        )
        is True
    )


def _bound_signature(tool: Any) -> inspect.Signature | None:
    """Return the signature the call finally binds to, when it differs.

    ``listen_toolkit`` can publish a base class signature for an override
    that gives a parameter a default. The override is what runs, so a
    parameter it does not require is not missing.
    """

    signature = getattr(
        getattr(tool, "func", None), "__listen_call_signature__", None
    )
    return signature if isinstance(signature, inspect.Signature) else None


def _requires(signature: inspect.Signature | None, name: str) -> bool:
    if signature is None:
        return True
    parameter = signature.parameters.get(name)
    return parameter is None or parameter.default is inspect.Parameter.empty


def _binding_problems(
    signature: inspect.Signature | None,
    arguments: dict[str, Any],
    *,
    additional_allowed: bool | None,
    bound_signature: inspect.Signature | None = None,
) -> list[_ArgumentProblem]:
    if signature is None:
        return []
    parameters = signature.parameters
    accepted = [
        name
        for name, parameter in parameters.items()
        if parameter.kind in _KEYWORD_KINDS
    ]
    problems: list[_ArgumentProblem] = []
    accepts_any = any(
        parameter.kind is inspect.Parameter.VAR_KEYWORD
        for parameter in parameters.values()
    )
    if not accepts_any and additional_allowed is not True:
        unknown = [name for name in arguments if name not in accepted]
        if unknown:
            problems.append(
                _ArgumentProblem(
                    error_code="unknown_tool_argument",
                    field=unknown[0],
                    message=(
                        f"Unknown argument(s): {_names(unknown)}. "
                        f"Accepted arguments: {_names(accepted) or 'none'}."
                    ),
                )
            )
    missing = [
        name
        for name, parameter in parameters.items()
        if parameter.kind in _KEYWORD_KINDS
        and parameter.default is inspect.Parameter.empty
        and name not in arguments
        and _requires(bound_signature, name)
    ]
    if missing:
        problems.append(
            _ArgumentProblem(
                error_code="missing_tool_argument",
                field=missing[0],
                message=f"Missing required argument(s): {_names(missing)}.",
            )
        )
    return problems


def _declared_scalar_types(schema: Any) -> frozenset[str] | None:
    """Return the scalar types a property declares, or None if ambiguous."""

    if not isinstance(schema, Mapping):
        return None
    declared: set[str] = set()
    if not _collect_types(schema.get("type"), declared):
        return None
    for keyword in ("anyOf", "oneOf"):
        options = schema.get(keyword)
        if options is None:
            continue
        if not isinstance(options, list):
            return None
        for option in options:
            if not isinstance(option, Mapping) or option.get("type") is None:
                return None
            if not _collect_types(option["type"], declared):
                return None
    declared.discard("null")
    if not declared or not declared <= _COERCIBLE_TYPES:
        return None
    if "boolean" in declared and len(declared) > 1:
        return None
    return frozenset(declared)


def _collect_types(value: Any, into: set[str]) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        into.add(value)
        return True
    if isinstance(value, list) and all(
        isinstance(item, str) for item in value
    ):
        into.update(value)
        return True
    return False


def _parse_scalar(text: str, declared: frozenset[str]) -> Any:
    stripped = text.strip()
    if declared == {"boolean"}:
        lowered = stripped.lower()
        if lowered == "true":
            return True
        if lowered == "false":
            return False
        return _UNPARSEABLE
    try:
        if "integer" in declared and _INTEGER_TEXT.fullmatch(stripped):
            return int(stripped)
        if "number" in declared and _NUMBER_TEXT.fullmatch(stripped):
            number = float(stripped)
            if math.isfinite(number):
                return number
    except ValueError:
        pass
    return _UNPARSEABLE


def _names(names: list[str]) -> str:
    return ", ".join(f"'{name}'" for name in names)


def _preview(value: str) -> str:
    text = repr(value)
    if len(text) > _MAX_VALUE_PREVIEW:
        return text[: _MAX_VALUE_PREVIEW - 3] + "..."
    return text
