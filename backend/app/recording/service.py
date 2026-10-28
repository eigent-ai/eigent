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

"""Brain-owned lifecycle, leased adapter commands and local-only publication."""

from __future__ import annotations

import secrets
import shutil
import threading
import time
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

from .media import atomic_publish, fingerprint, inspect_mp4, safe_child
from .models import (
    ACTIVE_STATES,
    CAPTURE_STATES,
    FINALIZE_SECONDS,
    FREE_SPACE_FLOOR,
    GRANT_IDLE_SECONDS,
    LEASE_SECONDS,
    MAX_CLIP_SECONDS,
    SPACE_BUDGET_BYTES,
    RecordingError,
    public_record,
)
from .provider import DesktopProvider
from .scope import active_attempt, binding_matches, resolve_scope
from .store import RecordingStore


class RecordingService:
    def __init__(
        self,
        store: RecordingStore,
        *,
        scope_resolver=resolve_scope,
        binding_check=binding_matches,
        run_check=active_attempt,
    ):
        self.store = store
        self.resolve_scope = scope_resolver
        self.binding_check = binding_check
        self.run_check = run_check
        self.provider: DesktopProvider | None = None
        self.lock = threading.RLock()
        self.recover()

    def _save(self, row: dict, **changes):
        return self.store.save(
            {**row, **changes, "updated_at": time.time()},
            expected_version=row["version"],
        )

    def _provider(self) -> DesktopProvider:
        if self.provider is None or not self.provider.available():
            raise RecordingError("provider_unavailable", 503)
        return self.provider

    def register(
        self, instance: str, spool_root: str, formats: list[str] | None = None
    ):
        with self.lock:
            self.disconnect()
            root = Path(spool_root)
            if (
                not root.is_absolute()
                or root.is_symlink()
                or not root.is_dir()
            ):
                raise RecordingError("invalid_provider_spool", 422)
            self.provider = DesktopProvider(
                instance,
                secrets.token_hex(16),
                secrets.token_urlsafe(32),
                str(root.resolve()),
                formats=tuple(
                    formats if formats is not None else ["video/mp4"]
                ),
            )
            return {
                "generation": self.provider.generation,
                "token": self.provider.token,
                "lease_seconds": LEASE_SECONDS,
                "schema_version": 1,
            }

    def authenticate_provider(self, token: str) -> DesktopProvider:
        provider = self.provider
        if (
            not provider
            or not token
            or not secrets.compare_digest(provider.token, token)
        ):
            raise RecordingError("provider_unauthorized", 401)
        return provider

    def capabilities(self, principal: str | None = None):
        with self.lock:
            provider = self.provider
            grants = list(provider.grants.items()) if provider else []
        import os

        secure_io = (
            os.open in os.supports_dir_fd and os.mkdir in os.supports_dir_fd
        )
        available = (
            provider is not None
            and provider.available()
            and bool(provider.formats)
            and secure_io
        )
        return {
            "schema_version": 1,
            "available": available,
            "reason": None
            if available
            else (
                "secure_publication_unavailable"
                if not secure_io
                else (
                    "encoder_unavailable"
                    if provider
                    and provider.available()
                    and not provider.formats
                    else "provider_unavailable"
                )
            ),
            "modes": ["clip"] if available else [],
            "formats": ["video/mp4"] if available else [],
            "source": "eigent-window" if available else None,
            "grant_idle_seconds": GRANT_IDLE_SECONDS,
            "capture_grants": [
                {
                    "grant_id": grant_id,
                    "source": "eigent-window",
                    "idle_expires_at": expires,
                }
                for grant_id, (account, expires) in (
                    grants if available and principal else []
                )
                if expires > time.time()
                and (
                    principal == "desktop_renderer:local"
                    or account == "user_" + principal.split(":", 1)[-1]
                )
            ],
        }

    def authorize(self, run_id: str, principal: str):
        with self.lock:
            scope = self.resolve_scope(run_id, principal)
            grant = self._provider().authorize(scope.account)
            return {
                "grant_id": grant,
                "source": "eigent-window",
                "idle_expires_in": GRANT_IDLE_SECONDS,
            }

    def revoke(self):
        with self.lock:
            if self.provider:
                self.provider.grants.clear()
            for row in self.store.all():
                if row["state"] in CAPTURE_STATES:
                    self.stop(
                        row["id"], row["principal"], reason="grant_revoked"
                    )

    def disconnect(self):
        with self.lock:
            self.revoke()
            for row in self.store.all():
                if row["state"] in ACTIVE_STATES:
                    self._save(
                        row,
                        state="interrupted",
                        reason="provider_disconnected",
                        ended_at=time.time(),
                    )
            self.provider = None

    def start(self, run_id: str, principal: str, grant_id: str, key: str):
        with self.lock:
            for row in self.store.all(principal):
                if row["idempotency_key"] == key:
                    if row["run_id"] != run_id:
                        raise RecordingError("idempotency_conflict")
                    return public_record(row)
            scope = self.resolve_scope(run_id, principal)
            provider = self._provider()
            if not self.capabilities()["available"]:
                raise RecordingError(self.capabilities()["reason"], 503)
            provider.check_grant(grant_id, scope.account)
            for row in self.store.all():
                if row["state"] in ACTIVE_STATES:
                    raise RecordingError(
                        "source_busy", active_recording_id=row["id"]
                    )
            root = scope.root
            if shutil.disk_usage(root).free < FREE_SPACE_FLOOR:
                raise RecordingError("disk_limit", 507)
            used = sum(
                c["bytes"]
                for r in self.store.all()
                if r["root"] == str(root)
                for c in r["clips"]
            )
            if used >= SPACE_BUDGET_BYTES:
                raise RecordingError("disk_limit", 507)
            recording_id = secrets.token_hex(16)
            directory = (
                "recordings/"
                + datetime.now().strftime("%Y-%m-%d_%H%M%S")
                + "_"
                + recording_id[:8]
            )
            destination = safe_child(root, directory)
            if destination.exists():
                raise RecordingError("destination_exists")
            row = {
                **asdict(scope),
                "root": str(root),
                "id": recording_id,
                "directory": directory,
                "fingerprint": fingerprint(root),
                "provider_generation": provider.generation,
                "source": "eigent-window",
                "grant_id": grant_id,
                "idempotency_key": key,
                "mode": "clip",
                "state": "starting",
                "reason": None,
                "clips": [],
                "schema_version": 1,
                "created_at": time.time(),
                "updated_at": time.time(),
                "started_at": None,
                "ended_at": None,
                "progress_at": time.time(),
                "sequence": -1,
                "profile": {
                    "mime": "video/mp4",
                    "width": 1920,
                    "height": 1080,
                    "fps": 24,
                    "bitrate": 2_500_000,
                    "max_seconds": MAX_CLIP_SECONDS,
                    "max_bytes": min(
                        SPACE_BUDGET_BYTES - used,
                        shutil.disk_usage(root).free - FREE_SPACE_FLOOR,
                    ),
                },
            }
            return public_record(self.store.save(row))

    def get(self, recording_id: str, principal: str):
        row = self.store.get(recording_id)
        if row["principal"] != principal:
            raise RecordingError("recording_not_found", 404)
        return public_record(row)

    def listing(self, principal: str, **filters):
        return [
            public_record(row)
            for row in self.store.all(principal)
            if all(
                value is None or row.get(key) == value
                for key, value in filters.items()
            )
        ][:200]

    def stop(
        self, recording_id: str, principal: str, *, reason: str | None = None
    ):
        with self.lock:
            self.get(recording_id, principal)
            row = self.store.get(recording_id)
            if row["state"] in CAPTURE_STATES:
                row = self._save(
                    row,
                    state="stopping",
                    reason=reason,
                    stop_requested_at=time.time(),
                )
            return public_record(row)

    def tick(self):
        with self.lock:
            now = time.time()
            if self.provider and not self.provider.available():
                self.disconnect()
                return
            for row in self.store.all():
                if row["state"] not in ACTIVE_STATES:
                    continue
                if not self.provider or not self.provider.available():
                    self._save(
                        row,
                        state="interrupted",
                        reason="provider_disconnected",
                        ended_at=now,
                    )
                    continue
                if row["state"] in CAPTURE_STATES:
                    grant = self.provider.grants.get(row["grant_id"])
                    if grant:
                        self.provider.grants[row["grant_id"]] = (
                            grant[0],
                            now + GRANT_IDLE_SECONDS,
                        )
                    active, attempt = self.run_check(row["run_id"])
                    reason = None
                    try:
                        self._validate_root(row)
                        root_valid = True
                    except (OSError, RecordingError):
                        root_valid = False
                    if not root_valid:
                        reason = "workspace_rebound"
                    elif not active or attempt != row["attempt_id"]:
                        reason = (
                            "task_ended" if not active else "attempt_ended"
                        )
                    elif now - row["progress_at"] > LEASE_SECONDS:
                        reason = "capture_stalled"
                    elif (
                        row["started_at"]
                        and now - row["started_at"] > MAX_CLIP_SECONDS
                    ):
                        reason = "clip_limit"
                    if reason:
                        self.stop(row["id"], row["principal"], reason=reason)
                elif (
                    now - row.get("stop_requested_at", row["updated_at"])
                    > FINALIZE_SECONDS
                ):
                    self._save(
                        row,
                        state="interrupted",
                        reason="finalization_timeout",
                        ended_at=now,
                    )

    def command(self, provider: DesktopProvider):
        with self.lock:
            if provider is not self.provider:
                raise RecordingError("stale_provider", 409)
            if not provider.available():
                self.disconnect()
                raise RecordingError("lease_expired")
            provider.last_seen = time.time()
            self.tick()
            for row in self.store.all():
                if row["state"] not in ACTIVE_STATES:
                    continue
                return {
                    "schema_version": 1,
                    "recording_id": row["id"],
                    "generation": provider.generation,
                    "lease_expires_at": time.time() + LEASE_SECONDS,
                    "action": "start"
                    if row["state"] in CAPTURE_STATES
                    else "stop",
                    "profile": row["profile"],
                }
            return {
                "schema_version": 1,
                "action": "idle",
                "lease_expires_at": time.time() + LEASE_SECONDS,
            }

    def report(
        self,
        provider: DesktopProvider,
        recording_id: str,
        *,
        sequence: int,
        state: str,
        media: dict | None = None,
        reason: str | None = None,
    ):
        with self.lock:
            row = self.store.get(recording_id)
            if (
                provider is not self.provider
                or row["provider_generation"] != provider.generation
            ):
                raise RecordingError("stale_provider")
            if not provider.available():
                raise RecordingError("lease_expired")
            if (
                sequence <= row["sequence"]
                or row["state"] not in ACTIVE_STATES
            ):
                return public_record(row)
            if state == "recording":
                if row["state"] in CAPTURE_STATES:
                    started_at = (media or {}).get("started_at", time.time())
                    if (
                        not isinstance(started_at, (int, float))
                        or not row["created_at"] - 2
                        <= started_at
                        <= time.time() + 1
                    ):
                        raise RecordingError("invalid_capture_timestamp", 422)
                    row = self._save(
                        row,
                        state="recording",
                        sequence=sequence,
                        progress_at=time.time(),
                        started_at=row["started_at"] or started_at,
                    )
            elif state in {"failed", "interrupted", "denied"}:
                row = self._save(
                    row,
                    state=state,
                    sequence=sequence,
                    reason=reason or "source_ended",
                    ended_at=time.time(),
                )
            elif state == "finalizing":
                if row["state"] != "finalizing":
                    row = self._save(
                        row,
                        state="finalizing",
                        sequence=sequence,
                        reason=reason or row["reason"],
                        stop_requested_at=row.get(
                            "stop_requested_at", time.time()
                        ),
                    )
            elif state == "completed":
                if not media:
                    raise RecordingError("invalid_media", 422)
                row = self._save(
                    row,
                    state="finalizing",
                    sequence=sequence,
                    reason=reason or row["reason"],
                    stop_requested_at=row.get(
                        "stop_requested_at", time.time()
                    ),
                )
            else:
                raise RecordingError("invalid_recording_state", 422)
            if state != "completed":
                return public_record(row)
        try:
            row = self.publish(row, provider, media, sequence)
        except RecordingError as exc:
            with self.lock:
                current = self.store.get(row["id"])
                if current["state"] in ACTIVE_STATES:
                    self._save(
                        current,
                        state="interrupted"
                        if exc.code == "workspace_rebound"
                        else "failed",
                        reason=exc.code,
                        ended_at=time.time(),
                    )
            raise

        if (
            state == "completed"
            and row["state"] == "completed"
            and row["reason"] == "clip_limit"
        ):
            active, attempt = self.run_check(row["run_id"])
            if active and attempt == row["attempt_id"]:
                try:
                    self.start(
                        row["run_id"],
                        row["principal"],
                        row["grant_id"],
                        "roll:" + row["id"],
                    )
                except RecordingError:
                    # A budget, revoked grant or ended Task ends capture;
                    # the completed preceding clip stays valid.
                    pass
        return public_record(row)

    def _validate_root(self, row):
        root = Path(row["root"])
        try:
            valid = (
                self.binding_check(row)
                and not root.is_symlink()
                and fingerprint(root) == row["fingerprint"]
            )
        except OSError:
            valid = False
        if not valid:
            raise RecordingError("workspace_rebound")
        return root

    def publish(self, row, provider, media, sequence):
        import math

        from app.utils.workspace_resolver import _filesystem_space_lock

        root = self._validate_root(row)
        # A previously revoked consent can finalize its stopped clip, but cannot
        # initiate or extend capture. Publication never renews a grant.
        source = safe_child(
            Path(provider.spool_root), row["id"] + "/capture.mp4"
        )
        size, digest = inspect_mp4(source)
        duration = media.get("duration", 0)
        if (
            not isinstance(duration, (int, float))
            or not math.isfinite(duration)
            or not 0 < duration <= MAX_CLIP_SECONDS + 10
        ):
            raise RecordingError("invalid_media", 422)
        if (
            size > row["profile"]["max_bytes"]
            or shutil.disk_usage(root).free < size + FREE_SPACE_FLOOR
        ):
            raise RecordingError("disk_limit", 507)
        for key, limit in (("width", 1920), ("height", 1080), ("fps", 60)):
            value = media.get(key)
            if (
                not isinstance(value, (int, float))
                or not math.isfinite(value)
                or not 0 < value <= limit
            ):
                raise RecordingError("invalid_media", 422)
        clip = {
            "id": row["id"] + "_001",
            "relative_path": row["directory"] + "/clip_001.mp4",
            "mime": "video/mp4",
            "container": "mp4",
            "codec": "avc1",
            "bytes": size,
            "sha256": digest,
            "duration": duration,
            "width": media["width"],
            "height": media["height"],
            "fps": media["fps"],
            "attempt_id": row["attempt_id"],
            "captured_at": row["started_at"],
        }
        row = self._save(
            row,
            state="finalizing",
            sequence=sequence,
            pending_clip=clip,
            ended_at=time.time(),
            stop_requested_at=row.get("stop_requested_at", time.time()),
        )
        with _filesystem_space_lock(root):
            self._validate_root(row)
            completed = {
                **row,
                "state": "interrupted"
                if row["reason"]
                in {
                    "source_ended",
                    "capture_stalled",
                    "grant_revoked",
                    "provider_disconnected",
                    "workspace_rebound",
                }
                else "completed",
                "clips": [clip],
            }
            completed.pop("pending_clip", None)
            manifest = {
                key: completed[key]
                for key in (
                    "schema_version",
                    "id",
                    "space_id",
                    "project_id",
                    "task_id",
                    "run_id",
                    "attempt_id",
                    "state",
                    "reason",
                    "created_at",
                    "started_at",
                    "ended_at",
                    "clips",
                )
            }
            safe_child(root, row["directory"])
            atomic_publish(
                root,
                row["directory"],
                source,
                (size, digest),
                row["fingerprint"],
                manifest,
            )
            self._validate_root(row)
            result = self.store.save(
                completed, expected_version=row["version"]
            )
        source.unlink(missing_ok=True)
        return result

    def recover(self):
        import json

        for row in self.store.all():
            if row["state"] not in ACTIVE_STATES:
                continue
            clip = row.get("pending_clip")
            if clip:
                try:
                    root = self._validate_root(row)
                    target = safe_child(root, clip["relative_path"])
                    manifest = safe_child(
                        root, row["directory"] + "/manifest.json"
                    )
                    saved = (
                        json.loads(manifest.read_text())
                        if manifest.is_file()
                        else None
                    )
                    if (
                        saved
                        and saved.get("id") == row["id"]
                        and saved.get("clips") == [clip]
                        and saved.get("state") in {"completed", "interrupted"}
                        and inspect_mp4(target)
                        == (
                            clip["bytes"],
                            clip["sha256"],
                        )
                    ):
                        row = {**row, "clips": [clip]}
                        row.pop("pending_clip", None)
                        self._save(row, state=saved["state"])
                        continue
                except (OSError, RecordingError, ValueError):
                    pass
            self._save(
                row,
                state="interrupted",
                reason="provider_disconnected",
                ended_at=time.time(),
            )
