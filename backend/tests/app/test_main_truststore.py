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
