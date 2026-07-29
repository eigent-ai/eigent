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

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.agent.toolkit import search_toolkit


def _env_value(name: str) -> str:
    values = {
        "SERVER_URL": "https://server.example.com",
        "cloud_api_key": "sk-legacy",
    }
    return values[name]


def test_cloud_search_uses_eigent_authorization_header():
    response = MagicMock()
    response.json.return_value = {"items": []}

    with (
        patch.object(
            search_toolkit,
            "get_current_run_context",
            return_value=SimpleNamespace(
                auth_header="Bearer eigent-user-token",
            ),
        ),
        patch.object(
            search_toolkit,
            "env_not_empty",
            side_effect=_env_value,
        ),
        patch.object(
            search_toolkit.httpx,
            "get",
            return_value=response,
        ) as request,
    ):
        result = search_toolkit.SearchToolkit.cloud_search_google(
            None,
            "query",
        )

    assert result == {"items": []}
    assert request.call_args.kwargs["headers"] == {
        "Authorization": "Bearer eigent-user-token"
    }


def test_cloud_search_keeps_legacy_key_header_fallback():
    response = MagicMock()
    response.json.return_value = {"items": []}

    with (
        patch.object(
            search_toolkit,
            "get_current_run_context",
            return_value=None,
        ),
        patch.object(
            search_toolkit,
            "env_not_empty",
            side_effect=_env_value,
        ),
        patch.object(
            search_toolkit.httpx,
            "get",
            return_value=response,
        ) as request,
    ):
        search_toolkit.SearchToolkit.cloud_search_google(
            None,
            "query",
        )

    assert request.call_args.kwargs["headers"] == {
        "api-key": "sk-legacy"
    }
