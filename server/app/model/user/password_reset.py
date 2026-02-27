from datetime import datetime
from sqlmodel import Field
from app.model.abstract.model import AbstractModel, DefaultTimes
from pydantic import BaseModel, EmailStr, field_validator, model_validator


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

    @field_validator("token")
    @classmethod
    def validate_token(cls, v: str) -> str:
        """Validate token is not empty."""
        if not v or not v.strip():
            raise ValueError("Token is required")
        return v.strip()

    @field_validator("new_password")
    @classmethod
    def validate_password_strength(cls, v: str) -> str:
        """Validate password meets strength requirements."""
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long")
        
        has_letter = any(c.isalpha() for c in v)
        has_number = any(c.isdigit() for c in v)
        
        if not has_letter:
            raise ValueError("Password must contain at least one letter")
        if not has_number:
            raise ValueError("Password must contain at least one number")
        
        return v

    @model_validator(mode="after")
    def validate_passwords_match(self):
        """Validate that new_password and confirm_password match."""
        if self.new_password != self.confirm_password:
            raise ValueError("Passwords do not match")
        return self


class DirectResetPasswordRequest(BaseModel):
    """Request model for direct password reset (local deployment only)."""
    email: EmailStr
    new_password: str
    confirm_password: str

    @field_validator("new_password")
    @classmethod
    def validate_password_strength(cls, v: str) -> str:
        """Validate password meets strength requirements."""
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long")
        
        has_letter = any(c.isalpha() for c in v)
        has_number = any(c.isdigit() for c in v)
        
        if not has_letter:
            raise ValueError("Password must contain at least one letter")
        if not has_number:
            raise ValueError("Password must contain at least one number")
        
        return v

    @model_validator(mode="after")
    def validate_passwords_match(self):
        """Validate that new_password and confirm_password match."""
        if self.new_password != self.confirm_password:
            raise ValueError("Passwords do not match")
        return self
