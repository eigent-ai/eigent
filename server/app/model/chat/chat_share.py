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
import os
import secrets

from itsdangerous import URLSafeTimedSerializer
from pydantic import BaseModel

logger = logging.getLogger(__name__)


def _get_secret_key() -> str:
    """Return the share-token signing key.

    Raises an error if the environment variable is not set.
    A hardcoded default or random fallback must never be used because the
    source code is public and anyone could forge valid share tokens.
    """
    key = os.getenv("CHAT_SHARE_SECRET_KEY")
    if key:
        return key
    raise RuntimeError(
        "CHAT_SHARE_SECRET_KEY environment variable is required but not set. "
        "Generate a secure key with: openssl rand -base64 32"
    )


def _get_salt() -> str:
    salt = os.getenv("CHAT_SHARE_SALT")
    if salt:
        return salt
    logger.warning(
        "CHAT_SHARE_SALT not set — using a random ephemeral salt. "
        "Share links will not survive server restarts. "
        "Set the CHAT_SHARE_SALT environment variable for persistence."
    )
    return secrets.token_urlsafe(8)


class ChatShare:
    SECRET_KEY = _get_secret_key()
    SALT = _get_salt()
    # Set expiration to 1 day
    EXPIRATION_SECONDS = int(os.getenv("CHAT_SHARE_EXPIRATION_SECONDS", str(60 * 60 * 24)))

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
