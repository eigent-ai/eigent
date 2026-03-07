#!/bin/bash
set -euo pipefail

# Install curl if not available
if command -v apk &> /dev/null; then
    apk add --no-cache curl bash procps
elif command -v apt-get &> /dev/null; then
    apt-get update
    apt-get install -y curl procps
fi

# Install Claude Code using the official installer

curl -fsSL https://claude.ai/install.sh | bash


export PATH="$HOME/.local/bin:$PATH"
claude --version