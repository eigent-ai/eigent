import json
import re


def normalize_error_to_openai_format(exception: Exception) -> tuple[str, str | None, dict | None]:
    """
    Normalize error to OpenAI-style error structure.

    Args:
        exception: The exception to normalize

    Returns:
        tuple: (message, error_code, error_object)
    """
    raw_msg = str(exception)
    error_obj = None
    error_code = None
    message = raw_msg

    # Match "Error code: <code> - {json}"
    m = re.search(r"Error code:\s*(\d+)\s*-\s*(\{.*\})", raw_msg, re.DOTALL)
    if m:
        error_code = m.group(1)
        try:
            parsed = json.loads(m.group(2))
            err = parsed.get("error") or parsed
            if isinstance(err, dict):
                error_obj = {
                    "message": err.get("message"),
                    "type": err.get("type"),
                    "param": err.get("param"),
                    "code": err.get("code"),
                }
                if err.get("message"):
                    message = err.get("message")
                if err.get("code"):
                    error_code = err.get("code")
        except Exception:
            pass

    # Heuristics if not parsed
    if error_obj is None:
        lower = raw_msg.lower()
        if "invalid_api_key" in lower or "incorrect api key" in lower or "unauthorized" in lower or " 401" in lower:
            error_code = "invalid_api_key"
            message = "Invalid key. Validation failed."
            error_obj = {
                "message": message,
                "type": "invalid_request_error",
                "param": None,
                "code": "invalid_api_key",
            }
        elif "model_not_found" in lower or "does not exist" in lower or " 404" in lower:
            error_code = "model_not_found"
            message = "Invalid model name. Validation failed."
            error_obj = {
                "message": message,
                "type": "invalid_request_error",
                "param": None,
                "code": "model_not_found",
            }
        elif "insufficient_quota" in lower or "quota" in lower or " 429" in lower:
            error_code = "insufficient_quota"
            message = "You exceeded your current quota, please check your plan and billing details."
            error_obj = {
                "message": message,
                "type": "insufficient_quota",
                "param": None,
                "code": "insufficient_quota",
            }

    return message, error_code, error_obj
