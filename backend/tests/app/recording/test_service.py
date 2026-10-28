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

import json
import time
from dataclasses import replace
from pathlib import Path

import pytest

from app.recording.models import RecordingError, RecordingScope
from app.recording.service import RecordingService
from app.recording.store import RecordingStore

PRINCIPAL = "desktop_renderer:local"


def atom(kind, data=b""):
    return (len(data) + 8).to_bytes(4, "big") + kind + data


@pytest.fixture
def env(tmp_path):
    root = tmp_path / "space"
    root.mkdir()
    spool = tmp_path / "spool"
    spool.mkdir()
    scope = RecordingScope(
        PRINCIPAL,
        "user_7",
        "space",
        "project",
        "task",
        "run",
        None,
        root,
        "binding-1",
    )
    state = {"scope": scope, "active": True, "bound": True}

    def resolve(run_id, principal):
        if principal != PRINCIPAL:
            raise RecordingError("recording_forbidden", 403)
        if not state["active"]:
            raise RecordingError("task_not_active")
        return replace(state["scope"], run_id=run_id)

    service = RecordingService(
        RecordingStore(tmp_path / "catalog.sqlite3"),
        scope_resolver=resolve,
        binding_check=lambda row: state["bound"],
        run_check=lambda run: (state["active"], state["scope"].attempt_id),
    )
    service.register("desktop", str(spool))
    grant = service.authorize("run", PRINCIPAL)["grant_id"]
    return service, grant, state, spool


def start(env, key="request", run="run"):
    service, grant, _, _ = env
    return service.start(run, PRINCIPAL, grant, key)


def media(env, row):
    directory = env[3] / row["id"]
    directory.mkdir()
    path = directory / "capture.mp4"
    path.write_bytes(
        atom(b"ftyp", b"isom\0\0\0\0isom")
        + atom(b"moov", b"fixture")
        + atom(b"mdat", b"frames")
    )
    return {"duration": 2, "width": 640, "height": 480, "fps": 24}


def test_headless_start_requires_grant_without_creating_row(env):
    service, _, _, _ = env
    with pytest.raises(RecordingError, match="permission_required"):
        service.start("run", PRINCIPAL, "not-a-grant", "key")
    assert service.store.all() == []


def test_unavailable_provider_does_not_require_desktop_imports(env):
    service, grant, _, _ = env
    service.disconnect()
    assert not service.capabilities()["available"]
    with pytest.raises(RecordingError, match="provider_unavailable"):
        service.start("run", PRINCIPAL, grant, "key")


def test_idempotency_busy_and_ownership(env):
    service, _, _, _ = env
    first = start(env)
    assert start(env)["id"] == first["id"]
    with pytest.raises(RecordingError, match="idempotency_conflict"):
        start(env, run="other-run")
    with pytest.raises(RecordingError, match="source_busy"):
        start(env, key="second", run="other-run")
    with pytest.raises(RecordingError, match="recording_not_found"):
        service.get(first["id"], "brain_user:8")
    assert service.listing("brain_user:8") == []
    assert "grant_id" not in first and "root" not in first


def test_grants_expire_on_idle_and_registration(env):
    service, grant, state, spool = env
    service.provider.grants[grant] = (state["scope"].account, time.time() - 1)
    with pytest.raises(RecordingError, match="permission_required"):
        start(env)
    fresh = service.authorize("run", PRINCIPAL)["grant_id"]
    old = service.provider
    service.register("desktop", str(spool))
    with pytest.raises(RecordingError, match="permission_required"):
        service.start("run", PRINCIPAL, fresh, "new")
    with pytest.raises(RecordingError, match="provider_unauthorized"):
        service.authenticate_provider(old.token)


def test_revoke_stops_capture_and_rejects_future_starts(env):
    service, _, _, _ = env
    row = start(env)
    service.revoke()
    assert service.get(row["id"], PRINCIPAL)["state"] == "stopping"
    assert service.get(row["id"], PRINCIPAL)["reason"] == "grant_revoked"
    with pytest.raises(RecordingError, match="permission_required"):
        start(env, key="next")


def test_publication_is_independent_of_task_completion(env):
    service, _, state, _ = env
    row = start(env)
    profile = media(env, row)
    assert service.store.reserved(
        state["scope"].root, row["directory"] + "/clip_001.mp4"
    )
    service.report(service.provider, row["id"], sequence=0, state="recording")
    state["active"] = False
    service.tick()
    assert service.get(row["id"], PRINCIPAL)["state"] == "stopping"
    result = service.report(
        service.provider,
        row["id"],
        sequence=1,
        state="completed",
        media=profile,
    )
    assert result["state"] == "completed"
    assert result["clips"][0]["attempt_id"] is None
    path = Path(result["clips"][0]["local_path"])
    assert path.is_file()
    manifest = json.loads((path.parent / "manifest.json").read_text())
    assert manifest["run_id"] == "run"
    assert not any(
        key in manifest for key in ("grant_id", "principal", "root")
    )
    assert "run" not in path.parent.name
    assert (
        service.report(
            service.provider,
            row["id"],
            sequence=1,
            state="completed",
            media=profile,
        )
        == result
    )
    assert len(service.store.all()) == 1


def test_pause_resume_attempt_and_null_attempt(env):
    service, _, state, _ = env
    row = start(env)
    state["scope"] = replace(state["scope"], attempt_id="attempt-2")
    service.tick()
    assert service.get(row["id"], PRINCIPAL)["reason"] == "attempt_ended"
    service.report(
        service.provider, row["id"], sequence=0, state="interrupted"
    )
    second = start(env, key="resume")
    assert second["attempt_id"] == "attempt-2"
    assert second["id"] != row["id"]


def test_rebinding_and_symlink_destination_never_publish(env, tmp_path):
    service, _, state, _ = env
    row = start(env)
    profile = media(env, row)
    other = tmp_path / "other"
    other.mkdir()
    (state["scope"].root / "recordings").symlink_to(
        other, target_is_directory=True
    )
    with pytest.raises(RecordingError, match="workspace_rebound"):
        service.report(
            service.provider,
            row["id"],
            sequence=0,
            state="completed",
            media=profile,
        )
    assert list(other.iterdir()) == []
    (state["scope"].root / "recordings").unlink()
    assert service.get(row["id"], PRINCIPAL)["state"] == "interrupted"
    row = start(env, key="rebound")
    profile = media(env, row)
    state["bound"] = False
    with pytest.raises(RecordingError, match="workspace_rebound"):
        service.report(
            service.provider,
            row["id"],
            sequence=0,
            state="completed",
            media=profile,
        )


def test_existing_destination_is_never_overwritten(env):
    service, _, state, _ = env
    row = start(env)
    profile = media(env, row)
    dest = state["scope"].root / row["directory"]
    dest.mkdir(parents=True)
    (dest / "clip_001.mp4").write_text("user content")
    with pytest.raises(FileExistsError):
        service.report(
            service.provider,
            row["id"],
            sequence=0,
            state="completed",
            media=profile,
        )
    assert (dest / "clip_001.mp4").read_text() == "user content"


def test_restart_retains_clips_and_interrupts_orphans(env):
    service, grant, state, spool = env
    first = start(env)
    profile = media(env, first)
    service.report(
        service.provider,
        first["id"],
        sequence=0,
        state="completed",
        media=profile,
    )
    second = service.start("run", PRINCIPAL, grant, "second")
    recovered = RecordingService(
        service.store,
        scope_resolver=service.resolve_scope,
        binding_check=service.binding_check,
        run_check=service.run_check,
    )
    assert recovered.get(first["id"], PRINCIPAL)["clips"]
    assert recovered.get(second["id"], PRINCIPAL)["state"] == "interrupted"
    assert not recovered.capabilities()["available"]


def test_stale_callbacks_and_frame_progress_are_fenced(env):
    service, _, _, spool = env
    row = start(env)
    provider = service.provider
    stored = service.store.get(row["id"])
    service._save(stored, progress_at=time.time() - 20)
    assert service.command(provider)["action"] == "stop"
    assert service.get(row["id"], PRINCIPAL)["reason"] == "capture_stalled"
    service.register("desktop", str(spool))
    with pytest.raises(RecordingError, match="stale_provider"):
        service.report(provider, row["id"], sequence=0, state="recording")


def test_disk_limit_and_invalid_container_are_truthful(env):
    service, _, _, _ = env
    row = start(env)
    profile = media(env, row)
    stored = service.store.get(row["id"])
    service._save(stored, profile={**stored["profile"], "max_bytes": 1})
    with pytest.raises(RecordingError, match="disk_limit"):
        service.report(
            service.provider,
            row["id"],
            sequence=0,
            state="completed",
            media=profile,
        )
    row = start(env, key="invalid-container")
    profile = media(env, row)
    path = env[3] / row["id"] / "capture.mp4"
    path.write_bytes(b"\x1aE\xdf\xa3" + b"webm" * 20)
    with pytest.raises(RecordingError, match="invalid_media"):
        service.report(
            service.provider,
            row["id"],
            sequence=0,
            state="completed",
            media=profile,
        )


def test_expired_provider_cannot_revive_old_grant(env):
    service, grant, _, _ = env
    row = start(env)
    provider = service.provider
    provider.last_seen = time.time() - 20
    with pytest.raises(RecordingError, match="lease_expired"):
        service.command(provider)
    assert service.provider is None
    assert service.get(row["id"], PRINCIPAL)["state"] == "interrupted"
    assert provider.grants == {}


def test_authorized_headless_client_can_discover_live_grant(env):
    service, grant, _, _ = env
    assert (
        service.capabilities(PRINCIPAL)["capture_grants"][0]["grant_id"]
        == grant
    )
    assert service.capabilities("brain_user:8")["capture_grants"] == []
    assert service.capabilities()["capture_grants"] == []


def test_hour_limit_rolls_to_new_clip_without_a_new_consent(env):
    service, _, _, _ = env
    row = start(env)
    profile = media(env, row)
    service.report(service.provider, row["id"], sequence=0, state="recording")
    service.report(
        service.provider,
        row["id"],
        sequence=1,
        state="finalizing",
        reason="clip_limit",
    )
    completed = service.report(
        service.provider,
        row["id"],
        sequence=2,
        state="completed",
        media=profile,
    )
    assert completed["state"] == "completed"
    rows = service.listing(PRINCIPAL)
    assert len(rows) == 2
    assert rows[0]["state"] == "starting"
    assert rows[0]["attempt_id"] == completed["attempt_id"]
    assert service.command(service.provider)["recording_id"] == rows[0]["id"]


def test_finalization_does_not_hold_lifecycle_lock(env, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from app.recording import service as module

    service, _, _, _ = env
    row = start(env)
    profile = media(env, row)
    entered = Event()
    release = Event()
    original = module.atomic_publish

    def slow_copy(*args, **kwargs):
        entered.set()
        assert release.wait(3)
        return original(*args, **kwargs)

    monkeypatch.setattr(module, "atomic_publish", slow_copy)
    with ThreadPoolExecutor() as executor:
        future = executor.submit(
            service.report,
            service.provider,
            row["id"],
            sequence=0,
            state="completed",
            media=profile,
        )
        assert entered.wait(3)
        # Leases, reads and stop requests remain responsive during media I/O.
        try:
            assert service.command(service.provider)["action"] == "stop"
            assert service.get(row["id"], PRINCIPAL)["state"] == "finalizing"
            assert service.stop(row["id"], PRINCIPAL)["state"] == "finalizing"
        finally:
            release.set()
        assert future.result()["state"] == "completed"


def test_provider_without_proved_encoder_is_unavailable(env):
    service, _, _, spool = env
    service.register("desktop", str(spool), formats=[])
    capabilities = service.capabilities()
    assert not capabilities["available"]
    assert capabilities["reason"] == "encoder_unavailable"
    assert capabilities["formats"] == []
