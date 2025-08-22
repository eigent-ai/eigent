import json
from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from app import api
from app.component import code
from app.exception.exception import NoPermissionException, TokenException
from app.component.pydantic.i18n import trans, get_language
from app.exception.exception import UserException
from sqlalchemy.exc import NoResultFound


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


async def no_results(request: Request, exception: NoResultFound):
    return JSONResponse(
        status_code=200,
        content={"code": code.not_found, "text": exception._message()},
    )
