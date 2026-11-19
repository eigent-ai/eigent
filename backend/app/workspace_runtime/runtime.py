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

"""Explicit deployment registration for the controlled execution capability.

No implicit database, credentials, filesystem policy or old model factory is
created when capabilities are queried. Registration must precede server startup.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .service import ExecutionService

_default_execution_service: ExecutionService | None = None
_default_registration_service = None
_initialization_state = "disabled"


def get_default_execution_service() -> ExecutionService | None:
    return _default_execution_service


def get_default_registration_service():
    return _default_registration_service


def execution_initialization_state():
    return _initialization_state


def initialize_execution_service(
    manifest_path,
    *,
    journal=None,
    coordinator=None,
    workspace_store=None,
    configuration_reader=None,
    transport=None,
):
    """Explicit trusted deployment initialization; never called by capability.

    The manifest selects an existing server authority and a release-provisioned
    tokenizer directory. It contains no accounts, keys, model config or user
    workspace paths. Journal configuration remains the existing application one.
    """
    global _default_registration_service, _initialization_state
    if not manifest_path or _default_execution_service is not None:
        return
    from .agent_configuration import AgentConfigurationUnavailable
    from .configuration_source import AccountConfigurationSource
    from .tokenizer_assets import load_tokenizer_assets

    try:
        path = Path(manifest_path)
        if not path.is_absolute():
            raise ValueError("explicit deployment path required")
        with path.open("rb") as handle:
            raw = handle.read(16 * 1024 + 1)
        if len(raw) > 16 * 1024:
            raise ValueError("oversized deployment manifest")
        document = json.loads(raw)
        if set(document) - {
            "session_history_enabled",
            "local_single_session_enabled",
        } != {
            "schema_version",
            "enabled",
            "server_url",
            "tokenizer_asset_directory",
            "capacity",
        }:
            raise ValueError("unsupported deployment manifest")
        history_enabled = document.get("session_history_enabled", False)
        single_enabled = document.get("local_single_session_enabled", False)
        if type(history_enabled) is not bool:
            raise ValueError("invalid session history switch")
        if type(single_enabled) is not bool:
            raise ValueError("invalid local Session entry switch")
        if document["schema_version"] != 1 or document["enabled"] is not True:
            raise ValueError("deployment is not enabled")
        capacity = document["capacity"]
        if type(capacity) is not int or not 2 <= capacity <= 16:
            raise ValueError("invalid deployment capacity")
        from app.run_sync.runtime import current_control_configuration

        source = AccountConfigurationSource(
            document["server_url"],
            configuration_reader or current_control_configuration,
            transport=transport,
        )
        tokenizers = load_tokenizer_assets(
            Path(document["tokenizer_asset_directory"])
        )
        if not tokenizers:
            _initialization_state = "tokenizer_assets_required"
            return
    except (OSError, ValueError, TypeError, AgentConfigurationUnavailable):
        _initialization_state = "configuration_required"
        return
    from app.run_journal.runtime import get_default_run_journal
    from app.run_runtime.runtime import get_default_run_coordinator
    from app.utils.workspace_resolver import WorkspaceStore

    from .registration import ExecutionRegistrationService
    from .service import ExecutionPolicyRegistry, ExecutionService

    journal = journal or get_default_run_journal()
    coordinator = coordinator or get_default_run_coordinator()
    policies = ExecutionPolicyRegistry()
    registration = ExecutionRegistrationService(
        journal,
        policies,
        source,
        workspace_store or WorkspaceStore(),
        tokenizers,
        journal.path.parent / "managed-executions",
        session_history_enabled=history_enabled,
        local_single_session_enabled=single_enabled,
    )
    registration.restore()
    service = ExecutionService(
        journal, coordinator, policies, capacity=capacity
    )
    service.registration = registration
    configure_execution_service(service)
    _default_registration_service = registration
    _initialization_state = "initialized"


def configure_execution_service(service: ExecutionService) -> None:
    global _default_execution_service
    if _default_execution_service not in (None, service):
        raise RuntimeError(
            "close the existing execution service before replacing it"
        )
    _default_execution_service = service


async def start_default_execution_service() -> None:
    service = _default_execution_service
    if service is not None:
        await service.start()


async def close_default_execution_service() -> None:
    global \
        _default_execution_service, \
        _default_registration_service, \
        _initialization_state
    service = _default_execution_service
    if service is not None:
        await service.close()
    _default_execution_service = None
    _default_registration_service = None
    _initialization_state = "disabled"
