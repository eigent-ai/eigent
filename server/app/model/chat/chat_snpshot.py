from typing import Optional
from sqlalchemy import Column, Integer, text
from sqlmodel import Field
from app.model.abstract.model import AbstractModel, DefaultTimes
from pydantic import BaseModel
import os
import base64
import time

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
        folder = os.path.join("app", "public", "upload", user_dir, api_task_id)
        os.makedirs(folder, exist_ok=True)
        filename = f"{int(time.time() * 1000)}.jpg"
        file_path = os.path.join(folder, filename)
        with open(file_path, "wb") as f:
            f.write(base64.b64decode(image_base64))
        return f"/public/upload/{user_dir}/{api_task_id}/{filename}"
