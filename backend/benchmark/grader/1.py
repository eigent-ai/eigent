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
"""Grader for benchmark 1: evaluate python313_features.md milestones."""

import json
import re
import sys
from pathlib import Path

BROWSER_LOG_DIR = Path(__file__).resolve().parents[2] / "browser_log"


def _visited_urls() -> set[str]:
    """Extract all URLs seen in browser logs."""
    urls: set[str] = set()
    if not BROWSER_LOG_DIR.exists():
        return urls
    for log_file in BROWSER_LOG_DIR.glob("hybrid_browser_toolkit_ws_*.log"):
        decoder = json.JSONDecoder()
        raw = log_file.read_text()
        pos = 0
        while pos < len(raw):
            stripped = raw[pos:].lstrip()
            if not stripped:
                break
            pos = len(raw) - len(stripped)
            try:
                obj, end = decoder.raw_decode(raw, pos)
                pos = end
                if not isinstance(obj, dict):
                    continue
                action = obj.get("action", "")
                if action == "visit_page":
                    args = obj.get("inputs", {}).get("args", [])
                    if args:
                        urls.add(args[0])
            except (json.JSONDecodeError, ValueError):
                pos += 1
    return urls


def grade(working_directory: str) -> tuple[int, int]:
    total = 7
    completed = 0

    md_file = Path(working_directory) / "python313_features.md"

    # 1. Visited the Python 3.13 What's New page
    visited = _visited_urls()
    if any("docs.python.org" in u and "3.13" in u for u in visited):
        completed += 1
    else:
        print("MISS [1]: did not visit docs.python.org/3.13 What's New page")

    if not md_file.exists():
        print("MISS [2-7]: python313_features.md does not exist")
        return completed, total

    content = md_file.read_text()
    lower = content.lower()

    # 2. Has a # warnings heading
    if re.search(r"^# warnings\b", content, re.MULTILINE | re.IGNORECASE):
        completed += 1
    else:
        print("MISS [2]: no '# warnings' heading found")

    # 3. Has a # multiprocessing heading
    if re.search(
        r"^# multiprocessing\b", content, re.MULTILINE | re.IGNORECASE
    ):
        completed += 1
    else:
        print("MISS [3]: no '# multiprocessing' heading found")

    # 4. Mentions warnings.deprecated() with backticks
    if "`warnings.deprecated()`" in content or (
        "warnings.deprecated" in lower and "`" in content
    ):
        completed += 1
    else:
        print(
            "MISS [4]: missing `warnings.deprecated()` "
            "(expected backtick-wrapped reference)"
        )

    # 5. Mentions PEP 702
    if "pep 702" in lower:
        completed += 1
    else:
        print("MISS [5]: no mention of PEP 702")

    # 6. Mentions os.process_cpu_count() with backticks
    if "`os.process_cpu_count()`" in content or (
        "os.process_cpu_count" in lower and "`" in content
    ):
        completed += 1
    else:
        print(
            "MISS [6]: missing `os.process_cpu_count()` "
            "(expected backtick-wrapped reference)"
        )

    # 7. Mentions os.cpu_count() (the old default being replaced)
    if "os.cpu_count" in lower:
        completed += 1
    else:
        print("MISS [7]: no mention of os.cpu_count()")

    return completed, total


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <working_directory>")
        sys.exit(1)
    completed, total = grade(sys.argv[1])
    print(f"{completed}/{total}")
    sys.exit(0 if completed == total else 1)
