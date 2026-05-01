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


class IChannelAdapter(ABC):
    """
    Channel Adapter interface.

    This round defines the extension contract only.
    Concrete adapters (Slack/WhatsApp/etc.) are out of scope.
    """

    @abstractmethod
    async def start(self) -> None:
        """Start channel listener."""
        ...

    @abstractmethod
    async def stop(self) -> None:
        """Stop channel listener."""
        ...

    @abstractmethod
    async def send_message(self, session_id: str, content: str) -> None:
        """Push outbound message to a channel session."""
        ...

    @abstractmethod
    def get_channel_type(self) -> str:
        """Channel identifier (e.g. 'slack', 'telegram')."""
        ...
