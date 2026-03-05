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

import ast
import json
import re


def _parse_dict(text: str) -> dict | None:
    """Parse a dict string (JSON double-quotes or Python single-quotes)."""
    for loader in (json.loads, ast.literal_eval):
        try:
            result = loader(text)
            if isinstance(result, dict):
                return result
        except Exception:  # nosec B112
            continue
    return None


def _extract_from_dict(d: dict) -> tuple[str | None, str | None, dict]:
    """Pull message / code / error_obj from an OpenAI-shaped dict."""
    err = d.get("error") or d
    if not isinstance(err, dict):
        return None, None, {}
    error_obj = {
        "message": err.get("message"),
        "type": err.get("type"),
        "param": err.get("param"),
        "code": err.get("code"),
    }
    return err.get("message"), err.get("code"), error_obj


def normalize_error_to_openai_format(
    exception: Exception,
) -> tuple[str, str | None, dict | None]:
    """
    Normalize error to OpenAI-style error structure.

    Args:
        exception: The exception to normalize

    Returns:
        tuple: (message, error_code, error_object)
    """
    raw_msg = str(exception)

    # 1) Structured attributes (OpenAI SDK exceptions expose .body)
    body = getattr(exception, "body", None)
    if isinstance(body, dict):
        msg, code, obj = _extract_from_dict(body)
        if msg:
            return msg, code, obj

    # 2) Parse "Error code: <status> - {dict}" from str(exception)
    m = re.search(r"Error code:\s*(\d+)\s*-\s*(\{.*\})", raw_msg, re.DOTALL)
    if m:
        parsed = _parse_dict(m.group(2))
        if parsed:
            msg, code, obj = _extract_from_dict(parsed)
            if msg:
                return msg, code or m.group(1), obj

    # 3) Keyword heuristics — classify the error but preserve original text
    lower = raw_msg.lower()
    if (
        "invalid_api_key" in lower
        or "incorrect api key" in lower
        or "unauthorized" in lower
        or " 401" in lower
    ):
        code = "invalid_api_key"
    elif (
        "model_not_found" in lower
        or "does not exist" in lower
        or " 404" in lower
    ):
        code = "model_not_found"
    elif "insufficient_quota" in lower or "quota" in lower or " 429" in lower:
        code = "insufficient_quota"
    else:
        return raw_msg, None, None

    return (
        raw_msg,
        code,
        {
            "message": raw_msg,
            "type": "invalid_request_error",
            "param": None,
            "code": code,
        },
    )
