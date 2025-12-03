import pytest
import sqlite3
import os
import tempfile
from unittest.mock import MagicMock, patch, call

from app.utils.cookie_manager import CookieManager


@pytest.mark.unit
class TestCookieManagerInit:
    """Test cases for CookieManager initialization."""

    def test_init_with_partition_cookies(self):
        """Test initialization when partition cookies exist."""
        user_data_dir = "/test/user/data"
        partition_path = os.path.join(user_data_dir, "Partitions", "user_login", "Cookies")

        with patch("os.path.exists") as mock_exists:
            mock_exists.side_effect = lambda path: path == partition_path

            manager = CookieManager(user_data_dir)

            assert manager.user_data_dir == user_data_dir
            assert manager.cookies_db_path == partition_path

    def test_init_with_default_cookies(self):
        """Test initialization with default cookies location."""
        user_data_dir = "/test/user/data"
        default_path = os.path.join(user_data_dir, "Cookies")
        partition_path = os.path.join(user_data_dir, "Partitions", "user_login", "Cookies")

        with patch("os.path.exists") as mock_exists:
            mock_exists.side_effect = lambda path: path == default_path

            manager = CookieManager(user_data_dir)

            assert manager.cookies_db_path == default_path

    def test_init_with_network_cookies(self):
        """Test initialization with Network cookies location."""
        user_data_dir = "/test/user/data"
        network_path = os.path.join(user_data_dir, "Network", "Cookies")

        with patch("os.path.exists") as mock_exists:
            def exists_side_effect(path):
                if "Partitions" in path:
                    return False
                if path == os.path.join(user_data_dir, "Cookies"):
                    return False
                if path == network_path:
                    return True
                return False

            mock_exists.side_effect = exists_side_effect

            manager = CookieManager(user_data_dir)

            assert manager.cookies_db_path == network_path

    def test_init_with_no_cookies_database(self):
        """Test initialization when no cookies database exists."""
        user_data_dir = "/test/user/data"
        default_path = os.path.join(user_data_dir, "Cookies")

        with patch("os.path.exists", return_value=False):
            manager = CookieManager(user_data_dir)

            # Should default to standard Cookies path even if doesn't exist
            assert manager.cookies_db_path == default_path


@pytest.mark.unit
class TestCookieManagerConnection:
    """Test cases for database connection management."""

    def test_get_cookies_connection_success(self, tmp_path):
        """Test successful database connection with temp copy."""
        user_data_dir = str(tmp_path)
        cookies_db = tmp_path / "Cookies"

        # Create a simple SQLite database
        conn = sqlite3.connect(str(cookies_db))
        conn.execute("CREATE TABLE cookies (id INTEGER PRIMARY KEY, name TEXT)")
        conn.commit()
        conn.close()

        with patch("os.path.exists", return_value=True):
            manager = CookieManager(user_data_dir)
            manager.cookies_db_path = str(cookies_db)

            connection = manager._get_cookies_connection()

            assert connection is not None
            assert isinstance(connection, sqlite3.Connection)
            assert connection.row_factory == sqlite3.Row

            connection.close()

            # Verify temp file was created
            temp_db_path = str(cookies_db) + ".tmp"
            assert os.path.exists(temp_db_path)

    def test_get_cookies_connection_missing_database(self):
        """Test connection when database doesn't exist."""
        with patch("os.path.exists", return_value=False):
            manager = CookieManager("/test/path")
            manager.cookies_db_path = "/nonexistent/Cookies"

            connection = manager._get_cookies_connection()

            assert connection is None

    def test_get_cookies_connection_error(self, tmp_path):
        """Test connection error handling."""
        user_data_dir = str(tmp_path)
        manager = CookieManager(user_data_dir)
        manager.cookies_db_path = "/invalid/path/Cookies"

        with patch("os.path.exists", return_value=True):
            with patch("shutil.copy2", side_effect=Exception("Copy error")):
                connection = manager._get_cookies_connection()

                assert connection is None

    def test_cleanup_temp_db(self, tmp_path):
        """Test temporary database cleanup."""
        cookies_db = tmp_path / "Cookies"
        temp_db = tmp_path / "Cookies.tmp"

        # Create temp file
        temp_db.touch()
        assert temp_db.exists()

        manager = CookieManager(str(tmp_path))
        manager.cookies_db_path = str(cookies_db)
        manager._cleanup_temp_db()

        assert not temp_db.exists()

    def test_cleanup_temp_db_nonexistent(self, tmp_path):
        """Test cleanup when temp file doesn't exist."""
        manager = CookieManager(str(tmp_path))
        manager.cookies_db_path = str(tmp_path / "Cookies")

        # Should not raise error
        manager._cleanup_temp_db()


@pytest.mark.unit
class TestCookieManagerGetDomains:
    """Test cases for getting cookie domains."""

    def test_get_cookie_domains_success(self):
        """Test successfully retrieving cookie domains."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor

        # Mock database rows
        mock_rows = [
            {'domain': 'example.com', 'cookie_count': 5, 'last_access': 13320000000000000},
            {'domain': 'google.com', 'cookie_count': 3, 'last_access': 13320001000000000},
        ]
        mock_cursor.fetchall.return_value = mock_rows

        manager = CookieManager("/test/path")

        with patch.object(manager, '_get_cookies_connection', return_value=mock_conn):
            with patch.object(manager, '_cleanup_temp_db'):
                domains = manager.get_cookie_domains()

        assert len(domains) == 2
        assert domains[0]['domain'] == 'example.com'
        assert domains[0]['cookie_count'] == 5
        assert 'last_access' in domains[0]
        assert domains[1]['domain'] == 'google.com'
        mock_conn.close.assert_called_once()

    def test_get_cookie_domains_no_connection(self):
        """Test get domains when connection fails."""
        manager = CookieManager("/test/path")

        with patch.object(manager, '_get_cookies_connection', return_value=None):
            domains = manager.get_cookie_domains()

        assert domains == []

    def test_get_cookie_domains_database_error(self):
        """Test get domains with database error."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.execute.side_effect = Exception("Database error")

        manager = CookieManager("/test/path")

        with patch.object(manager, '_get_cookies_connection', return_value=mock_conn):
            with patch.object(manager, '_cleanup_temp_db'):
                domains = manager.get_cookie_domains()

        assert domains == []
        mock_conn.close.assert_called_once()

    def test_get_cookie_domains_timestamp_conversion_error(self):
        """Test handling of timestamp conversion errors."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor

        # Mock row with invalid timestamp
        mock_rows = [
            {'domain': 'example.com', 'cookie_count': 5, 'last_access': None},
            {'domain': 'test.com', 'cookie_count': 2, 'last_access': 0},
        ]
        mock_cursor.fetchall.return_value = mock_rows

        manager = CookieManager("/test/path")

        with patch.object(manager, '_get_cookies_connection', return_value=mock_conn):
            with patch.object(manager, '_cleanup_temp_db'):
                domains = manager.get_cookie_domains()

        assert len(domains) == 2
        assert domains[0]['last_access'] == "Never"


@pytest.mark.unit
class TestCookieManagerGetCookiesForDomain:
    """Test cases for getting cookies for a specific domain."""

    def test_get_cookies_for_domain_success(self):
        """Test successfully retrieving cookies for a domain."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor

        # Mock cookie rows
        mock_rows = [
            {
                'host_key': 'example.com',
                'name': 'session_id',
                'value': 'abc123xyz',
                'path': '/',
                'is_secure': 1,
                'is_httponly': 1
            },
            {
                'host_key': 'www.example.com',
                'name': 'user_pref',
                'value': 'dark_mode',
                'path': '/settings',
                'is_secure': 0,
                'is_httponly': 0
            }
        ]
        mock_cursor.fetchall.return_value = mock_rows

        manager = CookieManager("/test/path")

        with patch.object(manager, '_get_cookies_connection', return_value=mock_conn):
            with patch.object(manager, '_cleanup_temp_db'):
                cookies = manager.get_cookies_for_domain("example.com")

        assert len(cookies) == 2
        assert cookies[0]['domain'] == 'example.com'
        assert cookies[0]['name'] == 'session_id'
        assert cookies[0]['value'] == 'abc123xyz'
        assert cookies[0]['secure'] is True
        assert cookies[0]['httponly'] is True
        mock_conn.close.assert_called_once()

    def test_get_cookies_for_domain_long_value_truncation(self):
        """Test that long cookie values are truncated."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor

        long_value = "a" * 100
        mock_rows = [
            {
                'host_key': 'example.com',
                'name': 'long_cookie',
                'value': long_value,
                'path': '/',
                'is_secure': 1,
                'is_httponly': 0
            }
        ]
        mock_cursor.fetchall.return_value = mock_rows

        manager = CookieManager("/test/path")

        with patch.object(manager, '_get_cookies_connection', return_value=mock_conn):
            with patch.object(manager, '_cleanup_temp_db'):
                cookies = manager.get_cookies_for_domain("example.com")

        assert len(cookies[0]['value']) == 53  # 50 chars + '...'
        assert cookies[0]['value'].endswith('...')

    def test_get_cookies_for_domain_no_connection(self):
        """Test get cookies when connection fails."""
        manager = CookieManager("/test/path")

        with patch.object(manager, '_get_cookies_connection', return_value=None):
            cookies = manager.get_cookies_for_domain("example.com")

        assert cookies == []

    def test_get_cookies_for_domain_database_error(self):
        """Test get cookies with database error."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.execute.side_effect = Exception("Query error")

        manager = CookieManager("/test/path")

        with patch.object(manager, '_get_cookies_connection', return_value=mock_conn):
            with patch.object(manager, '_cleanup_temp_db'):
                cookies = manager.get_cookies_for_domain("example.com")

        assert cookies == []
        mock_conn.close.assert_called_once()


@pytest.mark.unit
class TestCookieManagerDeleteCookies:
    """Test cases for deleting cookies."""

    def test_delete_cookies_for_domain_success(self):
        """Test successfully deleting cookies for a domain."""
        manager = CookieManager("/test/path")
        manager.cookies_db_path = "/test/Cookies"

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.rowcount = 5
        mock_conn.cursor.return_value = mock_cursor

        with patch("os.path.exists", return_value=True):
            with patch("sqlite3.connect", return_value=mock_conn):
                with patch.object(manager, '_cleanup_wal_files'):
                    result = manager.delete_cookies_for_domain("example.com")

        assert result is True
        assert mock_cursor.execute.call_count == 2  # DELETE + VACUUM
        mock_cursor.execute.assert_any_call(
            "\n                DELETE FROM cookies\n                WHERE host_key = ? OR host_key LIKE ?\n            ",
            ("example.com", "%.example.com")
        )
        mock_cursor.execute.assert_any_call("VACUUM")
        assert mock_conn.commit.call_count == 2
        mock_conn.close.assert_called_once()

    def test_delete_cookies_for_domain_missing_database(self):
        """Test delete cookies when database doesn't exist."""
        manager = CookieManager("/test/path")
        manager.cookies_db_path = "/nonexistent/Cookies"

        with patch("os.path.exists", return_value=False):
            result = manager.delete_cookies_for_domain("example.com")

        assert result is False

    def test_delete_cookies_for_domain_error(self):
        """Test delete cookies with database error."""
        manager = CookieManager("/test/path")
        manager.cookies_db_path = "/test/Cookies"

        with patch("os.path.exists", return_value=True):
            with patch("sqlite3.connect", side_effect=Exception("Connection error")):
                result = manager.delete_cookies_for_domain("example.com")

        assert result is False

    def test_delete_all_cookies_success(self):
        """Test successfully deleting all cookies."""
        manager = CookieManager("/test/path")
        manager.cookies_db_path = "/test/Cookies"

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.rowcount = 20
        mock_conn.cursor.return_value = mock_cursor

        with patch("os.path.exists", return_value=True):
            with patch("sqlite3.connect", return_value=mock_conn):
                with patch.object(manager, '_cleanup_wal_files'):
                    result = manager.delete_all_cookies()

        assert result is True
        mock_cursor.execute.assert_any_call("DELETE FROM cookies")
        mock_cursor.execute.assert_any_call("VACUUM")
        assert mock_conn.commit.call_count == 2
        mock_conn.close.assert_called_once()

    def test_delete_all_cookies_missing_database(self):
        """Test delete all cookies when database doesn't exist."""
        manager = CookieManager("/test/path")
        manager.cookies_db_path = "/nonexistent/Cookies"

        with patch("os.path.exists", return_value=False):
            result = manager.delete_all_cookies()

        assert result is False

    def test_delete_all_cookies_error(self):
        """Test delete all cookies with database error."""
        manager = CookieManager("/test/path")
        manager.cookies_db_path = "/test/Cookies"

        with patch("os.path.exists", return_value=True):
            with patch("sqlite3.connect", side_effect=Exception("Delete error")):
                result = manager.delete_all_cookies()

        assert result is False


@pytest.mark.unit
class TestCookieManagerWALCleanup:
    """Test cases for WAL file cleanup."""

    def test_cleanup_wal_files_success(self, tmp_path):
        """Test successfully cleaning up WAL files."""
        cookies_db = tmp_path / "Cookies"
        wal_file = tmp_path / "Cookies-wal"
        shm_file = tmp_path / "Cookies-shm"
        journal_file = tmp_path / "Cookies-journal"

        # Create files
        wal_file.touch()
        shm_file.touch()
        journal_file.touch()

        manager = CookieManager(str(tmp_path))
        manager.cookies_db_path = str(cookies_db)
        manager._cleanup_wal_files()

        assert not wal_file.exists()
        assert not shm_file.exists()
        assert not journal_file.exists()

    def test_cleanup_wal_files_partial_exists(self, tmp_path):
        """Test cleanup when only some WAL files exist."""
        cookies_db = tmp_path / "Cookies"
        wal_file = tmp_path / "Cookies-wal"

        # Create only WAL file
        wal_file.touch()

        manager = CookieManager(str(tmp_path))
        manager.cookies_db_path = str(cookies_db)
        manager._cleanup_wal_files()

        assert not wal_file.exists()

    def test_cleanup_wal_files_no_files(self, tmp_path):
        """Test cleanup when no WAL files exist."""
        cookies_db = tmp_path / "Cookies"

        manager = CookieManager(str(tmp_path))
        manager.cookies_db_path = str(cookies_db)

        # Should not raise error
        manager._cleanup_wal_files()

    def test_cleanup_wal_files_error(self, tmp_path):
        """Test cleanup with removal error."""
        cookies_db = tmp_path / "Cookies"

        manager = CookieManager(str(tmp_path))
        manager.cookies_db_path = str(cookies_db)

        with patch("os.path.exists", return_value=True):
            with patch("os.remove", side_effect=Exception("Permission denied")):
                # Should not raise error, just log warning
                manager._cleanup_wal_files()


@pytest.mark.unit
class TestCookieManagerSearch:
    """Test cases for searching cookies."""

    def test_search_cookies_success(self):
        """Test successfully searching cookies by keyword."""
        manager = CookieManager("/test/path")

        mock_domains = [
            {'domain': 'example.com', 'cookie_count': 5, 'last_access': '2024-01-01 12:00:00'},
            {'domain': 'google.com', 'cookie_count': 3, 'last_access': '2024-01-02 12:00:00'},
            {'domain': 'example.org', 'cookie_count': 2, 'last_access': '2024-01-03 12:00:00'},
            {'domain': 'facebook.com', 'cookie_count': 8, 'last_access': '2024-01-04 12:00:00'},
        ]

        with patch.object(manager, 'get_cookie_domains', return_value=mock_domains):
            results = manager.search_cookies("example")

        assert len(results) == 2
        assert results[0]['domain'] == 'example.com'
        assert results[1]['domain'] == 'example.org'

    def test_search_cookies_case_insensitive(self):
        """Test that search is case insensitive."""
        manager = CookieManager("/test/path")

        mock_domains = [
            {'domain': 'Example.COM', 'cookie_count': 5, 'last_access': '2024-01-01 12:00:00'},
            {'domain': 'google.com', 'cookie_count': 3, 'last_access': '2024-01-02 12:00:00'},
        ]

        with patch.object(manager, 'get_cookie_domains', return_value=mock_domains):
            results = manager.search_cookies("EXAMPLE")

        assert len(results) == 1
        assert results[0]['domain'] == 'Example.COM'

    def test_search_cookies_no_matches(self):
        """Test search with no matches."""
        manager = CookieManager("/test/path")

        mock_domains = [
            {'domain': 'example.com', 'cookie_count': 5, 'last_access': '2024-01-01 12:00:00'},
            {'domain': 'google.com', 'cookie_count': 3, 'last_access': '2024-01-02 12:00:00'},
        ]

        with patch.object(manager, 'get_cookie_domains', return_value=mock_domains):
            results = manager.search_cookies("nonexistent")

        assert len(results) == 0

    def test_search_cookies_empty_list(self):
        """Test search with empty domain list."""
        manager = CookieManager("/test/path")

        with patch.object(manager, 'get_cookie_domains', return_value=[]):
            results = manager.search_cookies("example")

        assert len(results) == 0


@pytest.mark.integration
class TestCookieManagerIntegration:
    """Integration tests for CookieManager with real SQLite database."""

    def test_full_workflow(self, tmp_path):
        """Test complete workflow: create, read, search, delete cookies."""
        user_data_dir = tmp_path
        cookies_db = user_data_dir / "Cookies"

        # Create a real SQLite database with cookies schema
        conn = sqlite3.connect(str(cookies_db))
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE cookies (
                host_key TEXT,
                name TEXT,
                value TEXT,
                path TEXT,
                expires_utc INTEGER,
                is_secure INTEGER,
                is_httponly INTEGER,
                last_access_utc INTEGER
            )
        """)

        # Insert test cookies
        test_cookies = [
            ('example.com', 'session', 'abc123', '/', 0, 1, 1, 13320000000000000),
            ('example.com', 'user', 'john', '/', 0, 0, 0, 13320000000000000),
            ('google.com', 'pref', 'en', '/', 0, 1, 0, 13320001000000000),
        ]
        cursor.executemany(
            "INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            test_cookies
        )
        conn.commit()
        conn.close()

        # Initialize manager
        manager = CookieManager(str(user_data_dir))

        # Test get_cookie_domains
        domains = manager.get_cookie_domains()
        assert len(domains) == 2

        # Test get_cookies_for_domain
        cookies = manager.get_cookies_for_domain("example.com")
        assert len(cookies) == 2

        # Test search_cookies
        results = manager.search_cookies("example")
        assert len(results) == 1

        # Test delete_cookies_for_domain
        success = manager.delete_cookies_for_domain("example.com")
        assert success is True

        # Verify deletion
        domains_after = manager.get_cookie_domains()
        assert len(domains_after) == 1
        assert domains_after[0]['domain'] == 'google.com'

        # Test delete_all_cookies
        success = manager.delete_all_cookies()
        assert success is True

        # Verify all deleted
        domains_final = manager.get_cookie_domains()
        assert len(domains_final) == 0
