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

import inspect

from unittest.mock import MagicMock


def test_redirect_controller_uses_url_encoding():
    """The redirect_callback function must use urllib.parse.quote to encode the code parameter."""
    import importlib

    mod = importlib.import_module("app.controller.redirect_controller")
    source = inspect.getsource(mod.redirect_callback)
    assert "quote(" in source or "safe_code" in source, (
        "redirect_callback does not encode the code parameter"
    )


def test_redirect_callback_escapes_script_injection():
    """An XSS payload in the code parameter must be rendered harmless."""
    from app.controller.redirect_controller import redirect_callback

    mock_request = MagicMock()
    mock_request.cookies = {}
    xss_payload = '";alert(document.cookie);//'
    response = redirect_callback(code=xss_payload, request=mock_request)
    body = response.body.decode()
    # The raw payload should NOT appear unescaped in the HTML
    assert xss_payload not in body, (
        "XSS payload appears unescaped in redirect HTML"
    )
    # The percent-encoded version should be present
    assert "%22" in body or "%3C" in body or "%26" in body
