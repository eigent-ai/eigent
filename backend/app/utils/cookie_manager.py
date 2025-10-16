"""
Electron/Chrome Cookie Manager
用于读取和管理Electron浏览器的cookies
"""
import sqlite3
import os
from typing import List, Dict, Optional
from loguru import logger
import shutil
from datetime import datetime


class CookieManager:
    """Cookie管理器，用于读取和管理浏览器cookies"""

    def __init__(self, user_data_dir: str):
        """
        初始化Cookie管理器

        Args:
            user_data_dir: 浏览器用户数据目录
        """
        self.user_data_dir = user_data_dir
        self.cookies_db_path = os.path.join(user_data_dir, "Cookies")

        # Check for alternative paths
        if not os.path.exists(self.cookies_db_path):
            # Try Network/Cookies path (some Electron versions)
            alt_path = os.path.join(user_data_dir, "Network", "Cookies")
            if os.path.exists(alt_path):
                self.cookies_db_path = alt_path
            else:
                logger.warning(f"Cookies database not found at {self.cookies_db_path}")

    def _get_cookies_connection(self) -> Optional[sqlite3.Connection]:
        """
        获取cookies数据库连接

        Returns:
            数据库连接或None
        """
        if not os.path.exists(self.cookies_db_path):
            logger.warning(f"Cookies database not found: {self.cookies_db_path}")
            return None

        try:
            # Create a temporary copy since the database might be locked
            temp_db_path = self.cookies_db_path + ".tmp"
            shutil.copy2(self.cookies_db_path, temp_db_path)

            # Open the temporary copy
            conn = sqlite3.connect(temp_db_path)
            conn.row_factory = sqlite3.Row
            return conn
        except Exception as e:
            logger.error(f"Error connecting to cookies database: {e}")
            return None

    def _cleanup_temp_db(self):
        """清理临时数据库文件"""
        temp_db_path = self.cookies_db_path + ".tmp"
        try:
            if os.path.exists(temp_db_path):
                os.remove(temp_db_path)
        except Exception as e:
            logger.debug(f"Error cleaning up temp database: {e}")

    def get_cookie_domains(self) -> List[Dict[str, any]]:
        """
        获取所有有cookies的域名列表

        Returns:
            域名列表，包含域名和cookie数量
        """
        conn = self._get_cookies_connection()
        if not conn:
            return []

        try:
            cursor = conn.cursor()

            # Group by host_key (domain) and count cookies
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
                # Convert Chrome timestamp (microseconds since 1601-01-01) to readable format
                try:
                    # Chrome timestamp is microseconds since 1601-01-01 UTC
                    chrome_timestamp = row['last_access']
                    if chrome_timestamp:
                        # Convert to seconds since epoch (1970-01-01)
                        # 11644473600 seconds between 1601-01-01 and 1970-01-01
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
        """
        获取指定域名的所有cookies

        Args:
            domain: 域名

        Returns:
            Cookie列表
        """
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

            # Match exact domain or subdomain pattern
            cursor.execute(query, (domain, f'%.{domain}'))
            rows = cursor.fetchall()

            cookies = []
            for row in rows:
                cookies.append({
                    'domain': row['host_key'],
                    'name': row['name'],
                    'value': row['value'][:50] + '...' if len(row['value']) > 50 else row['value'],  # Truncate long values
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
        """
        删除指定域名的所有cookies

        Args:
            domain: 域名

        Returns:
            是否删除成功
        """
        if not os.path.exists(self.cookies_db_path):
            logger.warning(f"Cookies database not found: {self.cookies_db_path}")
            return False

        try:
            # Direct connection to the actual database (not a copy)
            conn = sqlite3.connect(self.cookies_db_path)
            cursor = conn.cursor()

            # Delete cookies for exact domain and subdomains
            delete_query = """
                DELETE FROM cookies
                WHERE host_key = ? OR host_key LIKE ?
            """

            cursor.execute(delete_query, (domain, f'%.{domain}'))
            deleted_count = cursor.rowcount

            conn.commit()
            conn.close()

            logger.info(f"Deleted {deleted_count} cookies for domain {domain}")
            return True

        except Exception as e:
            logger.error(f"Error deleting cookies for domain {domain}: {e}")
            return False

    def delete_all_cookies(self) -> bool:
        """
        删除所有cookies

        Returns:
            是否删除成功
        """
        if not os.path.exists(self.cookies_db_path):
            logger.warning(f"Cookies database not found: {self.cookies_db_path}")
            return False

        try:
            conn = sqlite3.connect(self.cookies_db_path)
            cursor = conn.cursor()

            cursor.execute("DELETE FROM cookies")
            deleted_count = cursor.rowcount

            conn.commit()
            conn.close()

            logger.info(f"Deleted all {deleted_count} cookies")
            return True

        except Exception as e:
            logger.error(f"Error deleting all cookies: {e}")
            return False

    def search_cookies(self, keyword: str) -> List[Dict[str, any]]:
        """
        搜索包含关键词的cookies

        Args:
            keyword: 搜索关键词

        Returns:
            匹配的域名列表
        """
        domains = self.get_cookie_domains()
        keyword_lower = keyword.lower()

        return [
            domain for domain in domains
            if keyword_lower in domain['domain'].lower()
        ]
