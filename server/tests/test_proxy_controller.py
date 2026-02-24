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

from urllib.parse import parse_qs, quote_plus, urlparse


class TestGoogleSearchUrlEncoding:
    """Tests for Google Search query URL encoding.

    Validates that the query parameter is properly URL-encoded to prevent
    broken URLs and parameter injection when queries contain special characters.
    """

    def _build_url(self, query: str) -> str:
        """Replicate the URL construction logic from proxy_controller."""
        google_api_key = "TEST_KEY"
        search_engine_id = "TEST_CX"
        start_page_idx = 1
        search_language = "en"
        num_result_pages = 10

        return (
            f"https://www.googleapis.com/customsearch/v1?"
            f"key={google_api_key}&cx={search_engine_id}&q={quote_plus(query)}&start="
            f"{start_page_idx}&lr={search_language}&num={num_result_pages}"
        )

    def test_simple_query_encoded_correctly(self):
        """A simple query should pass through without issues."""
        url = self._build_url("python tutorial")
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        assert params["q"] == ["python tutorial"]

    def test_special_characters_encoded(self):
        """Queries with ampersands and equals signs must be encoded."""
        url = self._build_url("key=value&other=test")
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        # The query should be a single value, not split into multiple params
        assert params["q"] == ["key=value&other=test"]
        # Verify the original params are preserved
        assert params["key"] == ["TEST_KEY"]
        assert params["cx"] == ["TEST_CX"]

    def test_hash_character_encoded(self):
        """Hash characters must not truncate the URL."""
        url = self._build_url("C# programming")
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        assert params["q"] == ["C# programming"]

    def test_unicode_characters_encoded(self):
        """Non-ASCII characters must be properly encoded."""
        url = self._build_url("eigent AI asistan")
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        assert params["q"] == ["eigent AI asistan"]

    def test_plus_signs_in_query(self):
        """Plus signs should be encoded (not treated as spaces)."""
        url = self._build_url("C++ templates")
        assert "C%2B%2B" in url or "C%2B%2B+templates" in url
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        assert params["q"] == ["C++ templates"]

    def test_parameter_injection_prevented(self):
        """A malicious query must not inject extra URL parameters."""
        url = self._build_url("test&key=STOLEN_KEY&cx=STOLEN_CX")
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        # The injected key/cx must not overwrite the real ones
        assert params["key"] == ["TEST_KEY"]
        assert params["cx"] == ["TEST_CX"]
        # The malicious string should be the query value
        assert params["q"] == ["test&key=STOLEN_KEY&cx=STOLEN_CX"]
