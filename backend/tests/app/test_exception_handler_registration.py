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

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app import api
from app.exception.exception import UserException
from app.exception.handler import register_exception_handlers


def test_user_exception_handler_is_registered_on_shared_api():
    assert UserException in api.exception_handlers


def test_user_exception_returns_api_error_instead_of_http_500():
    test_api = FastAPI()
    register_exception_handlers(test_api)

    @test_api.get("/late-human-reply")
    async def late_human_reply():
        raise UserException(1, "No longer waiting for a human reply")

    with TestClient(test_api) as client:
        response = client.get("/late-human-reply")

    assert response.status_code == 200
    assert response.json() == {
        "code": 1,
        "text": "No longer waiting for a human reply",
    }


def test_validation_handler_works_without_eager_translation_import():
    test_api = FastAPI()
    register_exception_handlers(test_api)

    class Payload(BaseModel):
        count: int

    @test_api.post("/validate")
    async def validate(payload: Payload):
        return payload

    with TestClient(test_api) as client:
        response = client.post("/validate", json={"count": "not-a-number"})

    assert response.status_code == 200
    assert response.json()["code"] == 100
