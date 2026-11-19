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

from typing import Any

from app.hardware.interface import IHardwareBridge


class NullHardwareBridge(IHardwareBridge):
    """Null implementation when no hardware. All methods return empty or no-op"""

    def get_cdp_browsers(self) -> list[dict]:
        return []

    def add_cdp_browser(self, browser_id: str, **kwargs: Any) -> dict:
        raise NotImplementedError("CDP not available in this environment")

    def remove_cdp_browser(self, browser_id: str) -> bool:
        return False

    def create_webview(self, id: str, url: str) -> None:
        raise NotImplementedError("WebView not available in this environment")

    def hide_webview(self, id: str) -> None:
        pass

    def show_webview(self, id: str) -> None:
        pass

    def set_webview_size(self, id: str, size: dict) -> None:
        pass
