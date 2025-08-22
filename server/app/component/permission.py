from fastapi_babel import _

"""
权限定义：
当存在子权限的时候，父权限则不生效，应该全部放至子权限中定义处理
"""


def permissions():
    return [
        {
            "name": _("User"),
            "description": _("User manger"),
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
            "description": _("Admin manger"),
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
            "description": _("Role manger"),
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
            "description": _("Mcp manger"),
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
