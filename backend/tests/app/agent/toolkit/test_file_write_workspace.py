from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from app.agent.toolkit import file_write_toolkit
from app.agent.toolkit.file_write_toolkit import FileToolkit
from app.run_context import RunContext, run_context_scope
from app.utils.listen import toolkit_listen


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
    emitted: list[str] = []
    monkeypatch.setattr(
        file_write_toolkit,
        "_safe_put_queue",
        lambda _lock, event: emitted.append(event.data),
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
    assert emitted == ["report.md"]
