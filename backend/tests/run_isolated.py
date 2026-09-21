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

"""Run mock tests with temporary user state and in-process network disabled.

Usage from backend: python -B tests/run_isolated.py --fast-test-mode <tests>
Use this only with unit/mock suites; subprocesses are not sandboxed here.
"""

import os
import socket
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch


def main() -> int:
    backend_root = Path(__file__).resolve().parents[1]
    os.chdir(backend_root)
    sys.path.insert(0, str(backend_root))
    sys.dont_write_bytecode = True
    original_expanduser = os.path.expanduser

    with tempfile.TemporaryDirectory(prefix="eigent-mock-tests-") as temporary:
        state_root = Path(temporary)

        def isolated_expanduser(path):
            value = os.fspath(path)
            if isinstance(value, str) and (
                value == "~" or value.startswith("~/")
            ):
                return str(state_root) + value[1:]
            return original_expanduser(path)

        def deny_network(*args, **kwargs):
            raise AssertionError("Mock tests prohibit network connections")

        environment = {
            "LANGFUSE_ENABLED": "false",
            "PYTHON_DOTENV_DISABLED": "1",
            "CAMEL_LOGGING_DISABLED": "true",
            "CAMEL_MODEL_LOG_ENABLED": "false",
            "EIGENT_RUN_JOURNAL_PATH": str(state_root / "journal.sqlite3"),
            "CAMEL_LOG_DIR": str(state_root / "logs"),
            "file_save_path": str(state_root / "files"),
            "EIGENT_MODEL_CAPABILITY_CATALOG": str(
                backend_root / "app/workspace_config/model_capabilities.json"
            ),
        }
        with (
            patch.dict(os.environ, environment),
            patch("os.path.expanduser", isolated_expanduser),
            patch.object(Path, "home", return_value=state_root),
            patch.object(socket.socket, "connect", deny_network),
            patch.object(socket.socket, "connect_ex", deny_network),
            patch.object(socket, "create_connection", deny_network),
            patch.object(socket, "getaddrinfo", deny_network),
        ):
            import pytest

            return pytest.main(
                [*sys.argv[1:], "--basetemp", str(state_root / "pytest")]
            )


if __name__ == "__main__":
    raise SystemExit(main())
