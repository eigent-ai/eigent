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
from app.utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("exception_handler")


@api.exception_handler(RequestValidationError)
async def request_exception(request: Request, e: RequestValidationError):
    if (lang := get_language(request.headers.get("Accept-Language"))) is None:
        lang = "en_US"
    return JSONResponse(
        content={
            "code": code.form_error,
            "error": jsonable_encoder(trans.translate(list(e.errors()), locale=lang)),
        }
    )


@api.exception_handler(TokenException)
async def token_exception(request: Request, e: TokenException):
    return JSONResponse(content={"code": e.code, "text": e.text})


@api.exception_handler(UserException)
async def user_exception(request: Request, e: UserException):
    return JSONResponse(content={"code": e.code, "text": e.description})


@api.exception_handler(NoPermissionException)
async def no_permission(request: Request, exception: NoPermissionException):
    return JSONResponse(
        status_code=200,
        content={"code": code.no_permission_error, "text": exception.text},
    )


@api.exception_handler(ProgramException)
async def program_exception(request: Request, exception: NoPermissionException):
    return JSONResponse(
        status_code=200,
        content={"code": code.program_error, "text": exception.text},
    )


@api.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error: {exc}")
    traceback.print_exc()  # output to electron log

    return JSONResponse(
        status_code=500,
        content={
            "code": 500,
            "message": str(exc),
        },
    )
