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

from app.utils.toolkit.note_taking_toolkit import NoteTakingToolkit


@pytest.mark.unit
def test_working_directory_required():
    """Test that working_directory is required and raises
    ValueError if not provided.
    """
    with pytest.raises(ValueError) as exc_info:
        NoteTakingToolkit(api_task_id="test_task_123")

    assert "working_directory is required" in str(exc_info.value)
