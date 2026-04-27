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

from unittest.mock import patch

import pytest

from app.controller import health_controller


pytestmark = pytest.mark.unit


class _FakeHands:
    def get_capability_manifest(self):
        return {"deployment": "remote_cluster"}


@pytest.mark.asyncio
async def test_health_detail_prefers_configured_cdp_url(monkeypatch):
    monkeypatch.setenv("EIGENT_CDP_URL", "http://worker-17:9222")
    monkeypatch.setenv("browser_port", "9222")

    with (
        patch(
            "app.controller.health_controller.get_environment_hands",
            return_value=_FakeHands(),
        ),
        patch(
            "app.controller.health_controller.is_cdp_url_available",
            return_value=True,
        ) as is_cdp_url_available,
        patch(
            "app.controller.health_controller._is_cdp_available"
        ) as is_cdp_available,
    ):
        response = await health_controller.health_check(detail=True)

    assert response.capabilities["browser_cdp_reachable"] is True
    is_cdp_url_available.assert_called_once_with("http://worker-17:9222")
    is_cdp_available.assert_not_called()
