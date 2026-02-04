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
"""Checker for benchmark 0: hello_world.py should print 'Hello, World!'"""

import subprocess
import sys
from pathlib import Path


def check(working_directory: str) -> bool:
    script = Path(working_directory) / "hello_world.py"

    if not script.exists():
        print(f"FAIL: {script} does not exist")
        return False

    result = subprocess.run(
        [sys.executable, str(script)],
        capture_output=True,
        text=True,
        timeout=10,
    )

    output = result.stdout.strip()
    if output == "Hello, World!":
        print("PASS")
        return True
    else:
        print(f"FAIL: expected 'Hello, World!', got '{output}'")
        return False


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <working_directory>")
        sys.exit(1)
    success = check(sys.argv[1])
    sys.exit(0 if success else 1)
