import re
from urllib.parse import urlencode, quote
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse


router = APIRouter(tags=["Redirect"])


@router.get("/redirect/callback")
def redirect_callback(code: str, request: Request):
    if not re.match(r'^[A-Za-z0-9_-]+$', code):
        # fallback safe redirect without user data
        return RedirectResponse("eigent://callback")
    params = {"code": code}
    query = urlencode(params, quote_via=quote)
    redirect_url = f"eigent://callback?{query}"
    return RedirectResponse(redirect_url)