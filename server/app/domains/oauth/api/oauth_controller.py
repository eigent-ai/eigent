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

# STATUS: full-rewrite (uses OAuthService, H12 code/state XSS validation)
import json
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from app.core.oauth_adapter import OauthCallbackPayload
from app.domains.oauth.schema import OAuthAuthorizeReq, OAuthTokenReq
from app.domains.oauth.service.oauth_service import OAuthService

router = APIRouter(prefix="/oauth", tags=["Oauth Servers"])

_OAUTH_CODE_MAX_LEN = 2048
_OAUTH_STATE_MAX_LEN = 512
_OAUTH_SAFE_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.")


def _validate_oauth_param(value: Optional[str], name: str, max_len: int) -> str:
    """Validate and sanitize OAuth callback params to prevent XSS injection (H12)."""
    if value is None:
        return ""
    s = str(value).strip()
    if len(s) > max_len:
        raise HTTPException(status_code=400, detail=f"Invalid {name}: too long")
    if s and not all(c in _OAUTH_SAFE_CHARS or c in " /+=" for c in s):
        raise HTTPException(status_code=400, detail=f"Invalid {name}: invalid characters")
    return s


@router.get("/{app}/login", name="OAuth Login Redirect")
def oauth_login(app: str, request: Request, state: Optional[str] = None):
    callback_url = str(request.url_for("OAuth Callback", app=app))
    if callback_url.startswith("http://"):
        callback_url = "https://" + callback_url[len("http://"):]

    result = OAuthService.get_authorize_url(
        OAuthAuthorizeReq(provider=app, redirect_uri=callback_url, state=state)
    )
    if not result.success:
        raise HTTPException(status_code=400, detail="Failed to generate authorization URL")
    return RedirectResponse(str(result.authorize_url))


@router.get("/{app}/callback", name="OAuth Callback")
def oauth_callback(app: str, request: Request, code: Optional[str] = None, state: Optional[str] = None):
    if not code:
        raise HTTPException(status_code=400, detail="Missing code parameter")
    safe_code = _validate_oauth_param(code, "code", _OAUTH_CODE_MAX_LEN)
    safe_state = _validate_oauth_param(state, "state", _OAUTH_STATE_MAX_LEN)
    safe_app = _validate_oauth_param(app, "provider", 64) or ""
    query = f"provider={quote(safe_app, safe='')}&code={quote(safe_code, safe='')}&state={quote(safe_state, safe='')}"
    redirect_url = f"eigent://callback/oauth?{query}"
    html_content = f"""
    <html>
        <head>
            <title>OAuth Callback</title>
        </head>
        <body>
            <script type='text/javascript'>
                window.location.href = {json.dumps(redirect_url)};
            </script>
            <p>Redirecting, please wait...</p>
            <button onclick='window.close()'>Close this window</button>
        </body>
    </html>
    """
    return HTMLResponse(content=html_content)


@router.post("/{app}/token", name="OAuth Fetch Token")
def fetch_token(app: str, request: Request, data: OauthCallbackPayload):
    callback_url = str(request.url_for("OAuth Callback", app=app))
    if callback_url.startswith("http://"):
        callback_url = "https://" + callback_url[len("http://"):]

    result = OAuthService.exchange_token(
        OAuthTokenReq(provider=app, code=data.code, redirect_uri=callback_url)
    )
    if not result.success:
        raise HTTPException(status_code=500, detail="Token exchange failed")
    return JSONResponse(result.token_data)
