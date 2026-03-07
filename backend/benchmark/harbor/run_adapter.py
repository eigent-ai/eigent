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

"""CLI entry point for generating Harbor tasks from eigent benchmarks."""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

from adapter import EigentBenchAdapter

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

HARBOR_DATASETS_DIR = Path(__file__).resolve().parent / "datasets"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert eigent benchmark tasks into Harbor task directories."
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help=f"Output directory (default: {HARBOR_DATASETS_DIR / 'eigent-bench'})",
    )
    parser.add_argument(
        "--benchmark-dir",
        type=Path,
        default=None,
        help="Path to eigent benchmark/ directory (default: auto-detect)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of tasks to generate.",
    )
    parser.add_argument(
        "--checker-weight",
        type=float,
        default=0.5,
        help="Weight for checker score in reward (default: 0.5)",
    )
    parser.add_argument(
        "--grader-weight",
        type=float,
        default=0.5,
        help="Weight for grader score in reward (default: 0.5)",
    )
    args = parser.parse_args()

    output_dir = args.output_dir or (HARBOR_DATASETS_DIR / "eigent-bench")

    adapter = EigentBenchAdapter(
        task_dir=output_dir,
        benchmark_dir=args.benchmark_dir,
        checker_weight=args.checker_weight,
        grader_weight=args.grader_weight,
    )
    adapter.generate_all_tasks(limit=args.limit)
    logger.info("Done. Tasks written to %s", output_dir)


if __name__ == "__main__":
    main()
