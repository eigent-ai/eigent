#!/bin/bash
set -euo pipefail

echo "========================================="
echo "Running Eigent Benchmark Evaluation"
echo "========================================="

WORKING_DIR="${WORKING_DIR:-/workspace}"

set +e
python3 /tests/evaluate.py \
    --config /tests/config.json \
    --working-dir "$WORKING_DIR" \
    --output-dir /logs/verifier
eval_exit=$?
set -e

echo "========================================="
echo "Evaluation completed with exit code: $eval_exit"
echo "========================================="

if [ $eval_exit -ne 0 ] && [ ! -f /logs/verifier/reward.txt ]; then
    echo "0.0" > /logs/verifier/reward.txt
fi

exit 0
