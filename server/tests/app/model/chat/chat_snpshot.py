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

import base64
import os
import shutil

import pytest


def test_save_image_rejects_directory_traversal():
    """api_task_id with ../ must be rejected."""
    from app.model.chat.chat_snpshot import ChatSnapshotIn

    dummy_image = base64.b64encode(b"\xff\xd8\xff\xe0").decode()
    with pytest.raises(ValueError, match="disallowed characters"):
        ChatSnapshotIn.save_image(
            user_id=1,
            api_task_id="../../etc",
            image_base64=dummy_image,
        )


def test_save_image_rejects_special_characters():
    """api_task_id with slashes must be rejected."""
    from app.model.chat.chat_snpshot import ChatSnapshotIn

    dummy_image = base64.b64encode(b"\xff\xd8\xff\xe0").decode()
    with pytest.raises(ValueError):
        ChatSnapshotIn.save_image(
            user_id=1,
            api_task_id="task/../../passwd",
            image_base64=dummy_image,
        )


def test_save_image_accepts_valid_task_id():
    """A valid alphanumeric api_task_id should not raise."""
    from app.model.chat.chat_snpshot import ChatSnapshotIn

    dummy_image = base64.b64encode(b"\xff\xd8\xff\xe0").decode()
    result = ChatSnapshotIn.save_image(
        user_id=99999,
        api_task_id="valid-task-id_123",
        image_base64=dummy_image,
    )
    assert "valid-task-id_123" in result
    # Cleanup
    folder = os.path.join("app", "public", "upload")
    if os.path.exists(folder):
        for d in os.listdir(folder):
            full = os.path.join(folder, d)
            if "99999" in d or d.startswith("0"):
                shutil.rmtree(full, ignore_errors=True)
