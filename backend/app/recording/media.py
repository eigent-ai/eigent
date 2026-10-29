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

"""Bounded ISO-BMFF structure validation; never infer a container from its suffix."""

import hashlib
import os
from pathlib import Path

from .models import RecordingError


def inspect_mp4(path: Path) -> tuple[int, str]:
    size = path.stat().st_size
    if size < 32:
        raise RecordingError("invalid_media", 422)
    flags = set()
    digest = hashlib.sha256()
    with path.open("rb") as media:
        offset = 0
        atoms = 0
        while offset < size:
            media.seek(offset)
            head = media.read(16)
            if len(head) < 8:
                raise RecordingError("invalid_media", 422)
            length = int.from_bytes(head[:4], "big")
            atom = head[4:8]
            minimum = 8
            if length == 1:
                length = int.from_bytes(head[8:16], "big")
                minimum = 16
            if length == 0:
                length = size - offset
            if length < minimum or offset + length > size:
                raise RecordingError("invalid_media", 422)
            flags.add(atom)
            if offset == 0 and atom != b"ftyp":
                raise RecordingError("invalid_media", 422)
            offset += length
            atoms += 1
            if atoms > 100_000:
                raise RecordingError("invalid_media", 422)
        if not {b"ftyp", b"moov", b"mdat"}.issubset(flags):
            raise RecordingError("invalid_media", 422)
        media.seek(0)
        while chunk := media.read(1024 * 1024):
            digest.update(chunk)
    return size, digest.hexdigest()


def fingerprint(root: Path) -> list[int]:
    stat = root.stat()
    return [stat.st_dev, stat.st_ino]


def safe_child(root: Path, relative: str) -> Path:
    path = root / relative
    if not path.is_relative_to(root) or any(
        p in {"..", "."} for p in Path(relative).parts
    ):
        raise RecordingError("workspace_rebound")
    cursor = root
    for part in Path(relative).parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise RecordingError("workspace_rebound")
    return path


def open_private(path: Path, flags: int, mode=0o600):
    return os.open(path, flags | getattr(os, "O_NOFOLLOW", 0), mode)


def atomic_publish(
    root: Path,
    directory: str,
    source: Path,
    expected: tuple[int, str],
    expected_root: list[int],
    manifest: dict,
):
    """Anchor every destination operation to directory handles, never rewalk paths."""
    import json

    if os.open not in os.supports_dir_fd or os.mkdir not in os.supports_dir_fd:
        raise RecordingError("secure_publication_unavailable", 503)
    handles = []
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    try:
        root_fd = os.open(root, flags)
        handles.append(root_fd)
        stat = os.fstat(root_fd)
        if [stat.st_dev, stat.st_ino] != expected_root:
            raise RecordingError("workspace_rebound")
        parts = Path(directory).parts
        if (
            len(parts) != 2
            or parts[0] != "recordings"
            or any(part in {".", ".."} for part in parts)
        ):
            raise RecordingError("invalid_recording_destination", 422)
        try:
            os.mkdir("recordings", mode=0o700, dir_fd=root_fd)
        except FileExistsError:
            pass
        parent_fd = os.open("recordings", flags, dir_fd=root_fd)
        handles.append(parent_fd)
        os.mkdir(parts[1], mode=0o700, dir_fd=parent_fd)
        directory_fd = os.open(parts[1], flags, dir_fd=parent_fd)
        handles.append(directory_fd)
        stage_fd = os.open(
            ".clip_001.part",
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
            dir_fd=directory_fd,
        )
        digest = hashlib.sha256()
        total = 0
        with os.fdopen(stage_fd, "wb") as out:
            with os.fdopen(
                open_private(source, os.O_RDONLY), "rb"
            ) as original:
                while chunk := original.read(1024 * 1024):
                    total += len(chunk)
                    if total > expected[0]:
                        raise RecordingError("media_hash_mismatch", 422)
                    out.write(chunk)
                    digest.update(chunk)
            out.flush()
            os.fsync(out.fileno())
        if (total, digest.hexdigest()) != expected:
            raise RecordingError("media_hash_mismatch", 422)
        # A hard link publishes complete bytes atomically and fails if a racing
        # user created the destination. No rename may replace their content.
        os.link(
            ".clip_001.part",
            "clip_001.mp4",
            src_dir_fd=directory_fd,
            dst_dir_fd=directory_fd,
            follow_symlinks=False,
        )
        os.unlink(".clip_001.part", dir_fd=directory_fd)
        sidecar_fd = os.open(
            "manifest.json",
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
            dir_fd=directory_fd,
        )
        with os.fdopen(sidecar_fd, "w") as sidecar:
            json.dump(manifest, sidecar, indent=2)
            sidecar.flush()
            os.fsync(sidecar.fileno())
        os.fsync(directory_fd)
        os.fsync(parent_fd)
    finally:
        for handle in reversed(handles):
            os.close(handle)
