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

import os
from itsdangerous import URLSafeTimedSerializer
from pydantic import BaseModel


class ChatShare:
    SECRET_KEY = os.getenv("CHAT_SHARE_SECRET_KEY", "EGB1WRC9xMUVgNoIPH8tLw")
    SALT = os.getenv("CHAT_SHARE_SALT", "r4U2M")
    # Set expiration to 1 day
    EXPIRATION_SECONDS = int(os.getenv("CHAT_SHARE_EXPIRATION_SECONDS", 60 * 60 * 24))

    @classmethod
    def generate_token(cls, task_id: str) -> str:
        serializer = URLSafeTimedSerializer(cls.SECRET_KEY)
        return serializer.dumps(task_id, salt=cls.SALT)

    @classmethod
    def verify_token(cls, token: str, check_expiration: bool = True) -> str:
        """
        Verify token and return task_id

        Args:
            token: The token to verify
            check_expiration: Whether to check token expiration (default: True)

        Returns:
            str: The task_id from the token

        Raises:
            Exception: If token is invalid or expired (when check_expiration=True)
        """
        serializer = URLSafeTimedSerializer(cls.SECRET_KEY)

        if check_expiration:
            # Check expiration time
            return serializer.loads(token, salt=cls.SALT, max_age=cls.EXPIRATION_SECONDS)
        else:
            # Don't check expiration time
            return serializer.loads(token, salt=cls.SALT)


class ChatShareIn(BaseModel):
    task_id: str


class ChatHistoryShareOut(BaseModel):
    question: str
    language: str
    model_platform: str
    model_type: str
    max_retries: int
    project_name: str | None = None
    summary: str | None = None

    class Config:
        from_attributes = True
