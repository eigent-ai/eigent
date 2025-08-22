from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.component import code
from app.component.auth import Auth, auth_must
from app.component.database import session
from app.component.encrypt import password_hash, password_verify
from app.exception.exception import UserException
from app.model.user.user import UpdatePassword, UserOut
from fastapi_babel import _

router = APIRouter(tags=["User"])


@router.put("/user/update-password", name="update password", response_model=UserOut)
def update_password(data: UpdatePassword, auth: Auth = Depends(auth_must), session: Session = Depends(session)):
    model = auth.user
    if not password_verify(data.password, model.password):
        raise UserException(code.error, _("Password is incorrect"))
    if data.new_password != data.re_new_password:
        raise UserException(code.error, _("The two passwords do not match"))
    model.password = password_hash(data.new_password)
    model.save(session)
    return model
