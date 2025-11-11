import sqlite3
import os
from typing import List, Dict, Optional
from utils import traceroot_wrapper as traceroot
import shutil
from datetime import datetime

logger = traceroot.get_logger("cookie_manager")


class CookieManager:
    """Manager for reading and managing browser cookies
    from Electron/Chrome SQLite database"""

    def __init__(self, user_data_dir: str):
        self.user_data_dir = user_data_dir

        # Check for cookies in partition directory first (for persist:user_login)
        partition_cookies_path = os.path.join(user_data_dir, "Partitions", "user_login", "Cookies")

        if os.path.exists(partition_cookies_path):
            self.cookies_db_path = partition_cookies_path
            logger.info(f"Using partition cookies at: {partition_cookies_path}")
        else:
            # Fallback to default location
            self.cookies_db_path = os.path.join(user_data_dir, "Cookies")

            if not os.path.exists(self.cookies_db_path):
                alt_path = os.path.join(user_data_dir, "Network", "Cookies")
                if os.path.exists(alt_path):
                    self.cookies_db_path = alt_path
                else:
                    logger.warning(f"Cookies database not found at {self.cookies_db_path} or {partition_cookies_path}")

    def _get_cookies_connection(self) -> Optional[sqlite3.Connection]:
        """Get database connection using a temporary copy to avoid locks"""
        if not os.path.exists(self.cookies_db_path):
            logger.warning(f"Cookies database not found: {self.cookies_db_path}")
            return None

        try:
            temp_db_path = self.cookies_db_path + ".tmp"
            shutil.copy2(self.cookies_db_path, temp_db_path)
            conn = sqlite3.connect(temp_db_path)
            conn.row_factory = sqlite3.Row
            return conn
        except Exception as e:
            logger.error(f"Error connecting to cookies database: {e}")
            return None

    def _cleanup_temp_db(self):
        """Clean up temporary database file"""
        temp_db_path = self.cookies_db_path + ".tmp"
        try:
            if os.path.exists(temp_db_path):
                os.remove(temp_db_path)
        except Exception as e:
            logger.debug(f"Error cleaning up temp database: {e}")

    def get_cookie_domains(self) -> List[Dict[str, any]]:
        """Get list of all domains with cookies"""
        conn = self._get_cookies_connection()
        if not conn:
            return []

        try:
            cursor = conn.cursor()
            query = """
                SELECT
                    host_key as domain,
                    COUNT(*) as cookie_count,
                    MAX(last_access_utc) as last_access
                FROM cookies
                GROUP BY host_key
                ORDER BY last_access DESC
            """
            cursor.execute(query)
            rows = cursor.fetchall()

            domains = []
            for row in rows:
                try:
                    chrome_timestamp = row['last_access']
                    if chrome_timestamp:
                        seconds_since_epoch = (chrome_timestamp / 1000000.0) - 11644473600
                        last_access = datetime.fromtimestamp(seconds_since_epoch).strftime('%Y-%m-%d %H:%M:%S')
                    else:
                        last_access = "Never"
                except Exception as e:
                    logger.debug(f"Error converting timestamp: {e}")
                    last_access = "Unknown"

                domains.append({
                    'domain': row['domain'],
                    'cookie_count': row['cookie_count'],
                    'last_access': last_access
                })

            logger.info(f"Found {len(domains)} domains with cookies")
            return domains

        except Exception as e:
            logger.error(f"Error reading cookies: {e}")
            return []
        finally:
            conn.close()
            self._cleanup_temp_db()

    def get_cookies_for_domain(self, domain: str) -> List[Dict[str, str]]:
        """Get all cookies for a specific domain"""
        conn = self._get_cookies_connection()
        if not conn:
            return []

        try:
            cursor = conn.cursor()
            query = """
                SELECT
                    host_key,
                    name,
                    value,
                    path,
                    expires_utc,
                    is_secure,
                    is_httponly
                FROM cookies
                WHERE host_key = ? OR host_key LIKE ?
                ORDER BY name
            """
            cursor.execute(query, (domain, f'%.{domain}'))
            rows = cursor.fetchall()

            cookies = []
            for row in rows:
                cookies.append({
                    'domain': row['host_key'],
                    'name': row['name'],
                    'value': row['value'][:50] + '...' if len(row['value']) > 50 else row['value'],
                    'path': row['path'],
                    'secure': bool(row['is_secure']),
                    'httponly': bool(row['is_httponly'])
                })

            return cookies

        except Exception as e:
            logger.error(f"Error reading cookies for domain {domain}: {e}")
            return []
        finally:
            conn.close()
            self._cleanup_temp_db()

    def delete_cookies_for_domain(self, domain: str) -> bool:
        """Delete all cookies for a specific domain"""
        if not os.path.exists(self.cookies_db_path):
            logger.warning(f"Cookies database not found: {self.cookies_db_path}")
            return False

        try:
            conn = sqlite3.connect(self.cookies_db_path)
            cursor = conn.cursor()
            delete_query = """
                DELETE FROM cookies
                WHERE host_key = ? OR host_key LIKE ?
            """
            cursor.execute(delete_query, (domain, f'%.{domain}'))
            deleted_count = cursor.rowcount
            conn.commit()

            # IMPORTANT: Execute VACUUM to remove deleted data and compact database
            # This prevents recovery from WAL files
            cursor.execute("VACUUM")
            conn.commit()
            conn.close()

            # Also remove WAL and SHM files to ensure clean state
            self._cleanup_wal_files()

            logger.info(f"Deleted {deleted_count} cookies for domain {domain}")
            return True

        except Exception as e:
            logger.error(f"Error deleting cookies for domain {domain}: {e}")
            return False

    def _cleanup_wal_files(self):
        """Remove SQLite WAL and SHM files"""
        try:
            wal_path = self.cookies_db_path + '-wal'
            shm_path = self.cookies_db_path + '-shm'
            journal_path = self.cookies_db_path + '-journal'

            for path in [wal_path, shm_path, journal_path]:
                if os.path.exists(path):
                    os.remove(path)
                    logger.info(f"Removed temporary file: {path}")
        except Exception as e:
            logger.warning(f"Error cleaning up WAL files: {e}")

    def delete_all_cookies(self) -> bool:
        """Delete all cookies"""
        if not os.path.exists(self.cookies_db_path):
            logger.warning(f"Cookies database not found: {self.cookies_db_path}")
            return False

        try:
            conn = sqlite3.connect(self.cookies_db_path)
            cursor = conn.cursor()
            cursor.execute("DELETE FROM cookies")
            deleted_count = cursor.rowcount
            conn.commit()

            # IMPORTANT: Execute VACUUM to remove deleted data and compact database
            # This prevents recovery from WAL files
            cursor.execute("VACUUM")
            conn.commit()
            conn.close()

            # Also remove WAL and SHM files to ensure clean state
            self._cleanup_wal_files()

            logger.info(f"Deleted all {deleted_count} cookies")
            return True

        except Exception as e:
            logger.error(f"Error deleting all cookies: {e}")
            return False

    def search_cookies(self, keyword: str) -> List[Dict[str, any]]:
        """Search cookies by domain keyword"""
        domains = self.get_cookie_domains()
        keyword_lower = keyword.lower()
        return [
            domain for domain in domains
            if keyword_lower in domain['domain'].lower()
        ]
