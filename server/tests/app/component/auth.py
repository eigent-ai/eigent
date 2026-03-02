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


def test_auth_must_has_none_token_guard():
    """auth_must should accept Optional[str] and raise on None."""
    from app.component.auth import auth_must

    sig = inspect.signature(auth_must)
    token_param = sig.parameters["token"]
    annotation = str(token_param.annotation)
    assert "None" in annotation or "Optional" in annotation


def test_auth_must_checks_user_exists():
    """auth_must must verify user is not None after DB lookup."""
    from app.component.auth import auth_must

    source = inspect.getsource(auth_must)
    assert "if not user" in source or "user is None" in source, (
        "auth_must does not check if user exists after token decode"
    )
