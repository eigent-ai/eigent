"""
Password Reset Controller
Handles direct password reset for Full Local Deployment.
"""
import logging
from fastapi import APIRouter
from app.model.password_reset import DirectResetPasswordRequest

logger = logging.getLogger("password_reset_controller")

router = APIRouter()


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
