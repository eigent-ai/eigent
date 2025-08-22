from fastapi import Depends, Header
from fastapi_babel import _
from sqlmodel import Session, select
from app.component import code
from fastapi.security import OAuth2PasswordBearer
from app.component.database import session
from app.component.environment import env, env_not_empty
from datetime import timedelta, datetime
import jwt
from jwt.exceptions import InvalidTokenError
from app.model.mcp.proxy import ApiKey
from app.model.user.key import Key
from app.model.user.user import User

from app.exception.exception import (
    NoPermissionException,
    TokenException,
)


class Auth:
    SECRET_KEY = env_not_empty("secret_key")

    def __init__(self, id: int, expired_at: datetime):
        self.id = id
        self.expired_at = expired_at
        self._user: User | None = None

    @property
    def user(self):
        if self._user is None:
            raise NoPermissionException("未查询到登录用户")
        return self._user

    @classmethod
    def decode_token(cls, token: str):
        try:
            payload = jwt.decode(token, Auth.SECRET_KEY, algorithms=["HS256"])
            id = payload["id"]
            if payload["exp"] < int(datetime.now().timestamp()):
                raise TokenException(code.token_expired, _("Validate credentials expired"))
        except InvalidTokenError:
            raise TokenException(code.token_invalid, _("Could not validate credentials"))
        return Auth(id, payload["exp"])

    @classmethod
    def create_access_token(cls, user_id: int, expires_delta: timedelta | None = None):
        to_encode: dict = {"id": user_id}
        if expires_delta:
            expire = datetime.now() + expires_delta
        else:
            expire = datetime.now() + timedelta(days=30)
        to_encode.update({"exp": expire})
        encoded_jwt = jwt.encode(to_encode, Auth.SECRET_KEY, algorithm="HS256")
        return encoded_jwt


oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{env('url_prefix', '')}/dev_login", auto_error=False)


async def auth(
    token: str | None = Depends(oauth2_scheme),
    session: Session = Depends(session),
) -> Auth | None:
    if token is None:
        return None
    try:
        model = Auth.decode_token(token)
        user = session.get(User, model.id)
        model._user = user
        return model
    except Exception:
        return None


async def auth_must(
    token: str = Depends(oauth2_scheme),
    session: Session = Depends(session),
) -> Auth:
    model = Auth.decode_token(token)
    user = session.get(User, model.id)
    model._user = user
    return model


async def key_must(headers: ApiKey = Header(), session: Session = Depends(session)):
    model = session.exec(select(Key).where(Key.value == headers.api_key)).one_or_none()
    if model is None:
        raise TokenException(code.token_invalid, _(f"Could not validate key credentials: {headers.api_key}"))
    return model
