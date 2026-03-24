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

"""
Unified auth layer for v1.

- auth_must: user token, 1 week expiry, blacklist check, type: user claim
- admin_must: admin token, separate claim, blacklist check
- require_owner: IDOR protection utility
"""

from app.shared.auth.user_auth import auth_must, auth_optional, create_access_token, create_refresh_token
from app.shared.auth.admin_auth import admin_must
from app.shared.auth.ownership import require_owner

__all__ = [
    "auth_must",
    "auth_optional",
    "create_access_token",
    "create_refresh_token",
    "admin_must",
    "require_owner",
]
