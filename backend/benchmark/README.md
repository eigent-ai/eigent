# Benchmark

Run workforce benchmarks against the Eigent API and grade results.

## Setup

1. Start the backend and frontend in the main project directory:

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
  checker/        # Checker scripts (pass/fail per benchmark)
    0.py
  grader/         # Grading scripts (milestone completeness per benchmark)
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
  "model_kwargs": {
    "model_platform": "openai",
    "model_type": "gpt-4o"
  },
  "tests": {
    "grader": ["benchmark/grader/<n>.py"],
    "checker": ["benchmark/checker/<n>.py"]
  }
}
```

`model_platform` and `model_type` default to `"openai"` and `"gpt-4o"`. `api_key` defaults to `$OPENAI_API_KEY`. Set `api_url` for custom endpoints.

2. Create `benchmark/checker/<n>.py` with a `check(working_directory: str) -> bool` function.

1. Create `benchmark/grader/<n>.py` with a `grade(working_directory: str) -> tuple[int, int]` function.

## Checker

Each checker is a Python script that checks whether a benchmark task succeeded. It must export a `check(working_directory: str) -> bool` function that:

- Returns `True` and prints `PASS` if the task succeeded.
- Returns `False` and prints `FAIL: <reason>` if the task failed.

```python
def check(working_directory: str) -> bool:
    # check files, run scripts, inspect output, etc.
    if success:
        print("PASS")
        return True
    else:
        print("FAIL: expected X, got Y")
        return False
```

## Grader

Each grader is a Python script that evaluates milestone completeness. It must export a `grade(working_directory: str) -> tuple[int, int]` function that returns `(completed, total)`:

```python
def grade(working_directory: str) -> tuple[int, int]:
    total = 3
    completed = 0
    if milestone_1_done:
        completed += 1
    if milestone_2_done:
        completed += 1
    if milestone_3_done:
        completed += 1
    return completed, total  # e.g. 2/3
```

## Results

After all benchmarks finish, results are saved to `benchmark/{timestamp}_results.csv`:

```csv
benchmark,model,type,script,result
0,openai/gpt-5.2,checker,benchmark/checker/0.py,FAIL
0,openai/gpt-5.2,grader,benchmark/grader/0.py,7/7
```

Result CSV files are gitignored.

## TODO: With MCP servers

To provide MCP servers to the workforce, add `installed_mcp` to `env`.
Use `env_file` to store credentials separately (`.env` files are gitignored).
The credentials are injected into each MCP server's `env` before sending the payload to the backend.

```
# benchmark/envs/1.env
NOTION_API_KEY=ntn_xxxxx
```

```json
{
  "data": {
    "name": "1",
    "question": "List all Notion pages",
    "env": {
      "env_file": "benchmark/envs/1.env",
      "installed_mcp": {
        "mcpServers": {
          "notion": {
            "command": "npx",
            "args": ["@modelcontextprotocol/server-notion"]
          }
        }
      }
    }
  },
  "tests": {
    "checker": ["benchmark/checker/1.py"]
  }
}
```
