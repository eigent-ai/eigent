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

import ast
import json
import sys
from pathlib import Path

BROWSER_LOG_DIR = Path(__file__).resolve().parents[2] / "browser_log"


def _visited_urls() -> set[str]:
    """Extract all URLs seen in browser logs (visit_page + tab URLs)."""
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
                if action == "get_tab_info":
                    outputs = obj.get("outputs", [])
                    if isinstance(outputs, list):
                        for tab in outputs:
                            if isinstance(tab, dict) and tab.get("url"):
                                urls.add(tab["url"])
            except (json.JSONDecodeError, ValueError):
                pos += 1
    return urls


def grade(working_directory: str) -> tuple[int, int]:
    """Grade milestones and return (completed, total)."""
    total = 7
    completed = 0

    # 1. Visited mathspp.com blog page
    visited = _visited_urls()
    if any(
        "mathspp.com/blog/the-most-obscure-hello-world" in u for u in visited
    ):
        completed += 1

    script = Path(working_directory) / "hello_world.py"
    if not script.exists():
        return completed, total

    source = script.read_text()
    tree = ast.parse(source)

    # 1. Uses a decorator that immediately instantiates a class
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.decorator_list:
            completed += 1
            break

    # 2. Overloads __format__
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "__format__":
            completed += 1
            break

    # 3. Uses property injection on the class
    if "property" in source:
        completed += 1

    # 4. __format__ returns an empty string
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "__format__":
            for child in ast.walk(node):
                if isinstance(child, ast.Return
                              ) and isinstance(child.value, ast.Constant):
                    if child.value.value == "":
                        completed += 1
                        break
            break

    # 5. Uses function annotation to trigger f-string evaluation
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.returns is not None:
            if isinstance(node.returns, ast.JoinedStr):
                completed += 1
                break

    # 6. Uses _ as both class name and instance variable
    has_class_underscore = False
    has_attr_underscore = False
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == "_":
            has_class_underscore = True
        if isinstance(node,
                      ast.Attribute) and isinstance(node.value, ast.Name):
            if node.value.id == "_" and node.attr == "_":
                has_attr_underscore = True
    if has_class_underscore and has_attr_underscore:
        completed += 1

    return completed, total


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <working_directory>")
        sys.exit(1)
    completed, total = grade(sys.argv[1])
    print(f"{completed}/{total}")
    sys.exit(0 if completed == total else 1)
