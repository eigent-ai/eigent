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

import logging

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.component import code
from app.exception.exception import (
    NoPermissionException,
    ProgramException,
    TokenException,
    UserException,
)

logger = logging.getLogger("exception_handler")


async def request_exception(request: Request, e: RequestValidationError):
    logger.warning(f"Validation error on {request.url.path}: {e.errors()}")
    errors = list(e.errors())
    try:
        # Translation support is optional in the packaged local runtime. Keep
        # exception registration independent from fastapi-babel/Jinja2 so a
        # missing template dependency cannot prevent the API from starting.
        from app.component.pydantic.i18n import get_language, trans

        lang = get_language(request.headers.get("Accept-Language")) or "en_US"
        errors = trans.translate(errors, locale=lang)
    except ImportError:
        logger.info("Validation translation unavailable; using raw errors")

    return JSONResponse(
        content={
            "code": code.form_error,
            "error": jsonable_encoder(errors),
        }
    )


async def token_exception(request: Request, e: TokenException):
    logger.warning(f"Token exception on {request.url.path}: {e.text}")
    return JSONResponse(content={"code": e.code, "text": e.text})


async def user_exception(request: Request, e: UserException):
    logger.info(f"User exception on {request.url.path}: {e.description}")
    return JSONResponse(content={"code": e.code, "text": e.description})


async def no_permission(request: Request, exception: NoPermissionException):
    logger.warning(f"No permission on {request.url.path}: {exception.text}")
    return JSONResponse(
        status_code=200,
        content={"code": code.no_permission_error, "text": exception.text},
    )


async def program_exception(request: Request, exception: ProgramException):
    logger.error(
        f"Program exception on {request.url.path}: {exception.text}",
        exc_info=True,
    )
    return JSONResponse(
        status_code=200,
        content={"code": code.program_error, "text": exception.text},
    )


async def global_exception_handler(request: Request, exc: Exception):
    logger.error(
        f"Unhandled exception on {request.method} {request.url.path}: {exc}",
        exc_info=True,
        extra={
            "request_method": request.method,
            "request_path": str(request.url.path),
            "request_query": str(request.url.query),
            "client_host": request.client.host if request.client else None,
        },
    )

    return JSONResponse(
        status_code=500,
        content={
            "code": 500,
            "message": str(exc),
        },
    )


def register_exception_handlers(app: FastAPI) -> None:
    """Register Eigent's API error envelope on a FastAPI application."""
    app.add_exception_handler(RequestValidationError, request_exception)
    app.add_exception_handler(TokenException, token_exception)
    app.add_exception_handler(UserException, user_exception)
    app.add_exception_handler(NoPermissionException, no_permission)
    app.add_exception_handler(ProgramException, program_exception)
    app.add_exception_handler(Exception, global_exception_handler)
