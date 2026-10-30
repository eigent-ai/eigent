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
