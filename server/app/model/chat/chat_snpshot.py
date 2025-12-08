from typing import Optional
from sqlalchemy import Column, Integer, text
from sqlmodel import Field
from app.model.abstract.model import AbstractModel, DefaultTimes
from pydantic import BaseModel, field_validator
from pathlib import Path
import os
import base64
import time

from app.component.sqids import encode_user_id
from utils.path_safety import safe_component, sanitize_path


UPLOAD_ROOT = (Path("app") / "public" / "upload").resolve()


class ChatSnapshot(AbstractModel, DefaultTimes, table=True):
    id: int = Field(default=None, primary_key=True)
    user_id: int = Field(sa_column=(Column(Integer, server_default=text("0"))))
    api_task_id: str = Field(index=True)
    camel_task_id: str = Field(index=True)
    browser_url: str
    image_path: str

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
    user_id: Optional[int] = None
    camel_task_id: str
    browser_url: str
    image_base64: str

    @field_validator("api_task_id", "camel_task_id")
    @classmethod
    def validate_ids(cls, value: str, info):
        return safe_component(value, info.field_name)

    @staticmethod
    def save_image(user_id: int, api_task_id: str, image_base64: str) -> str:
        if "," in image_base64:
            image_base64 = image_base64.split(",", 1)[1]
        safe_task_id = safe_component(api_task_id, "api_task_id")
        user_dir = encode_user_id(user_id)
        folder = sanitize_path(UPLOAD_ROOT / user_dir / safe_task_id, UPLOAD_ROOT)
        if folder is None:
            raise ValueError("Invalid upload path")
        folder.mkdir(parents=True, exist_ok=True)
        filename = f"{int(time.time() * 1000)}.jpg"
        file_path = sanitize_path(folder / filename, UPLOAD_ROOT)
        if file_path is None:
            raise ValueError("Invalid upload path")
        with open(file_path, "wb") as f:
            f.write(base64.b64decode(image_base64))
        return f"/public/upload/{user_dir}/{safe_task_id}/{filename}"
