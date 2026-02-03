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

from typing import Literal

from pydantic import BaseModel


class ApiKey(BaseModel):
    api_key: str


class ExaSearch(BaseModel):
    query: str
    search_type: Literal["auto", "neural", "keyword"] = "auto"
    category: (
        Literal[
            "company",
            "research paper",
            "news",
            "pdf",
            "github",
            "tweet",
            "personal site",
            "linkedin profile",
            "financial report",
        ]
        | None
    ) = None
    num_results: int = 10
    include_text: list[str] | None = None
    exclude_text: list[str] | None = None
    use_autoprompt: bool | None = True
    text: bool | None = False
