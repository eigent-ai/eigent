from urllib.parse import urlencode, quote
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse


router = APIRouter(tags=["Redirect"])


@router.get("/redirect/callback")
def redirect_callback(code: str, request: Request):

    params = {"code": code}
    query = urlencode(params, quote_via=quote)
    redirect_url = f"eigent://callback?{query}"
    return RedirectResponse(redirect_url)