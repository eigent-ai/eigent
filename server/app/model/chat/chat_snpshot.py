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

import base64
import os
import re
import time
from datetime import datetime

from pydantic import BaseModel
from sqlalchemy import Column, Integer, text
from sqlmodel import Field

from app.core.sqids import encode_user_id
from app.model.abstract.model import AbstractModel, DefaultTimes

SNAPSHOT_PATH_COMPONENT = re.compile(r"^[a-zA-Z0-9_.:-]{1,200}$")


def _safe_snapshot_component(value: str, field_name: str) -> str:
    if not value or value in {".", ".."} or not SNAPSHOT_PATH_COMPONENT.match(value):
        raise ValueError(f"Invalid {field_name}: unsafe snapshot path component")
    return value


class ChatSnapshot(AbstractModel, DefaultTimes, table=True):
    id: int = Field(default=None, primary_key=True)
    user_id: int = Field(sa_column=(Column(Integer, server_default=text("0"))))
    api_task_id: str = Field(index=True)
    camel_task_id: str = Field(index=True)
    browser_url: str
    image_path: str
    storage_key: str | None = Field(default=None, index=True)

    @classmethod
    def get_user_dir(cls, user_id: int) -> str:
        return os.path.join("app", "public", "upload", encode_user_id(user_id))

    @classmethod
    def caclDir(cls, path: str) -> float:
        """Return disk usage of path directory (in MB, rounded to 2 decimal places)"""
        total_size = 0
        for dirpath, dirnames, filenames in os.walk(path):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                if os.path.isfile(fp):
                    total_size += os.path.getsize(fp)
        size_mb = total_size / (1024 * 1024)
        return round(size_mb, 2)


class ChatSnapshotIn(BaseModel):
    api_task_id: str
    user_id: int | None = None
    space_id: str | None = None
    project_id: str | None = None
    run_id: str | None = None
    camel_task_id: str
    browser_url: str
    image_base64: str
    storage_key: str | None = None

    @staticmethod
    def save_image(
        user_id: int,
        api_task_id: str,
        image_base64: str,
        *,
        space_id: str | None = None,
        project_id: str | None = None,
        run_id: str | None = None,
    ) -> str:
        if "," in image_base64:
            image_base64 = image_base64.split(",", 1)[1]
        if space_id and project_id:
            safe_space_id = _safe_snapshot_component(space_id, "space_id")
            safe_project_id = _safe_snapshot_component(project_id, "project_id")
            safe_run_id = _safe_snapshot_component(run_id or api_task_id, "run_id")
            folder = os.path.join(
                "app",
                "public",
                "upload",
                "v2",
                safe_space_id,
                safe_project_id,
                safe_run_id,
            )
            public_prefix = f"/public/upload/v2/{safe_space_id}/{safe_project_id}/{safe_run_id}"
        else:
            user_dir = encode_user_id(user_id)
            safe_api_task_id = _safe_snapshot_component(api_task_id, "api_task_id")
            folder = os.path.join("app", "public", "upload", user_dir, safe_api_task_id)
            public_prefix = f"/public/upload/{user_dir}/{safe_api_task_id}"
        os.makedirs(folder, exist_ok=True)
        filename = f"{int(time.time() * 1000)}.jpg"
        file_path = os.path.join(folder, filename)
        with open(file_path, "wb") as f:
            f.write(base64.b64decode(image_base64))
        return f"{public_prefix}/{filename}"


class ChatSnapshotOut(BaseModel):
    id: int
    user_id: int
    api_task_id: str
    camel_task_id: str
    browser_url: str
    image_path: str
    image_url: str
    storage_key: str | None = None
    deleted_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ChatSnapshotUpdate(BaseModel):
    """Update model - only updatable fields."""
    api_task_id: str | None = None
    camel_task_id: str | None = None
    browser_url: str | None = None
    image_path: str | None = None
    storage_key: str | None = None
