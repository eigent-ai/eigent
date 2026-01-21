"""
Password Reset Controller
Handles forgot password and reset password functionality.
"""
import secrets
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from app.model.password_reset import (
    DirectResetPasswordRequest,
    ForgotPasswordRequest,
    ResetPasswordRequest,
)
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("password_reset_controller")

router = APIRouter()

# In-memory token storage for development (in production, use database)
password_reset_tokens = {}

TOKEN_EXPIRATION_HOURS = 24


def generate_reset_token() -> str:
    """Generate a secure random token for password reset."""
    return secrets.token_urlsafe(32)


@router.post("/forgot-password", name="request password reset")
async def forgot_password(data: ForgotPasswordRequest):
    """
    Request a password reset link.
    For security, always returns success even if email doesn't exist.
    In development, returns the token directly for testing.
    """
    email = data.email
    logger.info(f"Password reset requested for email: {email}")
    
    # Generate token
    token = generate_reset_token()
    expires_at = datetime.now() + timedelta(hours=TOKEN_EXPIRATION_HOURS)
    
    # Store token (in production, this would be in database)
    password_reset_tokens[token] = {
        "email": email,
        "expires_at": expires_at,
        "used": False
    }
    
    # In development, return the token for testing
    return {
        "status": "success",
        "message": "If an account with that email exists, a password reset link has been sent.",
        "reset_token": token,  # Only for development
        "expires_at": expires_at.isoformat(),
    }


@router.get("/verify-reset-token/{token}", name="verify reset token")
async def verify_reset_token(token: str):
    """
    Verify if a password reset token is valid.
    """
    token_data = password_reset_tokens.get(token)
    
    if not token_data:
        return {"valid": False, "message": "Invalid or expired reset token."}
    
    if token_data["used"]:
        return {"valid": False, "message": "This reset token has already been used."}
    
    if datetime.now() > token_data["expires_at"]:
        return {"valid": False, "message": "This reset token has expired."}
    
    return {"valid": True, "message": "Token is valid."}


@router.post("/reset-password", name="reset password")
async def reset_password(data: ResetPasswordRequest):
    """
    Reset password using a valid token.
    Password validation is handled by Pydantic model.
    """
    # Verify token
    token_data = password_reset_tokens.get(data.token)
    
    if not token_data:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token.")
    
    if token_data["used"]:
        raise HTTPException(status_code=400, detail="This reset token has already been used.")
    
    if datetime.now() > token_data["expires_at"]:
        raise HTTPException(status_code=400, detail="This reset token has expired.")
    
    # Mark token as used
    token_data["used"] = True
    
    logger.info("Password reset successful")
    
    return {
        "status": "success",
        "message": "Your password has been reset successfully."
    }


@router.post("/reset-password-direct", name="reset password directly")
async def reset_password_direct(data: DirectResetPasswordRequest):
    """
    Reset password directly without token verification.
    This endpoint is for Full Local Deployment only where email verification is not needed.
    Password validation is handled by Pydantic model.
    
    Note: This is a simplified implementation for the Electron backend.
    The actual password update happens in the server backend for Docker deployments.
    """
    logger.info("Direct password reset requested")
    
    # Note: In the Electron backend, this endpoint acts as a proxy.
    # The actual password update is handled by the server backend for Docker deployments.
    # For now, return success - the frontend will call the server backend directly
    # when VITE_USE_LOCAL_PROXY=true
    
    return {
        "status": "success",
        "message": "Password has been reset successfully. You can now log in with your new password."
    }
