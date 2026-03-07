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

"""Eigent Benchmark adapter for Harbor.

Reads eigent benchmark dataset JSON configs and generates
Harbor-compatible task directories.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
from pathlib import Path

logger = logging.getLogger(__name__)

ADAPTER_DIR = Path(__file__).parent
TEMPLATE_DIR = ADAPTER_DIR / "template"
EVALUATE_SCRIPT = ADAPTER_DIR / "evaluate.py"
BENCHMARK_DIR = ADAPTER_DIR.parent  # backend/benchmark/


class EigentBenchAdapter:
    """Converts eigent benchmark dataset JSONs into Harbor task directories."""

    NAME = "eigent-bench"

    def __init__(
        self,
        task_dir: Path,
        benchmark_dir: Path | None = None,
        checker_weight: float = 0.5,
        grader_weight: float = 0.5,
    ) -> None:
        self.task_dir = Path(task_dir)
        self.benchmark_dir = (
            Path(benchmark_dir) if benchmark_dir else BENCHMARK_DIR
        )
        self.checker_weight = checker_weight
        self.grader_weight = grader_weight
        self.configs = self._load_configs()
        logger.info(
            "EigentBenchAdapter initialized: %d tasks, weights=(%s/%s)",
            len(self.configs),
            self.checker_weight,
            self.grader_weight,
        )

    def _load_configs(self) -> list[dict]:
        """Load all dataset JSON configs."""
        dataset_dir = self.benchmark_dir / "dataset"
        configs = []
        for json_file in sorted(dataset_dir.glob("*.json")):
            configs.append(json.loads(json_file.read_text()))
        if not configs:
            raise ValueError(f"No benchmark configs found in {dataset_dir}")
        return configs

    def generate_task(
        self, index: int, local_task_id: str | None = None
    ) -> None:
        """Generate a single Harbor task from a benchmark config."""
        if index < 0 or index >= len(self.configs):
            raise IndexError(
                f"Index {index} out of range (0..{len(self.configs) - 1})"
            )

        config = self.configs[index]
        if local_task_id is None:
            local_task_id = f"eigent-bench-{index:04d}"

        self._prepare_task(config, local_task_id, index)

    def generate_all_tasks(self, limit: int | None = None) -> None:
        """Generate all tasks."""
        total = (
            len(self.configs)
            if limit is None
            else min(limit, len(self.configs))
        )
        success_count = 0
        fail_count = 0
        for index in range(total):
            try:
                self.generate_task(index)
                success_count += 1
            except Exception:
                fail_count += 1
                logger.exception("Failed to generate task %d", index)
        logger.info(
            "Generation complete: %d succeeded, %d failed out of %d",
            success_count,
            fail_count,
            total,
        )

    def _prepare_task(
        self, config: dict, local_task_id: str, index: int
    ) -> None:
        """Generate the complete Harbor task directory."""
        output_dir = self.task_dir / local_task_id

        # 1. Copy template
        if output_dir.exists():
            shutil.rmtree(output_dir)
        shutil.copytree(TEMPLATE_DIR, output_dir)

        # 2. Fill in task.toml
        metadata = config.get("metadata", {})
        self._write_task_toml(output_dir, metadata)

        # 3. Fill in instruction.md
        data = config["data"]
        self._write_instruction(output_dir, data)

        # 4. Copy checker/grader scripts into tests/
        tests_dir = output_dir / "tests"
        tests_dir.mkdir(parents=True, exist_ok=True)
        tests_config = config.get("tests", {})

        checker_paths = []
        for checker_rel in tests_config.get("checker", []):
            src = (
                self.benchmark_dir.parent / checker_rel
            )  # relative to backend/
            dest = tests_dir / f"checker_{src.stem}.py"
            shutil.copy2(src, dest)
            checker_paths.append(f"/tests/{dest.name}")

        grader_paths = []
        for grader_rel in tests_config.get("grader", []):
            src = self.benchmark_dir.parent / grader_rel
            dest = tests_dir / f"grader_{src.stem}.py"
            self._copy_and_patch_grader(src, dest)
            grader_paths.append(f"/tests/{dest.name}")

        # 5. Copy answer files into tests/answer/{name}/ for graders that need them
        task_name = data.get("name", str(index))
        answer_src = self.benchmark_dir / "answer" / task_name
        if answer_src.exists():
            answer_dest = tests_dir / "answer" / task_name
            if answer_dest.exists():
                shutil.rmtree(answer_dest)
            shutil.copytree(answer_src, answer_dest)

        # 6. Write config.json for evaluate.py
        task_config = {
            "task_id": task_name,
            "question": data["question"],
            "checkers": checker_paths,
            "graders": grader_paths,
            "checker_weight": self.checker_weight,
            "grader_weight": self.grader_weight,
            "difficulty": metadata.get("difficulty", ""),
            "tags": metadata.get("tags", []),
        }
        (tests_dir / "config.json").write_text(
            json.dumps(task_config, indent=2) + "\n"
        )

        # 7. Copy evaluate.py into tests/
        shutil.copy2(EVALUATE_SCRIPT, tests_dir / "evaluate.py")

        # 8. Write solution/solve.sh from answer files
        solution_dir = output_dir / "solution"
        solution_dir.mkdir(parents=True, exist_ok=True)
        answer_dir = self.benchmark_dir / "answer" / task_name
        if answer_dir.exists():
            self._write_solution(solution_dir, answer_dir)

        # 9. Make test.sh executable
        test_sh = tests_dir / "test.sh"
        if test_sh.exists():
            test_sh.chmod(0o755)

        logger.info("Generated task: %s", local_task_id)

    def _copy_and_patch_grader(self, src: Path, dest: Path) -> None:
        """Copy grader script and patch for Harbor container.

        Patches applied:
        - Removes browser log checks (milestone #1) and adjusts total count,
          since browser logs are eigent-specific and not available for other agents.
        - ANSWER_CSV (grader 2): replaces path to resolve relative to copied script.
        """
        content = src.read_text()

        # Remove BROWSER_LOG_DIR and _visited_urls function entirely
        content = re.sub(
            r"^BROWSER_LOG_DIR\s*=.*$",
            "# BROWSER_LOG_DIR removed — browser checks disabled for Harbor",
            content,
            flags=re.MULTILINE,
        )
        content = re.sub(
            r"^def _visited_urls\(\).*?^(?=\ndef |\nclass |\n[A-Z])",
            "# _visited_urls removed — browser checks disabled for Harbor\n\n",
            content,
            flags=re.MULTILINE | re.DOTALL,
        )

        # Comment out the browser URL check block (milestone #1) and reduce total
        # Pattern: "    # 1. Visited..." through the else/print block ending
        content = re.sub(
            r"^(\s+# 1\. Visited.*?)(?=\n\s+(?:# 2\.|[a-z_]+ = Path|if not ))",
            lambda m: "\n".join(
                "    # " + line if line.strip() else line
                for line in m.group(1).splitlines()
            ),
            content,
            flags=re.MULTILINE | re.DOTALL,
        )
        # Remove "visited = _visited_urls()" if still present
        content = re.sub(
            r"^\s+visited = _visited_urls\(\)\s*$",
            "",
            content,
            flags=re.MULTILINE,
        )

        # Reduce total by 1 to account for removed browser milestone
        content = re.sub(
            r"^(\s+total\s*=\s*)(\d+)",
            lambda m: f"{m.group(1)}{int(m.group(2)) - 1}",
            content,
            flags=re.MULTILINE,
        )

        # Patch ANSWER_CSV to use path relative to the script in container
        content = re.sub(
            r'Path\(__file__\)\.resolve\(\)\.parents\[\d+\]\s*/\s*"answer"',
            'Path(__file__).resolve().parent / "answer"',
            content,
        )

        # Remove unused imports (urlparse, json for _visited_urls)
        # Keep them only if still used elsewhere in the file
        for module in ["from urllib.parse import urlparse"]:
            if (
                module in content
                and "urlparse" not in content.split(module, 1)[1]
            ):
                content = content.replace(module + "\n", "")

        dest.write_text(content)

    def _write_task_toml(self, output_dir: Path, metadata: dict) -> None:
        task_toml = output_dir / "task.toml"
        content = task_toml.read_text()
        difficulty = metadata.get("difficulty", "medium")
        tags_list = metadata.get("tags", [])
        tags_str = ", ".join(f'"{t}"' for t in ["eigent-bench"] + tags_list)
        content = content.replace("{difficulty}", difficulty)
        content = content.replace("{tags}", tags_str)
        task_toml.write_text(content)

    def _write_instruction(self, output_dir: Path, data: dict) -> None:
        instruction = output_dir / "instruction.md"
        content = instruction.read_text()
        content = content.replace("{question}", data["question"])
        instruction.write_text(content)

    def _write_solution(self, solution_dir: Path, answer_dir: Path) -> None:
        """Create solve.sh that copies answer files to workspace."""
        lines = ["#!/bin/bash", ""]
        for f in sorted(answer_dir.iterdir()):
            if f.is_file():
                shutil.copy2(f, solution_dir / f.name)
                lines.append(f"cp /solution/{f.name} /workspace/{f.name}")
        lines.append("")
        solve_sh = solution_dir / "solve.sh"
        solve_sh.write_text("\n".join(lines))
        solve_sh.chmod(0o755)
