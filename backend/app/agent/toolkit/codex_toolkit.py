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
The resulting access token is an OpenAI API key that can be stored as
OPENAI_API_KEY for agent usage.
"""

import base64
import hashlib
import json
import logging
import os
import secrets
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Optional
from urllib.parse import parse_qs, urlencode, urlparse

import requests

from app.utils.oauth_state_manager import oauth_state_manager

logger = logging.getLogger("codex_toolkit")

# OpenAI / Codex OAuth constants
CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
CODEX_AUTH_URL = "https://auth.openai.com/authorize"
CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token"
CODEX_AUDIENCE = "https://api.openai.com/v1"

# Token lifetime defaults (seconds)
CODEX_TOKEN_DEFAULT_LIFETIME = 3600  # 1 hour
CODEX_TOKEN_REFRESH_THRESHOLD = 300  # 5 minutes before expiry


def _generate_pkce_pair() -> tuple[str, str]:
    r"""Generate a PKCE code_verifier and S256 code_challenge.

    Returns:
        Tuple of (code_verifier, code_challenge).
    """
    code_verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return code_verifier, code_challenge


class _CallbackHandler(BaseHTTPRequestHandler):
    r"""HTTP handler that captures the OAuth callback code."""

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

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
            from html import escape
            self.wfile.write(
                f"<html><body><h1>Authorization failed</h1>"
                f"<p>{escape(error)}: {escape(desc)}</p></body></html>".encode()
            )
        else:
            self.send_response(400)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(
                b"<html><body><h1>Missing authorization code</h1></body></html>"
            )

    def log_message(self, format, *args):
        logger.debug("Codex callback server: %s", format % args)


class CodexOAuthManager:
    r"""Manages OpenAI Codex OAuth token lifecycle."""

    @staticmethod
    def _token_path() -> str:
        return os.path.join(
            os.path.expanduser("~"),
            ".eigent",
            "tokens",
            "codex",
            "codex_token.json",
        )

    @classmethod
    def save_token(cls, token_data: dict) -> bool:
        r"""Save token data to disk.

        Args:
            token_data: Dictionary with at least ``access_token``.

        Returns:
            True on success.
        """
        path = cls._token_path()
        try:
            if "saved_at" not in token_data:
                token_data["saved_at"] = int(time.time())

            if "expires_in" in token_data and "expires_at" not in token_data:
                token_data["expires_at"] = (
                    token_data["saved_at"] + token_data["expires_in"]
                )
            elif "expires_at" not in token_data:
                token_data["expires_at"] = (
                    token_data["saved_at"] + CODEX_TOKEN_DEFAULT_LIFETIME
                )

            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w") as f:
                json.dump(token_data, f, indent=2)
            logger.info("Saved Codex token to %s", path)

            if token_data.get("access_token"):
                os.environ["OPENAI_API_KEY"] = token_data["access_token"]

            return True
        except Exception as e:
            logger.error("Failed to save Codex token: %s", e)
            return False

    @classmethod
    def load_token(cls) -> Optional[dict]:
        r"""Load token data from disk."""
        path = cls._token_path()
        if os.path.exists(path):
            try:
                with open(path) as f:
                    return json.load(f)
            except Exception:
                pass
        return None

    @classmethod
    def clear_token(cls) -> bool:
        r"""Remove stored token and clean environment variable."""
        path = cls._token_path()
        try:
            if os.path.exists(path):
                os.remove(path)
                logger.info("Removed Codex token file: %s", path)

            token_dir = os.path.dirname(path)
            if os.path.exists(token_dir) and not os.listdir(token_dir):
                os.rmdir(token_dir)

            if "OPENAI_API_KEY" in os.environ:
                del os.environ["OPENAI_API_KEY"]

            return True
        except Exception as e:
            logger.error("Failed to clear Codex token: %s", e)
            return False

    @classmethod
    def is_authenticated(cls) -> bool:
        r"""Return True if a Codex/OpenAI token is available."""
        token = cls.load_token()
        if token and token.get("access_token"):
            return True
        return bool(os.environ.get("OPENAI_API_KEY"))

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
    def get_access_token(cls) -> Optional[str]:
        r"""Return the current access token, preferring the stored file."""
        token = cls.load_token()
        if token and token.get("access_token"):
            return token["access_token"]
        return os.environ.get("OPENAI_API_KEY")

    @classmethod
    def get_token_info(cls) -> Optional[dict]:
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
            token.update({
                "access_token": new_token["access_token"],
                "expires_in": new_token.get("expires_in", CODEX_TOKEN_DEFAULT_LIFETIME),
                "saved_at": int(time.time()),
            })
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

                # Start localhost callback server on a random port
                server = HTTPServer(("127.0.0.1", 0), _CallbackHandler)
                server.auth_code = None
                server.auth_error = None
                state.server = server
                port = server.server_address[1]

                redirect_uri = f"http://localhost:{port}/callback"

                params = urlencode({
                    "response_type": "code",
                    "client_id": CODEX_CLIENT_ID,
                    "redirect_uri": redirect_uri,
                    "scope": "openai.organization.read openai.api.read",
                    "audience": CODEX_AUDIENCE,
                    "code_challenge": code_challenge,
                    "code_challenge_method": "S256",
                    "codex_cli_simplified_flow": "true",
                })
                auth_url = f"{CODEX_AUTH_URL}?{params}"

                if state.is_cancelled():
                    server.server_close()
                    return

                logger.info("Opening browser for Codex OAuth on port %d", port)
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
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
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
