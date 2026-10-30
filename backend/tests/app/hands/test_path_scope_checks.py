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

import pytest

from app.file_access.upload_file_access import UploadFileAccess
from app.hands.full_hands import FullHands
from app.hands.sandbox_hands import SandboxHands


@pytest.mark.unit
def test_sandbox_hands_blocks_workspace_prefix_bypass(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    sibling = tmp_path / "workspace_evil"
    sibling.mkdir()
    inside = workspace / "safe.txt"
    inside.write_text("safe", encoding="utf-8")
    outside = sibling / "evil.txt"
    outside.write_text("evil", encoding="utf-8")

    hands = SandboxHands(workspace_root=str(workspace))
    assert hands.can_access_filesystem(str(inside)) is True
    assert hands.can_access_filesystem(str(outside)) is False


@pytest.mark.unit
def test_full_hands_blocks_workspace_prefix_bypass(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    sibling = tmp_path / "workspace_evil"
    sibling.mkdir()
    outside = sibling / "evil.txt"
    outside.write_text("evil", encoding="utf-8")

    hands = FullHands(workspace_root=str(workspace))
    assert hands.can_access_filesystem(str(outside)) is False


@pytest.mark.unit
def test_upload_file_access_blocks_workspace_prefix_bypass(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    sibling = tmp_path / "workspace_evil"
    sibling.mkdir()
    outside = sibling / "evil.txt"
    outside.write_text("evil", encoding="utf-8")

    file_access = UploadFileAccess(workspace_root=str(workspace))
    with pytest.raises(PermissionError):
        file_access.read_file(str(outside))
