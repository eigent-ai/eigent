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

"""OAuthService: adapter factory wrapper for unified OAuth flow. Follows CreditsService pattern."""

from loguru import logger

from app.core.oauth_adapter import get_oauth_adapter, OAUTH_ADAPTERS
from app.domains.oauth.schema import OAuthAuthorizeReq, OAuthTokenReq, OAuthResult


class OAuthService:
    """OAuth operations - static methods, wraps adapter factory."""

    @staticmethod
    def get_authorize_url(req: OAuthAuthorizeReq) -> OAuthResult:
        """Get OAuth authorization URL via adapter factory."""
        try:
            adapter = get_oauth_adapter(req.provider, req.redirect_uri)
            url = adapter.get_authorize_url(req.state)
            if not url:
                return OAuthResult(success=False, error_code="OAUTH_URL_FAILED")
            return OAuthResult(success=True, authorize_url=url)
        except Exception as e:
            logger.error(f"OAuth authorize failed provider={req.provider}: {e}")
            return OAuthResult(success=False, error_code="OAUTH_PROVIDER_ERROR")

    @staticmethod
    def exchange_token(req: OAuthTokenReq) -> OAuthResult:
        """Exchange authorization code for token via adapter factory."""
        try:
            adapter = get_oauth_adapter(req.provider, req.redirect_uri)
            token_data = adapter.fetch_token(req.code)
            if not token_data:
                return OAuthResult(success=False, error_code="OAUTH_TOKEN_FAILED")
            return OAuthResult(success=True, token_data=token_data)
        except Exception as e:
            logger.error(f"OAuth token exchange failed provider={req.provider}: {e}")
            return OAuthResult(success=False, error_code="OAUTH_PROVIDER_ERROR")

    @staticmethod
    def list_providers() -> list[str]:
        """Return list of supported OAuth providers."""
        return list(set(OAUTH_ADAPTERS.keys()))
