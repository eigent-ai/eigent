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
