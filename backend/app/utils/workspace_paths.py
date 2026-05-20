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

import re
from pathlib import Path

from app.component.environment import env


def get_workspace_root() -> Path:
    return Path(env("EIGENT_WORKSPACE", "~/.eigent/workspace")).expanduser()


def get_eigent_root() -> Path:
    eigent = Path.home() / "eigent"
    if eigent.exists():
        return eigent
    dot_eigent = Path.home() / ".eigent"
    if dot_eigent.exists():
        return dot_eigent
    return eigent


def sanitize_email(email: str) -> str:
    return re.sub(r'[\\/*?:"<>|\s]', "_", email.split("@")[0]).strip(".")


def project_root(email: str, project_id: str) -> Path:
    return get_eigent_root() / sanitize_email(email) / f"project_{project_id}"


def project_task_root(email: str, project_id: str, task_id: str) -> Path:
    return project_root(email, project_id) / f"task_{task_id}"


def legacy_task_root(email: str, task_id: str) -> Path:
    return get_eigent_root() / sanitize_email(email) / f"task_{task_id}"


def camel_log_root(email: str, project_id: str, task_id: str) -> Path:
    return (
        Path.home()
        / ".eigent"
        / sanitize_email(email)
        / f"project_{project_id}"
        / f"task_{task_id}"
        / "camel_logs"
    )


def legacy_camel_log_root(email: str, task_id: str) -> Path:
    return (
        Path.home()
        / ".eigent"
        / sanitize_email(email)
        / f"task_{task_id}"
        / "camel_logs"
    )


def runtime_task_root(email: str, project_id: str, task_id: str) -> Path:
    return (
        Path.home()
        / ".eigent"
        / sanitize_email(email)
        / "runtime"
        / f"project_{project_id}"
        / f"task_{task_id}"
    )


def workspace_state_root(email: str) -> Path:
    return Path.home() / ".eigent" / "workspaces" / sanitize_email(email)
