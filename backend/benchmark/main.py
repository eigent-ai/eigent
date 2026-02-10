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

import asyncio
import csv
import importlib.util
import sys
from datetime import datetime
from pathlib import Path

from benchmark.client import BenchmarkClient
from benchmark.environment import BenchmarkConfig

DATASET_DIR = Path(__file__).parent / "dataset"
RESULTS_DIR = Path(__file__).parent


async def run_benchmark(
    client: BenchmarkClient, benchmark_path: Path, verbose: bool = False
) -> dict:
    """Load a benchmark config and run it.

    Args:
        client (BenchmarkClient): BenchmarkClient instance for API
            communication.
        benchmark_path (Path): Path to the benchmark JSON config file.
        verbose (bool): If True, print SSE events during the run.

    Returns:
        dict: Results including benchmark name, model, checker and
            grader outcomes.
    """
    config = BenchmarkConfig.from_json(benchmark_path)
    data = config.data

    model_kwargs = config.model_kwargs
    model = f"{model_kwargs.model_platform}/{model_kwargs.model_type}"
    print(f"--- Benchmark: {data.name} ---")
    print(f"Question: {data.question}")
    print(f"Model: {model}")
    print(f"Working directory: {data.get_working_directory(model_kwargs)}")
    print(f"Checkers: {config.tests.checker}")
    print(f"Graders: {config.tests.grader}")

    events = await client.run(data, model_kwargs=model_kwargs, verbose=verbose)
    print(f"\n--- Done: {data.name} ({len(events)} events) ---")

    working_dir = data.get_working_directory(model_kwargs)
    checker_results = []
    for checker_path in config.tests.checker:
        print(f"Running checker: {checker_path}")
        spec = importlib.util.spec_from_file_location("checker", checker_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        passed = module.check(working_dir)
        print(f"  Result: {'PASS' if passed else 'FAIL'}")
        checker_results.append((checker_path, passed))

    grader_results = []
    for grader_path in config.tests.grader:
        print(f"Running grader: {grader_path}")
        spec = importlib.util.spec_from_file_location("grader", grader_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        completed, total = module.grade(working_dir)
        print(f"  Progress: {completed}/{total}")
        grader_results.append((grader_path, completed, total))

    print()
    return {
        "benchmark": data.name,
        "model": model,
        "checkers": checker_results,
        "graders": grader_results,
    }


def _write_results_csv(all_results: list[dict]) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = RESULTS_DIR / f"{timestamp}_results.csv"

    with open(csv_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["benchmark", "model", "type", "script", "result"])
        for result in all_results:
            for script, passed in result["checkers"]:
                writer.writerow(
                    [
                        result["benchmark"],
                        result["model"],
                        "checker",
                        script,
                        "PASS" if passed else "FAIL",
                    ]
                )
            for script, completed, total in result["graders"]:
                writer.writerow(
                    [
                        result["benchmark"],
                        result["model"],
                        "grader",
                        script,
                        f"{completed}/{total}",
                    ]
                )

    return csv_path


async def main() -> None:
    verbose: bool = "--verbose" in sys.argv or "-v" in sys.argv
    args: list[str] = [a for a in sys.argv[1:] if a not in ("--verbose", "-v")]

    if args:
        paths = [Path(p) for p in args]
    else:
        paths = sorted(DATASET_DIR.glob("*.json"))

    if not paths:
        print(f"No benchmark configs found in {DATASET_DIR}")
        return

    all_results = []
    async with BenchmarkClient() as client:
        for path in paths:
            result = await run_benchmark(client, path, verbose=verbose)
            all_results.append(result)

    csv_path = _write_results_csv(all_results)
    print(f"Results saved to {csv_path}")


if __name__ == "__main__":
    asyncio.run(main())
