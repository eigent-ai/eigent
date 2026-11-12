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
import io
import json
import logging
import logging.config

from uvicorn.config import LOGGING_CONFIG

from app.auth import file_access
from app.auth.file_access import (
    FILE_ACCESS_TTL_SECONDS,
    FileAccessLogFilter,
    FileAccessScope,
    install_file_access_log_redaction,
    issue_file_access_grant,
    read_file_access_grant,
    redact_file_access,
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


def test_grants_are_redacted_from_request_paths():
    grant, _ = issue_file_access_grant(SCOPE)

    stream = f"/files/stream/a.pdf?path=a.pdf&access={grant}&email=u%40e.com"
    assert redact_file_access(stream) == (
        "/files/stream/a.pdf?path=a.pdf&access=[REDACTED]&email=u%40e.com"
    )
    assert redact_file_access(f"/files/stream?access={grant}") == (
        "/files/stream?access=[REDACTED]"
    )
    assert redact_file_access(f"/api/v1/files/preview/{grant}/site/a.css") == (
        "/api/v1/files/preview/[REDACTED]/site/a.css"
    )
    assert redact_file_access(f"access={grant}&path=a.pdf") == (
        "access=[REDACTED]&path=a.pdf"
    )
    assert redact_file_access("/files?project_id=p&email=e") == (
        "/files?project_id=p&email=e"
    )
    assert grant not in redact_file_access(
        f'127.0.0.1:1 - "GET /files/preview/{grant}/index.html HTTP/1.1" 200'
    )


def test_uvicorn_access_log_never_contains_a_grant(monkeypatch):
    """Uvicorn configures its loggers first; the filter must survive that."""

    grant, _ = issue_file_access_grant(SCOPE)
    access_logger = logging.getLogger("uvicorn.access")
    for attribute, value in (
        ("filters", []),
        ("handlers", []),
        ("level", access_logger.level),
        ("propagate", access_logger.propagate),
        ("disabled", access_logger.disabled),
    ):
        monkeypatch.setattr(access_logger, attribute, value)
    install_file_access_log_redaction()
    install_file_access_log_redaction()
    assert (
        sum(isinstance(f, FileAccessLogFilter) for f in access_logger.filters)
        == 1
    )
    # Uvicorn applies its logging config again when it starts the server.
    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {"access": LOGGING_CONFIG["formatters"]["access"]},
            "handlers": {"access": LOGGING_CONFIG["handlers"]["access"]},
            "loggers": {
                "uvicorn.access": LOGGING_CONFIG["loggers"]["uvicorn.access"]
            },
        }
    )
    assert any(
        isinstance(f, FileAccessLogFilter) for f in access_logger.filters
    )
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logging.Formatter("%(message)s"))
    access_logger.handlers = [handler]
    access_logger.disabled = False

    access_logger.info(
        '%s - "%s %s HTTP/%s" %d',
        "127.0.0.1:50000",
        "GET",
        f"/files/stream/report.pdf?path=report.pdf&access={grant}",
        "1.1",
        206,
    )
    access_logger.info(
        '%s - "%s %s HTTP/%s" %d',
        "127.0.0.1:50000",
        "GET",
        f"/files/preview/{grant}/site/index.html",
        "1.1",
        200,
    )

    output = stream.getvalue()
    assert grant not in output
    assert "access=[REDACTED]" in output
    assert "/files/preview/[REDACTED]/site/index.html" in output
