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
  "metadata": {
    "difficulty": "easy|medium|hard",
    "description": "Brief description of what this benchmark tests",
    "tags": ["tag1", "tag2"]
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

The `metadata` field (optional) provides information about the benchmark:

- `difficulty`: Indicates complexity level: "easy", "medium", or "hard"
- `description`: Brief explanation of what skills or capabilities the benchmark tests
- `tags`: Array of keywords for filtering and organization

The `model_kwargs` field is optional. Defaults come from `BENCHMARK_*` environment variables (see below), falling back to `openai` / `gpt-5.2` / `$OPENAI_API_KEY`. Per-benchmark JSON values override the environment defaults.

### Custom model providers

You can override the model for all benchmarks via environment variables (see `.env.example`):

```bash
# Override all benchmarks to use MiniMax
export BENCHMARK_MODEL_PLATFORM="openai-compatible-model"
export BENCHMARK_MODEL_TYPE=""
export BENCHMARK_API_KEY=""
export BENCHMARK_API_URL=""
```

| Variable                   | Default                     | Description                                                                 |
| -------------------------- | --------------------------- | --------------------------------------------------------------------------- |
| `BENCHMARK_MODEL_PLATFORM` | `openai`                    | Provider name. Use `openai-compatible-model` for any OpenAI-compatible API. |
| `BENCHMARK_MODEL_TYPE`     | `gpt-5.2`                   | Model identifier passed to the provider.                                    |
| `BENCHMARK_API_KEY`        | `$OPENAI_API_KEY`           | API key for the provider.                                                   |
| `BENCHMARK_API_URL`        | `https://api.openai.com/v1` | Base URL for the provider's API.                                            |

To override a single benchmark, add `model_kwargs` to its JSON config — these take priority over environment variables.

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
