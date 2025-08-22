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
