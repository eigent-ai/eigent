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
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest


@pytest.mark.unit
def test_main_import_enables_system_trust_store_for_httpx(tmp_path):
    """Guard the backend entrypoint's early truststore injection."""
    backend_dir = Path(__file__).resolve().parents[2]
    script = textwrap.dedent(
        """
        import ssl

        import httpx
        import httpx._config
        import truststore

        import main

        if ssl.SSLContext is not truststore.SSLContext:
            raise SystemExit(
                f"ssl.SSLContext was not patched: {ssl.SSLContext!r}"
            )

        ctx = httpx._config.create_ssl_context()
        if not isinstance(ctx, truststore.SSLContext):
            raise SystemExit(
                "httpx did not use truststore after backend startup: "
                f"{type(ctx)!r}"
            )
        """
    )
    env = os.environ.copy()
    env["HOME"] = str(tmp_path)
    env["USERPROFILE"] = str(tmp_path)

    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=backend_dir,
        env=env,
        text=True,
        capture_output=True,
        timeout=30,
    )

    assert result.returncode == 0, result.stdout + result.stderr
