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

from sqlmodel import Column, Field, String

from app.model.abstract.model import AbstractModel, DefaultTimes


class UserIdCanonicalization(AbstractModel, DefaultTimes, table=True):
    """Maps legacy per-surface user ids into the Space-layer TEXT user id."""

    source: str = Field(sa_column=Column(String(64), primary_key=True))
    source_id: str = Field(sa_column=Column(String(128), primary_key=True))
    canonical_id: str = Field(sa_column=Column(String(128), nullable=False, index=True))
