from camel.models import ModelProcessingError
from app.component.error_format import normalize_error_to_openai_format
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("error_handler")


def prepare_model_error_response(
    error: ModelProcessingError,
    project_id: str,
    task_id: str,
    context: str = "task decomposition"
) -> tuple[dict, str, str | None]:
    """Prepare error response for ModelProcessingError.

    This function normalizes the error and prepares the payload for frontend notification.

    Args:
        error: The ModelProcessingError to handle
        project_id: Project ID for logging
        task_id: Task ID for logging
        context: Description of where the error occurred (for logging)

    Returns:
        tuple: (error_payload, message, error_code)
            - error_payload: SSE error payload ready to send to frontend
            - message: Human-readable error message
            - error_code: Error code (e.g., "invalid_api_key")
    """
    message, error_code, error_obj = normalize_error_to_openai_format(error)

    logger.error(
        f"{context.capitalize()} failed due to model error: {message}",
        extra={
            "project_id": project_id,
            "task_id": task_id,
            "error_code": error_code,
            "error": str(error)
        },
        exc_info=True
    )

    # Prepare error payload
    error_payload = {
        "message": message,
        "error_code": error_code,
        "error": error_obj
    }

    return error_payload, message, error_code
