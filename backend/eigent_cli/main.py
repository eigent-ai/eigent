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
"""Commands for starting, following and steering Eigent Tasks."""

from __future__ import annotations

import json
import sys
import time
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

import click
import httpx

from eigent_cli import brain as background
from eigent_cli.client import (
    EXIT_FAILED,
    EXIT_INTERRUPTED,
    EXIT_UNREACHABLE,
    EXIT_WAITING,
    TERMINAL_STATUS_EXIT,
    BrainClient,
    CliError,
    resolve_connection,
)
from eigent_cli.render import (
    format_time,
    interaction_summary,
    reason_text,
    render_event,
    status_word,
)

ACTIVE_STATUSES = ("pending", "running", "waiting_for_user")
WAITING_EVENT_TYPES = {"interaction.requested", "approval.requested"}
TERMINAL_EVENT_TYPES = {
    "run.completed",
    "run.failed",
    "run.cancelled",
    "run.deadline_reached",
}
MAX_RECONNECT_FAILURES = 5
# Starting a Task waits for admission, which prepares its environment.
START_TIMEOUT_SECONDS = 180.0
SESSION_MODES = ("single-agent", "workforce")

ClientFactory = Callable[[], BrainClient]


class Context:
    def __init__(self, *, url: str | None, as_json: bool):
        self.url = url
        self.as_json = as_json
        self.client_factory: ClientFactory | None = None

    def client(self) -> BrainClient:
        if self.client_factory is not None:
            return self.client_factory()
        return BrainClient(resolve_connection(self.url))

    def emit(self, data: Any) -> None:
        click.echo(json.dumps(data, ensure_ascii=False, default=str))


pass_context = click.make_pass_decorator(Context)


@click.group(
    context_settings={"help_option_names": ["-h", "--help"]},
)
@click.option(
    "--url",
    envvar="EIGENT_BRAIN_URL",
    help="Eigent address, e.g. http://127.0.0.1:5001. Defaults to the one "
    "Eigent publishes in "
    "~/.eigent/cli/brain.json.",
)
@click.option(
    "--json",
    "as_json",
    is_flag=True,
    help="Print JSON. Events are printed one per line, unchanged.",
)
@click.pass_context
def cli(ctx: click.Context, url: str | None, as_json: bool) -> None:
    """Start, follow and steer Eigent Tasks from a terminal.

    Works with the Eigent app when it runs with CLI access turned on
    (EIGENT_CLI_ACCESS=1), or with no app at all: "eigent run" starts
    Eigent in the background when it is not running. "eigent remote"
    steers the app on another machine through your Eigent account.

    \b
    Exit codes:
      0  Task completed      4  Task stopped
      1  Task failed/error   5  Task reached its deadline
      2  Usage error         6  Task interrupted
      3  Waiting for you     7  Cannot reach or sign in to Eigent
    """

    if ctx.obj is None:
        ctx.obj = Context(url=url, as_json=as_json)
    else:
        ctx.obj.url = url or ctx.obj.url
        ctx.obj.as_json = as_json or ctx.obj.as_json


# ---------------------------------------------------------------- helpers


def _pending_interactions(
    client: BrainClient, run_id: str
) -> list[dict[str, Any]]:
    body = client.get(
        f"/runs/{run_id}/interactions", params={"status": "pending"}
    )
    items = body.get("interactions") if isinstance(body, dict) else None
    return [item for item in items or [] if isinstance(item, dict)]


def _pick_interaction(
    items: list[dict[str, Any]],
    *,
    interaction_id: str | None,
    approval: bool,
) -> dict[str, Any]:
    if interaction_id:
        for item in items:
            if item.get("interaction_id") == interaction_id:
                return item
        raise CliError(f"No pending request {interaction_id!r} on this Task.")
    wanted = [
        item
        for item in items
        if (item.get("interaction_type") == "approval") == approval
    ]
    kind = "approval" if approval else "question"
    if not wanted:
        raise CliError(f"This Task has no pending {kind}.")
    if len(wanted) > 1:
        lines = "\n".join(f"  {interaction_summary(item)}" for item in wanted)
        raise CliError(
            f"This Task has {len(wanted)} pending {kind}s. "
            f"Choose one with --interaction:\n{lines}"
        )
    return wanted[0]


def _decide(
    client: BrainClient,
    run_id: str,
    interaction: dict[str, Any],
    decision: dict[str, Any],
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "decision_request_id": f"cli-{uuid.uuid4()}",
        "decision": decision,
        "expected_version": int(interaction.get("version") or 0),
        "actor_type": "user",
        "source": "desktop",
    }
    if interaction.get("interaction_type") == "approval":
        body["action_digest"] = interaction.get("action_digest")
    return client.post(
        f"/runs/{run_id}/interactions/{interaction['interaction_id']}"
        "/decisions",
        json=body,
    )


def _report_decision(ctx: Context, receipt: Any, verb: str) -> None:
    if ctx.as_json:
        ctx.emit(receipt)
        return
    status = receipt.get("status") if isinstance(receipt, dict) else None
    if status == "resolved":
        click.echo(f"{verb}.")
    else:
        click.echo(f"{verb}. The request is now {status or 'unknown'}.")


def _is_console(stream: Any) -> bool:
    try:
        if not stream.isatty():
            return False
        if sys.platform != "win32":
            return True
        # Windows reports the NUL device as a TTY; only a real console
        # handle has a console mode.
        import ctypes
        import msvcrt

        handle = msvcrt.get_osfhandle(stream.fileno())
        mode = ctypes.c_uint32()
        return bool(
            ctypes.windll.kernel32.GetConsoleMode(handle, ctypes.byref(mode))
        )
    except (AttributeError, ValueError, OSError):
        return False


def _attached_to_terminal() -> bool:
    """Whether a person is watching, so waiting for them makes sense."""

    return _is_console(sys.stdin) and _is_console(sys.stdout)


# --------------------------------------------------------------- commands


@cli.command()
@pass_context
def status(ctx: Context) -> None:
    """Show whether Eigent is reachable and which Sessions need you."""

    with ctx.client() as client:
        health = client.get("/health")
        attention = client.get("/runs/attention") or []
    if ctx.as_json:
        ctx.emit(
            {
                "brain_url": client.base_url,
                "health": health,
                "attention": attention,
            }
        )
        return
    click.echo(f"Eigent at {client.base_url}: {health.get('status', '?')}")
    if not attention:
        click.echo("No Session has a running Task.")
        return
    for row in attention:
        state = "waiting for you" if row["state"] == "waiting" else "running"
        click.echo(f"  Session {row['project_id']}: {state}")


@cli.command()
@click.option(
    "--session",
    "project_id",
    help="Session ID. Without it, lists active Tasks in every Session.",
)
@click.option(
    "--status",
    "statuses",
    multiple=True,
    help="Only Tasks with this status. Repeatable.",
)
@click.option("--limit", default=20, show_default=True, type=int)
@pass_context
def tasks(
    ctx: Context,
    project_id: str | None,
    statuses: tuple[str, ...],
    limit: int,
) -> None:
    """List Tasks."""

    runs: list[dict[str, Any]] = []
    with ctx.client() as client:
        if project_id:
            project_ids = [project_id]
            wanted = statuses
        else:
            attention = client.get("/runs/attention") or []
            project_ids = [row["project_id"] for row in attention]
            wanted = statuses or ACTIVE_STATUSES
        for pid in project_ids:
            params: dict[str, Any] = {"project_id": pid, "limit": limit}
            if wanted:
                params["status"] = list(wanted)
            body = client.get("/runs", params=params) or {}
            runs.extend(body.get("runs") or [])
    runs.sort(key=lambda run: run.get("updated_at") or 0, reverse=True)
    runs = runs[:limit]
    if ctx.as_json:
        ctx.emit({"tasks": runs})
        return
    if not runs:
        click.echo("No Tasks found.")
        return
    click.echo(f"{'TASK':<40} {'SESSION':<40} {'STATUS':<17} UPDATED")
    for run in runs:
        click.echo(
            f"{run['run_id']:<40} {run['project_id']:<40} "
            f"{status_word(run.get('status')):<17} "
            f"{format_time(run.get('updated_at'))}"
        )


@cli.command()
@click.argument("task_id")
@pass_context
def show(ctx: Context, task_id: str) -> None:
    """Show one Task and anything it is waiting on."""

    with ctx.client() as client:
        run = client.get(f"/runs/{task_id}")
        pending = (
            _pending_interactions(client, task_id)
            if run.get("status") == "waiting_for_user"
            else []
        )
    if ctx.as_json:
        ctx.emit({**run, "pending_interactions": pending})
        return
    click.echo(f"Task      {run['run_id']}")
    click.echo(f"Session   {run['project_id']}")
    click.echo(f"Status    {status_word(run.get('status'))}")
    reason = run.get("terminal_reason")
    if reason and reason != run.get("status"):
        click.echo(f"Reason    {reason_text(reason)}")
    model = run.get("resolved_model")
    if isinstance(model, dict) and model.get("model_type"):
        click.echo(f"Model     {model['model_type']}")
    click.echo(f"Attempts  {len(run.get('attempts') or [])}")
    click.echo(f"Started   {format_time(run.get('created_at'))}")
    click.echo(f"Updated   {format_time(run.get('updated_at'))}")
    for item in pending:
        click.echo(f"  {interaction_summary(item)}")


def _exit_for_run(
    ctx: Context, client: BrainClient, task_id: str
) -> int | None:
    """Exit code if the Task has stopped moving, otherwise None."""

    run = client.get(f"/runs/{task_id}")
    status = run.get("status")
    if status in TERMINAL_STATUS_EXIT:
        return TERMINAL_STATUS_EXIT[status]
    if status == "interrupted":
        if not ctx.as_json:
            click.echo(
                f"Task interrupted. Resume it with: eigent resume {task_id}",
                err=True,
            )
        return EXIT_INTERRUPTED
    return None


def _waiting_exit(ctx: Context, client: BrainClient, task_id: str) -> bool:
    pending = _pending_interactions(client, task_id)
    if not pending:
        return False
    if ctx.as_json:
        ctx.emit({"control": "waiting_for_user", "interactions": pending})
    else:
        click.echo("Waiting for you:", err=True)
        for item in pending:
            click.echo(f"  {interaction_summary(item)}", err=True)
        click.echo(
            f'Answer with: eigent answer {task_id} "..." or '
            f"eigent approve {task_id}",
            err=True,
        )
    return True


@cli.command()
@click.argument("task_id")
@click.option(
    "--after",
    "after_sequence",
    default=0,
    type=int,
    help="Only events after this sequence number.",
)
@click.option(
    "--exit-when-waiting/--keep-waiting",
    default=None,
    help="Exit with code 3 when the Task waits for a person. "
    "Default: exit when not run from an interactive terminal.",
)
@click.option("--verbose", is_flag=True, help="Show bookkeeping events too.")
@pass_context
def follow(
    ctx: Context,
    task_id: str,
    after_sequence: int,
    exit_when_waiting: bool | None,
    verbose: bool,
) -> None:
    """Print a Task's timeline and keep following it until it ends.

    The exit code reflects how the Task ended.
    """

    with ctx.client() as client:
        _follow_task(
            ctx,
            client,
            task_id,
            after_sequence=after_sequence,
            exit_when_waiting=exit_when_waiting,
            verbose=verbose,
        )


def _follow_task(
    ctx: Context,
    client: BrainClient,
    task_id: str,
    *,
    after_sequence: int = 0,
    exit_when_waiting: bool | None = None,
    verbose: bool = False,
) -> None:
    """Print a Task's timeline until it stops moving, then exit."""

    if exit_when_waiting is None:
        exit_when_waiting = not _attached_to_terminal()
    cursor = after_sequence
    failures = 0
    # Rounds in a row that brought no new event. A Task with no live
    # consumer in this Brain (for example, waiting on you) ends each stream
    # right after the replay, so back off instead of reconnecting every
    # second.
    idle_rounds = 0
    caught_up_once = False
    while True:
        start_cursor = cursor
        try:
            for name, data in client.stream_events(task_id, cursor):
                failures = 0
                if name == "heartbeat":
                    continue
                if name != "run_event":
                    repeat = name == "replay_caught_up" and caught_up_once
                    if ctx.as_json and not repeat:
                        ctx.emit({"control": name, **data})
                    if name == "replay_caught_up":
                        caught_up_once = True
                    if (
                        name == "replay_caught_up"
                        and exit_when_waiting
                        and _waiting_exit(ctx, client, task_id)
                    ):
                        sys.exit(EXIT_WAITING)
                    continue
                sequence = data.get("sequence")
                if isinstance(sequence, int):
                    cursor = max(cursor, sequence)
                if ctx.as_json:
                    ctx.emit(data)
                else:
                    line = render_event(data, verbose=verbose)
                    if line is not None:
                        click.echo(line)
                event_type = data.get("event_type")
                if event_type in TERMINAL_EVENT_TYPES:
                    code = _exit_for_run(ctx, client, task_id)
                    if code is not None:
                        sys.exit(code)
                if (
                    event_type in WAITING_EVENT_TYPES
                    and exit_when_waiting
                    and _waiting_exit(ctx, client, task_id)
                ):
                    sys.exit(EXIT_WAITING)
        except (httpx.TransportError, httpx.StreamError) as exc:
            failures += 1
            if failures >= MAX_RECONNECT_FAILURES:
                raise CliError(
                    f"Lost the connection to Eigent ({exc}).",
                    EXIT_UNREACHABLE,
                ) from exc
        # The stream ended or dropped. Stop if the Task has, otherwise
        # reconnect from the last sequence seen.
        code = _exit_for_run(ctx, client, task_id)
        if code is not None:
            sys.exit(code)
        if exit_when_waiting and _waiting_exit(ctx, client, task_id):
            sys.exit(EXIT_WAITING)
        idle_rounds = idle_rounds + 1 if cursor == start_cursor else 0
        time.sleep(min(1.0 + failures + idle_rounds, 5.0))


@cli.command()
@click.argument("task_id")
@click.argument("text", required=False)
@click.option(
    "--option",
    "option_id",
    help="Pick one of the offered options instead of typing an answer.",
)
@click.option(
    "--interaction",
    "interaction_id",
    help="Which question, when the Task has more than one.",
)
@pass_context
def answer(
    ctx: Context,
    task_id: str,
    text: str | None,
    option_id: str | None,
    interaction_id: str | None,
) -> None:
    """Answer a question a Task is waiting on."""

    if bool(text) == bool(option_id):
        raise click.UsageError("Give either an answer TEXT or --option.")
    with ctx.client() as client:
        interaction = _pick_interaction(
            _pending_interactions(client, task_id),
            interaction_id=interaction_id,
            approval=False,
        )
        if interaction.get("interaction_type") == "approval":
            raise CliError(
                "That request is an approval. Use eigent approve or "
                "eigent deny."
            )
        decision = {"option_id": option_id} if option_id else {"reply": text}
        receipt = _decide(client, task_id, interaction, decision)
    _report_decision(ctx, receipt, "Answer sent")


def _approval_command(approved: bool):
    verb = "approve" if approved else "deny"

    @click.argument("task_id")
    @click.option(
        "--scope",
        type=click.Choice(["once", "run", "space"]),
        default="once",
        show_default=True,
        help="once: this action only. run: the rest of this Task. "
        "space: future Tasks in this Space too. Only scopes the request "
        "offers are accepted.",
    )
    @click.option(
        "--interaction",
        "interaction_id",
        help="Which approval, when the Task has more than one.",
    )
    @pass_context
    def command(
        ctx: Context, task_id: str, scope: str, interaction_id: str | None
    ) -> None:
        with ctx.client() as client:
            interaction = _pick_interaction(
                _pending_interactions(client, task_id),
                interaction_id=interaction_id,
                approval=True,
            )
            if interaction.get("interaction_type") != "approval":
                raise CliError(
                    "That request is a question. Use eigent answer."
                )
            request = interaction.get("request") or {}
            offered = request.get("allowed_scopes") or ["once"]
            if scope not in offered:
                raise CliError(
                    f"Scope {scope!r} is not offered for this approval. "
                    f"Offered: {', '.join(map(str, offered))}."
                )
            receipt = _decide(
                client,
                task_id,
                interaction,
                {
                    "decision": "approved" if approved else "rejected",
                    "scope": scope,
                },
            )
        _report_decision(ctx, receipt, "Approved" if approved else "Denied")

    command.__doc__ = (
        "Approve the action a Task is waiting on."
        if approved
        else "Deny the action a Task is waiting on."
    )
    return cli.command(name=verb)(command)


approve = _approval_command(True)
deny = _approval_command(False)


@cli.command()
@click.argument("task_id")
@pass_context
def stop(ctx: Context, task_id: str) -> None:
    """Stop a running Task."""

    with ctx.client() as client:
        run = client.get(f"/runs/{task_id}")
        if run.get("status") in TERMINAL_STATUS_EXIT:
            message = f"Task already {status_word(run['status']).lower()}."
            if ctx.as_json:
                ctx.emit(run)
            else:
                click.echo(message)
            return
        result = client.post(
            f"/runs/{task_id}/cancel",
            json={
                "request_id": f"cli-cancel-{uuid.uuid4()}",
                "reason": "explicit_cancel",
            },
        )
    if ctx.as_json:
        ctx.emit(result)
        return
    click.echo(f"Task {status_word(result.get('status')).lower()}.")


# ------------------------------------------------- starting Tasks


def _client_for_start(ctx: Context, *, start: bool) -> BrainClient:
    """A client for commands that can run with no app open.

    Starts Eigent in the background when nothing is running and ``start`` is
    set. An explicit --url is never replaced by a background start.
    """

    if ctx.client_factory is not None:
        return ctx.client()
    try:
        connection = resolve_connection(ctx.url)
    except CliError:
        connection = None
    if connection is not None and background.is_reachable(connection):
        return BrainClient(connection)
    if not start or ctx.url:
        raise CliError(
            "Eigent is not running. Start it with: eigent brain start",
            EXIT_UNREACHABLE,
        )
    click.echo("Starting Eigent in the background...", err=True)
    return BrainClient(background.start_background())


def _start_task(client: BrainClient, body: dict[str, Any]) -> dict[str, Any]:
    result = client.post("/v1/tasks", json=body, timeout=START_TIMEOUT_SECONDS)
    if not isinstance(result, dict) or "task_id" not in result:
        raise CliError("Eigent did not return a Task.")
    return result


def _report_started(ctx: Context, result: dict[str, Any]) -> None:
    if ctx.as_json:
        ctx.emit({"control": "task_" + str(result.get("status")), **result})
        return
    task_id, session_id = result["task_id"], result.get("project_id")
    if result.get("status") == "queued":
        click.echo(
            f"Task {task_id} queued in Session {session_id}. It starts when "
            "the running Task ends.",
            err=True,
        )
    else:
        click.echo(
            f"Task {task_id} started in Session {session_id}.", err=True
        )


def _wait_until_started(client: BrainClient, task_id: str) -> None:
    """Block while a Task is still queued behind another one."""

    while True:
        task = client.get(f"/v1/tasks/{task_id}")
        if not task.get("queued"):
            return
        if task.get("status") != "queued":
            reason = task.get("terminal_reason")
            raise CliError(
                "The queued Task did not start"
                + (f": {reason}" if reason else ".")
            )
        time.sleep(1.0)


def _last_sequence(client: BrainClient, task_id: str) -> int:
    cursor = 0
    while True:
        page = client.get(
            f"/runs/{task_id}/events",
            params={"after_sequence": cursor, "limit": 5000},
        )
        next_sequence = page.get("next_sequence")
        if isinstance(next_sequence, int):
            cursor = max(cursor, next_sequence)
        if not page.get("has_more"):
            return cursor


def _start_and_follow(
    ctx: Context,
    client: BrainClient,
    body: dict[str, Any],
    *,
    follow_task: bool,
    exit_when_waiting: bool | None,
    verbose: bool,
) -> None:
    result = _start_task(client, body)
    _report_started(ctx, result)
    if not follow_task:
        return
    task_id = str(result["task_id"])
    if result.get("status") == "queued":
        _wait_until_started(client, task_id)
    _follow_task(
        ctx,
        client,
        task_id,
        exit_when_waiting=exit_when_waiting,
        verbose=verbose,
    )


_waiting_option = click.option(
    "--exit-when-waiting/--keep-waiting",
    default=None,
    help="Exit with code 3 when the Task waits for a person. "
    "Default: exit when not run from an interactive terminal.",
)
_verbose_option = click.option(
    "--verbose", is_flag=True, help="Show bookkeeping events too."
)
_attach_option = click.option(
    "--attach",
    "attachments",
    multiple=True,
    type=click.Path(exists=True, dir_okay=False, resolve_path=True),
    help="A file to give the Task. Repeatable.",
)


@cli.command(name="run")
@click.argument("prompt")
@click.option(
    "--space",
    "space",
    type=click.Path(exists=True, file_okay=False, resolve_path=True),
    help="Folder the Task works in. Required unless --session is given.",
)
@click.option(
    "--session",
    "project_id",
    help="Continue this Session instead of starting a new one.",
)
@click.option(
    "--mode",
    type=click.Choice(SESSION_MODES),
    help="How a new Session works: one agent, or a team of agents. "
    "Default: single-agent.",
)
@click.option(
    "--model",
    "model_type",
    help="Model name for a new Session, on the configured provider.",
)
@_attach_option
@click.option(
    "--detach",
    is_flag=True,
    help="Start the Task and return without following it.",
)
@click.option(
    "--no-start",
    is_flag=True,
    help="Fail instead of starting Eigent when it is not running.",
)
@_waiting_option
@_verbose_option
@pass_context
def run_task(
    ctx: Context,
    prompt: str,
    space: str | None,
    project_id: str | None,
    mode: str | None,
    model_type: str | None,
    attachments: tuple[str, ...],
    detach: bool,
    no_start: bool,
    exit_when_waiting: bool | None,
    verbose: bool,
) -> None:
    """Start a Task and follow it to the end.

    Works with no app open. The exit code reflects how the Task ended.

    \b
    A new Session needs a folder:   eigent run "..." --space DIR
    Continue an existing Session:   eigent run "..." --session ID
    """

    if not prompt.strip():
        raise click.UsageError("PROMPT is empty.")
    body: dict[str, Any] = {"prompt": prompt}
    if project_id:
        if space:
            raise click.UsageError(
                "--space only applies to a new Session; a Session keeps "
                "its folder."
            )
        body["project_id"] = project_id
        if mode:
            body["session_mode"] = mode
    else:
        if not space:
            raise click.UsageError(
                "Give the folder to work in with --space DIR, or continue "
                "a Session with --session ID."
            )
        body["space_root_path"] = str(Path(space))
        # Always stated: the app and the backend default differently.
        body["session_mode"] = mode or SESSION_MODES[0]
    if model_type:
        body["model_type"] = model_type
    if attachments:
        body["attachments"] = list(attachments)
    with _client_for_start(ctx, start=not no_start) as client:
        _start_and_follow(
            ctx,
            client,
            body,
            follow_task=not detach,
            exit_when_waiting=exit_when_waiting,
            verbose=verbose,
        )


@cli.command()
@click.argument("session_id")
@click.argument("text")
@_attach_option
@click.option(
    "--follow",
    "follow_task",
    is_flag=True,
    help="Follow the new Task to the end.",
)
@_waiting_option
@_verbose_option
@pass_context
def send(
    ctx: Context,
    session_id: str,
    text: str,
    attachments: tuple[str, ...],
    follow_task: bool,
    exit_when_waiting: bool | None,
    verbose: bool,
) -> None:
    """Send the next message to a Session started with "eigent run".

    It starts a new Task, or waits in line when one is still running.
    """

    if not text.strip():
        raise click.UsageError("TEXT is empty.")
    body: dict[str, Any] = {"prompt": text, "project_id": session_id}
    if attachments:
        body["attachments"] = list(attachments)
    with _client_for_start(ctx, start=True) as client:
        _start_and_follow(
            ctx,
            client,
            body,
            follow_task=follow_task,
            exit_when_waiting=exit_when_waiting,
            verbose=verbose,
        )


@cli.command()
@click.argument("task_id")
@click.option(
    "--detach",
    is_flag=True,
    help="Resume the Task and return without following it.",
)
@_waiting_option
@_verbose_option
@pass_context
def resume(
    ctx: Context,
    task_id: str,
    detach: bool,
    exit_when_waiting: bool | None,
    verbose: bool,
) -> None:
    """Resume an interrupted Task that was started with "eigent run".

    A Task is interrupted when Eigent stops while it is running.
    """

    with _client_for_start(ctx, start=True) as client:
        attempts = client.get(f"/runs/{task_id}").get("attempts") or []
        # Follow only what happens from here on, not the earlier timeline.
        last_sequence = _last_sequence(client, task_id)
        result = client.post(
            f"/v1/tasks/{task_id}/resume",
            json={"request_id": f"cli-resume-{uuid.uuid4()}"},
            timeout=START_TIMEOUT_SECONDS,
        )
        if ctx.as_json:
            ctx.emit({"control": "task_resumed", **result})
        else:
            click.echo(
                f"Task {task_id} resumed (attempt {len(attempts) + 1}).",
                err=True,
            )
        if detach:
            return
        _follow_task(
            ctx,
            client,
            task_id,
            after_sequence=last_sequence,
            exit_when_waiting=exit_when_waiting,
            verbose=verbose,
        )


# ---------------------------------------------- running with no app


@cli.group(name="brain")
def brain_group() -> None:
    """Run Eigent in the background, with no app open."""


@brain_group.command(name="start")
@click.option(
    "--port",
    type=int,
    envvar="EIGENT_BRAIN_PORT",
    help="Port to listen on. Default: the first free one from 5151.",
)
@pass_context
def brain_start(ctx: Context, port: int | None) -> None:
    """Start Eigent in the background.

    It keeps running after this command returns, until "eigent brain stop".
    Tasks need a model: set EIGENT_MODEL_PLATFORM, EIGENT_MODEL_TYPE and
    EIGENT_MODEL_API_KEY (and EIGENT_MODEL_API_URL for a custom endpoint)
    in the environment or in ~/.eigent/.env first.
    """

    running = background.find_running(ctx.url)
    if running is not None:
        if ctx.as_json:
            ctx.emit({"brain_url": running.base_url, "started": False})
        else:
            click.echo(f"Eigent is already running at {running.base_url}.")
        return
    connection = background.start_background(port)
    if ctx.as_json:
        ctx.emit({"brain_url": connection.base_url, "started": True})
        return
    click.echo(f"Eigent is running at {connection.base_url}.")
    click.echo(f"Log: {background.log_path()}")


@brain_group.command(name="stop")
@click.option(
    "--force",
    is_flag=True,
    help="End the process if it does not stop by itself.",
)
@pass_context
def brain_stop(ctx: Context, force: bool) -> None:
    """Stop the Eigent that "eigent brain start" started.

    Tasks still running become interrupted and can be resumed later. The
    desktop app is not affected: quit the app to stop that one.
    """

    connection = background.find_running(ctx.url)
    if connection is None:
        if ctx.as_json:
            ctx.emit({"stopped": False, "running": False})
        else:
            click.echo("Eigent is not running.")
        return
    with BrainClient(connection) as client:
        background.stop(client, connection, force=force)
    if ctx.as_json:
        ctx.emit({"stopped": True, "running": False})
    else:
        click.echo("Eigent stopped.")


def run(argv: list[str] | None = None, obj: Context | None = None) -> int:
    """Run one command and return its exit code."""

    try:
        result = cli.main(
            args=argv, prog_name="eigent", standalone_mode=False, obj=obj
        )
    except click.exceptions.Abort:
        click.echo("Interrupted.", err=True)
        return 130
    except click.ClickException as exc:
        exc.show()
        return exc.exit_code
    except CliError as exc:
        click.echo(f"Error: {exc.message}", err=True)
        return exc.exit_code
    except KeyboardInterrupt:
        return 130
    except SystemExit as exc:
        if exc.code is None:
            return 0
        return exc.code if isinstance(exc.code, int) else EXIT_FAILED
    return result if isinstance(result, int) else 0


def main(argv: list[str] | None = None) -> None:
    sys.exit(run(argv))


# Registers ``login``, ``logout`` and ``remote`` on ``cli``. Imported last:
# that module builds on the group and helpers defined above.
from eigent_cli import remote as _remote  # noqa: E402, F401

__all__ = ["Context", "cli", "main", "run"]
