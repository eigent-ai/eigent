from __future__ import annotations

import asyncio
import os
import time

os.environ.setdefault("database_url", "sqlite:///test.db")

from app.core import database


def test_postgres_connections_have_bounded_waits(monkeypatch):
    monkeypatch.delenv("DB_CONNECT_TIMEOUT_SECONDS", raising=False)
    monkeypatch.delenv("DB_LOCK_TIMEOUT_MS", raising=False)
    monkeypatch.delenv("DB_STATEMENT_TIMEOUT_MS", raising=False)
    monkeypatch.delenv("DB_IDLE_IN_TRANSACTION_TIMEOUT_MS", raising=False)

    args = database._database_connect_args("postgresql://postgres:postgres@localhost/eigent")

    assert args["connect_timeout"] == 10
    assert "lock_timeout=5000" in args["options"]
    assert "statement_timeout=120000" in args["options"]
    assert "idle_in_transaction_session_timeout=60000" in args["options"]


def test_non_postgres_connections_do_not_receive_libpq_options():
    assert database._database_connect_args("sqlite:///test.db") == {}


def test_async_session_work_does_not_block_event_loop(monkeypatch):
    class FakeSession:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def rollback(self):
            return None

    monkeypatch.setattr(database, "session_make", FakeSession)

    async def scenario() -> float:
        started = time.monotonic()
        task = asyncio.create_task(database.run_in_session_async(lambda _db: time.sleep(0.15)))
        await asyncio.sleep(0.02)
        tick_elapsed = time.monotonic() - started
        await task
        return tick_elapsed

    assert asyncio.run(scenario()) < 0.1
