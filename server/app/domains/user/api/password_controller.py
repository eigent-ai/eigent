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

from fastapi import APIRouter, Depends
from fastapi_babel import _
from sqlmodel import Session

from app.core import code
from app.core.database import session
from app.core.encrypt import password_hash, password_verify
from app.model.user.user import UpdatePassword, UserOut
from app.shared.auth import auth_must
from app.shared.auth.user_auth import V1UserAuth
from app.shared.exception import UserException

router = APIRouter(tags=["User"])


@router.put("/user/update-password", name="update password", response_model=UserOut)
def update_password(
    data: UpdatePassword, auth: V1UserAuth = Depends(auth_must), db_session: Session = Depends(session)
):
    model = auth.user
    if not password_verify(data.password, model.password):
        raise UserException(code.error, _("Password is incorrect"))
    if data.new_password != data.re_new_password:
        raise UserException(code.error, _("The two passwords do not match"))
    model.password = password_hash(data.new_password)
    model.save(db_session)
    return model
