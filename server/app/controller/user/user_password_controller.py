from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.component import code
from app.component.auth import Auth, auth_must
from app.component.database import session
from app.component.encrypt import password_hash, password_verify
from app.exception.exception import UserException
from app.model.user.user import UpdatePassword, UserOut
from fastapi_babel import _
from utils import traceroot_wrapper as traceroot

logger = traceroot.get_logger("server_password_controller")

router = APIRouter(tags=["User"])


@router.put("/user/update-password", name="update password", response_model=UserOut)
@traceroot.trace()
def update_password(data: UpdatePassword, auth: Auth = Depends(auth_must), session: Session = Depends(session)):
    """Update user password after verifying current password."""
    user_id = auth.user.id
    model = auth.user
    
    if not password_verify(data.password, model.password):
        logger.warning("Password update failed: incorrect current password", extra={"user_id": user_id})
        raise UserException(code.error, _("Password is incorrect"))
    
    if data.new_password != data.re_new_password:
        logger.warning("Password update failed: new passwords do not match", extra={"user_id": user_id})
        raise UserException(code.error, _("The two passwords do not match"))
    
    model.password = password_hash(data.new_password)
    model.save(session)
    logger.info("Password updated successfully", extra={"user_id": user_id})
    return model