"""
Password Reset Models
Pydantic models for password reset functionality with validation.
"""
from pydantic import BaseModel, field_validator, model_validator


class DirectResetPasswordRequest(BaseModel):
    """Request model for direct password reset (local deployment only)."""
    email: str
    new_password: str
    confirm_password: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        """Validate email format."""
        v = v.strip().lower()
        if not v:
            raise ValueError("Email is required")
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("Invalid email format")
        return v

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


class ForgotPasswordRequest(BaseModel):
    """Request model for forgot password (token-based flow)."""
    email: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        """Validate email format."""
        v = v.strip().lower()
        if not v:
            raise ValueError("Email is required")
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("Invalid email format")
        return v


class ResetPasswordRequest(BaseModel):
    """Request model for reset password with token."""
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
