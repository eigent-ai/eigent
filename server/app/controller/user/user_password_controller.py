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
from sqlmodel import Session

from app.component import code
from app.component.auth import Auth, auth_must
from app.component.database import session
from app.component.encrypt import password_hash, password_verify
from app.exception.exception import UserException
from app.model.user.user import UpdatePassword, UserOut
from fastapi_babel import _
import logging

logger = logging.getLogger("server_password_controller")

router = APIRouter(tags=["User"])


@router.put("/user/update-password", name="update password", response_model=UserOut)
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