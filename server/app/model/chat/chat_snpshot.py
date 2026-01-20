from typing import Optional
from sqlalchemy import Column, Integer, text
from sqlmodel import Field
from app.model.abstract.model import AbstractModel, DefaultTimes
from pydantic import BaseModel
import os
import base64
import time
import re
from pathlib import Path
from uuid import uuid4

from app.component.sqids import encode_user_id


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

    @staticmethod
    def save_image(user_id: int, api_task_id: str, image_base64: str) -> str:
        if "," in image_base64:
            image_base64 = image_base64.split(",", 1)[1]

        user_dir = encode_user_id(user_id)
        if os.path.basename(user_dir) != user_dir or not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", user_dir or ""):
            raise ValueError("Invalid user_id")

        base_dir = os.path.abspath(os.path.join("app", "public", "upload"))

        # Keep api_task_id as part of the path but ensure it cannot traverse
        safe_api_task_id = os.path.basename(api_task_id)
        if safe_api_task_id != api_task_id or not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", safe_api_task_id or ""):
            raise ValueError("Invalid api_task_id")

        folder = os.path.normpath(os.path.join(base_dir, user_dir, safe_api_task_id))
        # Directory traversal guard: ensure final path stays under base_dir
        if not folder.startswith(base_dir + os.sep):
            raise ValueError("Unsafe upload path detected")

        Path(folder).mkdir(parents=True, exist_ok=True)
        filename = f"{int(time.time() * 1000)}_{uuid4().hex}.jpg"
        file_path = os.path.join(folder, filename)
        with open(file_path, "wb") as f:
            f.write(base64.b64decode(image_base64))
        return f"/public/upload/{user_dir}/{safe_api_task_id}/{filename}"
