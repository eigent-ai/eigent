# Eigent CLI

Command-line interface for the Eigent AI coding agent.

## Prerequisites

- Node.js >= 18
- Eigent backend running (default: `http://localhost:5001`)

## Installation

```bash
# From the repo root
cd cli
npm install
npm run build
npm install -g .
```

After installation, the `eigent` command is available globally.

## Configuration

Run the config wizard to set your API key, model, and backend URL:

```bash
eigent config
```

Config is stored at `~/.eigent/cli-config.json`.

You can also use environment variables (or `.env.development` at the repo root):

```
EIGENT_API_URL=http://localhost:5001
EIGENT_API_KEY=sk-...
EIGENT_MODEL_PLATFORM=openai
EIGENT_MODEL_TYPE=gpt-4o
EIGENT_EMAIL=you@example.com
```

## Usage

### Interactive mode (REPL)

```bash
eigent
```

### One-shot mode

```bash
eigent "search for YC W2026 companies and save one to w26.json"
```

### CLI options

```
eigent [question]          Ask a question (one-shot mode)
eigent config              Configure API key, model, backend URL
eigent --help              Show help
eigent --version           Show version
```

### REPL commands

| Command              | Description                          |
|----------------------|--------------------------------------|
| `/new`               | Start a new conversation             |
| `/project`           | Show current project ID              |
| `/workspace`         | Show current workspace path          |
| `/workspace <path>`  | Change workspace directory           |
| `/stop`              | Stop the current task                |
| `/quit` or `/exit`   | Exit the CLI                         |
| `Ctrl+C`             | Stop streaming / exit                |
| `Ctrl+E`             | Expand last collapsed output         |

## Development

```bash
# Watch mode (auto-rebuild on changes)
npm run dev

# Manual build
npm run build

# Run without global install
node dist/index.js
```

## Updating

After pulling changes:

```bash
cd cli
npm run build
npm install -g .
```
