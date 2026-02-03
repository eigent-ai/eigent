# Benchmark

Run workforce benchmarks against the Eigent API and verify results.

## Setup

1. Start the backend and frontend:

```bash
npm run dev
```

2. Set your API key:

```bash
export OPENAI_API_KEY=sk-...
```

## Usage

From the `backend/` directory:

```bash
# Run all benchmarks
python3 -m benchmark.main

# Run with verbose SSE output
python3 -m benchmark.main -v

# Run a specific benchmark
python3 -m benchmark.main benchmark/dataset/0.json
```

## Structure

```
benchmark/
  main.py           # Entry point
  client.py         # API client (SSE streaming, auto task start, auto human reply)
  environment.py    # BenchmarkConfig, BenchmarkData, Env, Tests models
  dataset/          # Benchmark JSON configs
    0.json
  verifier/         # Verification scripts (one per benchmark)
    0.py
```

## Adding a benchmark

1. Create `benchmark/dataset/<n>.json`:

```json
{
  "data": {
    "name": "<n>",
    "question": "Your task description",
    "env": {}
  },
  "tests": {
    "verifier": ["benchmark/verifier/<n>.py"]
  }
}
```

2. Create `benchmark/verifier/<n>.py` with a `verify(working_directory: str) -> bool` function.
