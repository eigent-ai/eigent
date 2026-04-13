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

"""McpUserService: MCP install/uninstall/import with dedup."""

import json

from sqlmodel import select
from loguru import logger

from app.core.database import session_make
from app.model.mcp.mcp import Mcp, McpType
from app.model.mcp.mcp_user import McpImportType, McpUser, Status
from app.core.validator.McpServer import (
    McpRemoteServer,
    validate_mcp_remote_servers,
    validate_mcp_servers,
)


class McpUserService:
    """MCP user installation management - static methods, self-managed session."""

    @staticmethod
    def list_for_user(user_id: int, mcp_id: int | None = None) -> list[McpUser]:
        """List user's MCP installations, optionally filtered by mcp_id."""
        with session_make() as s:
            query = select(McpUser).where(McpUser.user_id == user_id)
            if mcp_id is not None:
                query = query.where(McpUser.mcp_id == mcp_id)
            return list(s.exec(query).all())

    @staticmethod
    def get(mcp_user_id: int, user_id: int) -> McpUser | None:
        """Get a single MCP user installation, scoped to user."""
        with session_make() as s:
            model = s.get(McpUser, mcp_user_id)
            if model and model.user_id == user_id:
                return model
            return None

    @staticmethod
    def install(mcp_id: int, user_id: int, s) -> dict:
        """Install MCP from store: dedup check, parse install_command, create McpUser.
        Returns {"success": True, "mcp_user": McpUser} or {"success": False, "error_code": str}.
        """
        mcp = s.get(Mcp, mcp_id)
        if not mcp:
            return {"success": False, "error_code": "MCP_NOT_FOUND"}

        exists = s.exec(
            select(McpUser).where(McpUser.mcp_id == mcp.id, McpUser.user_id == user_id)
        ).first()
        if exists:
            return {"success": False, "error_code": "MCP_ALREADY_INSTALLED"}

        install_command_raw = mcp.install_command or "{}"
        try:
            install_command = (
                json.loads(install_command_raw) if isinstance(install_command_raw, str) else install_command_raw or {}
            )
        except json.JSONDecodeError:
            return {"success": False, "error_code": "MCP_INVALID_INSTALL_COMMAND"}
        if not isinstance(install_command, dict) or "command" not in install_command:
            return {"success": False, "error_code": "MCP_INVALID_INSTALL_COMMAND"}

        mcp_user = McpUser(
            mcp_id=mcp.id,
            user_id=user_id,
            mcp_name=mcp.name,
            mcp_key=mcp.key,
            mcp_desc=mcp.description,
            type=mcp.type,
            status=Status.enable,
            command=install_command["command"],
            args=install_command.get("args"),
            env=install_command.get("env"),
            server_url=None,
        )
        mcp_user.save()
        return {"success": True, "mcp_user": mcp_user}

    @staticmethod
    def import_mcp(mcp_type: McpImportType, mcp_data: dict, user_id: int) -> dict:
        """Import MCP servers from user config. Returns result dict with imported/failed lists."""
        if mcp_type == McpImportType.Local:
            is_valid, res = validate_mcp_servers(mcp_data)
            if not is_valid:
                return {"success": False, "error_code": "MCP_INVALID_DATA", "detail": res}

            mcp_data_parsed = getattr(res, "mcpServers", mcp_data)
            imported_names = []
            failed_names = []
            for name, data in mcp_data_parsed.items():
                command = data.command if hasattr(data, "command") else data.get("command")
                args = data.args if hasattr(data, "args") else data.get("args")
                env = data.env if hasattr(data, "env") else data.get("env")
                try:
                    mcp_user = McpUser(
                        mcp_id=0,
                        user_id=user_id,
                        mcp_name=name,
                        mcp_key=name,
                        mcp_desc=name,
                        type=McpType.Local,
                        status=Status.enable,
                        command=command,
                        args=args,
                        env=env,
                        server_url=None,
                    )
                    mcp_user.save()
                    imported_names.append(name)
                except Exception as e:
                    logger.error("Failed to import local MCP", extra={"mcp_name": name, "error": str(e)})
                    failed_names.append(name)
            return {
                "success": True,
                "message": "Local MCP servers imported successfully",
                "count": len(imported_names),
                "imported": imported_names,
                "failed": failed_names,
            }

        elif mcp_type == McpImportType.Remote:
            is_valid, res = validate_mcp_remote_servers(mcp_data)
            if not is_valid:
                return {"success": False, "error_code": "MCP_INVALID_DATA", "detail": res}
            data: McpRemoteServer = res
            mcp_user = McpUser(
                mcp_id=0,
                user_id=user_id,
                type=McpType.Remote,
                status=Status.enable,
                mcp_name=data.server_name,
                server_url=data.server_url,
            )
            mcp_user.save()
            return {"success": True, "mcp_user": mcp_user}

        return {"success": False, "error_code": "MCP_INVALID_TYPE"}

    @staticmethod
    def update(mcp_user_id: int, user_id: int, data: dict) -> dict:
        """Update MCP user: ownership check."""
        with session_make() as s:
            model = s.get(McpUser, mcp_user_id)
            if not model or model.user_id != user_id:
                return {"success": False, "error_code": "MCP_USER_NOT_FOUND"}
            model.update_fields(data)
            model.save(s)
            s.refresh(model)
            return {"success": True, "mcp_user": model}

    @staticmethod
    def uninstall(mcp_user_id: int, user_id: int) -> bool:
        """Uninstall MCP: ownership check + delete."""
        with session_make() as s:
            model = s.get(McpUser, mcp_user_id)
            if not model or model.user_id != user_id:
                return False
            s.delete(model)
            s.commit()
            return True
