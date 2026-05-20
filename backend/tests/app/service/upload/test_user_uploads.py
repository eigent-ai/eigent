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
from pathlib import Path

import pytest

from app.service.upload.user_uploads import UploadIdError, resolve_user_upload


@pytest.mark.unit
def test_resolve_user_upload_allows_unicode_stored_name(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    workspace = tmp_path / "workspace"
    monkeypatch.setenv("EIGENT_WORKSPACE", str(workspace))
    uploads = workspace / "sess_ok" / "uploads"
    uploads.mkdir(parents=True)
    stored_name = "报告.pdf_123"
    upload_path = uploads / stored_name
    upload_path.write_bytes(b"ok")
    (uploads / f"{stored_name}.meta.json").write_text(
        json.dumps({"original_filename": "报告.pdf"}, ensure_ascii=False),
        encoding="utf-8",
    )

    path, original = resolve_user_upload(f"upload://{stored_name}", "sess_ok")

    assert path == upload_path.resolve()
    assert original == "报告.pdf"


@pytest.mark.unit
def test_resolve_user_upload_allows_middle_dotdot(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    workspace = tmp_path / "workspace"
    monkeypatch.setenv("EIGENT_WORKSPACE", str(workspace))
    uploads = workspace / "sess_ok" / "uploads"
    uploads.mkdir(parents=True)
    stored_name = "version..1.txt_123"
    upload_path = uploads / stored_name
    upload_path.write_bytes(b"ok")

    path, original = resolve_user_upload(f"upload://{stored_name}", "sess_ok")

    assert path == upload_path.resolve()
    assert original == stored_name


@pytest.mark.unit
@pytest.mark.parametrize(
    ("upload_id", "session_id"),
    [
        ("upload://../secret.txt", "sess_ok"),
        ("upload://file.txt.meta.json", "sess_ok"),
        ("upload://file.txt", "../sess_bad"),
    ],
)
def test_resolve_user_upload_rejects_traversal_and_sidecars(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    upload_id: str,
    session_id: str,
):
    monkeypatch.setenv("EIGENT_WORKSPACE", str(tmp_path / "workspace"))

    with pytest.raises(UploadIdError):
        resolve_user_upload(upload_id, session_id)
