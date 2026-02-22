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


def test_password_login_checks_blocked_status():
    """POST /login must reject blocked users."""
    from app.controller.user.login_controller import by_password

    source = inspect.getsource(by_password)
    assert "Status.Block" in source, (
        "by_password does not check user.status == Status.Block"
    )


def test_dev_login_checks_blocked_status():
    """POST /dev_login must reject blocked users."""
    from app.controller.user.login_controller import dev_login

    source = inspect.getsource(dev_login)
    assert "Status.Block" in source or "blocked" in source.lower(), (
        "dev_login does not check for blocked users"
    )
