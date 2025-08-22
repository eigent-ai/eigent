from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import RedirectResponse, JSONResponse, HTMLResponse
from app.component.environment import env
from app.component.oauth_adapter import OauthCallbackPayload, get_oauth_adapter
from typing import Optional

router = APIRouter(prefix="/oauth", tags=["Oauth Servers"])


@router.get("/{app}/login", name="OAuth Login Redirect")
def oauth_login(app: str, request: Request, state: Optional[str] = None):
    try:
        callback_url = str(request.url_for("OAuth Callback", app=app))
        if callback_url.startswith("http://"):
            callback_url = "https://" + callback_url[len("http://") :]
        adapter = get_oauth_adapter(app, callback_url)
        url = adapter.get_authorize_url(state)
        if not url:
            raise HTTPException(status_code=400, detail="Failed to generate authorization URL")
        return RedirectResponse(str(url))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{app}/callback", name="OAuth Callback")
def oauth_callback(app: str, request: Request, code: Optional[str] = None, state: Optional[str] = None):
    if not code:
        raise HTTPException(status_code=400, detail="Missing code parameter")
    redirect_url = f"eigent://callback/oauth?provider={app}&code={code}&state={state}"
    html_content = f"""
    <html>
        <head>
            <title>OAuth Callback</title>
        </head>
        <body>
            <script type='text/javascript'>
                window.location.href = '{redirect_url}';
            </script>
            <p>Redirecting, please wait...</p>
            <button onclick='window.close()'>Close this window</button>
        </body>
    </html>
    """
    return HTMLResponse(content=html_content)


@router.post("/{app}/token", name="OAuth Fetch Token")
def fetch_token(app: str, request: Request, data: OauthCallbackPayload):
    try:
        callback_url = str(request.url_for("OAuth Callback", app=app))
        if callback_url.startswith("http://"):
            callback_url = "https://" + callback_url[len("http://") :]

        adapter = get_oauth_adapter(app, callback_url)
        token_data = adapter.fetch_token(data.code)
        return JSONResponse(token_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
