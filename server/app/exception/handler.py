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

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import NoResultFound

from app import api
from app.component import code
from app.component.pydantic.i18n import get_language, trans
from app.exception.exception import (
    NoPermissionException,
    TokenException,
    UserException,
)


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
