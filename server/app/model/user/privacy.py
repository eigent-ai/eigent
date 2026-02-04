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

from pydantic import BaseModel
from sqlalchemy import JSON
from sqlmodel import Column, Field

from app.model.abstract.model import AbstractModel, DefaultTimes


class UserPrivacy(AbstractModel, DefaultTimes, table=True):
    id: int = Field(default=None, primary_key=True)
    user_id: int = Field(unique=True, foreign_key="user.id")
    pricacy_setting: dict = Field(default="{}", sa_column=Column(JSON))


class UserPrivacySettings(BaseModel):
    take_screenshot: bool | None = False
    access_local_software: bool | None = False
    access_your_address: bool | None = False
    password_storage: bool | None = False

    @classmethod
    def default_settings(cls) -> dict:
        return cls().model_dump()
