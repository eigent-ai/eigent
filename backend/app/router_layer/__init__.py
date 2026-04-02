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

"""Message Router layer: Channel/Session binding, Hands selection."""

from app.router_layer.hands_resolver import (
    get_environment_hands,
    get_hands_for_channel,
    init_environment_hands,
)
from app.router_layer.interface import (
    InboundMessage,
    IRouter,
    OutboundMessage,
)
from app.router_layer.message_router import DefaultMessageRouter
from app.router_layer.middleware import ChannelSessionMiddleware

__all__ = [
    "ChannelSessionMiddleware",
    "DefaultMessageRouter",
    "get_environment_hands",
    "get_hands_for_channel",
    "InboundMessage",
    "init_environment_hands",
    "IRouter",
    "OutboundMessage",
]
