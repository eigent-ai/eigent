import traceback
from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from app import api
from app.component import code
from app.exception.exception import NoPermissionException, ProgramException, TokenException
from app.component.pydantic.i18n import trans, get_language
from app.exception.exception import UserException
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("exception_handler")


@api.exception_handler(RequestValidationError)
async def request_exception(request: Request, e: RequestValidationError):
    if (lang := get_language(request.headers.get("Accept-Language"))) is None:
        lang = "en_US"
    logger.warning(f"Validation error on {request.url.path}: {e.errors()}")
    
    return JSONResponse(
        content={
            "code": code.form_error,
            "error": jsonable_encoder(trans.translate(list(e.errors()), locale=lang)),
        }
    )


@api.exception_handler(TokenException)
async def token_exception(request: Request, e: TokenException):
    logger.warning(f"Token exception on {request.url.path}: {e.text}")
    return JSONResponse(content={"code": e.code, "text": e.text})


@api.exception_handler(UserException)
async def user_exception(request: Request, e: UserException):
    logger.info(f"User exception on {request.url.path}: {e.description}")
    return JSONResponse(content={"code": e.code, "text": e.description})


@api.exception_handler(NoPermissionException)
async def no_permission(request: Request, exception: NoPermissionException):
    logger.warning(f"No permission on {request.url.path}: {exception.text}")
    return JSONResponse(
        status_code=200,
        content={"code": code.no_permission_error, "text": exception.text},
    )


@api.exception_handler(ProgramException)
async def program_exception(request: Request, exception: NoPermissionException):
    logger.error(f"Program exception on {request.url.path}: {exception.text}", exc_info=True)
    return JSONResponse(
        status_code=200,
        content={"code": code.program_error, "text": exception.text},
    )


@api.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(
        f"Unhandled exception on {request.method} {request.url.path}: {exc}",
        exc_info=True,
        extra={
            "request_method": request.method,
            "request_path": str(request.url.path),
            "request_query": str(request.url.query),
            "client_host": request.client.host if request.client else None,
        }
    )

    return JSONResponse(
        status_code=500,
        content={
            "code": 500,
            "message": str(exc),
        },
    )
