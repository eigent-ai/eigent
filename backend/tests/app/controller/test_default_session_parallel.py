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

"""Ordinary /chat admission with a fully registered, isolated Space.

The execution probe replaces model I/O only after the production writer gate.
These are synthetic scheduling tests, not model/tool or installed-app E2E.
"""

import asyncio
import json
import logging
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.controller import chat_controller as chat
from app.model.chat import Chat
from app.run_context import get_current_run_context
from app.run_journal import SQLiteRunJournal
from app.run_journal.runtime import run_journal_scope
from app.run_runtime import RunCoordinator, admission as activation
from app.service.task import TaskLock
from app.utils import workspace_resolver
from app.workspace_git import GitBackend, WorkspaceGitCoordinator
from app.workspace_runtime.bound_runtime import RuntimeBinding
from app.workspace_runtime.native_runtime import NativeAgentRuntime
from app.workspace_runtime.ordinary import finalize_ordinary_workspace


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "execution_mode", ["probe", "factory", "factory-stop"]
)
@pytest.mark.parametrize(
    "registered_git,cross_space",
    [(True, False), (False, False), (True, True), (False, True)],
)
async def test_registered_space_ordinary_sessions_execute_in_parallel(
    tmp_path, monkeypatch, execution_mode, registered_git, cross_space
):
    root = tmp_path / "space"
    root.mkdir()
    second_root = tmp_path / "second-space" if cross_space else root
    second_root.mkdir(exist_ok=True)
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    store = workspace_resolver.WorkspaceStore()
    monkeypatch.setattr(
        store, "_state_roots", lambda *_: (tmp_path / "state",)
    )
    resolver = workspace_resolver.WorkspaceResolver(store)
    store.save_binding("synthetic@example.test", "space-1", str(root))
    if cross_space:
        store.save_binding(
            "synthetic@example.test", "space-2", str(second_root)
        )
    monkeypatch.setattr(
        workspace_resolver,
        "run_output_root",
        lambda _email, _space, _project, task, _user: (
            tmp_path / "outputs" / task
        ),
    )
    locks = {}
    from app.service import task as task_module

    monkeypatch.setattr(task_module, "task_locks", locks)

    def task_lock(project):
        return locks.setdefault(
            project, TaskLock(project, asyncio.Queue(), {})
        )

    with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
        git = WorkspaceGitCoordinator(
            journal,
            state_root=tmp_path / "git-state",
            git_backend=GitBackend(hooks_path=hooks),
        )
        for index, source in (
            ((1, root), (2, second_root)) if cross_space else ((1, root),)
        ):
            if registered_git:
                git.content.bootstrap(
                    space_id=f"space-{index}",
                    space_root=source,
                    allow_init=True,
                )
            (source / "seed.txt").write_text("base\n")
            if registered_git:
                git.git.commit_paths(
                    source, (source / "seed.txt",), message="seed"
                )
            else:
                assert not (source / ".git").exists()
        repository = journal.get_space_git_repository(space_id="space-1")
        assert (repository is not None) is registered_git
        assert (
            store.get_binding("synthetic@example.test", "space-1") is not None
        )

        coordinator = RunCoordinator(journal=journal)
        entered = {key: asyncio.Event() for key in ("run-1", "run-2")}
        release = {key: asyncio.Event() for key in entered}
        observed = {}

        async def execution_probe(options, _request, lock):
            item = await lock.get_queue()
            assert await activation.activate_improve_admission(
                lock,
                item,
                project_id=options.project_id,
                logger=logging.getLogger(__name__),
            )
            workspace = lock.ordinary_workspace

            async def close():
                pass

            runtime = NativeAgentRuntime(
                RuntimeBinding(
                    options.task_id,
                    item.attempt_id,
                    1,
                    workspace.handle,
                    lock.environment_spec_id,
                    {},
                ),
                stop_resources=close,
            )

            async def model_probe(_runtime):
                context = get_current_run_context()
                observed[options.task_id] = Path(context.working_directory)
                entered[options.task_id].set()
                await release[options.task_id].wait()
                (
                    context.working_directory / (options.task_id + ".txt")
                ).write_text(options.task_id)
                return "probe completed"

            result = await runtime.run(model_probe)
            await finalize_ordinary_workspace(
                journal, workspace, runtime, result, "completed"
            )
            yield 'data: {"step":"probe-finished"}\n\n'

        monkeypatch.setattr(chat, "get_default_run_journal", lambda: journal)
        monkeypatch.setattr(
            chat, "get_default_run_coordinator", lambda: coordinator
        )
        monkeypatch.setattr(
            chat, "get_default_workspace_git_coordinator", lambda: git
        )
        monkeypatch.setattr(
            activation, "get_default_workspace_git_coordinator", lambda: git
        )
        monkeypatch.setattr(chat, "get_workspace_resolver", lambda: resolver)
        monkeypatch.setattr(chat, "get_or_create_task_lock", task_lock)
        monkeypatch.setattr(chat, "get_task_lock_if_exists", locks.get)
        monkeypatch.setattr(chat, "set_current_task_id", lambda *_: None)
        monkeypatch.setattr(
            chat,
            "_prepare_browser_for_request_with_timeout",
            AsyncMock(return_value=False),
        )
        monkeypatch.setattr(
            chat, "_assemble_runtime_environment", lambda *_: None
        )
        monkeypatch.setattr(
            chat, "_camel_log_dir", lambda *_: tmp_path / "logs"
        )
        monkeypatch.setattr(chat, "load_dotenv", lambda **_: None)
        monkeypatch.setattr(
            chat, "apply_run_env_for_third_party", lambda *_: None
        )
        if execution_mode == "probe":
            monkeypatch.setattr(chat, "step_solve", execution_probe)
        else:
            from camel.utils import token_counting
            from openai.resources.responses import AsyncResponses
            from tiktoken import Encoding

            from app.service.single_agent_service import single_agent_solve

            encoding = Encoding(
                "synthetic-bytes",
                pat_str=r"(?s).",
                mergeable_ranks={bytes([i]): i for i in range(256)},
                special_tokens={},
            )
            monkeypatch.setattr(
                token_counting, "get_model_encoding", lambda _: encoding
            )
            counts = {}

            async def responses(_client, **kwargs):
                context = get_current_run_context()
                run_id = context.run_id
                counts[run_id] = counts.get(run_id, 0) + 1
                assert kwargs["model"] == "gpt-6-astra"
                if counts[run_id] == 1:
                    tools = {tool["name"] for tool in kwargs["tools"]}
                    assert {
                        "shell_exec",
                        "write_to_file",
                        "browser_visit_page",
                    } <= tools
                    observed[run_id] = context.working_directory
                    entered[run_id].set()
                    await release[run_id].wait()
                    command = f"printf {run_id} > {run_id}.txt"
                    if execution_mode == "factory-stop" and run_id == "run-1":
                        command += f"; sleep 30; printf late >> {run_id}.txt"
                    output = [
                        {
                            "type": "function_call",
                            "id": "fc-" + run_id,
                            "call_id": "call-" + run_id,
                            "name": "shell_exec",
                            "arguments": json.dumps(
                                {"command": command, "block": True}
                            ),
                            "status": "completed",
                        }
                    ]
                elif counts[run_id] == 2:
                    source = context.workspace_source_root
                    output = [
                        {
                            "type": "function_call",
                            "id": "file-" + run_id,
                            "call_id": "file-call-" + run_id,
                            "name": "write_to_file",
                            "arguments": json.dumps(
                                {
                                    "title": "Saved output",
                                    "content": run_id,
                                    "filename": str(
                                        source / (run_id + ".txt")
                                    ),
                                }
                            ),
                            "status": "completed",
                        }
                    ]
                else:
                    assert not (
                        context.workspace_source_root / (run_id + ".txt")
                    ).exists()
                    output = [
                        {
                            "type": "message",
                            "role": "assistant",
                            "id": "msg-" + run_id,
                            "content": [
                                {
                                    "type": "output_text",
                                    "text": "Synthetic task completed",
                                    "annotations": [],
                                }
                            ],
                        }
                    ]
                return {
                    "id": f"response-{run_id}-{counts[run_id]}",
                    "output": output,
                    "created_at": 0,
                    "status": "completed",
                    "usage": {
                        "input_tokens": 10,
                        "output_tokens": 10,
                        "total_tokens": 20,
                    },
                }

            monkeypatch.setattr(AsyncResponses, "create", responses)
            monkeypatch.setattr(chat, "step_solve", single_agent_solve)

        async def finished(run_id):
            if execution_mode == "probe":
                await (await coordinator.get_handle(run_id)).wait()
            else:
                for _ in range(500):
                    for approval in journal.list_approvals(
                        run_id, pending_only=True
                    ):
                        # Simulate the user's exact once-only Terminal grant.
                        # Keep the ordinary default permission profile intact.
                        assert approval.prompt["tool_name"] in {
                            "shell_exec",
                            "write_to_file",
                        }
                        lock = locks[journal.get_run(run_id).project_id]
                        if not lock.human_input_waiters.get(
                            approval.prompt["agent"]
                        ):
                            continue
                        journal.decide_approval(
                            approval.approval_id,
                            decision="approved",
                            expected_version=approval.version,
                            action_digest=approval.action_digest,
                            continue_active_attempt=True,
                        )
                        await lock.put_human_input(
                            approval.prompt["agent"], {"decision": "approved"}
                        )
                    if (
                        journal.get_run(run_id).status == "completed"
                        and locks[
                            journal.get_run(run_id).project_id
                        ].status.value
                        == "done"
                    ):
                        return
                    await asyncio.sleep(0.01)
                raise AssertionError(
                    f"ordinary Run failed to complete: {journal.get_run(run_id).status}"
                )

        streams = []
        try:
            with run_journal_scope(journal):
                for index in (1, 2):
                    options = Chat(
                        **{
                            "question": "Synthetic execution probe",
                            "model_type": "gpt-6-astra",
                            "model_platform": "openai",
                            "extra_params": {
                                "api_mode": "responses",
                                "stream": False,
                            },
                            "api_key": "synthetic-key",
                            "api_url": "https://synthetic.test/v1",
                            "env_path": "",
                            "new_agents": [],
                            "email": "synthetic@example.test",
                            "space_id": f"space-{index}"
                            if cross_space
                            else "space-1",
                            "project_id": f"session-{index}",
                            "task_id": f"run-{index}",
                            "run_id": f"run-{index}",
                            "session_mode": "single-agent",
                        }
                    )
                    streams.append(
                        await chat.start_chat_stream(
                            options,
                            SimpleNamespace(
                                state=SimpleNamespace(), headers={}
                            ),
                        )
                    )
                await asyncio.wait_for(entered["run-1"].wait(), 5)
                await asyncio.wait_for(entered["run-2"].wait(), 5)
                first = journal.get_project_workspace_binding("session-1")
                second = journal.get_project_workspace_binding("session-2")
                if registered_git:
                    assert first is not None and second is not None
                    assert (first.repository_id == second.repository_id) is (
                        not cross_space
                    )
                    assert (first.checkout_id == second.checkout_id) is (
                        not cross_space
                    )
                    assert first.repository_id == repository.repository_id
                    assert first.worktree_path == str(root)
                    assert second.worktree_path == str(second_root)
                else:
                    assert first is None and second is None
                writer = journal.get_workspace_writer_request(
                    "workspace-writer:run-2"
                )
                assert writer is None
                assert observed["run-1"] != observed["run-2"]
                assert all(path != root for path in observed.values())
                assert not release["run-1"].is_set()
                assert journal.get_run("run-1").status == "running"
                if execution_mode == "factory-stop":
                    release["run-1"].set()
                    grants = asyncio.create_task(finished("run-1"))
                    try:
                        async with asyncio.timeout(5):
                            while not (
                                observed["run-1"] / "run-1.txt"
                            ).exists():
                                await asyncio.sleep(0.01)
                        cancelled = await asyncio.wait_for(
                            coordinator.cancel_durable(
                                "run-1",
                                request_id="stop-run-1",
                                reason="user_stop",
                            ),
                            10,
                        )
                        assert cancelled.status == "cancelled"
                    finally:
                        grants.cancel()
                        await asyncio.gather(grants, return_exceptions=True)
                    assert (
                        observed["run-1"] / "run-1.txt"
                    ).read_text() == "run-1"
                    assert not (root / "run-1.txt").exists()
                    assert journal.get_run("run-2").status == "running"
                    release["run-2"].set()
                    await finished("run-2")
                    assert (second_root / "run-2.txt").read_text() == "run-2"
                    (tmp_path / "smoke-observations.json").write_text(
                        json.dumps(
                            {
                                "execution": execution_mode,
                                "registered_git": registered_git,
                                "cross_space": cross_space,
                                "real_model_io": False,
                                "cancelled_terminal_settled": True,
                                "peer_completed": True,
                            },
                            indent=2,
                        )
                        + "\n"
                    )
                    return
                if execution_mode == "factory":
                    from fastapi import HTTPException

                    from app.model.chat import SupplementChat

                    prior_context = locks["session-1"].run_context
                    with pytest.raises(HTTPException) as busy:
                        await chat.improve(
                            "session-1",
                            SupplementChat(
                                question="Next FIFO message",
                                task_id="run-3",
                            ),
                            SimpleNamespace(
                                state=SimpleNamespace(), headers={}
                            ),
                        )
                    assert busy.value.status_code == 409
                    assert locks["session-1"].run_context is prior_context
                    assert journal.get_run("run-3") is None
                release["run-2"].set()
                await finished("run-2")
                assert (second_root / "run-2.txt").read_text() == "run-2"
                assert not (root / "run-1.txt").exists()
                release["run-1"].set()
                await finished("run-1")
                assert (root / "run-1.txt").read_text() == "run-1"
                from app.controller import (
                    run_controller,
                    workspace_git_controller,
                )
                from app.workspace_runtime.finalizer import WorkspaceFinalizer
                from app.workspace_runtime.ordinary import ordinary_provider

                monkeypatch.setattr(
                    workspace_git_controller, "_service", lambda: git.content
                )
                monkeypatch.setattr(
                    workspace_git_controller, "_binding_root", lambda **_: root
                )
                monkeypatch.setattr(
                    run_controller, "get_default_run_journal", lambda: journal
                )
                saved = WorkspaceFinalizer(journal).artifact_manifest(
                    run_id="run-1", provider=ordinary_provider(journal)
                )
                artifact = saved["artifacts"][0]
                (root / "run-1.txt").write_text("later change in Space")
                preview = await run_controller.ordinary_artifact_content(
                    "run-1", artifact["artifact_id"]
                )
                assert preview.body == b"run-1"
                if registered_git:
                    changes = await workspace_git_controller.run_git_changes(
                        "run-1",
                        space_id="space-1",
                        email="synthetic@example.test",
                        user_id=None,
                    )
                    assert {item["path"] for item in changes["files"]} == {
                        item["relativePath"] for item in saved["artifacts"]
                    }
                    review = (
                        await workspace_git_controller.run_git_change_content(
                            "run-1",
                            path="run-1.txt",
                            base_commit=changes["base_commit"],
                            target_commit=changes["target_commit"],
                            space_id="space-1",
                            email="synthetic@example.test",
                            user_id=None,
                        )
                    )
                    assert review["after"]["content"] == "run-1"
                if execution_mode == "factory":
                    entered["run-3"] = asyncio.Event()
                    release["run-3"] = asyncio.Event()
                    response = await chat.improve(
                        "session-1",
                        SupplementChat(
                            question="Next FIFO message",
                            task_id="run-3",
                        ),
                        SimpleNamespace(state=SimpleNamespace(), headers={}),
                    )
                    assert response.status_code == 201
                    await asyncio.wait_for(entered["run-3"].wait(), 5)
                    assert observed["run-3"] not in {
                        observed["run-1"],
                        observed["run-2"],
                        root,
                    }
                    assert (
                        journal.get_active_project_run("session-1").run_id
                        == "run-3"
                    )
                    release["run-3"].set()
                    await finished("run-3")
                    assert (root / "run-3.txt").read_text() == "run-3"
                (tmp_path / "smoke-observations.json").write_text(
                    json.dumps(
                        {
                            "execution": execution_mode,
                            "registered_git": registered_git,
                            "cross_space": cross_space,
                            "default_permissions": True,
                            "real_model_io": False,
                            "sdk_transport": "responses"
                            if execution_mode == "factory"
                            else None,
                            "model": "gpt-6-astra"
                            if execution_mode == "factory"
                            else None,
                            "real_terminal": execution_mode == "factory",
                            "real_file_write_with_source_absolute_path": execution_mode
                            == "factory",
                            "both_entered_before_first_release": True,
                            "working_directories": {
                                key: str(value)
                                for key, value in observed.items()
                            },
                            "saved_artifact_survives_target_edit": True,
                            "git_review_survives_target_edit": registered_git,
                        },
                        indent=2,
                    )
                    + "\n"
                )
        finally:
            for gate in release.values():
                gate.set()
            for stream in streams:
                await stream.aclose()
            await coordinator.close()
