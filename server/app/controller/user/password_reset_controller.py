import logging
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from fastapi_babel import _
from sqlmodel import Session, col

from app.component import code
from app.component.database import session
from app.component.encrypt import password_hash
from app.exception.exception import UserException
from app.model.user.password_reset import (
    DirectResetPasswordRequest,
    ForgotPasswordRequest,
    PasswordResetToken,
    ResetPasswordRequest,
)
from app.model.user.user import User

logger = logging.getLogger("server_password_reset_controller")

router = APIRouter(tags=["Password Reset"])


@router.post("/reset-password-direct", name="reset password directly")
async def reset_password_direct(
    data: DirectResetPasswordRequest,
    session: Session = Depends(session),
):
    """
    Reset password directly without token verification.
    This endpoint is for Full Local Deployment only where email verification is not needed.
    The password is updated directly in the local Docker database.
    Password validation is handled by Pydantic model.
    """
    # Find the user by email
    user = User.by(User.email == data.email, col(User.deleted_at).is_(None), s=session).one_or_none()
    
    if not user:
        logger.warning("Direct password reset failed: user not found")
        raise UserException(code.error, _("User with this email not found"))
    
    # Update password
    user.password = password_hash(data.new_password)
    user.save(session)
    
    logger.info(
        "Direct password reset successful",
        extra={"user_id": user.id}
    )
    
    return {
        "status": "success",
        "message": "Password has been reset successfully. You can now log in with your new password.",
    }
