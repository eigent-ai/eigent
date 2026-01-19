from datetime import datetime
from sqlmodel import Field
from app.model.abstract.model import AbstractModel, DefaultTimes
from pydantic import BaseModel, EmailStr


class PasswordResetToken(AbstractModel, DefaultTimes, table=True):
    """Model for storing password reset tokens."""
    id: int = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    token: str = Field(unique=True, max_length=255, index=True)
    expires_at: datetime = Field()
    used: bool = Field(default=False)

    def is_valid(self) -> bool:
        """Check if the token is still valid (not expired and not used)."""
        return not self.used and datetime.now() < self.expires_at


class ForgotPasswordRequest(BaseModel):
    """Request model for forgot password endpoint."""
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    """Request model for reset password endpoint."""
    token: str
    new_password: str
    confirm_password: str
