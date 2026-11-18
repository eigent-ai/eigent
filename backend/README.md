```bash
# Option 1: Start with uvicorn directly
uv run uvicorn main:api --port 5001

# Option 2: Standalone mode (no Electron dependency)
uv run python main.py

# Option 3: If uv run hangs, delete lock files and retry, or use venv directly:
.venv/bin/python main.py
# or
.venv/bin/uvicorn main:api --port 5001 --host 0.0.0.0

# If uv hangs, delete lock files first: rm -f uv_installing.lock uv_installed.lock
```

### Environment Variables (Standalone)

| Variable                           | Default             | Description                                                                               |
| ---------------------------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| `EIGENT_BRAIN_PORT`                | 5001                | Listening port                                                                            |
| `EIGENT_BRAIN_HOST`                | 0.0.0.0             | Listening address                                                                         |
| `EIGENT_DEBUG`                     | -                   | Set to 1/true to enable reload                                                            |
| `EIGENT_WORKSPACE`                 | ~/.eigent/workspace | Working directory                                                                         |
| `EIGENT_DEPLOYMENT_TYPE`           | (auto)              | `local` / `cloud_vm` / `sandbox` / `docker`; determines Hands capabilities (see ADR-0006) |
| `EIGENT_HANDS_MODE`                | -                   | Set to `remote` to enable `RemoteHands` (remote cluster resource mode)                    |
| `EIGENT_HANDS_CLUSTER_CONFIG_FILE` | -                   | Path to `RemoteHands` config file (TOML); **recommended**                                 |
| `EIGENT_HANDS_TERMINAL`            | -                   | Override terminal hand: `1`/`true`/`yes` or `0`/`false`/`no`                              |
| `EIGENT_HANDS_BROWSER`             | -                   | Override browser hand                                                                     |
| `EIGENT_HANDS_FILESYSTEM`          | -                   | Override filesystem scope: `full` / `workspace_only`                                      |
| `EIGENT_HANDS_MCP`                 | -                   | Override MCP mode: `all` / `allowlist`                                                    |

### Command-line client (`eigent`)

Follow and steer Tasks on a running Eigent from a terminal. CLI access is off
by default. Turn it on by setting `EIGENT_CLI_ACCESS=1` (in your environment or
in `~/.eigent/.env`) and restarting Eigent. Eigent then writes:

- `~/.eigent/cli/token`: the token the CLI sends. It works only on Run routes
  and only from this machine. Anything that can read this file as your user
  can approve or stop your Tasks, so leave CLI access off when you do not use
  it.
- `~/.eigent/cli/brain.json`: the address the CLI connects to.

```bash
uv run python -m eigent_cli status            # Is Eigent up, which Sessions need you
uv run python -m eigent_cli tasks             # Active Tasks across Sessions
uv run python -m eigent_cli show TASK_ID
uv run python -m eigent_cli follow TASK_ID    # Timeline until the Task ends
uv run python -m eigent_cli answer TASK_ID "use the docs folder"
uv run python -m eigent_cli approve TASK_ID --scope once
uv run python -m eigent_cli deny TASK_ID
uv run python -m eigent_cli stop TASK_ID
uv run python -m eigent_cli --json follow TASK_ID   # One event per line
```

`follow` exits with how the Task ended: `0` completed, `1` failed, `3` waiting
for you (when no one is at the terminal), `4` stopped, `5` deadline reached,
`6` interrupted, `7` cannot reach or sign in to Eigent.

RemoteHands config file example:

```bash
cp backend/config/hands_clusters.example.toml ~/.eigent/hands_clusters.toml
export EIGENT_HANDS_MODE=remote
export EIGENT_HANDS_CLUSTER_CONFIG_FILE=~/.eigent/hands_clusters.toml
```

i18n operation process: https://github.com/Anbarryprojects/fastapi-babel

```bash

pybabel extract -F babel.cfg -o messages.pot . --ignore-pot-creation-date  # Extract multilingual strings from code to messages.pot file
pybabel init -i messages.pot -d lang -l zh_CN   # Generate Chinese language pack, can only be generated initially, subsequent execution will cause overwrite
pybabel compile -d lang -l zh_CN                # Compile language pack


pybabel update -i messages.pot -d lang
# -i messages.pot: Specify the input file as the generated .pot file
# -d translations: Specify the translation directory, which typically contains .po files for each language
# -l zh: Specify the language code
```

```bash
# regular search
\berror\b(?!\])
```
