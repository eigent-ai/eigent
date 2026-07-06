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
Ownership check utility for IDOR protection.

All resource-access endpoints should verify the authenticated user owns the resource.
"""

from app.shared.exception import NoPermissionException


def require_owner(resource, user_id: int, field: str = "user_id") -> None:
    """
    Raise NoPermissionException if resource does not belong to user.

    :param resource: Model instance with ownership field (e.g. user_id)
    :param user_id: Authenticated user's ID
    :param field: Name of the ownership field (default: user_id)
    :raises NoPermissionException: If resource is None or ownership mismatch
    """
    if resource is None:
        raise NoPermissionException("Resource not found")
    owner_id = getattr(resource, field, None)
    if owner_id is None or owner_id != user_id:
        raise NoPermissionException("Resource not found")
