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

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from app.agent.toolkit import file_write_toolkit
from app.agent.toolkit.file_write_toolkit import FileToolkit
from app.run_context import RunContext, run_context_scope
from app.run_runtime.tool_checkpoint import ToolInvocationNotDispatchedError
from app.service.task import ActionWriteFileData
from app.utils.listen import toolkit_listen
from app.utils.space_overlay_client import relative_to_artifact_root
from app.workspace_git import WorkspaceOverlayConflictError


def _context(root: Path) -> RunContext:
    return RunContext(
        space_id="space-1",
        project_id="project-1",
        run_id="run-1",
        task_id="task-1",
        email="user@example.com",
        user_id="user-1",
        working_directory=root,
        task_output_root=root,
        camel_log_dir=root / ".logs",
        binding_source="test",
        workdir_mode="direct-write",
        browser_port=9222,
    )


def test_file_toolkit_routes_git_run_write_before_dispatch(
    tmp_path,
    monkeypatch,
):
    user_root = tmp_path / "user"
    run_root = tmp_path / "run"
    user_root.mkdir()
    run_root.mkdir()
    target = run_root / "report.md"
    prepared = SimpleNamespace(
        target_path=target,
        relative_path="report.md",
    )
    calls: list[tuple[str, object]] = []

    class _MutationService:
        def prepare_file_write(self, **kwargs):
            calls.append(("prepare", kwargs))
            assert not target.exists()
            return prepared

        def complete_file_write(self, value, **kwargs):
            calls.append(("complete", kwargs))
            assert value is prepared
            assert target.read_text() == "durable output"

    monkeypatch.setattr(
        file_write_toolkit,
        "get_default_workspace_mutation_service",
        lambda: _MutationService(),
    )
    monkeypatch.setattr(
        file_write_toolkit,
        "get_task_lock",
        lambda _task_id: object(),
    )
    monkeypatch.setattr(
        toolkit_listen,
        "get_task_lock",
        lambda _task_id: object(),
    )
    monkeypatch.setattr(
        toolkit_listen,
        "_safe_put_queue",
        lambda _lock, _event: None,
    )
    emitted: list[ActionWriteFileData] = []
    monkeypatch.setattr(
        file_write_toolkit,
        "_safe_put_queue",
        lambda _lock, event: emitted.append(event),
    )
    toolkit = FileToolkit(
        "project-1",
        working_directory=str(user_root),
        backup_enabled=False,
    )

    with run_context_scope(_context(user_root)):
        result = toolkit.write_to_file(
            "report",
            "durable output",
            "report.md",
        )

    assert [name for name, _ in calls] == ["prepare", "complete"]
    assert target.read_text() == "durable output"
    assert not (user_root / "report.md").exists()
    assert result == "Content successfully written to file: report.md"
    assert len(emitted) == 1
    assert emitted[0].data == "report.md"
    assert emitted[0].relative_path == "report.md"


def test_file_toolkit_routes_git_run_edit_before_dispatch(
    tmp_path,
    monkeypatch,
):
    user_root = tmp_path / "user"
    run_root = tmp_path / "run"
    user_root.mkdir()
    run_root.mkdir()
    user_target = user_root / "report.md"
    user_target.write_text("visible Space version")
    target = run_root / "report.md"
    target.write_text("original Run version")
    prepared = SimpleNamespace(
        target_path=target,
        relative_path="report.md",
    )
    calls: list[tuple[str, object]] = []

    class _MutationService:
        def prepare_file_write(self, **kwargs):
            calls.append(("prepare", kwargs))
            return prepared

        def complete_file_write(self, value, **kwargs):
            calls.append(("complete", kwargs))
            assert value is prepared
            assert target.read_text() == "updated Run version"

    monkeypatch.setattr(
        file_write_toolkit,
        "get_default_workspace_mutation_service",
        lambda: _MutationService(),
    )
    monkeypatch.setattr(
        file_write_toolkit,
        "get_task_lock",
        lambda _task_id: object(),
    )
    monkeypatch.setattr(
        toolkit_listen,
        "get_task_lock",
        lambda _task_id: object(),
    )
    monkeypatch.setattr(
        toolkit_listen,
        "_safe_put_queue",
        lambda _lock, _event: None,
    )
    emitted: list[ActionWriteFileData] = []
    monkeypatch.setattr(
        file_write_toolkit,
        "_safe_put_queue",
        lambda _lock, event: emitted.append(event),
    )
    toolkit = FileToolkit(
        "project-1",
        working_directory=str(user_root),
        backup_enabled=False,
    )

    with run_context_scope(_context(user_root)):
        result = toolkit.edit_file(
            "report.md",
            "original Run version",
            "updated Run version",
        )

    assert [name for name, _ in calls] == ["prepare", "complete"]
    assert target.read_text() == "updated Run version"
    assert user_target.read_text() == "visible Space version"
    assert result == "Successfully edited report.md"
    assert len(emitted) == 1
    assert emitted[0].data == "report.md"
    assert emitted[0].relative_path == "report.md"


@pytest.mark.parametrize("operation", ["write", "edit"])
def test_file_toolkit_marks_workspace_prepare_conflict_as_not_dispatched(
    tmp_path,
    monkeypatch,
    operation,
):
    user_root = tmp_path / "user"
    user_root.mkdir()
    target = user_root / "report.md"
    target.write_text("visible Space version")

    class _MutationService:
        def prepare_file_write(self, **_kwargs):
            raise WorkspaceOverlayConflictError(
                "Both Project and User sources changed 'report.md'"
            )

    monkeypatch.setattr(
        file_write_toolkit,
        "get_default_workspace_mutation_service",
        lambda: _MutationService(),
    )
    monkeypatch.setattr(
        toolkit_listen,
        "get_task_lock",
        lambda _task_id: object(),
    )
    monkeypatch.setattr(
        toolkit_listen,
        "_safe_put_queue",
        lambda _lock, _event: None,
    )
    toolkit = FileToolkit(
        "project-1",
        working_directory=str(user_root),
        backup_enabled=False,
    )

    with run_context_scope(_context(user_root)):
        with pytest.raises(
            ToolInvocationNotDispatchedError,
            match=(
                "File mutation was not started.*workspace_overlay_conflict"
            ),
        ) as captured:
            if operation == "write":
                toolkit.write_to_file("report", "new", "report.md")
            else:
                toolkit.edit_file("report.md", "visible", "new")

    assert isinstance(captured.value.__cause__, WorkspaceOverlayConflictError)
    assert target.read_text() == "visible Space version"


def test_file_toolkit_emits_safe_relative_path_for_legacy_run_write(
    tmp_path,
    monkeypatch,
):
    root = tmp_path / "run"
    root.mkdir()
    emitted: list[ActionWriteFileData] = []

    class _MutationService:
        def prepare_file_write(self, **_kwargs):
            return None

    monkeypatch.setattr(
        file_write_toolkit,
        "get_default_workspace_mutation_service",
        lambda: _MutationService(),
    )
    monkeypatch.setattr(
        file_write_toolkit,
        "get_task_lock",
        lambda _task_id: object(),
    )
    monkeypatch.setattr(
        toolkit_listen,
        "get_task_lock",
        lambda _task_id: object(),
    )
    monkeypatch.setattr(
        toolkit_listen,
        "_safe_put_queue",
        lambda _lock, _event: None,
    )
    monkeypatch.setattr(
        file_write_toolkit,
        "_safe_put_queue",
        lambda _lock, event: emitted.append(event),
    )
    toolkit = FileToolkit(
        "project-1",
        working_directory=str(root),
        backup_enabled=False,
    )

    with run_context_scope(_context(root)):
        result = toolkit.write_to_file(
            "report",
            "durable output",
            "reports/report.md",
        )

    written_path = root / "reports" / "report.md"
    assert written_path.read_text() == "durable output"
    assert result == f"Content successfully written to file: {written_path}"
    assert len(emitted) == 1
    assert emitted[0].data == str(written_path)
    assert emitted[0].relative_path == "reports/report.md"


def test_artifact_relative_path_rejects_file_outside_run_roots(tmp_path):
    root = tmp_path / "run"
    root.mkdir()
    outside = tmp_path / "outside.md"
    outside.write_text("not run-owned")

    assert relative_to_artifact_root(_context(root), outside) is None
