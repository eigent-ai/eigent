# The `eigent` command line

`eigent` starts, follows and steers Tasks from a terminal. It works in three
ways:

| You want to                                   | Use                             | Needs                                     |
| --------------------------------------------- | ------------------------------- | ----------------------------------------- |
| Watch or steer a Task running in the app      | `eigent follow`, `approve`, ... | The app on this machine, CLI access on    |
| Run Tasks with no app open (scripts, servers) | `eigent run`                    | A model key in Eigent's settings          |
| Steer your desktop from another machine       | `eigent login`, `eigent remote` | An Eigent account, the app on the desktop |

Words used here match the app: a **Space** is a folder you work in, a
**Session** is one conversation in a Space, and a **Task** is one request and
the work it leads to.

## Install

### With the desktop app

The app writes a launcher to `~/.eigent/bin` every time it starts
(`eigent` on macOS and Linux, `eigent.cmd` on Windows). Put it on your PATH
once:

```bash
~/.eigent/bin/eigent install-path
```

On Windows:

```powershell
& "$env:USERPROFILE\.eigent\bin\eigent.cmd" install-path
```

Then open a new terminal and run `eigent --help`.

`install-path` adds `~/.eigent/bin` to your user PATH on Windows. On macOS
and Linux it links the launcher into `~/.local/bin` when that folder is on
your PATH, and otherwise prints the line to add to your shell profile. It
never edits your shell profile.

### Without the desktop app

From a checkout of this repository, with [uv](https://docs.astral.sh/uv/):

```bash
cd backend
uv sync
uv run python -m eigent_cli install-path
```

That writes the same launcher, pointing at this checkout.

### Tab completion

```bash
eigent completion bash >> ~/.bashrc
eigent completion zsh >> ~/.zshrc
eigent completion fish > ~/.config/fish/completions/eigent.fish
```

## Next to the app

CLI access is off by default. Turn it on by adding `EIGENT_CLI_ACCESS=1` to
`~/.eigent/.env` (or your environment) and restarting the app.

```bash
eigent status                 # Is Eigent up, which Sessions need you
eigent tasks                  # Active Tasks
eigent follow TASK_ID         # Timeline until the Task ends
eigent answer TASK_ID "use the docs folder"
eigent approve TASK_ID --scope once
eigent deny TASK_ID
eigent stop TASK_ID
```

Anything that can read `~/.eigent/cli/token` as your user can approve or stop
your Tasks, including an agent with a terminal. Leave CLI access off when you
do not use it.

## With no app open

Tell Eigent which model to use, in `~/.eigent/.env` or your environment:

```bash
EIGENT_MODEL_PLATFORM=openai
EIGENT_MODEL_TYPE=gpt-5.2
EIGENT_MODEL_API_KEY=sk-...
# Only for compatible or local endpoints:
# EIGENT_MODEL_API_URL=http://localhost:11434/v1
```

Then:

```bash
eigent run "Summarise the open TODOs" --space ~/work/repo
```

`run` starts Eigent in the background if it is not running, starts a Task in
a new Session in that folder, prints its timeline and exits when it ends.

```bash
eigent run "and now fix them" --session SESSION_ID   # Continue the Session
eigent send SESSION_ID "one more thing"              # Queues if a Task is running
eigent run "..." --space DIR --detach                # Start and return
eigent resume TASK_ID                                # After an interruption
eigent brain stop                                    # Stop the background Eigent
```

- A new Session uses one agent. Pass `--mode workforce` for a team of agents.
- The same folder is always the same Space, so "allow for this Space"
  approvals carry over between runs.
- Sessions started this way are not listed in the app.
- Only one Eigent can use `~/.eigent` at a time. If the app is running, `run`
  uses it (with CLI access on) instead of starting a second one.

### Scripts

```bash
eigent --json run "..." --space DIR > events.jsonl
echo "exit code: $?"
```

`--json` prints one JSON object per line: first the Task that was started,
then its events, unchanged.

| Exit code | Meaning                                        |
| --------- | ---------------------------------------------- |
| 0         | Task completed                                 |
| 1         | Task failed, or the command hit an error       |
| 2         | Wrong usage                                    |
| 3         | The Task is waiting for a person               |
| 4         | Task stopped                                   |
| 5         | Task reached its deadline                      |
| 6         | Task interrupted (resume with `eigent resume`) |
| 7         | Cannot reach or sign in to Eigent              |

When no one is at the terminal, a Task that needs an answer or an approval
makes `run` exit with code 3 and print the request. Your script decides:

```bash
eigent --json run "Run the test suite" --space . > out.jsonl
if [ $? -eq 3 ]; then
  TASK=$(head -n 1 out.jsonl | python -c 'import json,sys; print(json.load(sys.stdin)["task_id"])')
  eigent approve "$TASK" --scope run
  eigent follow "$TASK"
fi
```

There is no flag that approves everything. What a Task may do without asking
is the Space's permission setting.

## From another machine

`remote` steers Tasks that run in the app on your desktop. The desktop needs
the app open and signed in.

```bash
eigent login            # Shows a code; approve it where you are signed in
eigent remote connect   # Creates a link to your online desktop
eigent remote send "Add tests for the parser" --follow
eigent remote approve
eigent remote stop
eigent remote disconnect
```

- `eigent remote list` shows your desktops and links.
- `eigent remote sessions` lists the Sessions in the link's Space;
  `--session ID` picks another one.
- A link lasts 24 hours unless you pass `--hours`. You can also paste a link
  copied from the app: `eigent remote connect "https://..."`.
- `eigent logout` forgets the sign-in and links on this machine only.

## Files it keeps

| File                              | What                                            |
| --------------------------------- | ----------------------------------------------- |
| `~/.eigent/bin/eigent`            | The launcher                                    |
| `~/.eigent/.env`                  | Settings: `EIGENT_CLI_ACCESS`, `EIGENT_MODEL_*` |
| `~/.eigent/cli/token`             | Token for the Eigent on this machine            |
| `~/.eigent/cli/brain.json`        | Where the Eigent on this machine listens        |
| `~/.eigent/cli/brain.log`         | Log of a background Eigent                      |
| `~/.eigent/cli/account.json`      | Sign-in tokens for `eigent remote`              |
| `~/.eigent/cli/remote-links.json` | Remote links this machine can use               |

## When something goes wrong

| Message                                              | What to do                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| "No running Eigent with CLI access was found"        | `eigent brain start`, or turn CLI access on in the app and restart it       |
| "No model is configured"                             | Add the `EIGENT_MODEL_*` settings above, then `eigent brain stop` and retry |
| "Eigent is already running ... without CLI access"   | The app is open. Add `EIGENT_CLI_ACCESS=1` and restart it                   |
| "This Session was not started from the command line" | Continue that Session in the app                                            |
| "That desktop is offline"                            | Open the app on the desktop and sign in to the same account                 |
| A Task shows as interrupted                          | Eigent stopped while it ran. `eigent resume TASK_ID`                        |
