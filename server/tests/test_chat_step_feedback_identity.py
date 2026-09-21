"""The legacy cloud JSON contract must retain committed feedback references."""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlmodel import Session, create_engine

from app.domains.chat.api import step_controller
from app.model.chat.chat_step import ChatStep, ChatStepIn, ChatStepOut


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("step", "data"),
    [
        ("end", {"content": "Final result", "source_event_id": "receipt:end"}),
        ("end", {"message": "Plain-text result", "source_event_id": "receipt:text"}),
        ("wait_confirm", {"content": "Answer", "question": "Question", "source_event_id": "receipt:wait"}),
        ("agent_end", {"content": "Worker result", "source_event_id": "receipt:agent"}),
        ("agent_summary_end", {"content": "Summary", "source_event_id": "receipt:summary"}),
        ("end", {"message_id": "logical-message", "content": "Result", "source_event_id": "receipt:explicit"}),
        ("end", "Old result without source identity"),
    ],
)
async def test_feedback_identity_survives_create_storage_and_playback(monkeypatch, step, data):
    # Use the existing cloud schema: a server deployment/migration must not be
    # required before an updated desktop can retain its reference in data.
    engine = create_engine("sqlite://")
    ChatStep.__table__.create(engine)
    auth = SimpleNamespace(user=SimpleNamespace(id=20))
    monkeypatch.setattr(step_controller, "_task_owned_by_user", lambda *_args: True)
    monkeypatch.setattr(step_controller, "_history_for_run", lambda *_args: SimpleNamespace(task_id="run-feedback"))
    monkeypatch.setattr(step_controller.RemoteControlService, "publish_chat_step", MagicMock())
    try:
        with Session(engine) as db:
            request = ChatStepIn.model_validate_json(
                json.dumps({"task_id": "run-feedback", "step": step, "data": data, "timestamp": 100.0})
            )
            await step_controller.create_chat_step(request, db_session=db, auth=auth)

        # Reload in another session to exercise the actual JSON storage codec.
        with Session(engine) as db:
            rows = await step_controller.list_chat_steps("run-feedback", db_session=db, auth=auth)
            assert len(rows) == 1
            assert ChatStepOut.model_validate(rows[0]).model_dump()["data"] == data
            for response in [
                await step_controller.share_playback("run-feedback", db_session=db, auth=auth),
                await step_controller.run_playback("run-feedback", db_session=db, auth=auth),
            ]:
                frames = [json.loads(frame.removeprefix("data: ")) async for frame in response.body_iterator]
                assert len(frames) == 1
                assert frames[0]["data"] == data
                assert frames[0]["run_id"] == "run-feedback"
                assert frames[0]["step"] == step
                assert "event_id" not in frames[0]
    finally:
        engine.dispose()
