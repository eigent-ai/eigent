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
import os
import time
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.agent.toolkit.codex_toolkit import CodexOAuthManager
from app.agent.toolkit.google_calendar_toolkit import GoogleCalendarToolkit
from app.agent.toolkit.linkedin_toolkit import LinkedInToolkit
from app.agent.toolkit.notion_mcp_toolkit import NotionMCPToolkit
from app.utils.cookie_manager import CookieManager
from app.utils.oauth_state_manager import oauth_state_manager


class LinkedInTokenRequest(BaseModel):
    r"""Request model for saving LinkedIn OAuth token."""

    access_token: str
    refresh_token: str | None = None
    expires_in: int | None = None
    scope: str | None = None


class CodexTokenRequest(BaseModel):
    r"""Request model for saving Codex/OpenAI API token."""

    access_token: str
    expires_in: int | None = None


logger = logging.getLogger("tool_controller")
router = APIRouter()


@router.post("/install/tool/{tool}", name="install tool")
async def install_tool(tool: str):
    """
    Install and pre-instantiate a specific MCP tool for authentication

    Args:
        tool: Tool name to install (notion)

    Returns:
        Installation result with tool information
    """
    if tool == "notion":
        try:
            # Use a dummy task_id for installation,
            # as this is just for pre-authentication
            toolkit = NotionMCPToolkit("install_auth")

            try:
                # Pre-instantiate by connecting (this completes authentication)
                await toolkit.connect()

                # Get available tools to verify connection
                tools = [
                    tool_func.func.__name__
                    for tool_func in toolkit.get_tools()
                ]
                logger.info(
                    "Successfully pre-instantiated"
                    f" {tool} toolkit with"
                    f" {len(tools)} tools"
                )

                # Disconnect, authentication info is saved
                await toolkit.disconnect()

                return {
                    "success": True,
                    "tools": tools,
                    "message": f"Successfully installed and authenticated {tool} toolkit",
                    "count": len(tools),
                    "toolkit_name": "NotionMCPToolkit",
                }
            except Exception as connect_error:
                logger.warning(
                    f"Could not connect to {tool} MCP server: {connect_error}"
                )
                # Even if connection fails, mark as
                # installed so user can use it later
                return {
                    "success": True,
                    "tools": [],
                    "message": f"{tool} toolkit installed but"
                    " not connected. Will connect"
                    " when needed.",
                    "count": 0,
                    "toolkit_name": "NotionMCPToolkit",
                    "warning": "Could not connect to Notion"
                    " MCP server. You may need to"
                    " authenticate when using"
                    " the tool.",
                }
        except Exception as e:
            logger.error(
                f"Failed to install {tool} toolkit: {e}", exc_info=True
            )
            raise HTTPException(
                status_code=500,
                detail=f"Failed to install {tool}. Check server logs for details.",
            )
    elif tool == "google_calendar":
        try:
            # Try to initialize toolkit - will succeed if credentials exist
            try:
                toolkit = GoogleCalendarToolkit("install_auth")
                tools = [
                    tool_func.func.__name__
                    for tool_func in toolkit.get_tools()
                ]
                logger.info(
                    "Successfully initialized Google"
                    " Calendar toolkit with"
                    f" {len(tools)} tools"
                )

                return {
                    "success": True,
                    "tools": tools,
                    "message": f"Successfully installed {tool} toolkit",
                    "count": len(tools),
                    "toolkit_name": "GoogleCalendarToolkit",
                }
            except ValueError as auth_error:
                # No credentials - need authorization
                logger.info(
                    "No credentials found, starting"
                    f" authorization: {auth_error}"
                )

                # Start background authorization in a new thread
                logger.info(
                    "Starting background Google Calendar authorization"
                )
                GoogleCalendarToolkit.start_background_auth("install_auth")

                return {
                    "success": False,
                    "status": "authorizing",
                    "message": "Authorization required. Browser"
                    " should open automatically."
                    " Complete authorization and"
                    " try installing again.",
                    "toolkit_name": "GoogleCalendarToolkit",
                    "requires_auth": True,
                }
        except Exception as e:
            logger.error(
                f"Failed to install {tool} toolkit: {e}", exc_info=True
            )
            raise HTTPException(
                status_code=500,
                detail=f"Failed to install {tool}. Check server logs for details.",
            )
    elif tool == "linkedin":
        try:
            # Check if LinkedIn is already authenticated
            if LinkedInToolkit.is_authenticated():
                # Check if token is expired
                if LinkedInToolkit.is_token_expired():
                    logger.info("LinkedIn token has expired")
                    return {
                        "success": False,
                        "status": "token_expired",
                        "message": "LinkedIn token has expired."
                        " Please re-authenticate"
                        " via OAuth.",
                        "toolkit_name": "LinkedInToolkit",
                        "requires_auth": True,
                        "oauth_url": "/api/oauth/linkedin/login",
                    }

                try:
                    toolkit = LinkedInToolkit("install_auth")
                    tools = [
                        tool_func.func.__name__
                        for tool_func in toolkit.get_tools()
                    ]

                    # Try to get profile to verify token is valid
                    profile = toolkit.get_profile_safe()

                    # Check if token is expiring soon
                    token_warning = None
                    if LinkedInToolkit.is_token_expiring_soon():
                        token_info = LinkedInToolkit.get_token_info()
                        if token_info and token_info.get("expires_at"):
                            days_remaining = (
                                token_info["expires_at"] - int(time.time())
                            ) // (24 * 60 * 60)
                            token_warning = (
                                "Token expires in"
                                f" {days_remaining}"
                                " days. Consider"
                                " re-authenticating"
                                " soon."
                            )

                    logger.info(
                        "Successfully initialized"
                        " LinkedIn toolkit with"
                        f" {len(tools)} tools"
                    )
                    result = {
                        "success": True,
                        "tools": tools,
                        "message": f"Successfully installed {tool} toolkit",
                        "count": len(tools),
                        "toolkit_name": "LinkedInToolkit",
                        "profile": profile if "error" not in profile else None,
                    }
                    if token_warning:
                        result["warning"] = token_warning
                    return result
                except Exception as e:
                    logger.warning(f"LinkedIn token may be invalid: {e}")
                    # Token exists but may be expired/invalid
                    return {
                        "success": False,
                        "status": "token_invalid",
                        "message": "LinkedIn token may be expired"
                        " or invalid. Please"
                        " re-authenticate via OAuth.",
                        "toolkit_name": "LinkedInToolkit",
                        "requires_auth": True,
                        "oauth_url": "/api/oauth/linkedin/login",
                    }
            else:
                # No credentials - need OAuth authorization
                logger.info("No LinkedIn credentials found, OAuth required")
                return {
                    "success": False,
                    "status": "not_configured",
                    "message": "LinkedIn OAuth required. Redirect user to OAuth login.",
                    "toolkit_name": "LinkedInToolkit",
                    "requires_auth": True,
                    "oauth_url": "/api/oauth/linkedin/login",
                }
        except Exception as e:
            logger.error(
                f"Failed to install {tool} toolkit: {e}", exc_info=True
            )
            raise HTTPException(
                status_code=500,
                detail=f"Failed to install {tool}. Check server logs for details.",
            )
    elif tool == "codex":
        try:
            if CodexOAuthManager.is_authenticated():
                if CodexOAuthManager.is_token_expired():
                    # Try refreshing first
                    if CodexOAuthManager.refresh_token_if_needed():
                        return {
                            "success": True,
                            "message": "Codex token refreshed successfully",
                            "toolkit_name": "CodexOAuthManager",
                        }
                    # Refresh failed, start new auth
                    logger.info(
                        "Codex token expired and refresh"
                        " failed, starting re-auth"
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
            logger.error(f"Failed to install {tool}: {e}")
            raise HTTPException(
                status_code=500, detail=f"Failed to install {tool}: {str(e)}"
            )
    else:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Tool '{tool}' not found."
                " Available tools:"
                " ['notion',"
                " 'google_calendar',"
                " 'linkedin',"
                " 'codex']"
            ),
        )


@router.get("/tools/available", name="list available tools")
async def list_available_tools():
    """
    List all available MCP tools that can be installed

    Returns:
        List of available tools with their information
    """
    return {
        "tools": [
            {
                "name": "notion",
                "display_name": "Notion MCP",
                "description": "Notion workspace integration"
                " for reading and managing"
                " Notion pages",
                "toolkit_class": "NotionMCPToolkit",
                "requires_auth": True,
            },
            {
                "name": "google_calendar",
                "display_name": "Google Calendar",
                "description": "Google Calendar integration"
                " for managing events"
                " and schedules",
                "toolkit_class": "GoogleCalendarToolkit",
                "requires_auth": True,
            },
            {
                "name": "linkedin",
                "display_name": "LinkedIn",
                "description": "LinkedIn integration for"
                " creating posts, managing"
                " profile, and social media"
                " automation",
                "toolkit_class": "LinkedInToolkit",
                "requires_auth": True,
                "oauth_url": "/api/oauth/linkedin/login",
            },
            {
                "name": "codex",
                "display_name": "Codex",
                "description": "OpenAI Codex integration via"
                " OAuth for AI-powered coding"
                " assistance",
                "toolkit_class": "CodexOAuthManager",
                "requires_auth": True,
            },
        ]
    }


@router.get("/oauth/status/{provider}", name="get oauth status")
async def get_oauth_status(provider: str):
    """
    Get the current OAuth authorization status for a provider

    Args:
        provider: OAuth provider name (e.g., 'google_calendar')

    Returns:
        Current authorization status
    """
    state = oauth_state_manager.get_state(provider)

    if not state:
        return {
            "provider": provider,
            "status": "not_started",
            "message": "No authorization in progress",
        }

    return state.to_dict()


@router.post("/oauth/cancel/{provider}", name="cancel oauth")
async def cancel_oauth(provider: str):
    """
    Cancel an ongoing OAuth authorization flow

    Args:
        provider: OAuth provider name (e.g., 'google_calendar')

    Returns:
        Cancellation result
    """
    state = oauth_state_manager.get_state(provider)

    if not state:
        raise HTTPException(
            status_code=404,
            detail=f"No authorization found for provider '{provider}'",
        )

    if state.status not in ["pending", "authorizing"]:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel authorization with status '{state.status}'",
        )

    state.cancel()
    logger.info(f"Cancelled OAuth authorization for {provider}")

    return {
        "success": True,
        "provider": provider,
        "message": "Authorization cancelled successfully",
    }


@router.delete("/uninstall/tool/{tool}", name="uninstall tool")
async def uninstall_tool(tool: str):
    """
    Uninstall a tool and clean up its authentication data

    Args:
        tool: Tool name to uninstall (notion, google_calendar)

    Returns:
        Uninstallation result
    """
    import os
    import shutil

    if tool == "notion":
        try:
            import glob
            import hashlib

            # Calculate the hash for Notion MCP URL
            # mcp-remote uses MD5 hash of the URL to generate file names
            notion_url = "https://mcp.notion.com/mcp"
            url_hash = hashlib.md5(
                notion_url.encode(), usedforsecurity=False
            ).hexdigest()

            # Find and remove Notion-specific auth files
            mcp_auth_dir = os.path.join(os.path.expanduser("~"), ".mcp-auth")
            deleted_files = []

            if os.path.exists(mcp_auth_dir):
                # Look for all files with the Notion hash prefix
                for version_dir in os.listdir(mcp_auth_dir):
                    version_path = os.path.join(mcp_auth_dir, version_dir)
                    if os.path.isdir(version_path):
                        # Find all files matching the hash pattern
                        pattern = os.path.join(version_path, f"{url_hash}_*")
                        notion_files = glob.glob(pattern)

                        for file_path in notion_files:
                            try:
                                os.remove(file_path)
                                deleted_files.append(file_path)
                                logger.info(
                                    f"Removed Notion auth file: {file_path}"
                                )
                            except Exception as e:
                                logger.warning(
                                    f"Failed to remove {file_path}: {e}"
                                )

            message = f"Successfully uninstalled {tool}"
            if deleted_files:
                message += (
                    " and cleaned up"
                    f" {len(deleted_files)}"
                    " authentication file(s)"
                )

            return {
                "success": True,
                "message": message,
                "deleted_files": deleted_files,
            }
        except Exception as e:
            logger.error(f"Failed to uninstall {tool}: {e}", exc_info=True)
            raise HTTPException(
                status_code=500,
                detail=f"Failed to uninstall {tool}. Check server logs for details.",
            )

    elif tool == "google_calendar":
        try:
            # Clean up Google Calendar token directories (user-scoped + legacy)
            token_dirs = set()
            try:
                token_dirs.add(
                    os.path.dirname(
                        GoogleCalendarToolkit._build_canonical_token_path()
                    )
                )
            except Exception as e:
                logger.warning(
                    "Failed to resolve canonical"
                    " Google Calendar token"
                    f" path: {e}"
                )

            token_dirs.add(
                os.path.join(
                    os.path.expanduser("~"),
                    ".eigent",
                    "tokens",
                    "google_calendar",
                )
            )

            for token_dir in token_dirs:
                if os.path.exists(token_dir):
                    shutil.rmtree(token_dir)
                    logger.info(
                        f"Removed Google Calendar token directory: {token_dir}"
                    )

            # Clear OAuth state manager cache (this is the key fix!)
            # This removes the cached credentials from memory
            state = oauth_state_manager.get_state("google_calendar")
            if state:
                if state.status in ["pending", "authorizing"]:
                    state.cancel()
                    logger.info(
                        "Cancelled ongoing Google Calendar authorization"
                    )
                # Clear the state completely to remove cached credentials
                oauth_state_manager._states.pop("google_calendar", None)
                logger.info("Cleared Google Calendar OAuth state cache")

            return {
                "success": True,
                "message": "Successfully uninstalled"
                f" {tool} and cleaned up"
                " authentication tokens",
            }
        except Exception as e:
            logger.error(f"Failed to uninstall {tool}: {e}", exc_info=True)
            raise HTTPException(
                status_code=500,
                detail=f"Failed to uninstall {tool}. Check server logs for details.",
            )
    elif tool == "linkedin":
        try:
            # Clear LinkedIn token
            success = LinkedInToolkit.clear_token()

            if success:
                return {
                    "success": True,
                    "message": "Successfully uninstalled"
                    f" {tool} and cleaned up"
                    " authentication tokens",
                }
            else:
                return {
                    "success": True,
                    "message": f"Uninstalled {tool} (no tokens found to clean up)",
                }
        except Exception as e:
            logger.error(f"Failed to uninstall {tool}: {e}", exc_info=True)
            raise HTTPException(
                status_code=500,
                detail=f"Failed to uninstall {tool}. Check server logs for details.",
            )
    elif tool == "codex":
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
                        f"Successfully uninstalled {tool}"
                        " and cleaned up"
                        " authentication tokens"
                    ),
                }
            else:
                return {
                    "success": True,
                    "message": f"Uninstalled {tool} (no tokens found to clean up)",
                }
        except Exception as e:
            logger.error(f"Failed to uninstall {tool}: {e}")
            raise HTTPException(
                status_code=500, detail=f"Failed to uninstall {tool}: {str(e)}"
            )
    else:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Tool '{tool}' not found."
                " Available tools:"
                " ['notion',"
                " 'google_calendar',"
                " 'linkedin',"
                " 'codex']"
            ),
        )


@router.post("/linkedin/save-token", name="save linkedin token")
async def save_linkedin_token(token_request: LinkedInTokenRequest):
    r"""Save LinkedIn OAuth token after successful authorization.

    Args:
        token_request: Token data containing
            access_token and optionally refresh_token

    Returns:
        Save result with tool information
    """
    try:
        token_data = token_request.model_dump(exclude_none=True)

        # Save the token
        success = LinkedInToolkit.save_token(token_data)

        if success:
            # Verify the token works by initializing toolkit
            try:
                toolkit = LinkedInToolkit("install_auth")
                tools = [
                    tool_func.func.__name__
                    for tool_func in toolkit.get_tools()
                ]
                profile = toolkit.get_profile_safe()

                return {
                    "success": True,
                    "message": "LinkedIn token saved successfully",
                    "tools": tools,
                    "count": len(tools),
                    "profile": profile if "error" not in profile else None,
                }
            except Exception as e:
                logger.warning(f"Token saved but verification failed: {e}")
                return {
                    "success": True,
                    "message": "LinkedIn token saved (verification pending)",
                    "warning": "Token verification failed. Check server logs.",
                }
        else:
            raise HTTPException(
                status_code=500, detail="Failed to save LinkedIn token"
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to save LinkedIn token: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to save token. Check server logs for details.",
        )


@router.get("/linkedin/status", name="get linkedin status")
async def get_linkedin_status():
    r"""Get current LinkedIn authentication status and token info.

    Returns:
        Status information including authentication state and token expiry
    """
    try:
        is_authenticated = LinkedInToolkit.is_authenticated()

        if not is_authenticated:
            return {
                "authenticated": False,
                "status": "not_configured",
                "message": "LinkedIn not configured. OAuth required.",
                "oauth_url": "/api/oauth/linkedin/login",
            }

        token_info = LinkedInToolkit.get_token_info()
        is_expired = LinkedInToolkit.is_token_expired()
        is_expiring_soon = LinkedInToolkit.is_token_expiring_soon()

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
                days_remaining = seconds_remaining // (24 * 60 * 60)
                result["expires_at"] = expires_at
                result["days_remaining"] = days_remaining

            if token_info.get("saved_at"):
                result["saved_at"] = token_info["saved_at"]

        if is_expired:
            result["message"] = "Token has expired. Please re-authenticate."
            result["oauth_url"] = "/api/oauth/linkedin/login"
        elif is_expiring_soon:
            days = result.get("days_remaining", "unknown")
            result["message"] = (
                f"Token expires in {days} days. Consider re-authenticating."
            )
            result["oauth_url"] = "/api/oauth/linkedin/login"
        else:
            result["message"] = "LinkedIn is connected and token is valid."

        return result
    except Exception as e:
        logger.error(f"Failed to get LinkedIn status: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to get status. Check server logs for details.",
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


@router.post("/browser/login", name="open browser for login")
async def open_browser_login():
    """
    Open an Electron-based Chrome browser for
    user login with a dedicated user data directory

    Returns:
        Browser session information
    """
    try:
        import socket
        import subprocess

        # Use fixed profile name for persistent logins (no port suffix)
        session_id = "user_login"
        cdp_port = 9223

        # IMPORTANT: Use dedicated profile for tool_controller browser
        # This is the SOURCE OF TRUTH for login data
        # On Eigent startup, this data will be copied
        # to WebView partition (one-way sync)
        browser_profiles_base = os.path.expanduser(
            "~/.eigent/browser_profiles"
        )
        user_data_dir = os.path.join(
            browser_profiles_base, "profile_user_login"
        )

        os.makedirs(user_data_dir, exist_ok=True)

        logger.info(
            "Creating browser session"
            f" {session_id} with profile"
            f" at: {user_data_dir}"
        )

        # Check if browser is already running on this port
        def is_port_in_use(port):
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                return s.connect_ex(("localhost", port)) == 0

        if is_port_in_use(cdp_port):
            logger.info(f"Browser already running on port {cdp_port}")
            return {
                "success": True,
                "session_id": session_id,
                "user_data_dir": user_data_dir,
                "cdp_port": cdp_port,
                "message": "Browser already running. Use existing window to log in.",
                "note": "Your login data will be saved in the profile.",
            }

        # Use static Electron browser script
        electron_script_path = os.path.join(
            os.path.dirname(__file__), "electron_browser.cjs"
        )

        # Verify script exists
        if not os.path.exists(electron_script_path):
            raise FileNotFoundError(
                f"Electron browser script not found: {electron_script_path}"
            )

        electron_cmd = "npx"
        electron_args = [
            electron_cmd,
            "electron",
            electron_script_path,
            user_data_dir,
            str(cdp_port),
            "https://www.google.com",
        ]

        # Get the app's directory to run npx in the right context
        app_dir = os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        )

        logger.info(
            "[PROFILE USER LOGIN] Launching"
            " Electron browser with CDP"
            f" on port {cdp_port}"
        )
        logger.info(f"[PROFILE USER LOGIN] Working directory: {app_dir}")
        logger.info(f"[PROFILE USER LOGIN] userData path: {user_data_dir}")
        logger.info(f"[PROFILE USER LOGIN] Electron args: {electron_args}")

        # Start process and capture output in real-time
        process = subprocess.Popen(
            electron_args,
            cwd=app_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  # Redirect stderr to stdout
            text=True,
            encoding="utf-8",
            errors="replace",  # Replace undecodable chars instead of crashing
            bufsize=1,  # Line buffered
        )

        # Create async task to log Electron output
        async def log_electron_output():
            for line in iter(process.stdout.readline, ""):
                if line:
                    logger.info(f"[ELECTRON OUTPUT] {line.strip()}")

        import asyncio

        asyncio.create_task(log_electron_output())

        # Wait a bit for Electron to start
        import asyncio

        await asyncio.sleep(3)

        logger.info(
            "[PROFILE USER LOGIN] Electron"
            " browser launched with"
            f" PID {process.pid}"
        )

        return {
            "success": True,
            "session_id": session_id,
            "user_data_dir": user_data_dir,
            "cdp_port": cdp_port,
            "pid": process.pid,
            "chrome_version": "130.0.6723.191",  # Electron 33's Chrome version
            "message": "Electron browser opened successfully."
            " Please log in to your accounts.",
            "note": "The browser will remain open for"
            " you to log in. Your login data"
            " will be saved in the profile.",
        }

    except Exception as e:
        logger.error(
            f"Failed to open Electron browser for login: {e}", exc_info=True
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to open browser. Check server logs for details.",
        )


@router.get("/browser/cookies", name="list cookie domains")
async def list_cookie_domains(search: str = None):
    """
    list cookie domains

    Args:
        search: url

    Returns:
       list of cookie domains
    """
    try:
        # Use tool_controller browser's user data directory (source of truth)
        user_data_base = os.path.expanduser("~/.eigent/browser_profiles")
        user_data_dir = os.path.join(user_data_base, "profile_user_login")

        logger.info(
            f"[COOKIES CHECK] Tool controller user_data_dir: {user_data_dir}"
        )
        logger.info(
            "[COOKIES CHECK] Tool controller"
            " user_data_dir exists:"
            f" {os.path.exists(user_data_dir)}"
        )

        # Check partition path
        partition_path = os.path.join(
            user_data_dir, "Partitions", "user_login"
        )
        logger.info(f"[COOKIES CHECK] partition path: {partition_path}")
        logger.info(
            "[COOKIES CHECK] partition"
            f" exists: {os.path.exists(partition_path)}"
        )

        # Check cookies file
        cookies_file = os.path.join(partition_path, "Cookies")
        logger.info(f"[COOKIES CHECK] cookies file: {cookies_file}")
        logger.info(
            "[COOKIES CHECK] cookies file"
            f" exists: {os.path.exists(cookies_file)}"
        )
        if os.path.exists(cookies_file):
            stat = os.stat(cookies_file)
            logger.info(
                f"[COOKIES CHECK] cookies file size: {stat.st_size} bytes"
            )

            # Try to read actual cookie count
            try:
                import sqlite3

                conn = sqlite3.connect(cookies_file)
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) FROM cookies")
                count = cursor.fetchone()[0]
                logger.info(
                    f"[COOKIES CHECK] actual cookie count in database: {count}"
                )
                conn.close()
            except Exception as e:
                logger.error(
                    f"[COOKIES CHECK] failed to read cookie count: {e}"
                )

        if not os.path.exists(user_data_dir):
            return {
                "success": True,
                "domains": [],
                "message": "No browser profile found."
                " Please login first"
                " using /browser/login.",
            }

        cookie_manager = CookieManager(user_data_dir)

        if search:
            domains = cookie_manager.search_cookies(search)
        else:
            domains = cookie_manager.get_cookie_domains()

        return {
            "success": True,
            "domains": domains,
            "total": len(domains),
            "user_data_dir": user_data_dir,
        }

    except Exception as e:
        logger.error(f"Failed to list cookie domains: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to list cookies. Check server logs for details.",
        )


@router.get("/browser/cookies/{domain}", name="get domain cookies")
async def get_domain_cookies(domain: str):
    """
    get domain cookies

    Args:
        domain

    Returns:
        cookies
    """
    try:
        user_data_base = os.path.expanduser("~/.eigent/browser_profiles")
        user_data_dir = os.path.join(user_data_base, "profile_user_login")

        if not os.path.exists(user_data_dir):
            raise HTTPException(
                status_code=404,
                detail=(
                    "No browser profile found."
                    " Please login first using"
                    " /browser/login."
                ),
            )

        cookie_manager = CookieManager(user_data_dir)
        cookies = cookie_manager.get_cookies_for_domain(domain)

        return {
            "success": True,
            "domain": domain,
            "cookies": cookies,
            "count": len(cookies),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to get cookies for domain {domain}: {e}", exc_info=True
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to get cookies. Check server logs for details.",
        )


@router.delete("/browser/cookies/{domain}", name="delete domain cookies")
async def delete_domain_cookies(domain: str):
    """
    Delete cookies

    Args:
        domain

    Returns:
        deleted cookies
    """
    try:
        user_data_base = os.path.expanduser("~/.eigent/browser_profiles")
        user_data_dir = os.path.join(user_data_base, "profile_user_login")

        if not os.path.exists(user_data_dir):
            raise HTTPException(
                status_code=404,
                detail=(
                    "No browser profile found."
                    " Please login first using"
                    " /browser/login."
                ),
            )

        cookie_manager = CookieManager(user_data_dir)
        success = cookie_manager.delete_cookies_for_domain(domain)

        if success:
            return {
                "success": True,
                "message": f"Successfully deleted cookies for domain: {domain}",
            }
        else:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to delete cookies for domain: {domain}",
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to delete cookies for domain {domain}: {e}", exc_info=True
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to delete cookies. Check server logs for details.",
        )


@router.delete("/browser/cookies", name="delete all cookies")
async def delete_all_cookies():
    """
    delete all cookies

    Returns:
        deleted cookies
    """
    try:
        user_data_base = os.path.expanduser("~/.eigent/browser_profiles")
        user_data_dir = os.path.join(user_data_base, "profile_user_login")

        if not os.path.exists(user_data_dir):
            raise HTTPException(
                status_code=404, detail="No browser profile found."
            )

        cookie_manager = CookieManager(user_data_dir)
        success = cookie_manager.delete_all_cookies()

        if success:
            return {
                "success": True,
                "message": "Successfully deleted all cookies",
            }
        else:
            raise HTTPException(
                status_code=500, detail="Failed to delete all cookies"
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete all cookies: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to delete cookies. Check server logs for details.",
        )
