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

from urllib.parse import parse_qs, urlparse

from app.core.oauth_adapter import (
    GoogleSuiteOAuthAdapter,
    NotionOAuthAdapter,
    SlackOAuthAdapter,
    XOAuthAdapter,
)


REDIRECT_URI = "https://example.com/api/oauth/callback?next=/space one&locale=zh 中文"
STATE = "return=/tasks/1&nonce=hello world"


def _query_params(url: str) -> dict[str, list[str]]:
    return parse_qs(urlparse(url).query, keep_blank_values=True)


def _assert_common_encoded_params(params: dict[str, list[str]]) -> None:
    assert params["redirect_uri"] == [REDIRECT_URI]
    assert params["state"] == [STATE]
    assert "next" not in params
    assert "locale" not in params
    assert "nonce" not in params


def test_slack_authorize_url_encodes_query_parameters():
    adapter = SlackOAuthAdapter(redirect_uri=REDIRECT_URI)
    adapter.client_id = "slack-client&tenant=one"
    adapter.scope = "chat:write,channels:read,emoji:read"

    params = _query_params(adapter.get_authorize_url(STATE))

    assert params["client_id"] == ["slack-client&tenant=one"]
    assert params["scope"] == ["chat:write,channels:read,emoji:read"]
    _assert_common_encoded_params(params)


def test_notion_authorize_url_encodes_query_parameters():
    adapter = NotionOAuthAdapter(redirect_uri=REDIRECT_URI)
    adapter.client_id = "notion-client&tenant=one"

    params = _query_params(adapter.get_authorize_url(STATE))

    assert params["client_id"] == ["notion-client&tenant=one"]
    assert params["owner"] == ["user"]
    assert params["response_type"] == ["code"]
    _assert_common_encoded_params(params)


def test_x_authorize_url_encodes_query_parameters_and_pkce():
    adapter = XOAuthAdapter(redirect_uri=REDIRECT_URI)
    adapter.client_id = "x-client&tenant=one"
    adapter.scope = "tweet.read users.read offline.access"
    code_challenge = "challenge+/= &zh 中文"

    params = _query_params(
        adapter.get_authorize_url(
            STATE,
            code_challenge=code_challenge,
            code_challenge_method="S256",
        )
    )

    assert params["response_type"] == ["code"]
    assert params["client_id"] == ["x-client&tenant=one"]
    assert params["scope"] == ["tweet.read users.read offline.access"]
    assert params["code_challenge"] == [code_challenge]
    assert params["code_challenge_method"] == ["S256"]
    _assert_common_encoded_params(params)


def test_google_suite_authorize_url_encodes_query_parameters():
    adapter = GoogleSuiteOAuthAdapter(redirect_uri=REDIRECT_URI)
    adapter.client_id = "google-client&tenant=one"
    adapter.scope = "openid email profile https://www.googleapis.com/auth/drive.metadata.readonly"

    params = _query_params(adapter.get_authorize_url(STATE))

    assert params["client_id"] == ["google-client&tenant=one"]
    assert params["response_type"] == ["code"]
    assert params["scope"] == ["openid email profile https://www.googleapis.com/auth/drive.metadata.readonly"]
    assert params["access_type"] == ["offline"]
    assert params["include_granted_scopes"] == ["true"]
    _assert_common_encoded_params(params)
