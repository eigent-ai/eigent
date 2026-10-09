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

import base64
import json

from app.auth import file_access
from app.auth.file_access import (
    FILE_ACCESS_TTL_SECONDS,
    FileAccessScope,
    issue_file_access_grant,
    read_file_access_grant,
)

SCOPE = FileAccessScope.of("user@example.com", "project-1", "space-1", "7")


def test_grant_round_trips_its_scope_until_it_expires():
    grant, expires_at = issue_file_access_grant(SCOPE, now=1_000)

    assert expires_at == 1_000 + FILE_ACCESS_TTL_SECONDS
    assert read_file_access_grant(grant, now=expires_at - 1) == SCOPE
    assert read_file_access_grant(grant, now=expires_at) is None


def test_scope_treats_empty_optional_ids_as_absent():
    assert FileAccessScope.of("a@example.com", "p", "", "") == (
        FileAccessScope("a@example.com", "p")
    )


def test_grant_is_url_safe():
    grant, _ = issue_file_access_grant(SCOPE)

    assert set(grant) <= set(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_."
    )


def test_tampered_or_malformed_grants_are_rejected():
    grant, _ = issue_file_access_grant(SCOPE)
    body, signature = grant.split(".")
    payload = json.loads(base64.urlsafe_b64decode(body + "=="))
    payload["project_id"] = "project-2"
    forged_body = (
        base64.urlsafe_b64encode(json.dumps(payload).encode())
        .rstrip(b"=")
        .decode()
    )

    other_last = "B" if signature[-1] == "A" else "A"

    for candidate in (
        None,
        "",
        body,
        f"{forged_body}.{signature}",
        f"{body}.{signature[:-1]}{other_last}",
        f"{body}é.{signature}",
        "user@example.com",
    ):
        assert read_file_access_grant(candidate) is None


def test_grants_do_not_survive_a_new_signing_key(monkeypatch):
    grant, _ = issue_file_access_grant(SCOPE)

    monkeypatch.setattr(file_access, "_signing_key", b"\x00" * 32)

    assert read_file_access_grant(grant) is None
