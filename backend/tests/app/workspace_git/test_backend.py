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

import os
import subprocess
from pathlib import Path

import pytest

from app.workspace_git import GitBackend


@pytest.mark.parametrize(
    "filename",
    [
        "report.md",
        "my report.md",
        "报告.md",
        pytest.param(
            "tab\tname.md",
            marks=pytest.mark.skipif(
                os.name == "nt", reason="Windows forbids tabs in filenames"
            ),
        ),
        pytest.param(
            "line\nname.md",
            marks=pytest.mark.skipif(
                os.name == "nt", reason="Windows forbids newlines in filenames"
            ),
        ),
        pytest.param(
            "carriage\rname.md",
            marks=pytest.mark.skipif(
                os.name == "nt", reason="Windows forbids newlines in filenames"
            ),
        ),
        pytest.param(
            "crlf\r\nname.md",
            marks=pytest.mark.skipif(
                os.name == "nt", reason="Windows forbids newlines in filenames"
            ),
        ),
    ],
)
def test_path_status_preserves_filenames(tmp_path: Path, filename: str):
    backend = GitBackend()
    backend.init_repository(tmp_path)
    target = tmp_path / filename
    target.write_text("baseline\n", encoding="utf-8")

    assert backend.path_status(tmp_path, (target,)) == {filename: "??"}
    backend.commit_paths(tmp_path, (target,), message="baseline")
    assert backend.path_status(tmp_path, (target,)) == {}

    target.write_text("changed\n", encoding="utf-8")
    assert backend.path_status(tmp_path, (target,)) == {filename: " M"}
    assert backend.changed_paths(tmp_path, (target,)) == (filename,)


def test_path_status_consumes_rename_source_before_next_record(tmp_path: Path):
    backend = GitBackend()
    backend.init_repository(tmp_path)
    source = tmp_path / "old report.md"
    target = tmp_path / "new report.md"
    other = tmp_path / "z-other.md"
    source.write_text("renamed content\n", encoding="utf-8")
    other.write_text("baseline\n", encoding="utf-8")
    backend.commit_paths(tmp_path, (source, other), message="baseline")
    backend.run_advanced_argv(tmp_path, ("mv", "--", source.name, target.name))
    other.write_text("changed\n", encoding="utf-8")

    assert backend.path_status(tmp_path, (source, target, other)) == {
        "new report.md": "R ",
        "z-other.md": " M",
    }


def test_path_status_decodes_utf8_independently_of_locale(
    tmp_path: Path, monkeypatch
):
    backend = GitBackend()
    backend.init_repository(tmp_path)
    target = tmp_path / "报告.md"
    target.write_text("content\n", encoding="utf-8")
    # Model Python 3.11's default subprocess decoding on Windows, while
    # keeping the real Git command and its raw UTF-8 filename output.
    monkeypatch.setattr(subprocess, "_text_encoding", lambda: "cp1252")

    assert backend.path_status(tmp_path, (target,)) == {"报告.md": "??"}


def test_init_repository_owns_non_ascii_root_under_legacy_locale(
    tmp_path: Path, monkeypatch
):
    # A Windows profile such as C:\Users\Алексей with a cp1251 locale: Git
    # prints the repository root as UTF-8, which must not be decoded with
    # the locale codec or the ownership check compares two different paths.
    monkeypatch.setattr(subprocess, "_text_encoding", lambda: "cp1251")
    root = tmp_path / "Алексей" / "eigent" / "Space"
    backend = GitBackend()

    probe = backend.init_repository(root)

    assert probe.is_repository
    assert probe.owns_requested_root
    assert probe.repository_root == root.resolve()
    assert backend.probe(root).owns_requested_root


def test_commit_paths_lists_non_ascii_filenames_unquoted(
    tmp_path: Path, monkeypatch
):
    monkeypatch.setattr(subprocess, "_text_encoding", lambda: "cp1252")
    root = tmp_path / "Алексей"
    backend = GitBackend()
    backend.init_repository(root)
    target = root / "отчёт.md"
    target.write_text("content\n", encoding="utf-8")

    commit = backend.commit_paths(root, (target,), message="baseline")

    assert backend.show_commit_paths(root, commit) == ("отчёт.md",)


def test_ignored_paths_sends_non_ascii_names_as_utf8(
    tmp_path: Path, monkeypatch
):
    # cp1251 cannot encode 报告, and encodes Алексей to bytes Git does not
    # read as the same name. Paths on Git's stdin must always be UTF-8.
    monkeypatch.setattr(subprocess, "_text_encoding", lambda: "cp1251")
    backend = GitBackend()
    backend.init_repository(tmp_path)
    (tmp_path / ".gitignore").write_text(
        "Алексей.log\n报告.tmp\n", encoding="utf-8"
    )

    assert backend.ignored_paths(
        tmp_path, ("Алексей.log", "报告.tmp", "отчёт.md")
    ) == {"Алексей.log", "报告.tmp"}


def test_tree_names_that_are_not_utf8_round_trip(tmp_path: Path):
    # A Linux file name may hold bytes that are not UTF-8. Reading it from
    # Git and writing it back must keep the same name, not U+FFFD.
    backend = GitBackend()
    backend.init_repository(tmp_path)
    blob = subprocess.run(
        [
            backend.git_executable,
            "-C",
            str(tmp_path),
            "hash-object",
            "-w",
            "--stdin",
        ],
        input=b"content\n",
        capture_output=True,
        check=True,
    ).stdout.strip()
    tree = (
        subprocess.run(
            [backend.git_executable, "-C", str(tmp_path), "mktree", "-z"],
            input=b"100644 blob " + blob + b"\tcaf\xe9.md\0",
            capture_output=True,
            check=True,
        )
        .stdout.strip()
        .decode("ascii")
    )

    listing = backend._run(tmp_path, ("ls-tree", "-z", tree)).stdout
    rebuilt = backend._run(
        tmp_path, ("mktree", "-z"), input_text=listing
    ).stdout.strip()

    assert rebuilt == tree
