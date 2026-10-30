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

import base64
import json
import os
from typing import Any

import httpx

from app.model.chat import Chat

RESOLVER_URL_ENV = "CODEX_RESOLVER_URL"
RESOLVER_SECRET_ENV = "CODEX_RESOLVER_SECRET"
MODEL_API_URL_ENV = "CODEX_MODEL_API_URL"
MODEL_DEFAULT_HEADERS_ENV = "CODEX_MODEL_DEFAULT_HEADERS_JSON"
RESOLVER_SECRET_HEADER = "x-eigent-resolver-secret"
DEFAULT_CODEX_API_URL = "https://chatgpt.com/backend-api/codex"


class CodexSubscriptionAuthError(RuntimeError):
    """Raised when the backend cannot get a local-only Codex token."""


def is_codex_subscription_auth(options: Chat) -> bool:
    return options.auth_source == "codex_subscription"


def _resolver_endpoint() -> tuple[str, str]:
    resolver_url = os.getenv(RESOLVER_URL_ENV, "").strip().rstrip("/")
    resolver_secret = os.getenv(RESOLVER_SECRET_ENV, "").strip()
    if not resolver_url or not resolver_secret:
        raise CodexSubscriptionAuthError(
            "Codex subscription resolver is not available. "
            "Restart the desktop app and try again."
        )
    return resolver_url, resolver_secret


def _resolve_access_token(
    email: str, force_refresh: bool = False
) -> dict[str, Any]:
    resolver_url, resolver_secret = _resolver_endpoint()
    try:
        response = httpx.post(
            f"{resolver_url}/codex/token",
            headers={RESOLVER_SECRET_HEADER: resolver_secret},
            json={"email": email, "force_refresh": force_refresh},
            timeout=5.0,
        )
    except httpx.HTTPError as exc:
        raise CodexSubscriptionAuthError(
            "Codex subscription resolver is unreachable."
        ) from exc

    if response.status_code != 200:
        error_code = "unknown_error"
        try:
            payload = response.json()
            if isinstance(payload, dict):
                error_code = str(payload.get("error_code") or error_code)
        except ValueError:
            pass
        raise CodexSubscriptionAuthError(
            f"Codex subscription token is unavailable: {error_code}"
        )

    try:
        payload = response.json()
    except ValueError as exc:
        raise CodexSubscriptionAuthError(
            "Codex subscription resolver returned an invalid response."
        ) from exc

    access_token = payload.get("access_token")
    if not isinstance(access_token, str) or not access_token.strip():
        raise CodexSubscriptionAuthError(
            "Codex subscription resolver returned an empty token."
        )
    return payload


def _configured_default_headers() -> dict[str, str] | None:
    raw = os.getenv(MODEL_DEFAULT_HEADERS_ENV, "").strip()
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except ValueError as exc:
        raise CodexSubscriptionAuthError(
            f"{MODEL_DEFAULT_HEADERS_ENV} must be valid JSON."
        ) from exc
    if not isinstance(parsed, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in parsed.items()
    ):
        raise CodexSubscriptionAuthError(
            f"{MODEL_DEFAULT_HEADERS_ENV} must be a JSON object of strings."
        )
    return parsed


def _decode_jwt_payload(token: str) -> dict[str, Any]:
    parts = token.split(".")
    if len(parts) < 2:
        return {}
    payload = parts[1]
    payload += "=" * (-len(payload) % 4)
    try:
        parsed = json.loads(base64.urlsafe_b64decode(payload.encode("utf-8")))
    except (ValueError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _codex_runtime_headers(access_token: str) -> dict[str, str]:
    headers = {
        "User-Agent": "codex_cli_rs/0.0.0 (Eigent)",
        "originator": "codex_cli_rs",
    }
    payload = _decode_jwt_payload(access_token)
    auth = payload.get("https://api.openai.com/auth")
    if isinstance(auth, dict):
        account_id = auth.get("chatgpt_account_id")
        if isinstance(account_id, str) and account_id:
            headers["ChatGPT-Account-ID"] = account_id
    return headers


def apply_codex_subscription_runtime(
    options: Chat,
    effective_config: dict[str, Any],
    extra_params: dict[str, Any],
    force_refresh: bool = False,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if not is_codex_subscription_auth(options):
        return effective_config, extra_params

    token_payload = _resolve_access_token(
        options.email, force_refresh=force_refresh
    )
    updated_config = dict(effective_config)
    updated_extra_params = dict(extra_params or {})

    updated_config["api_key"] = token_payload["access_token"]
    updated_config["model_platform"] = (
        updated_config.get("model_platform") or "openai"
    )
    access_token = token_payload["access_token"]
    updated_config["api_url"] = (
        updated_config.get("api_url")
        or os.getenv(MODEL_API_URL_ENV)
        or DEFAULT_CODEX_API_URL
    )

    default_headers = {
        **_codex_runtime_headers(access_token),
        **(_configured_default_headers() or {}),
    }
    updated_extra_params.setdefault("api_mode", "responses")
    # ChatGPT Codex requires streaming Responses calls and rejects stored
    # Responses calls. CAMEL otherwise chooses streaming from model_config and
    # defaults store=True when api_mode="responses".
    updated_extra_params["stream"] = True
    updated_extra_params["store"] = False
    if default_headers:
        existing_headers = updated_extra_params.get("default_headers")
        if isinstance(existing_headers, dict):
            updated_extra_params["default_headers"] = {
                **default_headers,
                **existing_headers,
            }
        else:
            updated_extra_params["default_headers"] = default_headers

    return updated_config, updated_extra_params
