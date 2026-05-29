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

import os
import sys
from types import SimpleNamespace

os.environ.setdefault("database_url", "sqlite:////private/tmp/eigent_space_lock_test.db")

from app.domains.space.service import apply_service


class _FakeUrl:
    def __init__(self, backend_name: str) -> None:
        self.backend_name = backend_name

    def get_backend_name(self) -> str:
        return self.backend_name


def test_space_write_lock_uses_thread_lock_for_non_postgres(monkeypatch):
    class FakeEngine:
        url = _FakeUrl("sqlite")

        def connect(self):  # pragma: no cover - should not be called.
            raise AssertionError("non-Postgres lock should not open a DB connection")

    monkeypatch.setitem(sys.modules, "app.core.database", SimpleNamespace(engine=FakeEngine()))

    with apply_service.space_write_lock("space_a"):
        pass


def test_space_write_lock_uses_postgres_advisory_lock(monkeypatch):
    calls: list[tuple[str, dict[str, int]]] = []

    class FakeConnection:
        def execute(self, statement, params):
            calls.append((str(statement), dict(params)))

        def close(self):
            calls.append(("close", {}))

    class FakeEngine:
        url = _FakeUrl("postgresql")

        def connect(self):
            return FakeConnection()

    monkeypatch.setitem(sys.modules, "app.core.database", SimpleNamespace(engine=FakeEngine()))

    with apply_service.space_write_lock("space_a"):
        pass

    assert calls[0][0] == "SELECT pg_advisory_lock(:lock_key)"
    assert calls[1][0] == "SELECT pg_advisory_unlock(:lock_key)"
    assert calls[0][1]["lock_key"] == calls[1][1]["lock_key"]
    assert calls[2] == ("close", {})
