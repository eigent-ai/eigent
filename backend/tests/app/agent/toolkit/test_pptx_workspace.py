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

from camel.toolkits import PPTXToolkit as BasePPTXToolkit

from app.agent.toolkit import pptx_toolkit
from app.agent.toolkit.pptx_toolkit import PPTXToolkit
from app.run_context import RunContext, run_context_scope
from app.service.task import ActionWriteFileData
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


def test_pptx_toolkit_emits_safe_relative_path(tmp_path, monkeypatch):
    root = tmp_path / "run"
    root.mkdir()
    emitted: list[ActionWriteFileData] = []

    def fake_create_presentation(self, _content, filename, _template=None):
        path = self._resolve_filepath(filename)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"pptx")
        return f"PowerPoint presentation successfully created: {path}"

    monkeypatch.setattr(
        BasePPTXToolkit,
        "create_presentation",
        fake_create_presentation,
    )
    monkeypatch.setattr(
        pptx_toolkit,
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
        pptx_toolkit,
        "_safe_put_queue",
        lambda _lock, event: emitted.append(event),
    )
    toolkit = PPTXToolkit("project-1", working_directory=str(root))

    with run_context_scope(_context(root)):
        result = toolkit.create_presentation("# Slides", "decks/briefing")

    expected_path = root / "decks" / "briefing.pptx"
    assert result == (
        f"PowerPoint presentation successfully created: {expected_path}"
    )
    assert len(emitted) == 1
    assert emitted[0].data == str(expected_path)
    assert emitted[0].relative_path == "decks/briefing.pptx"
