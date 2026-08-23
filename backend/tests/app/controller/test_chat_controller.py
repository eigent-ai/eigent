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

import asyncio
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import Response
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.controller.chat_controller import (
    _admission_request_id,
    _classify_persisted_admission,
    _prepare_browser_for_request,
    _prepare_chat_run,
    _PreparedChatRun,
    _require_supported_bundle_session_mode,
    human_reply,
    improve,
    install_mcp,
    post,
    start_chat_stream,
    status,
    stop,
    supplement,
)
from app.exception.exception import UserException
from app.model.chat import Chat, HumanReply, McpServers, Status, SupplementChat
from app.run_context import RunContext
from app.run_journal import InvalidRunTransitionError, SQLiteRunJournal
from app.run_runtime import RunCoordinator
from app.workspace_bundle.runtime import EnvironmentSetupRequiredError


@pytest.fixture(autouse=True)
def controller_run_journal():
    journal = MagicMock()
    journal.get_run.return_value = None
    journal.create_run_attempt.return_value = SimpleNamespace(
        attempt_id="attempt-1", status="pending"
    )
    journal.list_run_attempts.return_value = []
    journal.create_run_attempt.return_value = SimpleNamespace(
        attempt_id="attempt-1",
        status="pending",
    )
    with patch(
        "app.controller.chat_controller.get_default_run_journal",
        return_value=journal,
    ):
        yield journal


@pytest.mark.unit
class TestChatController:
    """Test cases for chat controller endpoints."""

    @pytest.mark.asyncio
    async def test_electron_browser_uses_owned_embedded_target_only(
        self, mock_request
    ):
        mock_request.state = SimpleNamespace()
        with (
            patch.dict(
                os.environ,
                {
                    "EIGENT_RUNTIME": "electron",
                    "EIGENT_ELECTRON_CDP_PORT": "9333",
                },
                clear=True,
            ),
            patch(
                "app.controller.chat_controller.has_eigent_embedded_browser_target",
                return_value=True,
            ) as mock_owned_target,
            patch(
                "app.controller.chat_controller.ensure_cdp_browser_endpoint"
            ) as mock_external_launcher,
        ):
            assert await _prepare_browser_for_request(
                mock_request,
                9222,
                "about:blank#eigent-browser-toolkit=7",
            )

        assert mock_request.state.cdp_url == "http://127.0.0.1:9333"
        assert mock_request.state.browser_port == 9333
        assert mock_request.state.browser_available is True
        mock_owned_target.assert_called_once_with(
            "http://127.0.0.1:9333",
            "about:blank#eigent-browser-toolkit=7",
        )
        mock_external_launcher.assert_not_called()

    @pytest.mark.asyncio
    async def test_electron_browser_does_not_fallback_to_external_browser(
        self, mock_request
    ):
        mock_request.state = SimpleNamespace()
        with (
            patch.dict(
                os.environ,
                {"EIGENT_RUNTIME": "electron"},
                clear=True,
            ),
            patch(
                "app.controller.chat_controller.is_cdp_url_available",
                return_value=True,
            ),
            patch(
                "app.controller.chat_controller.has_eigent_embedded_browser_target",
                return_value=False,
            ),
            patch(
                "app.controller.chat_controller.ensure_cdp_browser_endpoint"
            ) as mock_external_launcher,
        ):
            assert not await _prepare_browser_for_request(mock_request, 9222)

        assert mock_request.state.cdp_url is None
        assert mock_request.state.browser_available is False
        mock_external_launcher.assert_not_called()

    @pytest.mark.asyncio
    async def test_standalone_brain_retains_external_browser_fallback(
        self, mock_request
    ):
        mock_request.state = SimpleNamespace()
        with (
            patch.dict(os.environ, {}, clear=True),
            patch(
                "app.controller.chat_controller.is_cdp_url_available",
                return_value=False,
            ),
            patch(
                "app.controller.chat_controller.ensure_cdp_browser_endpoint",
                return_value="http://127.0.0.1:9444",
            ) as mock_external_launcher,
        ):
            assert await _prepare_browser_for_request(mock_request, 9222)

        assert mock_request.state.cdp_url == "http://127.0.0.1:9444"
        assert mock_request.state.browser_port == 9444
        mock_external_launcher.assert_called_once_with(9222)

    @pytest.mark.asyncio
    async def test_post_chat_endpoint_success(
        self,
        sample_chat_data,
        mock_request,
        mock_task_lock,
        mock_environment_variables,
        controller_run_journal,
    ):
        """Test successful chat initialization."""
        chat_data = Chat(**sample_chat_data)

        with (
            patch(
                "app.controller.chat_controller.get_or_create_task_lock",
                return_value=mock_task_lock,
            ),
            patch(
                "app.controller.chat_controller.step_solve"
            ) as mock_step_solve,
            patch("app.controller.chat_controller.load_dotenv"),
            patch("app.controller.chat_controller.set_current_task_id"),
            patch(
                "app.controller.chat_controller._prepare_browser_for_request_with_timeout",
                new=AsyncMock(return_value=True),
            ),
            patch("pathlib.Path.mkdir"),
            patch("pathlib.Path.home", return_value=MagicMock()),
        ):
            # Mock async generator
            async def mock_generator():
                yield "data: test_response\n\n"
                yield "data: test_response_2\n\n"

            mock_step_solve.return_value = mock_generator()

            response = await post(chat_data, mock_request)

            assert isinstance(response, StreamingResponse)
            assert response.media_type == "text/event-stream"
            controller_run_journal.ensure_run.assert_called_once_with(
                run_id=chat_data.run_id or chat_data.task_id,
                project_id=chat_data.project_id,
                status="pending",
            )

    @pytest.mark.asyncio
    async def test_duplicate_chat_admission_attaches_without_repeating_setup(
        self, sample_chat_data, mock_request, mock_task_lock
    ):
        chat_data = Chat(**sample_chat_data)
        run_id = chat_data.run_id or chat_data.task_id
        run_context = SimpleNamespace(run_id=run_id)
        mock_task_lock.run_context = run_context
        mock_task_lock.queue = asyncio.Queue()
        coordinator = RunCoordinator()
        release = asyncio.Event()

        async def source():
            await release.wait()
            yield "data: once\n\n"

        prepare = AsyncMock(
            return_value=_PreparedChatRun(
                task_lock=mock_task_lock,
                run_context=run_context,
                attempt_id="attempt-1",
                initial_action=MagicMock(),
            )
        )
        with (
            patch(
                "app.controller.chat_controller.get_default_run_coordinator",
                return_value=coordinator,
            ),
            patch(
                "app.controller.chat_controller._prepare_chat_run",
                new=prepare,
            ),
            patch(
                "app.controller.chat_controller.step_solve",
                side_effect=lambda *_args: source(),
            ) as execution,
        ):
            first_stream = await start_chat_stream(chat_data, mock_request)
            # Let the detached consumer enter the patched ExecutionBackend
            # before the patch scope can end.
            await asyncio.sleep(0)
            retry_stream = await start_chat_stream(chat_data, mock_request)

            handle = await coordinator.get_handle(run_id)
            assert handle is not None
            assert handle.subscriber_count == 2
            prepare.assert_awaited_once_with(
                chat_data,
                mock_request,
                admission_request_id=_admission_request_id(
                    run_id,
                    question=chat_data.question,
                    attaches=chat_data.attaches,
                    project_context=chat_data.project_context,
                ),
            )
            assert execution.call_count == 1

            first_next = asyncio.create_task(first_stream.__anext__())
            retry_next = asyncio.create_task(retry_stream.__anext__())
            release.set()
            assert await asyncio.gather(first_next, retry_next) == [
                "data: once\n\n",
                "data: once\n\n",
            ]
            await first_stream.aclose()
            await retry_stream.aclose()
            await coordinator.close()

    @pytest.mark.asyncio
    async def test_pending_partial_admission_is_retryable_but_reuse_conflicts(
        self, tmp_path
    ):
        run_id = "run-partial"
        request_id = _admission_request_id(
            run_id,
            question="original",
            attaches=[],
            project_context=None,
        )
        with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
            journal.ensure_run(
                run_id=run_id, project_id="project-1", status="pending"
            )
            journal.create_run_attempt(
                run_id,
                request_id=request_id,
                reason="initial_execution",
                activate=False,
            )

            retry, _attempt = await _classify_persisted_admission(
                journal,
                run_id=run_id,
                request_id=request_id,
            )
            conflict, _attempt = await _classify_persisted_admission(
                journal,
                run_id=run_id,
                request_id=_admission_request_id(
                    run_id,
                    question="different",
                    attaches=[],
                    project_context=None,
                ),
            )

        assert retry == "retry"
        assert conflict == "conflict"

    def test_review_handoff_ids_participate_in_admission_identity(self):
        common = {
            "run_id": "run-review",
            "question": "Apply review feedback",
            "attaches": [],
            "project_context": None,
        }

        first = _admission_request_id(
            **common,
            review_handoff_ids=["review-handoff-1"],
        )
        retry = _admission_request_id(
            **common,
            review_handoff_ids=["review-handoff-1"],
        )
        different = _admission_request_id(
            **common,
            review_handoff_ids=["review-handoff-2"],
        )

        assert retry == first
        assert different != first

    @pytest.mark.asyncio
    async def test_legacy_admission_without_fingerprint_is_replay_only(
        self, tmp_path
    ):
        run_id = "run-legacy-partial"
        with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
            journal.ensure_run(
                run_id=run_id, project_id="project-1", status="pending"
            )
            journal.create_run_attempt(
                run_id,
                request_id=f"initial:{run_id}",
                reason="initial_execution",
                activate=False,
            )

            admission, _attempt = await _classify_persisted_admission(
                journal,
                run_id=run_id,
                request_id=_admission_request_id(
                    run_id,
                    question="unverifiable payload",
                    attaches=[],
                    project_context=None,
                ),
            )

        assert admission == "duplicate"

    @pytest.mark.asyncio
    async def test_persisted_run_replays_without_implicit_restart(
        self,
        sample_chat_data,
        mock_request,
        controller_run_journal,
    ):
        chat_data = Chat(**sample_chat_data)
        run_id = chat_data.run_id or chat_data.task_id
        coordinator = RunCoordinator()
        controller_run_journal.get_run.return_value = SimpleNamespace(
            run_id=run_id,
            status="completed",
        )
        controller_run_journal.list_run_attempts.return_value = [
            SimpleNamespace(
                resume_request_id=_admission_request_id(
                    run_id,
                    question=chat_data.question,
                    attaches=chat_data.attaches,
                    project_context=chat_data.project_context,
                ),
                status="completed",
            )
        ]
        controller_run_journal.list_events.return_value = [
            SimpleNamespace(
                legacy_step="end",
                event_type="legacy.end",
                payload={"summary": "already finished"},
            )
        ]
        prepare = AsyncMock()

        with (
            patch(
                "app.controller.chat_controller.get_default_run_coordinator",
                return_value=coordinator,
            ),
            patch(
                "app.controller.chat_controller._prepare_chat_run",
                new=prepare,
            ),
        ):
            stream = await start_chat_stream(chat_data, mock_request)
            chunks = [chunk async for chunk in stream]

        prepare.assert_not_awaited()
        assert len(chunks) == 1
        assert '"step": "end"' in chunks[0]
        assert "already finished" in chunks[0]

    @pytest.mark.asyncio
    async def test_explicit_resume_creates_new_attempt_on_same_run(
        self,
        sample_chat_data,
        mock_request,
        mock_task_lock,
        tmp_path,
    ):
        run_id = sample_chat_data["task_id"]
        chat_data = Chat(
            **sample_chat_data,
            run_id=run_id,
            resume_request_id="resume-request-1",
        )
        coordinator = RunCoordinator()
        release = asyncio.Event()
        run_context = RunContext(
            space_id="space-1",
            project_id=chat_data.project_id,
            run_id=run_id,
            task_id=chat_data.task_id,
            email=chat_data.email,
            user_id=(
                str(chat_data.user_id)
                if chat_data.user_id is not None
                else None
            ),
            working_directory=tmp_path,
            task_output_root=tmp_path / "output",
            camel_log_dir=tmp_path / "camel-log",
            binding_source="test",
            workdir_mode=None,
            browser_port=chat_data.browser_port,
        )
        mock_task_lock.queue = asyncio.Queue()

        async def source():
            await release.wait()
            yield "data: resumed\n\n"

        with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
            journal.ensure_run(run_id=run_id, project_id=chat_data.project_id)
            first = journal.create_run_attempt(
                run_id,
                request_id="initial-request",
                reason="initial_execution",
                activate=True,
                now=1,
            )
            journal.reconcile_startup(now=2)
            prepare = AsyncMock(
                return_value=_PreparedChatRun(
                    task_lock=mock_task_lock,
                    run_context=run_context,
                    attempt_id="resume-attempt",
                    initial_action=MagicMock(),
                )
            )
            with (
                patch(
                    "app.controller.chat_controller.get_default_run_journal",
                    return_value=journal,
                ),
                patch(
                    "app.controller.chat_controller.get_default_run_coordinator",
                    return_value=coordinator,
                ),
                patch(
                    "app.controller.chat_controller._prepare_chat_run",
                    new=prepare,
                ),
                patch(
                    "app.controller.chat_controller.step_solve",
                    side_effect=lambda *_args: source(),
                ),
            ):
                stream = await start_chat_stream(chat_data, mock_request)
                attempts = journal.list_run_attempts(run_id)
                assert len(attempts) == 2
                assert attempts[0].attempt_id == first.attempt_id
                assert attempts[1].attempt_number == 2
                assert attempts[1].resume_reason == "explicit_resume"
                assert attempts[1].resume_request_id == "resume-request-1"
                prepare.assert_awaited_once()
                assert prepare.await_args.kwargs[
                    "resume_attempt"
                ].attempt_id == (attempts[1].attempt_id)

                release.set()
                assert await stream.__anext__() == "data: resumed\n\n"
                await stream.aclose()
        await coordinator.close()

    @pytest.mark.asyncio
    async def test_resume_setup_failure_returns_run_to_interrupted(
        self,
        sample_chat_data,
        mock_request,
        tmp_path,
    ):
        run_id = sample_chat_data["task_id"]
        chat_data = Chat(
            **sample_chat_data,
            run_id=run_id,
            resume_request_id="resume-request-fails",
        )
        coordinator = RunCoordinator()
        with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
            journal.ensure_run(run_id=run_id, project_id=chat_data.project_id)
            journal.create_run_attempt(
                run_id,
                request_id="initial-request",
                reason="initial_execution",
                activate=True,
                now=1,
            )
            journal.reconcile_startup(now=2)
            with (
                patch(
                    "app.controller.chat_controller.get_default_run_journal",
                    return_value=journal,
                ),
                patch(
                    "app.controller.chat_controller.get_default_run_coordinator",
                    return_value=coordinator,
                ),
                patch(
                    "app.controller.chat_controller._prepare_chat_run",
                    new=AsyncMock(side_effect=RuntimeError("binding failed")),
                ),
                patch("app.controller.chat_controller.step_solve") as solve,
            ):
                with pytest.raises(RuntimeError, match="binding failed"):
                    await start_chat_stream(chat_data, mock_request)

            run = journal.get_run(run_id)
            assert run is not None
            assert run.status == "interrupted"
            assert run.active_attempt_id is None
            assert not any(
                attempt.status in {"pending", "running", "waiting_for_user"}
                for attempt in journal.list_run_attempts(run_id)
            )
            solve.assert_not_called()
            assert (
                journal.list_run_attempts(run_id)[-1].status == "interrupted"
            )
            assert journal.list_events(run_id)[-1].payload["reason"] == (
                "resume_admission_failed"
            )
        await coordinator.close()

    @pytest.mark.asyncio
    async def test_resume_silently_backfills_legacy_environment_spec(
        self,
        sample_chat_data,
        mock_request,
        mock_task_lock,
        tmp_path,
    ):
        run_id = sample_chat_data["task_id"]
        chat_data = Chat(
            **sample_chat_data,
            run_id=run_id,
            resume_request_id="resume-with-current-environment",
            session_mode="single-agent",
        )
        resolver = MagicMock()
        resolver.freeze_task_directories.return_value = SimpleNamespace(
            working_directory=tmp_path,
            task_output_root=tmp_path / "output",
            base_snapshot_id=None,
            snapshot=MagicMock(),
            binding_source="test",
            workdir_mode=None,
        )
        resolver.space_root.return_value = tmp_path
        git_coordinator = MagicMock()

        with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
            journal.ensure_run(
                run_id=run_id,
                project_id=chat_data.project_id,
                status="interrupted",
            )
            resume_attempt = journal.create_run_attempt(
                run_id,
                request_id=chat_data.resume_request_id,
                reason="explicit_resume",
                activate=False,
            )
            with (
                patch(
                    "app.controller.chat_controller.get_default_run_journal",
                    return_value=journal,
                ),
                patch(
                    "app.controller.chat_controller.get_or_create_task_lock",
                    return_value=mock_task_lock,
                ),
                patch(
                    "app.controller.chat_controller.get_workspace_resolver",
                    return_value=resolver,
                ),
                patch(
                    "app.controller.chat_controller."
                    "get_default_workspace_git_coordinator",
                    return_value=git_coordinator,
                ),
                patch(
                    "app.controller.chat_controller."
                    "_prepare_browser_for_request_with_timeout",
                    new=AsyncMock(return_value=True),
                ),
                patch(
                    "app.controller.chat_controller._assemble_runtime_environment",
                    return_value=None,
                ),
                patch(
                    "app.controller.chat_controller._camel_log_dir",
                    return_value=tmp_path / "camel-log",
                ),
                patch("app.controller.chat_controller.set_current_task_id"),
                patch("app.controller.chat_controller.load_dotenv"),
            ):
                prepared = await _prepare_chat_run(
                    chat_data,
                    mock_request,
                    resume_attempt=resume_attempt,
                )

            rebound = journal.get_run_attempt(resume_attempt.attempt_id)
            assert rebound is not None
            assert rebound.environment_spec_id is not None
            assert prepared.attempt_id == resume_attempt.attempt_id
            assert prepared.run_context.attempt_id == resume_attempt.attempt_id
            assert mock_task_lock.run_context.attempt_id == (
                resume_attempt.attempt_id
            )
            assert mock_task_lock.environment_spec_id == (
                rebound.environment_spec_id
            )
            assert journal.list_events(run_id)[-1].event_type == (
                "run.attempt_environment_bound"
            )
            assert journal.list_events(run_id)[-1].payload["reason"] == (
                "legacy_environment_backfill"
            )
            git_coordinator.admit_run.assert_called_once()

    @pytest.mark.asyncio
    async def test_initial_attempt_precedes_workspace_writer_admission(
        self,
        sample_chat_data,
        mock_request,
        mock_task_lock,
        tmp_path,
    ):
        chat_data = Chat(
            **sample_chat_data,
            run_id="run-writer-must-not-leak",
            session_mode="single-agent",
        )
        resolver = MagicMock()
        resolver.freeze_task_directories.return_value = SimpleNamespace(
            working_directory=tmp_path,
            task_output_root=tmp_path / "output",
            base_snapshot_id=None,
            snapshot=MagicMock(),
            binding_source="test",
            workdir_mode=None,
        )
        resolver.space_root.return_value = tmp_path
        git_coordinator = MagicMock()

        with SQLiteRunJournal(tmp_path / "journal.sqlite3") as journal:
            journal.ensure_run(
                run_id="run-project-blocker",
                project_id=chat_data.project_id,
            )
            journal.create_run_attempt(
                "run-project-blocker",
                request_id="initial:run-project-blocker",
                reason="initial_execution",
                activate=True,
            )
            with (
                patch(
                    "app.controller.chat_controller.get_default_run_journal",
                    return_value=journal,
                ),
                patch(
                    "app.controller.chat_controller.get_or_create_task_lock",
                    return_value=mock_task_lock,
                ),
                patch(
                    "app.controller.chat_controller.get_workspace_resolver",
                    return_value=resolver,
                ),
                patch(
                    "app.controller.chat_controller."
                    "get_default_workspace_git_coordinator",
                    return_value=git_coordinator,
                ),
                patch(
                    "app.controller.chat_controller."
                    "_prepare_browser_for_request_with_timeout",
                    new=AsyncMock(return_value=True),
                ),
                patch(
                    "app.controller.chat_controller._assemble_runtime_environment",
                    return_value=None,
                ),
                patch(
                    "app.controller.chat_controller._camel_log_dir",
                    return_value=tmp_path / "camel-log",
                ),
                patch("app.controller.chat_controller.set_current_task_id"),
                patch("app.controller.chat_controller.load_dotenv"),
            ):
                with pytest.raises(
                    InvalidRunTransitionError,
                    match="already executes Run 'run-project-blocker'",
                ):
                    await _prepare_chat_run(chat_data, mock_request)

        git_coordinator.admit_run.assert_not_called()

    def test_bundle_runtime_rejects_legacy_workforce_session_mode(self):
        with pytest.raises(EnvironmentSetupRequiredError) as error:
            _require_supported_bundle_session_mode("workforce", object())

        assert error.value.issues == ("bundle_session_mode_unsupported",)

    def test_bundle_runtime_accepts_persisted_follow_up_single_agent_mode(
        self,
    ):
        from app.model.chat import SupplementChat

        follow_up = SupplementChat(question="continue from the pinned files")
        assert not hasattr(follow_up, "session_mode")
        _require_supported_bundle_session_mode("single-agent", object())

    @pytest.mark.asyncio
    async def test_status_distinguishes_lock_from_live_consumer(
        self, mock_task_lock
    ):
        coordinator = RunCoordinator()
        release = asyncio.Event()
        mock_task_lock.status = Status.processing
        mock_task_lock.current_task_id = "task-1"
        mock_task_lock.run_context = SimpleNamespace(run_id="run-1")

        async def source():
            await release.wait()
            yield "done"

        subscription = await coordinator.start_with_subscription(
            run_id="run-1",
            stream_factory=source,
        )
        with (
            patch(
                "app.controller.chat_controller.get_task_lock_if_exists",
                return_value=mock_task_lock,
            ),
            patch(
                "app.controller.chat_controller.get_default_run_coordinator",
                return_value=coordinator,
            ),
        ):
            result = await status("project-1")

        assert result["has_lock"] is True
        assert result["run_id"] == "run-1"
        assert result["consumer_alive"] is True
        assert result["subscriber_count"] == 1

        await subscription.aclose()
        release.set()
        await subscription.handle.wait()

    @pytest.mark.asyncio
    async def test_post_chat_sets_run_context_and_third_party_env(
        self, sample_chat_data, mock_request, mock_task_lock
    ):
        """Run-scoped values stay in RunContext; CAMEL path keys are published."""
        chat_data = Chat(**sample_chat_data)

        with (
            patch(
                "app.controller.chat_controller.get_or_create_task_lock",
                return_value=mock_task_lock,
            ),
            patch(
                "app.controller.chat_controller.step_solve"
            ) as mock_step_solve,
            patch("app.controller.chat_controller.load_dotenv"),
            patch("app.controller.chat_controller.set_current_task_id"),
            patch(
                "app.controller.chat_controller._prepare_browser_for_request",
                return_value=True,
            ),
            patch("pathlib.Path.mkdir"),
            patch("pathlib.Path.home", return_value=MagicMock()),
            patch.dict(os.environ, {}, clear=True),
        ):

            async def mock_generator():
                yield "data: test_response\n\n"

            mock_step_solve.return_value = mock_generator()

            await post(chat_data, mock_request)

            run_context = mock_task_lock.run_context
            assert run_context.api_key == "test_key"
            assert run_context.api_base_url == "https://api.openai.com/v1"
            assert run_context.browser_port == 8080
            assert os.environ.get("CAMEL_LOG_DIR") == str(
                run_context.camel_log_dir
            )
            assert os.environ.get("CAMEL_WORKDIR") == str(
                run_context.task_output_root
            )

    @pytest.mark.asyncio
    async def test_post_chat_sets_cdp_url_when_browser_ready(
        self, sample_chat_data, mock_request, mock_task_lock
    ):
        """Web mode should set EIGENT_CDP_URL after successful browser ensure."""
        chat_data = Chat(**sample_chat_data)
        mock_request.state = SimpleNamespace()

        with (
            patch(
                "app.controller.chat_controller.get_or_create_task_lock",
                return_value=mock_task_lock,
            ),
            patch(
                "app.controller.chat_controller.step_solve"
            ) as mock_step_solve,
            patch(
                "app.controller.chat_controller.is_cdp_url_available",
                return_value=False,
            ),
            patch(
                "app.controller.chat_controller.ensure_cdp_browser_endpoint",
                return_value="http://127.0.0.1:8080",
            ),
            patch("app.controller.chat_controller.load_dotenv"),
            patch("app.controller.chat_controller.set_current_task_id"),
            patch("pathlib.Path.mkdir"),
            patch("pathlib.Path.home", return_value=MagicMock()),
            patch.dict(os.environ, {}, clear=True),
        ):

            async def mock_generator():
                yield "data: test_response\n\n"

            mock_step_solve.return_value = mock_generator()

            await post(chat_data, mock_request)

            assert (
                mock_task_lock.run_context.cdp_url == "http://127.0.0.1:8080"
            )
            assert mock_task_lock.run_context.browser_port == 8080
            assert mock_request.state.browser_available is True

    @pytest.mark.asyncio
    async def test_post_chat_clears_cdp_url_when_browser_unavailable(
        self, sample_chat_data, mock_request, mock_task_lock
    ):
        """Web mode should mark browser unavailable and clear EIGENT_CDP_URL."""
        chat_data = Chat(**sample_chat_data)
        mock_request.state = SimpleNamespace()

        with (
            patch(
                "app.controller.chat_controller.get_or_create_task_lock",
                return_value=mock_task_lock,
            ),
            patch(
                "app.controller.chat_controller.step_solve"
            ) as mock_step_solve,
            patch(
                "app.controller.chat_controller.is_cdp_url_available",
                return_value=False,
            ),
            patch(
                "app.controller.chat_controller.ensure_cdp_browser_endpoint",
                return_value=None,
            ),
            patch("app.controller.chat_controller.load_dotenv"),
            patch("app.controller.chat_controller.set_current_task_id"),
            patch("pathlib.Path.mkdir"),
            patch("pathlib.Path.home", return_value=MagicMock()),
            patch.dict(
                os.environ,
                {"EIGENT_CDP_URL": "http://127.0.0.1:9222"},
                clear=True,
            ),
        ):

            async def mock_generator():
                yield "data: test_response\n\n"

            mock_step_solve.return_value = mock_generator()

            await post(chat_data, mock_request)

            assert mock_task_lock.run_context.cdp_url is None
            assert mock_task_lock.run_context.browser_port == 8080
            assert mock_request.state.browser_available is False

    @pytest.mark.asyncio
    async def test_post_chat_preserves_existing_cdp_url(
        self, sample_chat_data, mock_request, mock_task_lock
    ):
        chat_data = Chat(**sample_chat_data)
        mock_request.state = SimpleNamespace()

        with (
            patch(
                "app.controller.chat_controller.get_or_create_task_lock",
                return_value=mock_task_lock,
            ),
            patch(
                "app.controller.chat_controller.step_solve"
            ) as mock_step_solve,
            patch(
                "app.controller.chat_controller.is_cdp_url_available",
                return_value=True,
            ),
            patch(
                "app.controller.chat_controller.ensure_cdp_browser_endpoint",
            ) as mock_ensure_browser,
            patch("app.controller.chat_controller.load_dotenv"),
            patch("app.controller.chat_controller.set_current_task_id"),
            patch("pathlib.Path.mkdir"),
            patch("pathlib.Path.home", return_value=MagicMock()),
            patch.dict(
                os.environ,
                {"EIGENT_CDP_URL": "http://worker-17:9222"},
                clear=True,
            ),
        ):

            async def mock_generator():
                yield "data: test_response\n\n"

            mock_step_solve.return_value = mock_generator()

            await post(chat_data, mock_request)

            assert (
                mock_task_lock.run_context.cdp_url == "http://worker-17:9222"
            )
            assert mock_task_lock.run_context.browser_port == 9222
            assert mock_request.state.browser_available is True
            mock_ensure_browser.assert_not_called()

    @pytest.mark.asyncio
    async def test_improve_chat_success(self, mock_task_lock, mock_request):
        """Test successful chat improvement."""
        task_id = "test_task_123"
        supplement_data = SupplementChat(question="Improve this code")
        mock_task_lock.status = Status.processing

        with (
            patch(
                "app.controller.chat_controller.get_task_lock",
                return_value=mock_task_lock,
            ),
            patch(
                "app.controller.chat_controller."
                "_prepare_browser_for_request_with_timeout",
                new=AsyncMock(return_value=True),
            ),
        ):
            response = await improve(task_id, supplement_data, mock_request)

            assert isinstance(response, Response)
            assert response.status_code == 201
            mock_task_lock.put_queue.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_follow_up_admission_persists_and_rebinds_live_consumer(
        self,
        mock_task_lock,
        mock_request,
        controller_run_journal,
        tmp_path,
    ):
        coordinator = RunCoordinator()
        release = asyncio.Event()

        async def source():
            await release.wait()
            yield "done"

        subscription = await coordinator.start_with_subscription(
            run_id="run-old",
            stream_factory=source,
        )
        mock_task_lock.status = Status.processing
        mock_task_lock.runtime_session_mode = "single-agent"
        mock_task_lock.environment_admission_template = MagicMock()
        mock_task_lock.email = "u@example.com"
        mock_task_lock.user_id = "42"
        mock_task_lock.space_id = "space-1"
        mock_task_lock.run_context = RunContext(
            space_id="space-1",
            project_id="project-1",
            run_id="run-old",
            task_id="run-old",
            email="u@example.com",
            user_id="42",
            working_directory=tmp_path,
            task_output_root=tmp_path / "old-output",
            camel_log_dir=tmp_path / "old-log",
            binding_source="test",
            workdir_mode=None,
            browser_port=9222,
            attempt_id="attempt-old",
        )
        mock_request.state = SimpleNamespace(browser_port=9222, cdp_url=None)
        frozen_dirs = SimpleNamespace(
            working_directory=tmp_path,
            task_output_root=tmp_path / "new-output",
            snapshot=MagicMock(),
            binding_source="test",
            workdir_mode=None,
            base_snapshot_id=None,
        )
        resolver = MagicMock()
        resolver.freeze_task_directories_for.return_value = frozen_dirs
        admission_service = MagicMock()
        follow_up_spec = SimpleNamespace(
            spec_id="envspec-follow-up",
            thinking_effort_requested=SimpleNamespace(value="medium"),
            thinking_effort_effective=SimpleNamespace(value="medium"),
            provider_parameter_name=None,
            provider_value=None,
            provider_capability_revision="provider-test",
        )
        admission_service.persist_for_run.return_value = SimpleNamespace(
            spec=follow_up_spec,
            binding=object(),
        )
        data = SupplementChat(question="next turn", task_id="run-new")

        with (
            patch(
                "app.controller.chat_controller.get_default_run_coordinator",
                return_value=coordinator,
            ),
            patch(
                "app.controller.chat_controller.get_task_lock",
                return_value=mock_task_lock,
            ),
            patch(
                "app.controller.chat_controller.get_workspace_resolver",
                return_value=resolver,
            ),
            patch(
                "app.controller.chat_controller.SQLiteRunJournal",
                new=MagicMock,
            ),
            patch(
                "app.controller.chat_controller.EnvironmentAdmissionTemplate",
                new=MagicMock,
            ),
            patch(
                "app.controller.chat_controller.EnvironmentAdmissionService",
                return_value=admission_service,
            ),
            patch(
                "app.controller.chat_controller._assemble_runtime_environment",
                return_value=object(),
            ),
            patch(
                "app.controller.chat_controller._prepare_browser_for_request_with_timeout",
                new=AsyncMock(return_value=True),
            ),
            patch(
                "app.controller.chat_controller._camel_log_dir",
                return_value=tmp_path / "new-log",
            ),
            patch(
                "app.controller.chat_controller.apply_run_env_for_third_party"
            ),
        ):
            response = await improve("project-1", data, mock_request)

        assert response.status_code == 201
        controller_run_journal.ensure_run.assert_called_once_with(
            run_id="run-new",
            project_id="project-1",
            status="pending",
        )
        assert await coordinator.get_handle("run-old") is None
        assert await coordinator.get_handle("run-new") is subscription.handle
        mock_task_lock.put_queue.assert_awaited_once()
        admission_service.persist_for_run.assert_called_once()
        assert mock_task_lock.run_context.attempt_id == "attempt-1"
        queued = mock_task_lock.put_queue.await_args.args[0]
        assert queued.attempt_id == mock_task_lock.run_context.attempt_id

        await subscription.aclose()
        release.set()
        await subscription.handle.wait()

    @pytest.mark.asyncio
    async def test_duplicate_follow_up_run_is_not_queued_again(
        self,
        mock_request,
        controller_run_journal,
    ):
        data = SupplementChat(question="duplicate", task_id="run-existing")
        controller_run_journal.get_run.return_value = SimpleNamespace(
            run_id="run-existing", status="completed"
        )
        controller_run_journal.list_run_attempts.return_value = [
            SimpleNamespace(
                resume_request_id=_admission_request_id(
                    "run-existing",
                    question=data.question,
                    attaches=data.attaches,
                    project_context=data.project_context,
                ),
                status="completed",
            )
        ]

        with patch(
            "app.controller.chat_controller._improve_chat",
            new=AsyncMock(),
        ) as improve_chat:
            response = await improve("project-1", data, mock_request)

        assert response.status_code == 201
        improve_chat.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_follow_up_rebind_failure_precedes_durable_admission(
        self,
        mock_task_lock,
        mock_request,
        controller_run_journal,
        tmp_path,
    ):
        old_context = RunContext(
            space_id="space-1",
            project_id="project-1",
            run_id="run-old",
            task_id="run-old",
            email="u@example.com",
            user_id="42",
            working_directory=tmp_path,
            task_output_root=tmp_path / "old-output",
            camel_log_dir=tmp_path / "old-log",
            binding_source="test",
            workdir_mode=None,
            browser_port=9222,
        )
        mock_task_lock.run_context = old_context
        mock_task_lock.status = Status.processing
        mock_task_lock.email = "u@example.com"
        mock_task_lock.user_id = "42"
        mock_request.state = SimpleNamespace(browser_port=9222, cdp_url=None)
        frozen_dirs = SimpleNamespace(
            working_directory=tmp_path,
            task_output_root=tmp_path / "new-output",
            snapshot=MagicMock(),
            binding_source="test",
        )
        resolver = MagicMock()
        resolver.freeze_task_directories_for.return_value = frozen_dirs
        with (
            patch(
                "app.controller.chat_controller.get_default_run_coordinator",
                return_value=RunCoordinator(),
            ),
            patch(
                "app.controller.chat_controller.get_task_lock",
                return_value=mock_task_lock,
            ),
            patch(
                "app.controller.chat_controller.get_workspace_resolver",
                return_value=resolver,
            ),
            patch(
                "app.controller.chat_controller._prepare_browser_for_request_with_timeout",
                new=AsyncMock(return_value=True),
            ),
            patch(
                "app.controller.chat_controller._camel_log_dir",
                return_value=tmp_path / "new-log",
            ),
            patch(
                "app.controller.chat_controller.apply_run_env_for_third_party"
            ),
        ):
            with pytest.raises(UserException, match="no live consumer"):
                await improve(
                    "project-1",
                    SupplementChat(question="next", task_id="run-new"),
                    mock_request,
                )

        controller_run_journal.ensure_run.assert_not_called()
        controller_run_journal.create_run_attempt.assert_not_called()
        mock_task_lock.put_queue.assert_not_awaited()
        assert mock_task_lock.run_context is old_context

    @pytest.mark.asyncio
    async def test_improve_chat_task_done_resets_to_confirming(
        self, mock_task_lock, mock_request
    ):
        """Test improvement when task is done resets status to confirming."""
        task_id = "test_task_123"
        supplement_data = SupplementChat(question="Improve this code")
        mock_task_lock.status = Status.done

        with (
            patch(
                "app.controller.chat_controller.get_task_lock",
                return_value=mock_task_lock,
            ),
            patch(
                "app.controller.chat_controller._prepare_browser_for_request_with_timeout",
                new=AsyncMock(return_value=True),
            ),
        ):
            response = await improve(task_id, supplement_data, mock_request)

            assert mock_task_lock.status == Status.confirming
            assert isinstance(response, Response)
            assert response.status_code == 201

    @pytest.mark.asyncio
    async def test_improve_rejects_follow_up_when_run_rotation_failed(
        self, mock_task_lock, mock_request
    ):
        """A failed directory rotation must not admit the follow-up Run."""

        # Use a real RunContext-shaped stand-in so getattr access works.
        stale_run = SimpleNamespace(
            run_id="stale_run_from_previous_turn",
            space_id="blank_space_x",
            project_id="project_x",
            task_id="stale_task_id",
            browser_port=9222,
            cdp_url=None,
            user_id="42",
            email="u@example.com",
        )
        # Make isinstance(stale_run, RunContext) return True via patching.
        mock_task_lock.run_context = stale_run
        mock_task_lock.status = Status.processing
        mock_task_lock.email = "u@example.com"

        supplement_data = SupplementChat(
            question="next turn", task_id="brand_new_task_id"
        )

        with (
            patch(
                "app.controller.chat_controller.get_task_lock",
                return_value=mock_task_lock,
            ),
            patch(
                "app.controller.chat_controller.RunContext",
                new=SimpleNamespace,
            ),
            patch(
                "app.controller.chat_controller.get_workspace_resolver",
                side_effect=RuntimeError(
                    "simulated resolver failure -- rotation never happens"
                ),
            ),
            patch(
                "app.controller.chat_controller._prepare_browser_for_request_with_timeout",
                new=AsyncMock(return_value=True),
            ),
        ):
            with pytest.raises(UserException, match="durably prepare"):
                await improve("project_x", supplement_data, mock_request)
            mock_task_lock.put_queue.assert_not_awaited()
            assert mock_task_lock.run_context is stale_run

    def test_supplement_chat_success(self, mock_task_lock):
        """Test successful chat supplementation."""
        task_id = "test_task_123"
        supplement_data = SupplementChat(question="Add more details")
        mock_task_lock.status = Status.done

        with (
            patch(
                "app.controller.chat_controller.get_task_lock",
                return_value=mock_task_lock,
            ),
            patch(
                "app.controller.chat_controller._queue_action_from_worker"
            ) as mock_queue_action,
        ):
            response = supplement(task_id, supplement_data)

            assert isinstance(response, Response)
            assert response.status_code == 201
            mock_queue_action.assert_called_once()

    def test_supplement_chat_task_not_done_error(self, mock_task_lock):
        """Test supplementation fails when task is not done."""
        task_id = "test_task_123"
        supplement_data = SupplementChat(question="Add more details")
        mock_task_lock.status = Status.processing

        with patch(
            "app.controller.chat_controller.get_task_lock",
            return_value=mock_task_lock,
        ):
            with pytest.raises(UserException):
                supplement(task_id, supplement_data)

    @pytest.mark.asyncio
    async def test_stop_chat_success(self, mock_task_lock):
        """Test successful chat stopping."""
        task_id = "test_task_123"

        with (
            patch(
                "app.controller.chat_controller.get_task_lock_if_exists",
                return_value=mock_task_lock,
            ),
        ):
            response = await stop(task_id)

            assert isinstance(response, Response)
            assert response.status_code == 204
            mock_task_lock.put_queue.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_human_reply_success(self, mock_task_lock, mock_request):
        """Test successful human reply."""
        task_id = "test_task_123"
        reply_data = HumanReply(agent="test_agent", reply="This is my reply")

        with (
            patch(
                "app.controller.chat_controller.get_task_lock_if_exists",
                return_value=mock_task_lock,
            ),
            patch(
                "app.controller.chat_controller.sync_step_event"
            ) as mock_sync_step,
        ):
            mock_request.headers = {"authorization": "Bearer test"}
            mock_task_lock.memory_service = None
            mock_task_lock.run_context = None
            mock_task_lock.current_task_id = task_id
            response = await human_reply(task_id, reply_data, mock_request)

            assert isinstance(response, Response)
            assert response.status_code == 201
            mock_task_lock.put_human_input.assert_awaited_once_with(
                "test_agent", "This is my reply"
            )
            mock_task_lock.add_conversation.assert_called_once_with(
                "human_reply",
                {"agent": "test_agent", "reply": "This is my reply"},
            )
            mock_sync_step.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_human_reply_missing_task_lock_returns_user_error(
        self, mock_request
    ):
        """Expired human replies should not raise backend program errors."""
        task_id = "test_task_123"
        reply_data = HumanReply(agent="test_agent", reply="late reply")

        with patch(
            "app.controller.chat_controller.get_task_lock_if_exists",
            return_value=None,
        ):
            with pytest.raises(UserException):
                await human_reply(task_id, reply_data, mock_request)

    @pytest.mark.asyncio
    async def test_human_reply_cannot_consume_pending_approval(
        self,
        tmp_path,
        mock_task_lock,
        mock_request,
        controller_run_journal,
    ):
        task_id = "test_task_approval"
        mock_task_lock.run_context = RunContext(
            space_id="space-1",
            project_id=task_id,
            run_id="run-1",
            task_id=task_id,
            email="user@example.com",
            user_id="user-1",
            working_directory=tmp_path,
            task_output_root=tmp_path,
            camel_log_dir=tmp_path / "camel_logs",
            binding_source="test",
            workdir_mode="workspace",
            browser_port=9222,
        )
        controller_run_journal.list_human_interactions.return_value = [
            SimpleNamespace(
                interaction_id="approval-1",
                interaction_type="approval",
                request={"agent": "test_agent"},
            )
        ]
        reply_data = HumanReply(agent="test_agent", reply="yes")

        with patch(
            "app.controller.chat_controller.get_task_lock_if_exists",
            return_value=mock_task_lock,
        ):
            with pytest.raises(UserException, match="approval decision"):
                await human_reply(task_id, reply_data, mock_request)

        mock_task_lock.put_human_input.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_human_reply_cannot_bypass_approval_when_question_is_also_pending(
        self,
        tmp_path,
        mock_task_lock,
        mock_request,
        controller_run_journal,
    ):
        task_id = "test_task_mixed_interactions"
        mock_task_lock.run_context = RunContext(
            space_id="space-1",
            project_id=task_id,
            run_id="run-1",
            task_id=task_id,
            email="user@example.com",
            user_id="user-1",
            working_directory=tmp_path,
            task_output_root=tmp_path,
            camel_log_dir=tmp_path / "camel_logs",
            binding_source="test",
            workdir_mode="workspace",
            browser_port=9222,
        )
        controller_run_journal.get_run.return_value = SimpleNamespace(
            active_attempt_id="attempt-1"
        )
        controller_run_journal.list_human_interactions.return_value = [
            SimpleNamespace(
                interaction_id="question-old",
                attempt_id="attempt-1",
                interaction_type="question",
                request={"agent": "test_agent"},
            ),
            SimpleNamespace(
                interaction_id="approval-current",
                attempt_id="attempt-1",
                interaction_type="approval",
                request={"agent": "test_agent"},
            ),
        ]

        with patch(
            "app.controller.chat_controller.get_task_lock_if_exists",
            return_value=mock_task_lock,
        ):
            with pytest.raises(UserException, match="approval decision"):
                await human_reply(
                    task_id,
                    HumanReply(agent="test_agent", reply="yes"),
                    mock_request,
                )

        mock_task_lock.put_human_input.assert_not_awaited()
        controller_run_journal.resolve_human_interaction.assert_not_called()

    @pytest.mark.asyncio
    async def test_stale_interrupted_approval_does_not_block_current_question(
        self,
        tmp_path,
        mock_task_lock,
        mock_request,
        controller_run_journal,
    ):
        task_id = "test_task_stale_approval"
        mock_task_lock.run_context = RunContext(
            space_id="space-1",
            project_id=task_id,
            run_id="run-1",
            task_id=task_id,
            email="user@example.com",
            user_id="user-1",
            working_directory=tmp_path,
            task_output_root=tmp_path,
            camel_log_dir=tmp_path / "camel_logs",
            binding_source="test",
            workdir_mode="workspace",
            browser_port=9222,
        )
        controller_run_journal.get_run.return_value = SimpleNamespace(
            active_attempt_id="attempt-2"
        )
        controller_run_journal.list_human_interactions.return_value = [
            SimpleNamespace(
                interaction_id="approval-stale",
                attempt_id="attempt-1",
                interaction_type="approval",
                request={"agent": "test_agent"},
            ),
            SimpleNamespace(
                interaction_id="question-current",
                attempt_id="attempt-2",
                interaction_type="question",
                request={"agent": "test_agent"},
                version=0,
            ),
        ]

        with patch(
            "app.controller.chat_controller.get_task_lock_if_exists",
            return_value=mock_task_lock,
        ):
            await human_reply(
                task_id,
                HumanReply(
                    agent="test_agent",
                    reply="continue",
                    interaction_id="question-current",
                ),
                mock_request,
            )

        mock_task_lock.put_human_input.assert_awaited_once_with(
            "test_agent", "continue"
        )
        controller_run_journal.resolve_human_interaction.assert_called_once()

    def test_install_mcp_success(self, mock_task_lock):
        """Test successful MCP installation."""
        task_id = "test_task_123"
        mcp_data: McpServers = {
            "mcpServers": {"test_server": {"config": "test"}}
        }

        with (
            patch(
                "app.controller.chat_controller.get_task_lock",
                return_value=mock_task_lock,
            ),
            patch(
                "app.controller.chat_controller._queue_action_from_worker"
            ) as mock_queue_action,
        ):
            response = install_mcp(task_id, mcp_data)

            assert isinstance(response, Response)
            assert response.status_code == 201
            mock_queue_action.assert_called_once()


@pytest.mark.integration
class TestChatControllerIntegration:
    """Integration tests for chat controller."""

    def test_chat_endpoint_integration(
        self, client: TestClient, sample_chat_data
    ):
        """Test chat endpoint through FastAPI test client."""
        with (
            patch(
                "app.controller.chat_controller.get_or_create_task_lock"
            ) as mock_create_lock,
            patch(
                "app.controller.chat_controller.step_solve"
            ) as mock_step_solve,
            patch("app.controller.chat_controller.load_dotenv"),
            patch("app.controller.chat_controller.set_current_task_id"),
            patch(
                "app.controller.chat_controller._prepare_browser_for_request_with_timeout",
                new=AsyncMock(return_value=True),
            ),
            patch("pathlib.Path.mkdir"),
            patch("pathlib.Path.home", return_value=MagicMock()),
        ):
            mock_task_lock = MagicMock()
            mock_task_lock.put_queue = AsyncMock()
            mock_create_lock.return_value = mock_task_lock

            async def mock_generator():
                yield "data: test_response\n\n"

            mock_step_solve.return_value = mock_generator()

            response = client.post("/chat", json=sample_chat_data)

            assert response.status_code == 200
            assert (
                response.headers["content-type"]
                == "text/event-stream; charset=utf-8"
            )

    def test_improve_chat_endpoint_integration(self, client: TestClient):
        """Test improve chat endpoint through FastAPI test client."""
        task_id = "test_task_123"
        supplement_data = {"question": "Improve this code"}

        with (
            patch(
                "app.controller.chat_controller.get_task_lock"
            ) as mock_get_lock,
            patch(
                "app.controller.chat_controller._prepare_browser_for_request_with_timeout",
                new=AsyncMock(return_value=True),
            ),
        ):
            mock_task_lock = MagicMock()
            mock_task_lock.status = Status.processing
            mock_task_lock.put_queue = AsyncMock()
            mock_get_lock.return_value = mock_task_lock

            response = client.post(f"/chat/{task_id}", json=supplement_data)

            assert response.status_code == 201

    def test_supplement_chat_endpoint_integration(self, client: TestClient):
        """Test supplement chat endpoint through FastAPI test client."""
        task_id = "test_task_123"
        supplement_data = {"question": "Add more details"}

        with (
            patch(
                "app.controller.chat_controller.get_task_lock"
            ) as mock_get_lock,
            patch("app.controller.chat_controller._queue_action_from_worker"),
        ):
            mock_task_lock = MagicMock()
            mock_task_lock.status = Status.done
            mock_get_lock.return_value = mock_task_lock

            response = client.put(f"/chat/{task_id}", json=supplement_data)

            assert response.status_code == 201

    def test_stop_chat_endpoint_integration(self, client: TestClient):
        """Test stop chat endpoint through FastAPI test client."""
        task_id = "test_task_123"

        with (
            patch(
                "app.controller.chat_controller.get_task_lock_if_exists"
            ) as mock_get_lock,
        ):
            mock_task_lock = MagicMock()
            mock_task_lock.put_queue = AsyncMock()
            mock_get_lock.return_value = mock_task_lock

            response = client.delete(f"/chat/{task_id}")

            assert response.status_code == 204

    def test_human_reply_endpoint_integration(self, client: TestClient):
        """Test human reply endpoint through FastAPI test client."""
        task_id = "test_task_123"
        reply_data = {"agent": "test_agent", "reply": "This is my reply"}

        with (
            patch(
                "app.controller.chat_controller.get_task_lock_if_exists"
            ) as mock_get_lock,
        ):
            mock_task_lock = MagicMock()
            mock_task_lock.put_human_input = AsyncMock()
            mock_task_lock.current_task_id = task_id
            mock_task_lock.memory_service = None
            mock_task_lock.run_context = None
            mock_get_lock.return_value = mock_task_lock

            response = client.post(
                f"/chat/{task_id}/human-reply", json=reply_data
            )

            assert response.status_code == 201

    def test_install_mcp_endpoint_integration(self, client: TestClient):
        """Test install MCP endpoint through FastAPI test client."""
        task_id = "test_task_123"
        mcp_data = {"mcpServers": {"test_server": {"config": "test"}}}

        with (
            patch(
                "app.controller.chat_controller.get_task_lock"
            ) as mock_get_lock,
            patch("app.controller.chat_controller._queue_action_from_worker"),
        ):
            mock_task_lock = MagicMock()
            mock_get_lock.return_value = mock_task_lock

            response = client.post(
                f"/chat/{task_id}/install-mcp", json=mcp_data
            )

            assert response.status_code == 201


@pytest.mark.model_backend
class TestChatControllerWithLLM:
    """Tests that require LLM backend (marked for selective running)."""

    @pytest.mark.asyncio
    async def test_post_with_real_llm_model(
        self, sample_chat_data, mock_request
    ):
        """Test chat endpoint with real LLM model (slow test)."""
        # This test would use actual LLM models and should be marked accordingly
        Chat(**sample_chat_data)

        # Test implementation would involve real model calls
        # This is marked as model_backend test for selective execution
        assert True  # Placeholder

    @pytest.mark.very_slow
    async def test_full_chat_workflow_with_llm(
        self, sample_chat_data, mock_request
    ):
        """Test complete chat workflow with LLM (very slow test)."""
        # This test would run the complete workflow including actual agent interactions
        # Marked as very_slow for execution only in full test mode
        assert True  # Placeholder


@pytest.mark.unit
class TestChatControllerErrorCases:
    """Test error cases and edge conditions."""

    @pytest.mark.asyncio
    async def test_post_with_invalid_data(self, mock_request):
        """Test chat endpoint with invalid data."""
        # Construction itself should raise a validation error due to multiple invalid fields
        with pytest.raises((ValueError, TypeError, ValidationError)):
            Chat(
                task_id="",  # Invalid empty task_id
                email="invalid_email",  # Invalid email format
                question="",  # Empty question
                attaches=[],
                model="invalid_model",  # Field not defined in model -> triggers error
                model_platform="invalid_platform",
                api_key="",
                api_url="invalid_url",
                new_agents=[],
                env_path="nonexistent.env",
                browser_port=-1,  # Invalid port
                summary_prompt="",
            )
        # If future validation moves to endpoint level, keep logic placeholder below.
        # (Intentionally not calling post with invalid Chat object since creation fails.)

    @pytest.mark.asyncio
    async def test_improve_with_nonexistent_task(self):
        """Test improve endpoint with nonexistent task."""
        task_id = "nonexistent_task"
        supplement_data = SupplementChat(question="Improve this code")
        request = SimpleNamespace()

        with patch(
            "app.controller.chat_controller.get_task_lock",
            side_effect=KeyError("Task not found"),
        ):
            with pytest.raises(KeyError):
                await improve(task_id, supplement_data, request)

    def test_supplement_with_empty_question(self, mock_task_lock):
        """Test supplement endpoint with empty question."""
        task_id = "test_task_123"
        supplement_data = SupplementChat(question="")
        mock_task_lock.status = Status.done

        with (
            patch(
                "app.controller.chat_controller.get_task_lock",
                return_value=mock_task_lock,
            ),
            patch("app.controller.chat_controller._queue_action_from_worker"),
        ):
            # Should handle empty question gracefully or raise appropriate error
            response = supplement(task_id, supplement_data)
            assert response.status_code == 201  # Or should it be an error?

    @pytest.mark.asyncio
    async def test_post_environment_setup_failure(
        self, sample_chat_data, mock_request
    ):
        """Test chat endpoint when environment setup fails."""
        chat_data = Chat(**sample_chat_data)

        with (
            patch(
                "app.controller.chat_controller.get_or_create_task_lock"
            ) as mock_create_lock,
            patch(
                "app.controller.chat_controller.sanitize_env_path",
                return_value="/tmp/fake.env",
            ),
            patch(
                "app.controller.chat_controller.load_dotenv",
                side_effect=Exception("Env load failed"),
            ),
            patch(
                "pathlib.Path.mkdir",
                side_effect=Exception("Directory creation failed"),
            ),
        ):
            mock_task_lock = MagicMock()
            mock_create_lock.return_value = mock_task_lock

            # Should handle environment setup failures gracefully
            with pytest.raises(Exception):
                await post(chat_data, mock_request)

    @pytest.mark.asyncio
    async def test_bundle_runtime_setup_failure_prevents_attempt_and_dispatch(
        self,
        sample_chat_data,
        mock_request,
        mock_task_lock,
        tmp_path,
    ):
        chat_data = Chat(**sample_chat_data)
        database = tmp_path / "run-journal.sqlite3"
        journal = SQLiteRunJournal(database)
        resolver = MagicMock()
        resolver.freeze_task_directories.return_value = SimpleNamespace(
            working_directory=tmp_path,
            task_output_root=tmp_path / "output",
            base_snapshot_id=None,
            snapshot=MagicMock(),
            binding_source="test",
            workdir_mode=None,
        )
        resolver.space_root.return_value = tmp_path

        with (
            patch(
                "app.controller.chat_controller.get_default_run_journal",
                return_value=journal,
            ),
            patch(
                "app.controller.chat_controller.get_default_run_coordinator",
                return_value=RunCoordinator(),
            ),
            patch(
                "app.controller.chat_controller.get_or_create_task_lock",
                return_value=mock_task_lock,
            ),
            patch(
                "app.controller.chat_controller.get_workspace_resolver",
                return_value=resolver,
            ),
            patch(
                "app.controller.chat_controller._prepare_browser_for_request_with_timeout",
                new=AsyncMock(return_value=True),
            ),
            patch(
                "app.controller.chat_controller._camel_log_dir",
                return_value=tmp_path / "camel-log",
            ),
            patch(
                "app.controller.chat_controller._legacy_environment_template",
                return_value=MagicMock(),
            ),
            patch(
                "app.controller.chat_controller."
                "EnvironmentAdmissionService.persist_for_run",
                return_value=SimpleNamespace(
                    spec=MagicMock(),
                    binding=MagicMock(),
                ),
            ),
            patch(
                "app.controller.chat_controller._assemble_runtime_environment",
                side_effect=EnvironmentSetupRequiredError(
                    ["mcp_destination_confirmation_required"]
                ),
            ),
            patch("app.controller.chat_controller.step_solve") as solve,
            patch(
                "app.agent.factory.toolkit_assembler.assemble_single_agent_toolkits",
                new=AsyncMock(),
            ) as assemble_toolkits,
        ):
            with pytest.raises(UserException) as error:
                await start_chat_stream(chat_data, mock_request)

        assert error.value.error_code == "environment_setup_required"
        assert (
            journal.list_run_attempts(chat_data.run_id or chat_data.task_id)
            == []
        )
        solve.assert_not_called()
        assemble_toolkits.assert_not_awaited()
        journal.close()
