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

from pydantic import BaseModel
from sqlmodel import Field

from app.model.abstract.model import AbstractModel


class AdminRole(AbstractModel, table=True):
    admin_id: int = Field(primary_key=True)
    role_id: int = Field(primary_key=True)


class AdminRoleIn(BaseModel):
    admin_id: int
    role_ids: list[int]
