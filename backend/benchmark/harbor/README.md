# Eigent Benchmark — Harbor Adapter

Converts eigent benchmark tasks into [Harbor](https://harborframework.com/) task format for standardized agent evaluation.

## Prerequisites

```bash
# Install Harbor CLI
uv tool install harbor

# Set your API key
export ANTHROPIC_API_KEY=your-key-here
```

## Quick Start

```bash
cd backend/benchmark/harbor

# 1. Generate Harbor tasks
python run_adapter.py

# 2. Verify with oracle (should score 1.0)
harbor run \
    -p datasets/eigent-bench \
    -a oracle \
    --env docker

# 3. Run with an agent
harbor run \
    -p datasets/eigent-bench \
    -a claude-code \
    -m anthropic/claude-sonnet-4-20250514 \
    --env docker
```

## Generating Tasks

```bash
cd backend/benchmark/harbor

# Default (all tasks, 50/50 weights)
python run_adapter.py

# Custom weights (70% checker, 30% grader)
python run_adapter.py --checker-weight 0.7 --grader-weight 0.3

# Limit number of tasks
python run_adapter.py --limit 2
```

## Running Benchmarks

Harbor builds a Docker image from each task's `environment/Dockerfile` automatically on first run. Subsequent runs reuse the cached image.

### Run a specific task

```bash
# Run only task 0 (hello world)
harbor run \
    -p datasets/eigent-bench \
    -a claude-code \
    -m anthropic/claude-haiku-4-5-20251001 \
    -t "eigent-bench-0000" \
    --env docker
```

### Run all tasks

```bash
harbor run \
    -p datasets/eigent-bench \
    -a claude-code \
    -m anthropic/claude-sonnet-4-20250514 \
    --env docker
```

### Run with different models

```bash
# Claude Haiku
harbor run -p datasets/eigent-bench -a claude-code \
    -m anthropic/claude-haiku-4-5-20251001 --env docker

```

### Run with concurrency

```bash
harbor run \
    -p datasets/eigent-bench \
    -a claude-code \
    -m anthropic/claude-sonnet-4-20250514 \
    --env docker \
    --n-concurrent 3
```

## Rebuild Docker Image

Harbor caches Docker images. To force a rebuild (e.g., after changing the Dockerfile):

```bash
# Clear Harbor's Docker build cache
docker builder prune -f

# Then rerun — Harbor will rebuild the image
harbor run -p datasets/eigent-bench -a oracle --env docker
```

## Reward Computation

```
reward = checker_weight × checker_score + grader_weight × grader_score
```

- `checker_score`: 1.0 if checker passes, 0.0 if fails
- `grader_score`: completed_milestones / total_milestones (0.0–1.0)
- Default weights: 0.5 / 0.5 (configurable via CLI flags)

## Results

Results are written to `jobs/<timestamp>/result.json`. Each trial directory contains:

```
jobs/<timestamp>/
├── result.json                    # Overall results
├── job.log                        # Build + run logs
└── eigent-bench-NNNN__<id>/
    ├── agent/                     # Agent logs and trajectory
    │   ├── claude-code.txt        # Raw agent output
    │   └── trajectory.json        # ATIF trajectory
    └── verifier/
        ├── metrics.json           # Detailed checker/grader results
        └── test-stdout.txt        # Verifier output
```

## Generated Task Structure

```
eigent-bench-NNNN/
├── task.toml           # Harbor metadata
├── instruction.md      # Task question
├── environment/
│   ├── Dockerfile      # Eigent stack + evaluation deps
│   └── workspace/
│       └── .env.development
├── tests/
│   ├── test.sh         # Entry point → evaluate.py
│   ├── evaluate.py     # Checker+grader → reward.txt
│   ├── checker_N.py    # Copied from benchmark/checker/
│   ├── grader_N.py     # Copied from benchmark/grader/
│   └── config.json     # Task config + weights
└── solution/
    └── solve.sh        # Oracle solution
```
