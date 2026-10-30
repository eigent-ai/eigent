"""Run offline Memory regressions without reading the user's configuration.

Usage from the repository root:
    backend/.venv/bin/python backend/tests/run_isolated_memory_tests.py \
        tests/app/lightweight_memory/test_extraction_budget.py --fast-test-mode -q

This is a test-process bootstrap, not an application environment setting.
"""

from __future__ import annotations

import os
import socket
import sys
import tempfile
from pathlib import Path


def main() -> int:
    backend = Path(__file__).resolve().parents[1]
    isolation = Path(tempfile.mkdtemp(prefix="eigent-memory-extraction-test-"))
    original_expanduser = os.path.expanduser

    def isolated_expanduser(value):
        value = os.fspath(value)
        if isinstance(value, str) and (value == "~" or value.startswith("~/")):
            return str(isolation) + value[1:]
        return original_expanduser(value)

    def block_network(*_args, **_kwargs):
        raise OSError("Network disabled in isolated Memory tests")

    os.path.expanduser = isolated_expanduser
    os.environ.update(
        {
            "EIGENT_RUN_JOURNAL_PATH": str(isolation / "fallback.sqlite3"),
            "CAMEL_LOG_DIR": str(isolation / "logs"),
            "file_save_path": str(isolation / "workspace"),
            "TIKTOKEN_CACHE_DIR": str(isolation / "tiktoken"),
            "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
        }
    )
    socket.socket.connect = block_network
    socket.socket.connect_ex = block_network

    import dotenv
    import dotenv.main

    dotenv.load_dotenv = dotenv.main.load_dotenv = lambda *a, **k: False
    dotenv.dotenv_values = dotenv.main.dotenv_values = lambda *a, **k: {}
    os.chdir(backend)
    sys.path.insert(0, str(backend))

    import pytest

    pytest.register_assert_rewrite("pytest_asyncio")
    return pytest.main(["-p", "pytest_asyncio.plugin", *sys.argv[1:]])


if __name__ == "__main__":
    raise SystemExit(main())
