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
"""Grader for benchmark 2: evaluate yc_w25_b2b_ai.csv milestones."""

import csv
import json
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

BROWSER_LOG_DIR = Path(__file__).resolve().parents[2] / "browser_log"
ANSWER_CSV = (
    Path(__file__).resolve().parents[1] / "answer" / "2" / "yc_w25_b2b_ai.csv"
)

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


def _load_answer() -> tuple[int, Counter]:
    """Load expected company count and category distribution from answer CSV."""
    cat_counts: Counter = Counter()
    count = 0
    if not ANSWER_CSV.exists():
        return 0, cat_counts
    with open(ANSWER_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            count += 1
            cat = row.get("ai_category", "")
            if cat:
                cat_counts[cat] += 1
    return count, cat_counts


def _category_overlap(expected: Counter, actual: Counter) -> float:
    """Compute distribution overlap between expected and actual categories.

    Normalizes both to proportions, then sums min(expected_pct, actual_pct)
    for each category. Returns a value between 0.0 and 1.0.
    """
    exp_total = sum(expected.values())
    act_total = sum(actual.values())
    if exp_total == 0 or act_total == 0:
        return 0.0
    all_cats = set(expected.keys()) | set(actual.keys())
    overlap = 0.0
    for cat in all_cats:
        exp_pct = expected.get(cat, 0) / exp_total
        act_pct = actual.get(cat, 0) / act_total
        overlap += min(exp_pct, act_pct)
    return overlap


def grade(working_directory: str) -> tuple[int, int]:
    total = 10
    completed = 0

    csv_file = Path(working_directory) / "yc_w25_b2b_ai.csv"

    # 1. Visited YC W25 companies page
    visited = _visited_urls()
    if any(
        (p := urlparse(u)).hostname is not None
        and (
            p.hostname == "ycombinator.com"
            or p.hostname.endswith(".ycombinator.com")
        )
        and "W25" in u
        for u in visited
    ):
        completed += 1
    else:
        print("MISS [1]: did not visit ycombinator.com W25 companies page")

    # 2. CSV file exists
    if not csv_file.exists():
        print(f"MISS [2-10]: {csv_file.name} does not exist")
        return completed, total
    completed += 1

    try:
        with open(csv_file, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            headers = set(reader.fieldnames or [])
            rows = list(reader)
    except Exception as e:
        print(f"MISS [3-10]: failed to parse CSV: {e}")
        return completed, total

    # 3. Has correct columns
    if REQUIRED_COLUMNS.issubset(headers):
        completed += 1
    else:
        missing = REQUIRED_COLUMNS - headers
        print(f"MISS [3]: missing columns: {missing}")

    # 4. All company_name values are lowercase
    non_lower = [
        row.get("company_name", "")
        for row in rows
        if row.get("company_name", "") != row.get("company_name", "").lower()
    ]
    if rows and not non_lower:
        completed += 1
    else:
        print(
            f"MISS [4]: {len(non_lower)} company_name(s) not lowercase, "
            f"e.g. {non_lower[:3]}"
        )

    # 5. All product_description values are <= 100 chars
    too_long = [
        (i, len(row.get("product_description", "")))
        for i, row in enumerate(rows)
        if len(row.get("product_description", "")) > 100
    ]
    if rows and not too_long:
        completed += 1
    else:
        print(
            f"MISS [5]: {len(too_long)} description(s) exceed 100 chars, "
            f"e.g. row {too_long[0][0]} has {too_long[0][1]} chars"
            if too_long
            else "MISS [5]: no rows found"
        )

    # 6. All ai_category values are valid enums
    invalid_cats = [
        (i, row.get("ai_category", ""))
        for i, row in enumerate(rows)
        if row.get("ai_category", "") not in VALID_CATEGORIES
    ]
    if rows and not invalid_cats:
        completed += 1
    else:
        print(
            f"MISS [6]: {len(invalid_cats)} invalid category value(s), "
            f"e.g. row {invalid_cats[0][0]}: '{invalid_cats[0][1]}'"
            if invalid_cats
            else "MISS [6]: no rows found"
        )

    # Load answer for approximate matching
    expected_count, expected_cats = _load_answer()
    actual_count = len(rows)

    # 7-8. Company count within 50% → +1, within 25% → +1 more
    if expected_count > 0 and actual_count > 0:
        ratio = actual_count / expected_count
        if 0.5 <= ratio <= 1.5:
            completed += 1
            if 0.75 <= ratio <= 1.25:
                completed += 1
            else:
                print(
                    f"MISS [8]: count {actual_count} is within 50% but not "
                    f"25% of expected {expected_count} (ratio={ratio:.2f})"
                )
        else:
            print(
                f"MISS [7-8]: count {actual_count} is not within 50% of "
                f"expected {expected_count} (ratio={ratio:.2f})"
            )
    else:
        print(
            f"MISS [7-8]: expected_count={expected_count}, "
            f"actual_count={actual_count}"
        )

    # 9-10. Category distribution overlap >= 50% → +1, >= 75% → +1 more
    actual_cats: Counter = Counter()
    for row in rows:
        cat = row.get("ai_category", "")
        if cat:
            actual_cats[cat] += 1
    overlap = _category_overlap(expected_cats, actual_cats)
    if overlap >= 0.50:
        completed += 1
        if overlap >= 0.75:
            completed += 1
        else:
            print(
                f"MISS [10]: category overlap {overlap:.2%} >= 50% but < 75%"
            )
    else:
        print(
            f"MISS [9-10]: category overlap {overlap:.2%} < 50%. "
            f"Expected dist: {dict(expected_cats)}, "
            f"actual dist: {dict(actual_cats)}"
        )

    return completed, total


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <working_directory>")
        sys.exit(1)
    completed, total = grade(sys.argv[1])
    print(f"{completed}/{total}")
    sys.exit(0 if completed == total else 1)
