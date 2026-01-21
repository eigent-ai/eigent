import secrets
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, col

from app.component import code
from app.component.database import session
from app.component.encrypt import password_hash
from app.exception.exception import UserException
from app.model.user.password_reset import (
    ForgotPasswordRequest,
    PasswordResetToken,
    ResetPasswordRequest,
)
from app.model.user.user import User
from fastapi_babel import _
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("server_password_reset_controller")

router = APIRouter(tags=["Password Reset"])

# Token expiration time in hours
TOKEN_EXPIRATION_HOURS = 24


def generate_reset_token() -> str:
    """Generate a secure random token for password reset."""
    return secrets.token_urlsafe(32)


@router.post("/forgot-password", name="request password reset")
@traceroot.trace()
async def forgot_password(
    data: ForgotPasswordRequest,
    session: Session = Depends(session),
):
    """
    Request a password reset. Generates a reset token for the user.
    
    For security reasons, always returns success even if email doesn't exist.
    In production, this would send an email with the reset link.
    """
    email = data.email
    user = User.by(User.email == email, col(User.deleted_at).is_(None), s=session).one_or_none()
    
    if user:
        # Invalidate any existing unused tokens for this user
        existing_tokens = PasswordResetToken.by(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used == False,  # noqa: E712
            col(PasswordResetToken.deleted_at).is_(None),
            s=session
        ).all()
        
        for token in existing_tokens:
            token.used = True
            token.save(session)
        
        # Generate new token
        token = generate_reset_token()
        expires_at = datetime.now() + timedelta(hours=TOKEN_EXPIRATION_HOURS)
        
        reset_token = PasswordResetToken(
            user_id=user.id,
            token=token,
            expires_at=expires_at,
        )
        reset_token.save(session)
        
        logger.info(
            "Password reset token generated",
            extra={"user_id": user.id, "email": email, "expires_at": str(expires_at)}
        )
        
        # TODO: In production, send email with reset link
        # For now, return the token in response (development only)
        # In production, remove token from response and send via email
        return {
            "status": "success",
            "message": "If an account with that email exists, a password reset link has been sent.",
            # Development only - remove in production
            "reset_token": token,
            "expires_at": expires_at.isoformat(),
        }
    else:
        logger.warning(
            "Password reset requested for non-existent email",
            extra={"email": email}
        )
    
    # Always return success for security (don't reveal if email exists)
    return {
        "status": "success",
        "message": "If an account with that email exists, a password reset link has been sent.",
    }


@router.post("/reset-password", name="reset password with token")
@traceroot.trace()
async def reset_password(
    data: ResetPasswordRequest,
    session: Session = Depends(session),
):
    """
    Reset password using a valid reset token.
    """
    # Validate passwords match
    if data.new_password != data.confirm_password:
        logger.warning("Password reset failed: passwords do not match")
        raise UserException(code.error, _("Passwords do not match"))
    
    # Validate password strength
    if len(data.new_password) < 8:
        raise UserException(code.error, _("Password must be at least 8 characters long"))
    
    if not any(c.isdigit() for c in data.new_password) or not any(c.isalpha() for c in data.new_password):
        raise UserException(code.error, _("Password must contain both letters and numbers"))
    
    # Find the token
    reset_token = PasswordResetToken.by(
        PasswordResetToken.token == data.token,
        col(PasswordResetToken.deleted_at).is_(None),
        s=session
    ).one_or_none()
    
    if not reset_token:
        logger.warning("Password reset failed: invalid token")
        raise UserException(code.error, _("Invalid or expired reset token"))
    
    if not reset_token.is_valid():
        logger.warning(
            "Password reset failed: token expired or used",
            extra={"token_id": reset_token.id, "used": reset_token.used}
        )
        raise UserException(code.error, _("Invalid or expired reset token"))
    
    # Get the user
    user = session.get(User, reset_token.user_id)
    if not user:
        logger.error(
            "Password reset failed: user not found",
            extra={"user_id": reset_token.user_id}
        )
        raise UserException(code.error, _("User not found"))
    
    # Update password
    user.password = password_hash(data.new_password)
    user.save(session)
    
    # Mark token as used
    reset_token.used = True
    reset_token.save(session)
    
    logger.info(
        "Password reset successful",
        extra={"user_id": user.id, "email": user.email}
    )
    
    return {
        "status": "success",
        "message": "Password has been reset successfully. You can now log in with your new password.",
    }


@router.get("/verify-reset-token/{token}", name="verify reset token")
@traceroot.trace()
async def verify_reset_token(
    token: str,
    session: Session = Depends(session),
):
    """
    Verify if a reset token is valid.
    Used by frontend to check token before showing reset form.
    """
    reset_token = PasswordResetToken.by(
        PasswordResetToken.token == token,
        col(PasswordResetToken.deleted_at).is_(None),
        s=session
    ).one_or_none()
    
    if not reset_token or not reset_token.is_valid():
        return {
            "valid": False,
            "message": "Invalid or expired reset token",
        }
    
    return {
        "valid": True,
        "message": "Token is valid",
    }


class DirectResetPasswordRequest(BaseModel):
    """Request model for direct password reset (local deployment only)."""
    email: str
    new_password: str
    confirm_password: str


@router.post("/reset-password-direct", name="reset password directly")
@traceroot.trace()
async def reset_password_direct(
    data: DirectResetPasswordRequest,
    session: Session = Depends(session),
):
    """
    Reset password directly without token verification.
    This endpoint is for Full Local Deployment only where email verification is not needed.
    The password is updated directly in the local Docker database.
    """
    # Validate passwords match
    if data.new_password != data.confirm_password:
        logger.warning("Direct password reset failed: passwords do not match")
        raise UserException(code.error, _("Passwords do not match"))
    
    # Validate password strength
    if len(data.new_password) < 8:
        raise UserException(code.error, _("Password must be at least 8 characters long"))
    
    if not any(c.isdigit() for c in data.new_password) or not any(c.isalpha() for c in data.new_password):
        raise UserException(code.error, _("Password must contain both letters and numbers"))
    
    # Find the user by email
    user = User.by(User.email == data.email, col(User.deleted_at).is_(None), s=session).one_or_none()
    
    if not user:
        logger.warning(
            "Direct password reset failed: user not found",
            extra={"email": data.email}
        )
        raise UserException(code.error, _("User with this email not found"))
    
    # Update password
    user.password = password_hash(data.new_password)
    user.save(session)
    
    logger.info(
        "Direct password reset successful",
        extra={"user_id": user.id, "email": user.email}
    )
    
    return {
        "status": "success",
        "message": "Password has been reset successfully. You can now log in with your new password.",
    }
