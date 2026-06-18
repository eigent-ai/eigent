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

import pytest

from app.utils.cookie_manager import CookieManager


@pytest.mark.unit
class TestCookieManagerTempFile:
    """Tests verifying cookie_manager uses unique temp files via mkstemp."""

    def test_get_cookies_connection_creates_unique_temp(self, tmp_path):
        """_get_cookies_connection should create a uniquely-named temp copy."""
        # Create a minimal SQLite database to act as the cookies DB
        import sqlite3

        cookies_db = tmp_path / "Cookies"
        conn = sqlite3.connect(str(cookies_db))
        conn.execute(
            "CREATE TABLE cookies ("
            "host_key TEXT, name TEXT, value TEXT, path TEXT, "
            "expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, "
            "last_access_utc INTEGER)"
        )
        conn.commit()
        conn.close()

        manager = CookieManager(str(tmp_path))
        result_conn = manager._get_cookies_connection()
        assert result_conn is not None

        # The temp file should NOT be the predictable ".tmp" suffix
        # but a unique mkstemp-generated file
        predictable_tmp = str(cookies_db) + ".tmp"
        # The actual temp file is in the same directory
        temp_files = [
            f
            for f in os.listdir(str(tmp_path))
            if f.endswith(".tmp") and f != "Cookies.tmp"
        ]
        assert len(temp_files) >= 1, (
            "mkstemp temp file not found — still using predictable .tmp suffix?"
        )

        result_conn.close()
        # Cleanup temp files
        for f in temp_files:
            full = os.path.join(str(tmp_path), f)
            if os.path.exists(full):
                os.remove(full)

    def test_missing_cookies_db_returns_none(self, tmp_path):
        """_get_cookies_connection should return None for missing DB."""
        manager = CookieManager(str(tmp_path / "nonexistent"))
        assert manager._get_cookies_connection() is None
