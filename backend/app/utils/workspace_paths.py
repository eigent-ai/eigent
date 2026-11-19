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


def sanitize_identity(value: str | int | None) -> str:
    if value is None:
        return ""
    return re.sub(r'[\\/*?:"<>|\s]', "_", str(value)).strip(".")


def runtime_owner_key(email: str, user_id: str | int | None = None) -> str:
    user_key = sanitize_identity(user_id)
    if user_key:
        return f"user_{user_key}"
    return sanitize_email(email)


def task_dir_name(task_id: str) -> str:
    return f"task_{str(task_id).removeprefix('task_')}"


def project_root(
    email: str, project_id: str, user_id: str | int | None = None
) -> Path:
    return (
        get_eigent_root()
        / runtime_owner_key(email, user_id)
        / f"project_{project_id}"
    )


def project_task_root(
    email: str,
    project_id: str,
    task_id: str,
    user_id: str | int | None = None,
) -> Path:
    return project_root(email, project_id, user_id) / task_dir_name(task_id)


def legacy_task_root(
    email: str, task_id: str, user_id: str | int | None = None
) -> Path:
    return (
        get_eigent_root()
        / runtime_owner_key(email, user_id)
        / task_dir_name(task_id)
    )


def camel_log_root(
    email: str,
    project_id: str,
    task_id: str,
    user_id: str | int | None = None,
) -> Path:
    return (
        Path.home()
        / ".eigent"
        / runtime_owner_key(email, user_id)
        / f"project_{project_id}"
        / task_dir_name(task_id)
        / "camel_logs"
    )


def legacy_camel_log_root(
    email: str, task_id: str, user_id: str | int | None = None
) -> Path:
    return (
        Path.home()
        / ".eigent"
        / runtime_owner_key(email, user_id)
        / task_dir_name(task_id)
        / "camel_logs"
    )


def runtime_owner_root(email: str, user_id: str | int | None = None) -> Path:
    return (
        Path.home() / ".eigent" / runtime_owner_key(email, user_id) / "runtime"
    )


def runtime_task_root(
    email: str,
    project_id: str,
    task_id: str,
    user_id: str | int | None = None,
) -> Path:
    return (
        runtime_owner_root(email, user_id)
        / f"project_{project_id}"
        / task_dir_name(task_id)
    )


SPACE_FOLDER_IS_HOME = "space_folder_is_home"
SPACE_FOLDER_HOLDS_APP_DATA = "space_folder_holds_app_data"


def space_folder_conflict(
    folder: Path | str,
    email: str,
    user_id: str | int | None = None,
) -> str | None:
    """Return why Tasks cannot work directly in ``folder``, or ``None``.

    Every Run keeps its toolchains and caches in Eigent's per-user runtime
    folder, which must stay separate from the folder Tasks write to (see
    ``app.utils.runtime_storage``). A folder that contains that runtime
    folder, such as the home folder or Eigent's own data folder, or a folder
    inside it, can therefore never be used. Other folders inside Eigent's
    data folder, such as a blank Space's own folder, are not affected.
    """

    resolved = Path(folder).expanduser().resolve()
    if resolved == Path.home().resolve():
        return SPACE_FOLDER_IS_HOME
    runtime = runtime_owner_root(email, user_id)
    # Runtime storage compares its unresolved absolute path; also compare the
    # resolved one so a linked home or data folder cannot slip through.
    for root in {runtime.absolute(), runtime.resolve()}:
        if root.is_relative_to(resolved) or resolved.is_relative_to(root):
            return SPACE_FOLDER_HOLDS_APP_DATA
    return None


def run_output_root(
    email: str,
    space_id: str,
    project_id: str,
    run_id: str,
    user_id: str | int | None = None,
) -> Path:
    return (
        Path.home()
        / ".eigent"
        / runtime_owner_key(email, user_id)
        / "spaces"
        / space_id
        / "projects"
        / project_id
        / "runs"
        / run_id
    )


def project_workdir_root(
    email: str,
    space_id: str,
    project_id: str,
    user_id: str | int | None = None,
) -> Path:
    return (
        Path.home()
        / ".eigent"
        / runtime_owner_key(email, user_id)
        / "spaces"
        / space_id
        / "projects"
        / project_id
        / "workdir"
    )


def workspace_state_root(email: str, user_id: str | int | None = None) -> Path:
    return (
        Path.home()
        / ".eigent"
        / "workspaces"
        / runtime_owner_key(email, user_id)
    )
