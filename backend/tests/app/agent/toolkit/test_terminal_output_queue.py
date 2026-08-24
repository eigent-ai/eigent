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

from unittest.mock import MagicMock

import app.agent.toolkit.terminal_toolkit as terminal_toolkit_module
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.service.task import Action, process_task


def test_terminal_output_uses_threadsafe_tasklock_queue(monkeypatch):
    """Terminal output must not leave a coroutine owned by a worker thread."""
    task_lock = MagicMock()
    safe_put_queue = MagicMock()
    monkeypatch.setattr(
        terminal_toolkit_module,
        "get_task_lock",
        lambda _task_id: task_lock,
    )
    monkeypatch.setattr(
        terminal_toolkit_module,
        "_safe_put_queue",
        safe_put_queue,
    )
    toolkit = object.__new__(TerminalToolkit)
    toolkit.api_task_id = "project-1"
    token = process_task.set("subtask-1")

    try:
        toolkit._update_terminal_output("hello")
    finally:
        process_task.reset(token)

    safe_put_queue.assert_called_once()
    assert safe_put_queue.call_args.args[0] is task_lock
    event = safe_put_queue.call_args.args[1]
    assert event.action == Action.terminal
    assert event.process_task_id == "subtask-1"
    assert event.data == "hello"
    task_lock.put_queue.assert_not_called()
