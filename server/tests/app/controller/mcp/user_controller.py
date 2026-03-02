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

import inspect


def test_get_mcp_user_has_ownership_filter():
    """GET /mcp/users/{id} must filter by user_id."""
    from app.controller.mcp.user_controller import get_mcp_user

    source = inspect.getsource(get_mcp_user)
    assert "McpUser.user_id" in source, (
        "get_mcp_user does not filter by user_id - IDOR vulnerability"
    )


def test_delete_mcp_user_has_ownership_check():
    """DELETE /mcp/users/{id} must check ownership before deletion."""
    from app.controller.mcp.user_controller import delete_mcp_user

    source = inspect.getsource(delete_mcp_user)
    assert "user_id" in source and "403" in source, (
        "delete_mcp_user does not check ownership - IDOR vulnerability"
    )
