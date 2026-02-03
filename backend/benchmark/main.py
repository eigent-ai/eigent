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
import importlib.util
import os
import sys
from pathlib import Path

from benchmark.client import BenchmarkClient
from benchmark.environment import BenchmarkConfig

DATASET_DIR = Path(__file__).parent / "dataset"

MODEL_KWARGS = {
    "model_platform": "openai",
    "model_type": "gpt-4o",
    "api_key": os.environ["OPENAI_API_KEY"],
}


async def run_benchmark(
    client: BenchmarkClient, benchmark_path: Path, verbose: bool = False
):
    """Load a benchmark config and run it."""
    config = BenchmarkConfig.from_json(benchmark_path)
    data = config.data
    print(f"--- Benchmark: {data.name} ---")
    print(f"Question: {data.question}")
    print(f"Working directory: {data.get_working_directory(**MODEL_KWARGS)}")
    print(f"Verifiers: {config.tests.verifier}")
    print()

    events = await client.run(data, verbose=verbose, **MODEL_KWARGS)
    print(f"\n--- Done: {data.name} ({len(events)} events) ---")

    working_dir = data.get_working_directory(**MODEL_KWARGS)
    for verifier_path in config.tests.verifier:
        print(f"Running verifier: {verifier_path}")
        spec = importlib.util.spec_from_file_location(
            "verifier", verifier_path
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        passed = module.verify(working_dir)
        print(f"  Result: {'PASS' if passed else 'FAIL'}")
    print()


async def main():
    verbose = "--verbose" in sys.argv or "-v" in sys.argv
    args = [a for a in sys.argv[1:] if a not in ("--verbose", "-v")]

    if args:
        paths = [Path(p) for p in args]
    else:
        paths = sorted(DATASET_DIR.glob("*.json"))

    if not paths:
        print(f"No benchmark configs found in {DATASET_DIR}")
        return

    async with BenchmarkClient() as client:
        for path in paths:
            await run_benchmark(client, path, verbose=verbose)


if __name__ == "__main__":
    asyncio.run(main())
