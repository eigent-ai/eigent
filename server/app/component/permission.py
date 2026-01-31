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

from fastapi_babel import _

"""
权限定义：
当存在子权限的时候，父权限则不生效，应该全部放至子权限中定义处理
"""


def permissions():
    return [
        {
            "name": _("User"),
            "description": _("User manager"),
            "children": [
                {
                    "identity": "user:view",
                    "name": _("User Manage"),
                    "description": _("View users"),
                },
                {
                    "identity": "user:edit",
                    "name": _("User Edit"),
                    "description": _("Manage users"),  # 修改用户信息，邀请用户（限本组织下）
                },
            ],
        },
        {
            "name": _("Admin"),
            "description": _("Admin manager"),
            "children": [
                {
                    "identity": "admin:view",
                    "name": _("Admin View"),
                    "description": _("View admins"),  # 修改项目，工作区，角色，用户
                },
                {
                    "identity": "admin:edit",
                    "name": _("Admin Edit"),
                    "description": _("Edit admins"),
                },
            ],
        },
        {
            "name": _("Role"),
            "description": _("Role manager"),
            "children": [
                {
                    "identity": "role:view",
                    "name": _("Role View"),
                    "description": _("View roles"),  # 修改项目和工作区中的角色，创建新的角色
                },
                {
                    "identity": "role:edit",
                    "name": _("Role Edit"),
                    "description": _("Edit roles"),  # 修改角色
                },
            ],
        },
        {
            "name": _("Mcp"),
            "description": _("Mcp manager"),
            "children": [
                {
                    "identity": "mcp:edit",
                    "name": _("Mcp Edit"),
                    "description": _("Edit mcp service"),
                },
                {
                    "identity": "mcp-category:edit",
                    "name": _("Mcp Category Edit"),
                    "description": _("Edit mcp category"),
                },
            ],
        },
    ]
