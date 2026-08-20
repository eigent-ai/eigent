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

from app.agent.toolkit.screenshot_toolkit import ScreenshotToolkit


def test_image_review_preserves_unbounded_parent_step_timeout():
    toolkit = object.__new__(ScreenshotToolkit)
    toolkit._agent = SimpleNamespace(
        model_backend=MagicMock(),
        step_timeout=None,
    )
    response = SimpleNamespace(
        msg=SimpleNamespace(content="image reviewed"),
        msgs=[],
    )

    with (
        patch(
            "app.agent.toolkit.screenshot_toolkit.os.path.exists",
            return_value=True,
        ),
        patch("app.agent.toolkit.screenshot_toolkit.Image.open"),
        patch(
            "app.agent.toolkit.screenshot_toolkit.BaseMessage.make_user_message"
        ),
        patch("app.agent.toolkit.screenshot_toolkit.ChatAgent") as chat_agent,
    ):
        chat_agent.return_value.step.return_value = response
        assert toolkit.read_image("/tmp/preview.png") == "image reviewed"

    assert chat_agent.call_args.kwargs["step_timeout"] is None
