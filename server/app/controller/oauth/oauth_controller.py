from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import RedirectResponse, JSONResponse, HTMLResponse
from app.component.environment import env
from app.component.oauth_adapter import OauthCallbackPayload, get_oauth_adapter
from typing import Optional
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("server_oauth_controller")

router = APIRouter(prefix="/oauth", tags=["Oauth Servers"])


@router.get("/{app}/login", name="OAuth Login Redirect")
@traceroot.trace()
def oauth_login(app: str, request: Request, state: Optional[str] = None):
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


ALLOWED_OAUTH_PROVIDERS = {"slack", "notion", "x", "googlesuite"}

@router.get("/{app}/callback", name="OAuth Callback")
@traceroot.trace()
def oauth_callback(app: str, request: Request, code: Optional[str] = None, state: Optional[str] = None):
    """Handle OAuth provider callback and redirect to client app."""
    import re
    CODE_STATE_REGEX = re.compile(r'^[A-Za-z0-9_\-]+$')
    from starlette.datastructures import URL

    if app not in ALLOWED_OAUTH_PROVIDERS:
        logger.warning("Invalid OAuth provider", extra={"provider": app, "code": code})
        raise HTTPException(status_code=400, detail="Invalid OAuth provider")
    if not code or not CODE_STATE_REGEX.match(code):
        logger.warning("OAuth callback missing or invalid code", extra={"provider": app, "code": code})
        raise HTTPException(status_code=400, detail="Missing or invalid code parameter")
    if state and not CODE_STATE_REGEX.match(state):
        logger.warning("OAuth callback invalid state", extra={"provider": app, "state": state})
        raise HTTPException(status_code=400, detail="Invalid state parameter")

    logger.info("OAuth callback received", extra={"provider": app, "has_state": state is not None})

    base_url = URL("eigent://callback/oauth")
    redirect_url = base_url.include_query_params(
        provider=app,
        code=code,
        state=state or "",
    )

    return RedirectResponse(str(redirect_url))


@router.post("/{app}/token", name="OAuth Fetch Token")
@traceroot.trace()
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