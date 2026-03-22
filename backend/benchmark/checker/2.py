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
"""Checker for benchmark 2: yc_w25_b2b_ai.csv with B2B AI companies."""

import csv
import sys
from pathlib import Path

VALID_CATEGORIES = {
    "ai-agents",
    "ai-infrastructure",
    "ai-developer-tools",
    "ai-analytics",
    "ai-security",
    "ai-healthcare",
    "ai-sales",
    "ai-productivity",
    "ai-customer-support",
    "ai-coding",
    "ai-data",
    "ai-fintech",
    "ai-legal",
    "ai-hr",
    "ai-marketing",
    "ai-other",
}

REQUIRED_COLUMNS = {"company_name", "product_description", "ai_category"}


def check(working_directory: str) -> bool:
    csv_file = Path(working_directory) / "yc_w25_b2b_ai.csv"

    if not csv_file.exists():
        print(f"FAIL: {csv_file} does not exist")
        return False

    with open(csv_file, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        headers = set(reader.fieldnames or [])

        missing = REQUIRED_COLUMNS - headers
        if missing:
            print(f"FAIL: missing columns: {missing}")
            return False

        rows = list(reader)

    if len(rows) < 5:
        print(f"FAIL: expected at least 5 companies, got {len(rows)}")
        return False

    for i, row in enumerate(rows):
        name = row.get("company_name", "")
        if name != name.lower():
            print(f"FAIL: row {i}: company_name '{name}' is not lowercase")
            return False

        desc = row.get("product_description", "")
        if len(desc) > 100:
            print(
                f"FAIL: row {i}: product_description exceeds 100 chars "
                f"({len(desc)})"
            )
            return False

        cat = row.get("ai_category", "")
        if cat not in VALID_CATEGORIES:
            print(f"FAIL: row {i}: invalid ai_category '{cat}'")
            return False

    print("PASS")
    return True


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <working_directory>")
        sys.exit(1)
    success = check(sys.argv[1])
    sys.exit(0 if success else 1)
