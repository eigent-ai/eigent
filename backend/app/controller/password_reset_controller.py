"""
Password Reset Controller
Handles direct password reset for Full Local Deployment.
Proxies requests to the server backend which has database access.
"""
import logging
import os
import httpx
from fastapi import APIRouter, HTTPException
from app.model.password_reset import DirectResetPasswordRequest

logger = logging.getLogger("password_reset_controller")

router = APIRouter()

# Server backend URL for database operations
SERVER_BACKEND_URL = os.getenv("SERVER_BACKEND_URL", "http://localhost:8000")


@router.post("/reset-password-direct", name="reset password directly")
async def reset_password_direct(data: DirectResetPasswordRequest):
    """
    Reset password directly without token verification.
    This endpoint is for Full Local Deployment only where email verification is not needed.
    Password validation is handled by Pydantic model.
    
    Proxies the request to the server backend which performs the actual database update.
    """
    logger.info("Direct password reset requested, proxying to server backend")
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{SERVER_BACKEND_URL}/api/reset-password-direct",
                json={
                    "email": data.email,
                    "new_password": data.new_password,
                    "confirm_password": data.confirm_password,
                }
            )
            
            if response.status_code == 200:
                logger.info("Direct password reset successful")
                return response.json()
            else:
                logger.warning(f"Server backend returned status {response.status_code}")
                error_detail = response.json().get("text", "Password reset failed")
                raise HTTPException(status_code=response.status_code, detail=error_detail)
                
    except httpx.RequestError as e:
        logger.error(f"Failed to connect to server backend: {e}")
        raise HTTPException(
            status_code=503,
            detail="Unable to connect to server backend. Please ensure the server is running."
        )
