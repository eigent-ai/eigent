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
r"""OpenAI Codex OAuth manager.

Handles Authorization Code + PKCE flow using Codex CLI's public client_id.
The resulting access token is stored in an encrypted file and used
independently of the OPENAI_API_KEY environment variable.
"""

import base64
import getpass
import hashlib
import json
import logging
import os
import platform
import secrets
import socket
import stat
import threading
import time
import webbrowser
from html import escape as html_escape
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

import requests
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from filelock import FileLock

from app.utils.oauth_state_manager import oauth_state_manager

logger = logging.getLogger("codex_oauth")

# OpenAI / Codex OAuth constants
# Fixed public client_id from the Codex CLI (not a secret).
CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
CODEX_AUTH_URL = "https://auth.openai.com/oauth/authorize"
CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token"
# Fixed callback port used by Codex CLI
CODEX_CALLBACK_PORT = 1455

# Token storage path
CODEX_TOKEN_DIR = os.path.join(
    os.path.expanduser("~"), ".eigent", "tokens", "codex"
)
CODEX_TOKEN_PATH = os.path.join(CODEX_TOKEN_DIR, "codex_token.enc")

# Token lifetime defaults (seconds)
CODEX_TOKEN_DEFAULT_LIFETIME = 3600  # 1 hour
CODEX_TOKEN_REFRESH_THRESHOLD = 300  # 5 minutes before expiry


def _get_machine_identifier() -> bytes:
    r"""Get a machine-specific identifier for key derivation.

    Combines multiple machine-specific values to create a stable identifier
    that is unique to this machine but consistent across restarts.

    Returns:
        Machine identifier as bytes.
    """
    components = [
        getpass.getuser(),
        socket.gethostname(),
        platform.node(),
        # Add home directory path for additional uniqueness
        os.path.expanduser("~"),
    ]

    # Try to get machine-id on Linux
    machine_id_paths = [
        "/etc/machine-id",
        "/var/lib/dbus/machine-id",
    ]
    for path in machine_id_paths:
        try:
            with open(path) as f:
                components.append(f.read().strip())
                break
        except (FileNotFoundError, PermissionError):
            continue

    return "|".join(components).encode("utf-8")


def _derive_encryption_key() -> bytes:
    r"""Derive an encryption key from machine-specific identifiers.

    Uses PBKDF2 to derive a Fernet-compatible key from machine identifiers.
    This ties the encryption to the specific machine without storing a key file.

    Returns:
        The Fernet encryption key as bytes.
    """
    # Fixed salt for this application (not secret, just ensures uniqueness)
    # The security comes from the machine-specific identifier
    app_salt = b"eigent-codex-token-encryption-v1"

    machine_id = _get_machine_identifier()

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=app_salt,
        iterations=100_000,
    )

    # Derive a 32-byte key and encode it as base64 for Fernet
    derived_key = kdf.derive(machine_id)
    return base64.urlsafe_b64encode(derived_key)


def _encrypt_token_data(token_data: dict) -> bytes:
    r"""Encrypt token data using Fernet symmetric encryption.

    Args:
        token_data: Dictionary containing token information.

    Returns:
        Encrypted bytes.
    """
    key = _derive_encryption_key()
    fernet = Fernet(key)
    json_bytes = json.dumps(token_data).encode("utf-8")
    return fernet.encrypt(json_bytes)


def _decrypt_token_data(encrypted_data: bytes) -> dict | None:
    r"""Decrypt token data.

    Args:
        encrypted_data: Encrypted bytes from file.

    Returns:
        Decrypted token dictionary, or None if decryption fails.
    """
    try:
        key = _derive_encryption_key()
        fernet = Fernet(key)
        decrypted = fernet.decrypt(encrypted_data)
        return json.loads(decrypted.decode("utf-8"))
    except (InvalidToken, json.JSONDecodeError) as e:
        logger.warning("Failed to decrypt token data: %s", e)
        return None


def _generate_pkce_pair() -> tuple[str, str]:
    r"""Generate a PKCE code_verifier and S256 code_challenge.

    Returns:
        Tuple of (code_verifier, code_challenge).
    """
    code_verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = (
        base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    )
    return code_verifier, code_challenge


class _CallbackHandler(BaseHTTPRequestHandler):
    r"""HTTP handler that captures the OAuth callback code."""

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        # Validate state parameter to prevent CSRF attacks
        received_state = params.get("state", [None])[0]
        expected_state = getattr(self.server, "expected_state", None)

        if expected_state and received_state != expected_state:
            self.server.auth_error = "state_mismatch: Invalid state parameter"
            self.send_response(400)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(
                b"<html><body><h1>Authorization failed</h1>"
                b"<p>Invalid state parameter. Possible CSRF attack.</p>"
                b"</body></html>"
            )
            return

        if "code" in params:
            self.server.auth_code = params["code"][0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(
                b"<html><body>"
                b"<h1>Authorization successful!</h1>"
                b"<p>You can close this window and return to Eigent.</p>"
                b"</body></html>"
            )
        elif "error" in params:
            error = params.get("error", ["unknown"])[0]
            desc = params.get("error_description", [""])[0]
            self.server.auth_error = f"{error}: {desc}"
            self.send_response(400)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            # Escape HTML to prevent XSS from query parameters
            self.wfile.write(
                f"<html><body><h1>Authorization failed</h1>"
                f"<p>{html_escape(error)}: {html_escape(desc)}</p>"
                f"</body></html>".encode()
            )
        else:
            self.send_response(400)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(
                b"<html><body><h1>"
                b"Missing authorization code"
                b"</h1></body></html>"
            )

    def log_message(self, format, *args):
        logger.debug("Codex callback server: %s", format % args)


class CodexOAuthManager:
    r"""Manages OpenAI Codex OAuth token lifecycle."""

    @staticmethod
    def _token_path() -> str:
        return CODEX_TOKEN_PATH

    @classmethod
    def save_token(cls, token_data: dict) -> bool:
        r"""Save token data to disk with encryption.

        Args:
            token_data: Dictionary with at least ``access_token``.

        Returns:
            True on success.
        """
        path = cls._token_path()
        token_data = token_data.copy()
        try:
            if "saved_at" not in token_data:
                token_data["saved_at"] = int(time.time())

            # Compute absolute expiry from the relative expires_in value
            # (if present), then discard expires_in so we only store the
            # absolute timestamp.
            if "expires_at" not in token_data:
                expires_in = token_data.pop(
                    "expires_in", CODEX_TOKEN_DEFAULT_LIFETIME
                )
                token_data["expires_at"] = token_data["saved_at"] + expires_in
            else:
                token_data.pop("expires_in", None)

            os.makedirs(os.path.dirname(path), exist_ok=True)
            lock = FileLock(path + ".lock")

            # Encrypt token data before saving
            encrypted_data = _encrypt_token_data(token_data)

            with lock, open(path, "wb") as f:
                f.write(encrypted_data)

            # Set restrictive permissions on token file
            os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)

            logger.info("Saved encrypted Codex token to %s", path)

            return True
        except Exception as e:
            logger.error("Failed to save Codex token: %s", e)
            return False

    @classmethod
    def load_token(cls) -> dict | None:
        r"""Load and decrypt token data from disk."""
        path = cls._token_path()
        if os.path.exists(path):
            try:
                lock = FileLock(path + ".lock")
                with lock, open(path, "rb") as f:
                    encrypted_data = f.read()
                return _decrypt_token_data(encrypted_data)
            except Exception as e:
                logger.warning("Failed to load token: %s", e)
        return None

    @classmethod
    def clear_token(cls) -> bool:
        r"""Remove stored token file."""
        path = cls._token_path()
        try:
            if os.path.exists(path):
                os.remove(path)
                logger.info("Removed Codex token file: %s", path)

            token_dir = os.path.dirname(path)
            if os.path.exists(token_dir) and not os.listdir(token_dir):
                os.rmdir(token_dir)

            return True
        except Exception as e:
            logger.error("Failed to clear Codex token: %s", e)
            return False

    @classmethod
    def is_authenticated(cls) -> bool:
        r"""Return True if a Codex OAuth token is available."""
        token = cls.load_token()
        return bool(token and token.get("access_token"))

    @classmethod
    def is_token_expired(cls) -> bool:
        r"""Return True if the stored token has expired."""
        token = cls.load_token()
        if not token:
            return False
        expires_at = token.get("expires_at")
        if not expires_at:
            return False
        return int(time.time()) >= expires_at

    @classmethod
    def is_token_expiring_soon(cls) -> bool:
        r"""Return True if the token expires within the refresh threshold."""
        token = cls.load_token()
        if not token:
            return False
        expires_at = token.get("expires_at")
        if not expires_at:
            return False
        return (expires_at - int(time.time())) < CODEX_TOKEN_REFRESH_THRESHOLD

    @classmethod
    def get_access_token(cls) -> str | None:
        r"""Return the current Codex OAuth access token."""
        token = cls.load_token()
        if token and token.get("access_token"):
            return token["access_token"]
        return None

    @classmethod
    def get_token_info(cls) -> dict | None:
        r"""Return stored token metadata."""
        return cls.load_token()

    @classmethod
    def refresh_token_if_needed(cls) -> bool:
        r"""Attempt to refresh the token if it has a refresh_token.

        Returns:
            True if refreshed or not needed, False on failure.
        """
        token = cls.load_token()
        if not token:
            return False

        if not cls.is_token_expiring_soon():
            return True

        refresh_token = token.get("refresh_token")
        if not refresh_token:
            return False

        try:
            resp = requests.post(
                CODEX_TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "client_id": CODEX_CLIENT_ID,
                    "refresh_token": refresh_token,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=30,
            )
            resp.raise_for_status()
            new_token = resp.json()

            # Merge with existing data
            token.update(
                {
                    "access_token": new_token["access_token"],
                    "expires_in": new_token.get(
                        "expires_in", CODEX_TOKEN_DEFAULT_LIFETIME
                    ),
                    "saved_at": int(time.time()),
                }
            )
            if new_token.get("refresh_token"):
                token["refresh_token"] = new_token["refresh_token"]
            token.pop("expires_at", None)

            return cls.save_token(token)
        except Exception as e:
            logger.error("Failed to refresh Codex token: %s", e)
            return False

    # ------------------------------------------------------------------
    # Background OAuth flow
    # ------------------------------------------------------------------

    @classmethod
    def start_background_auth(cls) -> str:
        r"""Launch the PKCE OAuth flow in a background thread.

        Returns:
            ``"authorizing"`` immediately.
        """
        # Cancel any existing flow
        old_state = oauth_state_manager.get_state("codex")
        if old_state and old_state.status in ["pending", "authorizing"]:
            old_state.cancel()
            if hasattr(old_state, "server") and old_state.server:
                try:
                    old_state.server.shutdown()
                except Exception:
                    pass

        state = oauth_state_manager.create_state("codex")

        def _auth_flow():
            try:
                state.status = "authorizing"
                oauth_state_manager.update_status("codex", "authorizing")

                code_verifier, code_challenge = _generate_pkce_pair()

                # Generate state parameter to prevent CSRF attacks
                oauth_state = secrets.token_urlsafe(32)

                # Start localhost callback server on fixed port 1455 (Codex standard)
                server = HTTPServer(
                    ("127.0.0.1", CODEX_CALLBACK_PORT), _CallbackHandler
                )
                server.auth_code = None
                server.auth_error = None
                server.expected_state = oauth_state
                state.server = server

                redirect_uri = (
                    f"http://localhost:{CODEX_CALLBACK_PORT}/auth/callback"
                )

                params = urlencode(
                    {
                        "response_type": "code",
                        "client_id": CODEX_CLIENT_ID,
                        "redirect_uri": redirect_uri,
                        "scope": "openid profile email offline_access",
                        "code_challenge": code_challenge,
                        "code_challenge_method": "S256",
                        "state": oauth_state,
                        "id_token_add_organizations": "true",
                        "codex_cli_simplified_flow": "true",
                    }
                )
                auth_url = f"{CODEX_AUTH_URL}?{params}"

                if state.is_cancelled():
                    server.server_close()
                    return

                logger.info(
                    "Opening browser for Codex OAuth on port %d",
                    CODEX_CALLBACK_PORT,
                )
                webbrowser.open(auth_url)

                # Wait for the callback (single request)
                server.handle_request()

                if state.is_cancelled():
                    server.server_close()
                    return

                if server.auth_error:
                    raise ValueError(server.auth_error)

                if not server.auth_code:
                    raise ValueError("No authorization code received")

                auth_code = server.auth_code
                server.server_close()

                # Exchange code for token
                token_resp = requests.post(
                    CODEX_TOKEN_URL,
                    data={
                        "grant_type": "authorization_code",
                        "client_id": CODEX_CLIENT_ID,
                        "code": auth_code,
                        "redirect_uri": redirect_uri,
                        "code_verifier": code_verifier,
                    },
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded"
                    },
                    timeout=30,
                )
                token_resp.raise_for_status()
                token_data = token_resp.json()

                if state.is_cancelled():
                    return

                cls.save_token(token_data)

                oauth_state_manager.update_status(
                    "codex", "success", result=token_data
                )
                logger.info("Codex OAuth authorization successful")

            except Exception as e:
                if state.is_cancelled():
                    oauth_state_manager.update_status("codex", "cancelled")
                else:
                    logger.error("Codex OAuth failed: %s", e)
                    oauth_state_manager.update_status(
                        "codex", "failed", error=str(e)
                    )
            finally:
                state.server = None

        thread = threading.Thread(
            target=_auth_flow,
            daemon=True,
            name=f"Codex-OAuth-{state.started_at.timestamp()}",
        )
        state.thread = thread
        thread.start()

        logger.info("Started background Codex OAuth authorization")
        return "authorizing"
