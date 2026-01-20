import re
from fastapi import APIRouter, Request,HTTPException
from fastapi.responses import RedirectResponse
from utils import traceroot_wrapper as traceroot
logger = traceroot.get_logger("server_redirect_controller")

router = APIRouter(tags=["Redirect"])


@router.get("/redirect/callback")
def redirect_callback(code: str, request: Request):
    from starlette.datastructures import URL

    if not re.match(r'^[A-Za-z0-9_-]+$', code):
        logger.warning("redirect callback invalid code", extra={"code": code})
        raise HTTPException(status_code=400, detail="Invalid state parameter")

    base_url = URL("eigent://callback")
    redirect_url = base_url.include_query_params(code=code)
    return RedirectResponse(str(redirect_url))

