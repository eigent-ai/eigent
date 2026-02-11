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
"""Checker for benchmark 2: python313_features.md with warnings and
multiprocessing sections."""

import re
import sys
from pathlib import Path


def check(working_directory: str) -> bool:
    md_file = Path(working_directory) / "python313_features.md"

    if not md_file.exists():
        print(f"FAIL: {md_file} does not exist")
        return False

    content = md_file.read_text()

    if len(content.strip()) < 50:
        print("FAIL: file content is too short")
        return False

    # Check for at least 2 heading sections (# warnings, # multiprocessing)
    h1_sections = re.findall(r"^# .+", content, re.MULTILINE)
    if len(h1_sections) < 2:
        print(
            f"FAIL: expected at least 2 # sections, found {len(h1_sections)}"
        )
        return False

    lower = content.lower()
    if "warnings" not in lower:
        print("FAIL: missing warnings section")
        return False

    if "multiprocessing" not in lower:
        print("FAIL: missing multiprocessing section")
        return False

    print("PASS")
    return True


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <working_directory>")
        sys.exit(1)
    success = check(sys.argv[1])
    sys.exit(0 if success else 1)
