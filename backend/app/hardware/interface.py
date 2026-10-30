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

from abc import ABC, abstractmethod
from typing import Any


class IHardwareBridge(ABC):
    """Hardware capability bridge. Only Desktop has implementation, others use NullBridge"""

    @abstractmethod
    def get_cdp_browsers(self) -> list[dict]:
        """Get available CDP browser list"""
        pass

    @abstractmethod
    def add_cdp_browser(self, browser_id: str, **kwargs: Any) -> dict:
        """Add CDP browser"""
        pass

    @abstractmethod
    def remove_cdp_browser(self, browser_id: str) -> bool:
        """Remove CDP browser"""
        pass

    @abstractmethod
    def create_webview(self, id: str, url: str) -> None:
        """Create WebView (Electron)"""
        pass

    @abstractmethod
    def hide_webview(self, id: str) -> None:
        """Hide WebView"""
        pass

    @abstractmethod
    def show_webview(self, id: str) -> None:
        """Show WebView"""
        pass

    @abstractmethod
    def set_webview_size(self, id: str, size: dict) -> None:
        """Set WebView size"""
        pass
