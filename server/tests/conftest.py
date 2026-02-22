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
"""Pytest configuration and shared fixtures for Eigent backend tests."""

import sys
from pathlib import Path

import pytest

# Add server directory to Python path so imports work correctly
server_dir = Path(__file__).parent.parent
sys.path.insert(0, str(server_dir))


@pytest.fixture(scope="session")
def server_root() -> Path:
    """Return the path to the server root directory."""
    return server_dir
