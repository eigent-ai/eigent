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
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.utils.codex_oauth import CodexOAuthManager
from app.utils.oauth_state_manager import oauth_state_manager


class CodexTokenRequest(BaseModel):
    r"""Request model for saving Codex/OpenAI API token."""

    access_token: str
    expires_in: int | None = None


logger = logging.getLogger("codex_controller")
router = APIRouter()


@router.post("/codex/connect", name="connect codex")
async def connect_codex():
    r"""Connect to Codex/OpenAI via OAuth PKCE flow.

    Initiates or completes the Codex OAuth authorization flow
    to obtain an OpenAI API key.

    Returns:
        Connection result with access token and provider info
    """
    try:
        if CodexOAuthManager.is_authenticated():
            if CodexOAuthManager.is_token_expired():
                # Try refreshing first
                if CodexOAuthManager.refresh_token_if_needed():
                    return {
                        "success": True,
                        "message": "Codex token refreshed successfully",
                        "toolkit_name": "CodexOAuthManager",
                        "access_token": CodexOAuthManager.get_access_token(),
                        "provider_name": "openai",
                        "endpoint_url": "https://api.openai.com/v1",
                    }
                # Refresh failed, start new auth
                logger.info(
                    "Codex token expired and refresh failed, starting re-auth"
                )
                CodexOAuthManager.start_background_auth()
                return {
                    "success": False,
                    "status": "authorizing",
                    "message": "Token expired. Browser should"
                    " open for re-authorization.",
                    "toolkit_name": "CodexOAuthManager",
                    "requires_auth": True,
                }

            return {
                "success": True,
                "message": "Codex/OpenAI is already authenticated",
                "toolkit_name": "CodexOAuthManager",
                "access_token": CodexOAuthManager.get_access_token(),
                "provider_name": "openai",
                "endpoint_url": "https://api.openai.com/v1",
            }
        else:
            logger.info("No Codex credentials found, starting OAuth flow")
            CodexOAuthManager.start_background_auth()
            return {
                "success": False,
                "status": "authorizing",
                "message": "Authorization required. Browser"
                " should open automatically.",
                "toolkit_name": "CodexOAuthManager",
                "requires_auth": True,
            }
    except Exception as e:
        logger.error(f"Failed to connect Codex: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to connect Codex: {str(e)}"
        )


@router.post("/codex/disconnect", name="disconnect codex")
async def disconnect_codex():
    r"""Disconnect Codex/OpenAI and clean up authentication data.

    Cancels any active OAuth flow and clears stored tokens.

    Returns:
        Disconnection result
    """
    try:
        # Cancel any active OAuth flow
        state = oauth_state_manager.get_state("codex")
        if state and state.status in ["pending", "authorizing"]:
            state.cancel()
            if hasattr(state, "server") and state.server:
                try:
                    state.server.shutdown()
                except Exception:
                    pass
        oauth_state_manager._states.pop("codex", None)

        success = CodexOAuthManager.clear_token()

        if success:
            return {
                "success": True,
                "message": (
                    "Successfully disconnected Codex"
                    " and cleaned up"
                    " authentication tokens"
                ),
            }
        else:
            return {
                "success": True,
                "message": "Disconnected Codex (no tokens found to clean up)",
            }
    except Exception as e:
        logger.error(f"Failed to disconnect Codex: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to disconnect Codex: {str(e)}"
        )


@router.post("/codex/save-token", name="save codex token")
async def save_codex_token(token_request: CodexTokenRequest):
    r"""Save Codex/OpenAI API token (manual API key entry fallback).

    Args:
        token_request: Token data containing access_token
            and optionally expires_in

    Returns:
        Save result
    """
    try:
        token_data = token_request.model_dump(exclude_none=True)
        token_data["manual"] = True

        success = CodexOAuthManager.save_token(token_data)

        if success:
            return {
                "success": True,
                "message": "Codex token saved successfully",
            }
        else:
            raise HTTPException(
                status_code=500, detail="Failed to save Codex token"
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to save Codex token: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to save token: {str(e)}"
        )


@router.get("/codex/status", name="get codex status")
async def get_codex_status():
    r"""Get current Codex/OpenAI authentication status and token info.

    Returns:
        Status information including authentication state and token expiry
    """
    try:
        is_authenticated = CodexOAuthManager.is_authenticated()

        if not is_authenticated:
            return {
                "authenticated": False,
                "status": "not_configured",
                "message": "Codex not configured. OAuth or API key required.",
            }

        token_info = CodexOAuthManager.get_token_info()
        is_expired = CodexOAuthManager.is_token_expired()
        is_expiring_soon = CodexOAuthManager.is_token_expiring_soon()

        result = {
            "authenticated": True,
            "status": "expired"
            if is_expired
            else ("expiring_soon" if is_expiring_soon else "valid"),
        }

        if token_info:
            if token_info.get("expires_at"):
                current_time = int(time.time())
                expires_at = token_info["expires_at"]
                seconds_remaining = max(0, expires_at - current_time)
                result["expires_at"] = expires_at
                result["seconds_remaining"] = seconds_remaining

            if token_info.get("saved_at"):
                result["saved_at"] = token_info["saved_at"]

            if token_info.get("manual"):
                result["manual"] = True

        if is_expired:
            result["message"] = "Token has expired. Please re-authenticate."
        elif is_expiring_soon:
            result["message"] = (
                "Token is expiring soon. Consider re-authenticating."
            )
        else:
            result["message"] = "Codex/OpenAI is connected and token is valid."

        return result
    except Exception as e:
        logger.error(f"Failed to get Codex status: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to get status: {str(e)}"
        )
