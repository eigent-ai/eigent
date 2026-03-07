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

"""Evaluation bridge: runs eigent checker + grader and outputs Harbor format.

Reads config.json for task metadata, runs checker and grader scripts,
computes weighted reward, and writes reward.txt + metrics.json.
"""

import argparse
import importlib.util
import json
from pathlib import Path


def load_module(path: str, module_name: str):
    """Dynamically load a Python module from a file path."""
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_checker(checker_path: str, working_dir: str) -> bool:
    """Run checker script and return pass/fail."""
    module = load_module(checker_path, "checker")
    return module.check(working_dir)


def run_grader(grader_path: str, working_dir: str) -> tuple[int, int]:
    """Run grader script and return (completed, total)."""
    module = load_module(grader_path, "grader")
    return module.grade(working_dir)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, help="Path to config.json")
    parser.add_argument(
        "--working-dir", required=True, help="Agent working directory"
    )
    parser.add_argument(
        "--output-dir", default="/logs/verifier", help="Output directory"
    )
    args = parser.parse_args()

    config = json.loads(Path(args.config).read_text())
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    checker_weight = config.get("checker_weight", 0.5)
    grader_weight = config.get("grader_weight", 0.5)

    # Run checker(s)
    checker_score = 0.0
    checker_results = []
    for checker_path in config.get("checkers", []):
        try:
            passed = run_checker(checker_path, args.working_dir)
            checker_results.append({"script": checker_path, "passed": passed})
            if passed:
                checker_score = 1.0
        except Exception as e:
            checker_results.append(
                {"script": checker_path, "passed": False, "error": str(e)}
            )

    # Run grader(s)
    grader_score = 0.0
    grader_results = []
    for grader_path in config.get("graders", []):
        try:
            completed, total = run_grader(grader_path, args.working_dir)
            grader_results.append(
                {
                    "script": grader_path,
                    "completed": completed,
                    "total": total,
                }
            )
            if total > 0:
                grader_score = completed / total
        except Exception as e:
            grader_results.append(
                {
                    "script": grader_path,
                    "completed": 0,
                    "total": 0,
                    "error": str(e),
                }
            )

    # Compute weighted reward
    reward = checker_weight * checker_score + grader_weight * grader_score

    # Write Harbor output
    (output_dir / "reward.txt").write_text(f"{reward:.4f}\n")
    (output_dir / "metrics.json").write_text(
        json.dumps(
            {
                "reward": reward,
                "checker_score": checker_score,
                "grader_score": grader_score,
                "checker_weight": checker_weight,
                "grader_weight": grader_weight,
                "checker_results": checker_results,
                "grader_results": grader_results,
            },
            indent=2,
        )
        + "\n"
    )

    print(
        f"Reward: {reward:.4f} (checker={checker_score:.2f}*{checker_weight} + grader={grader_score:.2f}*{grader_weight})"
    )


if __name__ == "__main__":
    main()
