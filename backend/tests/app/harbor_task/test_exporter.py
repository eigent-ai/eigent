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

import json
import os
import subprocess
import tomllib
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.harbor_task import (
    HARBOR_TASKS_DIR_ENV,
    EarlierRun,
    HarborTaskInstruction,
    HarborTaskSource,
    HarborTaskUnavailable,
    earlier_runs,
    harbor_tasks_root,
    resolve_harbor_task_source,
    run_instruction,
    run_reference_text,
    run_request_text,
    save_harbor_task,
)
from app.workspace_git import GitBackend

BASE = "a" * 40
TARGET = "b" * 40


def _event(content, *, created_at=1.0, attachment_names=()):
    return SimpleNamespace(
        event_type="user.message",
        created_at=created_at,
        payload={
            "content": content,
            "attachment_names": list(attachment_names),
        },
    )


class _Journal:
    def __init__(
        self,
        *,
        status="completed",
        base=BASE,
        target=TARGET,
        materialized=True,
        events=None,
        interactions=(),
        decisions=None,
    ):
        self.run = SimpleNamespace(project_id="project-1", status=status)
        self.materialization = (
            SimpleNamespace(
                repository_id="repo-1",
                workspace_base_commit=base,
                promoted_commit=target,
            )
            if materialized
            else None
        )
        self.events = (
            [_event("Build a brew calculator")] if events is None else events
        )
        self.interactions = list(interactions)
        self.decisions = decisions or {}

    def get_run(self, run_id):
        return self.run if run_id == "run-1" else None

    def get_run_git_materialization(self, _run_id):
        return self.materialization

    def list_events(self, _run_id, *, event_type_prefix=None):
        return [
            event
            for event in self.events
            if event_type_prefix is None
            or event.event_type.startswith(event_type_prefix)
        ]

    def list_human_interactions(self, _run_id):
        return self.interactions

    def list_human_interaction_decisions(self, interaction_id):
        return self.decisions.get(interaction_id, [])


@pytest.mark.parametrize(
    ("journal", "reason"),
    [
        (_Journal(status="running"), "run_not_completed"),
        (_Journal(materialized=False), "run_git_not_recorded"),
        (_Journal(target=None), "run_git_not_finalized"),
        (_Journal(target=BASE), "run_changed_no_files"),
        (_Journal(events=[_event("   ")]), "run_has_no_user_message"),
    ],
)
def test_resolve_source_explains_why_a_run_cannot_be_saved(journal, reason):
    with pytest.raises(HarborTaskUnavailable) as raised:
        resolve_harbor_task_source(journal, "run-1")
    assert raised.value.reason == reason


def test_resolve_source_reports_missing_run():
    with pytest.raises(HarborTaskUnavailable) as raised:
        resolve_harbor_task_source(_Journal(), "run-missing")
    assert raised.value.reason == "run_not_found"


def test_resolve_source_returns_recorded_commits():
    source = resolve_harbor_task_source(_Journal(), "run-1")
    assert source == HarborTaskSource(
        run_id="run-1",
        project_id="project-1",
        repository_id="repo-1",
        base_commit=BASE,
        target_commit=TARGET,
    )


def test_instruction_keeps_user_words_in_order_and_maps_workspace(tmp_path):
    workspace = tmp_path / "space"
    workspace.mkdir()
    journal = _Journal(
        events=[
            _event(
                f"Read {workspace}/data.csv but not {workspace}-old/x",
                attachment_names=["recipes.json"],
            ),
            _event("Also add a header row", created_at=30.0),
        ],
        interactions=[
            SimpleNamespace(
                interaction_id="ask-1", interaction_type="question"
            ),
            SimpleNamespace(
                interaction_id="ok-1", interaction_type="approval"
            ),
        ],
        decisions={
            "ask-1": [
                SimpleNamespace(
                    actor_type="user",
                    created_at=20.0,
                    decision={"reply": "Skip unknown SKUs"},
                )
            ],
            "ok-1": [
                SimpleNamespace(
                    actor_type="user",
                    created_at=25.0,
                    decision={"reply": "approve"},
                )
            ],
        },
    )

    instruction = run_instruction(journal, "run-1", workspace_root=workspace)

    assert instruction.text == (
        f"Read /app/data.csv but not {workspace}-old/x\n\n"
        "Additional input from the user:\nSkip unknown SKUs\n\n"
        "Additional input from the user:\nAlso add a header row\n"
    )
    assert any("recipes.json" in note for note in instruction.notes)


def _git(cwd: Path, *args: str) -> str:
    environment = {
        **os.environ,
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_AUTHOR_NAME": "test",
        "GIT_AUTHOR_EMAIL": "test@example.com",
        "GIT_COMMITTER_NAME": "test",
        "GIT_COMMITTER_EMAIL": "test@example.com",
    }
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def _commit(root: Path, message: str) -> str:
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "--allow-empty", "-m", message)
    return _git(root, "rev-parse", "HEAD")


def _tree(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in root.rglob("*")
        if path.is_file() and path.relative_to(root).parts[0] != ".git"
    }


@pytest.fixture
def repository(tmp_path):
    root = tmp_path / "space"
    root.mkdir()
    _git(root, "init", "-q")
    (root / "notes.md").write_text("first\n", encoding="utf-8")
    (root / "remove.txt").write_text("gone soon\n", encoding="utf-8")
    (root / "image.bin").write_bytes(b"\x00\x01\x02")
    (root / "empty.txt").write_bytes(b"")
    script = root / "tools" / "run.sh"
    script.parent.mkdir()
    script.write_text("#!/bin/sh\necho old\n", encoding="utf-8")
    script.chmod(0o755)
    base = _commit(root, "before")
    start = _tree(root)

    (root / "notes.md").write_text("first\nsecond\n", encoding="utf-8")
    (root / "remove.txt").unlink()
    (root / "image.bin").write_bytes(b"\x00\xff\x02\x03")
    (root / "reports").mkdir()
    (root / "reports" / "brew.html").write_text("<p>ok</p>\n")
    script.write_text("#!/bin/sh\necho new\n", encoding="utf-8")
    target = _commit(root, "after")
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    return SimpleNamespace(
        root=root,
        base=base,
        target=target,
        start=start,
        git=GitBackend(hooks_path=hooks),
    )


def _source(repository) -> HarborTaskSource:
    return HarborTaskSource(
        run_id="1791378437947-5797",
        project_id="project-1",
        repository_id="repo-1",
        base_commit=repository.base,
        target_commit=repository.target,
    )


def test_saved_task_starts_before_the_run_with_placeholder_scripts(
    repository, tmp_path
):
    destination = tmp_path / "Downloads" / "eigent-harbor-tasks"
    instruction = HarborTaskInstruction(
        text="Build a brew calculator\n", notes=("a note",)
    )

    saved = save_harbor_task(
        git=repository.git,
        repository_root=repository.root,
        source=_source(repository),
        instruction=instruction,
        reference_text="",
        destination_root=destination,
    )

    task = destination / "task-1791378437947-5797"
    assert saved.path == task
    assert saved.name == "eigent/task-1791378437947-5797"
    assert saved.notes == ("a note",)
    assert sorted(p.name for p in destination.iterdir()) == [task.name]
    assert _tree(task / "environment" / "workspace") == repository.start
    assert (task / "instruction.md").read_text() == instruction.text
    assert (
        "COPY workspace/ /app/"
        in (task / "environment" / "Dockerfile").read_text()
    )
    assert json.loads(
        (task / "environment" / "omitted_files.json").read_text()
    ) == {"base_commit": repository.base, "files": []}
    # placeholders: the verifier and the solution are written later
    assert sorted(p.name for p in (task / "solution").iterdir()) == [
        "solve.sh"
    ]
    for script in ("solution/solve.sh", "tests/test.sh"):
        assert os.access(task / script, os.X_OK)
        assert "exit 1" in (task / script).read_text()

    config = tomllib.loads((task / "task.toml").read_text())
    assert config["schema_version"] == "1.4"
    assert config["verifier"]["environment_mode"] == "separate"
    assert config["task"]["name"] == saved.name
    assert config["task"]["description"] == "Build a brew calculator"
    assert config["metadata"]["eigent"] == {
        "run_id": "1791378437947-5797",
        "project_id": "project-1",
        "base_commit": repository.base,
        "target_commit": repository.target,
        "starting_files": (
            "files the Task changed or referenced, plus small text files, "
            "from the Content Repository commit before the Run, without what "
            "Tasks in other Sessions wrote"
        ),
        "omitted_files": 0,
        "omitted_bytes": 0,
        "omitted_list": "environment/omitted_files.json",
        "verifier": "none",
        "notes": ["a note"],
    }


def test_saving_again_replaces_the_task(repository, tmp_path):
    destination = tmp_path / "tasks"
    stale = destination / "task-1791378437947-5797" / "stale.txt"
    stale.parent.mkdir(parents=True)
    stale.write_text("old export\n")

    save_harbor_task(
        git=repository.git,
        repository_root=repository.root,
        source=_source(repository),
        instruction=HarborTaskInstruction(text="Task\n"),
        reference_text="",
        destination_root=destination,
    )

    assert not stale.exists()
    assert [p.name for p in destination.iterdir()] == [stale.parent.name]


@pytest.mark.skipif(os.name == "nt", reason="symlinks need privileges")
def test_symbolic_links_are_not_supported_yet(repository, tmp_path):
    (repository.root / "link").symlink_to("notes.md")
    target = _commit(repository.root, "link")
    source = HarborTaskSource(
        run_id="run-1",
        project_id="project-1",
        repository_id="repo-1",
        base_commit=repository.target,
        target_commit=target,
    )

    with pytest.raises(HarborTaskUnavailable) as raised:
        save_harbor_task(
            git=repository.git,
            repository_root=repository.root,
            source=source,
            instruction=HarborTaskInstruction(text="Task\n"),
            reference_text="",
            destination_root=tmp_path / "tasks",
        )

    assert raised.value.reason == "unsupported_file_type"
    assert not (tmp_path / "tasks").exists()


def test_tasks_root_defaults_to_downloads(monkeypatch, tmp_path):
    monkeypatch.delenv(HARBOR_TASKS_DIR_ENV, raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    assert harbor_tasks_root() == (
        Path.home() / "Downloads" / "eigent-harbor-tasks"
    )

    monkeypatch.setenv(HARBOR_TASKS_DIR_ENV, str(tmp_path / "chosen"))
    assert harbor_tasks_root() == tmp_path / "chosen"


def test_environment_keeps_only_what_the_task_needs(tmp_path):
    root = tmp_path / "space"
    root.mkdir()
    _git(root, "init", "-q")
    files = {
        "src/app.py": b"print('hi')\n",
        "assets/font.ttf": b"\x00font" * 400,
        "assets/logo.png": b"\x89PNG\x00logo",
        "assets/photo.jpg": b"\xff\xd8\x00photo",
        "docs/big.md": b"x" * (1024 * 1024 + 1),
        "docs/spec.md": b"y" * (1024 * 1024 + 1),
        ".next/cache/0.pack": b"\x00cache",
        ".DS_Store": b"\x00finder",
    }
    for relative, data in files.items():
        (root / relative).parent.mkdir(parents=True, exist_ok=True)
        (root / relative).write_bytes(data)
    base = _commit(root, "before")
    (root / "report.pdf").write_bytes(b"%PDF\x00report")
    (root / ".next" / "cache" / "0.pack").write_bytes(b"\x00rebuilt")
    target = _commit(root, "after")
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    git = GitBackend(hooks_path=hooks)
    journal = _Journal(
        events=[
            _event("Make a report"),
            SimpleNamespace(
                event_type="tool.completed",
                created_at=2.0,
                payload={
                    "arguments": f'{{"path": "{root}/assets/logo.png"}}',
                    "output": ["docs/spec.md:12: spec", "photo.jpg  src"],
                },
            ),
        ]
    )
    source = HarborTaskSource(
        run_id="run-1",
        project_id="project-1",
        repository_id="repo-1",
        base_commit=base,
        target_commit=target,
    )

    saved = save_harbor_task(
        git=git,
        repository_root=root,
        source=source,
        instruction=HarborTaskInstruction(text="Make a report\n"),
        reference_text=run_reference_text(journal, "run-1"),
        destination_root=tmp_path / "tasks",
    )

    workspace = saved.path / "environment" / "workspace"
    assert sorted(_tree(workspace)) == [
        "assets/logo.png",
        "assets/photo.jpg",
        "docs/spec.md",
        "src/app.py",
    ]
    config = tomllib.loads((saved.path / "task.toml").read_text())
    assert config["metadata"]["eigent"]["omitted_files"] == 4
    assert any("4 workspace files" in note for note in saved.notes)
    omitted = json.loads(
        (saved.path / "environment" / "omitted_files.json").read_text()
    )
    assert omitted["base_commit"] == base
    assert [
        (item["path"], item["reason"], item["size_bytes"])
        for item in omitted["files"]
    ] == [
        (".DS_Store", "system_file", len(files[".DS_Store"])),
        (
            ".next/cache/0.pack",
            "build_cache",
            len(files[".next/cache/0.pack"]),
        ),
        (
            "assets/font.ttf",
            "binary_unreferenced",
            len(files["assets/font.ttf"]),
        ),
        ("docs/big.md", "large_unreferenced", len(files["docs/big.md"])),
    ]
    assert omitted["files"][2]["git_oid"] == _git(
        root, "rev-parse", f"{base}:assets/font.ttf"
    )
    # what the Run produced is not kept
    assert "report.pdf" not in _tree(workspace)
    assert sorted(p.name for p in (saved.path / "solution").iterdir()) == [
        "solve.sh"
    ]


def test_a_run_that_only_touched_caches_changed_nothing(tmp_path):
    root = tmp_path / "space"
    (root / "__pycache__").mkdir(parents=True)
    _git(root, "init", "-q")
    (root / "main.py").write_text("print(1)\n")
    (root / "__pycache__" / "main.pyc").write_bytes(b"\x00a")
    base = _commit(root, "before")
    (root / "__pycache__" / "main.pyc").write_bytes(b"\x00b")
    target = _commit(root, "after")
    hooks = tmp_path / "hooks"
    hooks.mkdir()

    with pytest.raises(HarborTaskUnavailable) as raised:
        save_harbor_task(
            git=GitBackend(hooks_path=hooks),
            repository_root=root,
            source=HarborTaskSource(
                run_id="run-1",
                project_id="project-1",
                repository_id="repo-1",
                base_commit=base,
                target_commit=target,
            ),
            instruction=HarborTaskInstruction(text="Task\n"),
            reference_text="",
            destination_root=tmp_path / "tasks",
        )
    assert raised.value.reason == "run_changed_no_files"


def test_files_other_sessions_wrote_are_left_out_unless_this_task_used_them(
    tmp_path,
):
    root = tmp_path / "space"
    root.mkdir()
    _git(root, "init", "-q")

    def write(**files):
        for relative, text in files.items():
            (root / relative).write_text(text, encoding="utf-8")

    write(**{"brief.md": "the user's own brief\n"})
    start = _commit(root, "the user adds a brief")
    write(
        **{
            "aero-lab.html": "<p>another Session's page</p>\n",
            "notes.txt": "another Session's notes\n",
            "style.css": "body {}\n",
        }
    )
    other = _commit(root, "a Task in another Session")
    write(**{"draft.html": "<p>an earlier Task in this Session</p>\n"})
    same = _commit(root, "an earlier Task in this Session")
    write(**{"notes.txt": "the user edited them since\n"})
    edited = _commit(root, "the user edits the notes")
    write(**{"used.csv": "a,b\n"})
    used = _commit(root, "another Session again")
    write(**{"bike.html": "<p>this Task</p>\n", "style.css": "body {x}\n"})
    target = _commit(root, "this Task")
    hooks = tmp_path / "hooks"
    hooks.mkdir()

    saved = save_harbor_task(
        git=GitBackend(hooks_path=hooks),
        repository_root=root,
        source=HarborTaskSource(
            run_id="run-1",
            project_id="project-1",
            repository_id="repo-1",
            base_commit=used,
            target_commit=target,
        ),
        instruction=HarborTaskInstruction(text="Make a bike page\n"),
        # a directory listing names every file; it is no use to the Task
        reference_text="aero-lab.html brief.md draft.html notes.txt used.csv",
        destination_root=tmp_path / "tasks",
        earlier=(  # newest first, as earlier_runs gives them
            EarlierRun("project-2", edited, used),
            EarlierRun("project-1", other, same),
            EarlierRun("project-2", start, other),
            EarlierRun("project-2", "c" * 40, "d" * 40),  # gone: skipped
        ),
        request_text=f"Make a bike page from {root}/used.csv",
    )

    # kept: the user's files (notes.txt was edited after another Session
    # wrote it), this Session's, the file the request names and the one
    # this Task changed
    workspace = saved.path / "environment" / "workspace"
    assert sorted(_tree(workspace)) == [
        "brief.md",
        "draft.html",
        "notes.txt",
        "style.css",
        "used.csv",
    ]
    omitted = json.loads(
        (saved.path / "environment" / "omitted_files.json").read_text()
    )
    assert [(item["path"], item["reason"]) for item in omitted["files"]] == [
        ("aero-lab.html", "other_session_output")
    ]


def test_request_text_is_what_the_user_and_the_tool_calls_named():
    journal = _Journal(
        events=[
            _event("Use data.csv"),
            SimpleNamespace(
                event_type="tool.dispatched",
                created_at=2.0,
                payload={"request": {"file_path": "/space/style.css"}},
            ),
            SimpleNamespace(
                event_type="tool.completed",
                created_at=3.0,
                payload={
                    "request": {"command": "ls"},
                    "result": "aero-lab.html style.css",
                },
            ),
            SimpleNamespace(
                event_type="legacy.terminal",
                created_at=4.0,
                payload={"output": "aero-lab.html"},
            ),
        ]
    )

    text = run_request_text(journal, "run-1")

    assert "data.csv" in text and "/space/style.css" in text
    assert "aero-lab.html" not in text


def test_earlier_runs_are_this_repository_s_before_this_run_newest_first():
    def record(run_id, created_at, *, repository="repo-1", base="1", end="2"):
        return SimpleNamespace(
            run_id=run_id,
            project_id=f"session-{run_id}",
            repository_id=repository,
            workspace_base_commit=base,
            promoted_commit=end,
            created_at=created_at,
        )

    records = [
        record("old", 1.0, base="a", end="b"),
        record("newer", 2.0, base="b", end="c"),
        record("elsewhere", 2.5, repository="repo-2"),
        record("unchanged", 2.6, end="1"),
        record("unfinished", 2.7, end=None),
        record("run-1", 3.0),
        record("later", 4.0),
    ]
    journal = _Journal()
    journal.materialization = records[5]
    journal.list_run_git_materializations = lambda: records
    source = resolve_harbor_task_source(journal, "run-1")

    assert earlier_runs(journal, source) == (
        EarlierRun("session-newer", "b", "c"),
        EarlierRun("session-old", "a", "b"),
    )
