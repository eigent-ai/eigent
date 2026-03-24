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

"""v1 UserAuthService and KeyService request/response schemas."""

from pydantic import BaseModel


# UserAuthService DTOs
class LoginReq(BaseModel):
    email: str
    password: str


class RefreshTokenReq(BaseModel):
    refresh_token: str


class LogoutReq(BaseModel):
    token: str


class AuthResult(BaseModel):
    success: bool
    access_token: str | None = None
    refresh_token: str | None = None
    email: str | None = None
    error_code: str | None = None


# KeyService DTOs
class GetKeyReq(BaseModel):
    user_id: int


class KeyResult(BaseModel):
    success: bool
    key_value: str | None = None
    warning_code: str | None = None
    warning_text: str | None = None
    error_code: str | None = None
