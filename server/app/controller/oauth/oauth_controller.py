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
import re
from urllib.parse import quote, urlencode

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from app.component.oauth_adapter import OauthCallbackPayload, get_oauth_adapter

# Allowed OAuth provider names (alphanumeric and hyphens only)
ALLOWED_PROVIDER_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")

logger = logging.getLogger("server_oauth_controller")

router = APIRouter(prefix="/oauth", tags=["Oauth Servers"])


@router.get("/{app}/login", name="OAuth Login Redirect")
def oauth_login(app: str, request: Request, state: str | None = None):
    """Redirect user to OAuth provider's authorization endpoint."""
    try:
        callback_url = str(request.url_for("OAuth Callback", app=app))
        if callback_url.startswith("http://"):
            callback_url = "https://" + callback_url[len("http://") :]

        adapter = get_oauth_adapter(app, callback_url)
        url = adapter.get_authorize_url(state)

        if not url:
            logger.error("Failed to generate authorization URL", extra={"provider": app, "callback_url": callback_url})
            raise HTTPException(status_code=400, detail="Failed to generate authorization URL")

        logger.info("OAuth login initiated", extra={"provider": app})
        return RedirectResponse(str(url))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("OAuth login failed", extra={"provider": app, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=400, detail="OAuth login failed")


@router.get("/{app}/callback", name="OAuth Callback")
def oauth_callback(
    app: str,
    request: Request,
    code: str | None = None,
    state: str | None = None,
):
    """Handle OAuth provider callback and redirect to client app."""
    # Security: Validate provider name to prevent injection
    if not ALLOWED_PROVIDER_PATTERN.match(app):
        logger.warning(
            "OAuth callback invalid provider name",
            extra={"provider": app[:50]},  # Truncate for logging
        )
        raise HTTPException(status_code=400, detail="Invalid provider")

    if not code:
        logger.warning("OAuth callback missing code", extra={"provider": app})
        raise HTTPException(status_code=400, detail="Missing code parameter")

    logger.info(
        "OAuth callback received",
        extra={"provider": app, "has_state": state is not None},
    )

    # Security: URL-encode all parameters to prevent XSS
    params = {"provider": app, "code": code}
    if state is not None:
        params["state"] = state
    redirect_url = f"eigent://callback/oauth?{urlencode(params)}"

    # Security: Use a safe redirect approach without embedding in JavaScript
    # The redirect URL uses a custom protocol, so we encode it safely
    safe_redirect_url = quote(redirect_url, safe=":/&?=")

    html_content = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>OAuth Callback</title>
    <meta http-equiv="refresh" content="0;url={safe_redirect_url}">
</head>
<body>
    <p>Redirecting, please wait...</p>
    <p>If you are not redirected, <a href="{safe_redirect_url}">click here</a>.</p>
    <button onclick="window.close()">Close this window</button>
</body>
</html>"""
    return HTMLResponse(content=html_content)


@router.post("/{app}/token", name="OAuth Fetch Token")
def fetch_token(app: str, request: Request, data: OauthCallbackPayload):
    """Exchange authorization code for access token."""
    try:
        callback_url = str(request.url_for("OAuth Callback", app=app))
        if callback_url.startswith("http://"):
            callback_url = "https://" + callback_url[len("http://") :]

        adapter = get_oauth_adapter(app, callback_url)
        token_data = adapter.fetch_token(data.code)
        logger.info("OAuth token fetched", extra={"provider": app})
        return JSONResponse(token_data)
    except Exception as e:
        logger.error("OAuth token fetch failed", extra={"provider": app, "error": str(e)}, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
