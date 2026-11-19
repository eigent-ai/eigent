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
"""``eigent login`` and ``eigent remote``: steer a desktop from elsewhere.

Every command here goes through the Eigent server, the same way the remote
web page does. The Task runs on the desktop; this machine only sends
commands and reads the events the desktop syncs.
"""

from __future__ import annotations

import socket
import sys
import time
import uuid
import webbrowser
from typing import Any

import click
import httpx

from eigent_cli.client import (
    EXIT_CANCELLED,
    EXIT_COMPLETED,
    EXIT_DEADLINE,
    EXIT_FAILED,
    EXIT_INTERRUPTED,
    EXIT_UNREACHABLE,
    EXIT_WAITING,
    CliError,
)
from eigent_cli.cloud import (
    Account,
    CloudClient,
    RemoteLink,
    default_server_url,
    forget_account,
    forget_link,
    load_account,
    load_links,
    parse_link_url,
    resolve_link,
    save_link,
)
from eigent_cli.main import (
    Context,
    _attached_to_terminal,
    cli,
    pass_context,
)
from eigent_cli.render import (
    format_time,
    interaction_summary,
    render_event,
    status_word,
)

MAX_RECONNECT_FAILURES = 5
TERMINAL_EVENT_EXIT = {
    "run.completed": EXIT_COMPLETED,
    "run.failed": EXIT_FAILED,
    "run.cancelled": EXIT_CANCELLED,
    "run.deadline_reached": EXIT_DEADLINE,
    "run.interrupted": EXIT_INTERRUPTED,
    "runtime.interrupted": EXIT_INTERRUPTED,
}
_REQUESTED = {"interaction.requested", "approval.requested"}
_CLOSED = {
    "interaction.resolved",
    "interaction.cancelled",
    "interaction.expired",
    "approval.decided",
    "approval.cancelled",
    "approval.expired",
    "approval.expired_rejected",
}


def _cloud(ctx: Context, *, server: str | None = None) -> CloudClient:
    """A client for the server the saved sign-in belongs to."""

    factory = getattr(ctx, "cloud_factory", None)
    if factory is not None:
        return factory()
    account = load_account()
    return CloudClient(
        server or (account.server_url if account else default_server_url()),
        account,
    )


# ------------------------------------------------------------- sign-in


@cli.command()
@click.option(
    "--server",
    envvar="EIGENT_SERVER_URL",
    help="Eigent server address. Default: the public Eigent service.",
)
@click.option(
    "--no-browser",
    is_flag=True,
    help="Only print the address; do not try to open a browser.",
)
@click.option(
    "--approve",
    "approve_code",
    metavar="CODE",
    help="Approve a sign-in that was started on another machine, using the "
    "code it shows. Needs this machine to be signed in already.",
)
@pass_context
def login(
    ctx: Context,
    server: str | None,
    no_browser: bool,
    approve_code: str | None,
) -> None:
    """Sign in to your Eigent account from this terminal.

    Prints a short code. Approve it where you are already signed in; this
    command waits until you do. Needed for "eigent remote" only: working
    with an Eigent on this machine needs no account.
    """

    if approve_code:
        with _cloud(ctx, server=server) as client:
            result = client.approve_device_sign_in(approve_code)
        if ctx.as_json:
            ctx.emit(result)
        else:
            name = result.get("client_name") or "the other machine"
            click.echo(f"Approved the sign-in for {name}.")
        return

    factory = getattr(ctx, "cloud_factory", None)
    client = factory() if factory else CloudClient(default_server_url(server))
    with client:
        started = client.start_device_sign_in(
            f"eigent CLI on {socket.gethostname()}"
        )
        user_code = str(started["user_code"])
        address = str(started["verification_uri"])
        if ctx.as_json:
            ctx.emit(
                {
                    "control": "sign_in_started",
                    "user_code": user_code,
                    "verification_uri": address,
                    "verification_uri_complete": started.get(
                        "verification_uri_complete"
                    ),
                    "expires_in": started.get("expires_in"),
                }
            )
        else:
            click.echo(f"To sign in, open {address}", err=True)
            click.echo(f"and enter the code: {user_code}", err=True)
            click.echo("Waiting for you to approve it...", err=True)
        if not no_browser and _attached_to_terminal():
            try:
                webbrowser.open(
                    str(started.get("verification_uri_complete") or address)
                )
            except Exception:  # noqa: S110 - the address is printed above
                pass
        interval = float(started.get("interval") or 5)
        deadline = time.monotonic() + float(started.get("expires_in") or 600)
        tokens: dict[str, Any] | None = None
        while time.monotonic() < deadline:
            time.sleep(interval)
            result = client.poll_device_sign_in(str(started["device_code"]))
            if isinstance(result, dict):
                tokens = result
                break
            if result == "slow_down":
                interval += 5
        if tokens is None:
            raise CliError(
                "The sign-in code expired before it was approved. Run "
                "eigent login again.",
                EXIT_UNREACHABLE,
            )
        account = Account(
            server_url=client.server_url,
            access_token=str(tokens["access_token"]),
            refresh_token=str(tokens.get("refresh_token") or ""),
            email=tokens.get("email"),
        )
        account.save()
    if ctx.as_json:
        ctx.emit({"control": "signed_in", "email": account.email})
    else:
        click.echo(f"Signed in as {account.email or 'your account'}.")


@cli.command()
@pass_context
def logout(ctx: Context) -> None:
    """Forget this machine's sign-in and its saved remote links.

    Other devices stay signed in, and remote links stay usable from where
    they were created.
    """

    removed = forget_account()
    for session_id in list(load_links()):
        forget_link(session_id)
    if ctx.as_json:
        ctx.emit({"signed_out": removed})
    else:
        click.echo("Signed out." if removed else "You were not signed in.")


# ------------------------------------------------------- event helpers


def pending_requests(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Questions and approvals still open after ``events``, oldest first.

    Shaped like the local API's pending interactions so the same summary and
    decision code can use them.
    """

    pending: dict[str, dict[str, Any]] = {}
    for event in events:
        event_type = event.get("event_type")
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
        request_id = payload.get("interaction_id") or payload.get(
            "approval_id"
        )
        if not request_id:
            continue
        if event_type in _CLOSED:
            pending.pop(str(request_id), None)
        elif event_type in _REQUESTED:
            approval = event_type == "approval.requested"
            request = payload.get("prompt" if approval else "request")
            request = dict(request) if isinstance(request, dict) else {}
            if approval:
                scopes = payload.get("decision_scope")
                request.setdefault(
                    "allowed_scopes",
                    scopes if isinstance(scopes, list) else ["once"],
                )
                request.setdefault("prompt", payload.get("prompt"))
            pending[str(request_id)] = {
                "interaction_id": str(request_id),
                "interaction_type": "approval"
                if approval
                else payload.get("interaction_type") or "question",
                "run_id": event.get("run_id"),
                "version": payload.get("version") or 0,
                "action_digest": payload.get("action_digest"),
                "request": request,
                "options": payload.get("options") or [],
            }
    return list(pending.values())


def _as_local_event(event: dict[str, Any]) -> dict[str, Any]:
    """Number a synced event the way a local Task's timeline is numbered."""

    return {**event, "sequence": event.get("run_sequence")}


def _pick_request(
    pending: list[dict[str, Any]],
    *,
    interaction_id: str | None,
    approval: bool,
) -> dict[str, Any]:
    kind = "approval" if approval else "question"
    if interaction_id:
        for item in pending:
            if item["interaction_id"] == interaction_id:
                return item
        raise CliError(
            f"No pending request {interaction_id!r} in this Session."
        )
    wanted = [
        item
        for item in pending
        if (item["interaction_type"] == "approval") == approval
    ]
    if not wanted:
        raise CliError(f"This Session has no pending {kind}.")
    if len(wanted) > 1:
        lines = "\n".join(f"  {interaction_summary(item)}" for item in wanted)
        raise CliError(
            f"This Session has {len(wanted)} pending {kind}s. Choose one "
            f"with --interaction:\n{lines}"
        )
    return wanted[0]


def _target(
    client: CloudClient, link: RemoteLink, project_id: str | None
) -> dict[str, Any]:
    """The Session a command goes to, as the server wants it addressed."""

    if project_id is None:
        info = client.link_info(link)
        project_id = info.get("current_project_id") or info.get("project_id")
        brain = info.get("current_brain_session_id") or info.get(
            "brain_session_id"
        )
        if project_id and brain:
            return {
                "project_id": project_id,
                "task_id": info.get("current_task_id"),
                "brain_session_id": brain,
            }
    if project_id is None:
        raise CliError(
            "This remote link has no Session selected yet. List the Space's "
            "Sessions with: eigent remote sessions, then pass --session ID."
        )
    selected = client.set_target(link, project_id)
    return {
        "project_id": selected.get("current_project_id") or project_id,
        "task_id": selected.get("current_task_id"),
        "brain_session_id": selected.get("current_brain_session_id"),
    }


def _report_waiting(ctx: Context, pending: list[dict[str, Any]]) -> None:
    if ctx.as_json:
        ctx.emit({"control": "waiting_for_user", "interactions": pending})
        return
    click.echo("Waiting for you:", err=True)
    for item in pending:
        click.echo(f"  {interaction_summary(item)}", err=True)
    click.echo(
        'Answer with: eigent remote answer "..." or eigent remote approve',
        err=True,
    )


def _follow_remote(
    ctx: Context,
    client: CloudClient,
    link: RemoteLink,
    project_id: str,
    *,
    task_id: str | None,
    cursor: int | None,
    exit_when_waiting: bool | None,
    verbose: bool,
) -> None:
    """Print a Task's timeline from the server until it ends, then exit."""

    if exit_when_waiting is None:
        exit_when_waiting = not _attached_to_terminal()
    seen: list[dict[str, Any]] = []

    def handle(event: dict[str, Any]) -> None:
        nonlocal task_id
        if task_id is None:
            task_id = event.get("run_id")
        if event.get("run_id") != task_id:
            return
        seen.append(event)
        if ctx.as_json:
            ctx.emit(event)
        else:
            line = render_event(_as_local_event(event), verbose=verbose)
            if line is not None:
                click.echo(line)
        event_type = event.get("event_type")
        if event_type in TERMINAL_EVENT_EXIT:
            sys.exit(TERMINAL_EVENT_EXIT[event_type])
        if event_type in _REQUESTED and exit_when_waiting:
            _report_waiting(ctx, pending_requests(seen))
            sys.exit(EXIT_WAITING)

    if cursor is None:
        snapshot = client.snapshot(link, project_id)
        runs = snapshot.get("runs") or []
        if task_id is None and runs:
            latest = max(
                runs, key=lambda run: str(run.get("updated_at") or "")
            )
            task_id = latest.get("run_id")
        cursor = 0
        for event in snapshot.get("recent_events") or []:
            cursor = max(cursor, int(event.get("cloud_cursor") or 0))
            handle(event)
        cursor = max(cursor, int(snapshot.get("current_cursor") or 0))
        open_requests = pending_requests(seen)
        if open_requests and exit_when_waiting:
            _report_waiting(ctx, open_requests)
            sys.exit(EXIT_WAITING)

    failures = 0
    while True:
        try:
            for name, data in client.stream_events(link, project_id, cursor):
                failures = 0
                if name == "canonical_event":
                    cursor = max(cursor, int(data.get("cloud_cursor") or 0))
                    handle(data)
                elif name == "end":
                    cursor = max(cursor, int(data.get("cursor") or 0))
                    if data.get("reason") == "link_closed":
                        raise CliError(
                            "The remote link was turned off or expired.",
                            EXIT_UNREACHABLE,
                        )
                    break
        except (httpx.TransportError, httpx.StreamError) as exc:
            failures += 1
            if failures >= MAX_RECONNECT_FAILURES:
                raise CliError(
                    f"Lost the connection to the Eigent server ({exc}).",
                    EXIT_UNREACHABLE,
                ) from exc
            time.sleep(min(1.0 + failures, 5.0))


def _session_events(
    client: CloudClient, link: RemoteLink, project_id: str
) -> list[dict[str, Any]]:
    return list(client.snapshot(link, project_id).get("recent_events") or [])


# ------------------------------------------------------------ commands


@cli.group(name="remote")
def remote_group() -> None:
    """Follow and steer Tasks on your desktop from another machine.

    The desktop must be running the Eigent app, signed in to the same
    account. Sign in here first with "eigent login".
    """


_link_option = click.option(
    "--link",
    "link_ref",
    help="Which remote link, by ID or the start of it. Not needed when "
    "this machine has only one.",
)
_session_option = click.option(
    "--session",
    "project_id",
    help="Session ID. Default: the Session the link is on.",
)
_waiting_option = click.option(
    "--exit-when-waiting/--keep-waiting",
    default=None,
    help="Exit with code 3 when the Task waits for a person. "
    "Default: exit when not run from an interactive terminal.",
)


@remote_group.command(name="list")
@pass_context
def remote_list(ctx: Context) -> None:
    """Show your desktops and remote links."""

    saved = load_links()
    with _cloud(ctx) as client:
        desktops = client.list_desktops()
        links = client.list_links()
    if ctx.as_json:
        ctx.emit(
            {
                "desktops": desktops,
                "links": [
                    {**link, "usable_here": link["session_id"] in saved}
                    for link in links
                ],
            }
        )
        return
    if not desktops:
        click.echo("No desktop is registered to your account yet.")
    for desktop in desktops:
        state = (
            "online" if desktop.get("bridge_status") == "online" else "offline"
        )
        click.echo(f"Desktop {desktop['desktop_instance_id']}: {state}")
    if not links:
        click.echo("No remote link is active.")
        return
    click.echo(
        f"{'LINK':<30} {'SPACE':<24} {'DESKTOP':<8} {'HERE':<5} EXPIRES"
    )
    for link in links:
        here = "yes" if link["session_id"] in saved else "no"
        click.echo(
            f"{link['session_id']:<30} "
            f"{str(link.get('space_name') or '-')[:24]:<24} "
            f"{str(link.get('bridge_status') or '-'):<8} {here:<5} "
            f"{str(link.get('expires_at') or '')[:16]}"
        )
    if not saved:
        click.echo(
            "A link marked HERE=no was created elsewhere. Create one for "
            "this machine with: eigent remote connect"
        )


@remote_group.command(name="connect")
@click.argument("link_url", required=False)
@click.option(
    "--desktop", "desktop_id", help="Desktop ID, when you have several."
)
@click.option("--space", "space_id", help="Space ID, when you have several.")
@click.option(
    "--hours",
    default=24,
    show_default=True,
    type=click.IntRange(1, 168),
    help="How long the new link stays valid.",
)
@pass_context
def remote_connect(
    ctx: Context,
    link_url: str | None,
    desktop_id: str | None,
    space_id: str | None,
    hours: int,
) -> None:
    """Create a remote link to a desktop, or save one you were given.

    With no LINK_URL, creates a link to your online desktop. With a
    LINK_URL copied from the Eigent app, saves that link on this machine.
    """

    with _cloud(ctx) as client:
        if link_url:
            session_id, token = parse_link_url(link_url)
            link = RemoteLink(session_id=session_id, link_token=token)
            info = client.link_info(link)
        else:
            if desktop_id is None:
                online = [
                    desktop
                    for desktop in client.list_desktops()
                    if desktop.get("bridge_status") == "online"
                ]
                if not online:
                    raise CliError(
                        "None of your desktops is online. Open the Eigent "
                        "app on one and sign in to the same account.",
                        EXIT_UNREACHABLE,
                    )
                if len(online) > 1:
                    names = ", ".join(d["desktop_instance_id"] for d in online)
                    raise CliError(
                        f"Several desktops are online ({names}). Choose one "
                        "with --desktop ID."
                    )
                desktop_id = str(online[0]["desktop_instance_id"])
            if space_id is None:
                spaces = client.list_spaces()
                if len(spaces) > 1:
                    lines = "\n".join(
                        f"  {space.get('id')}  {space.get('name')}"
                        for space in spaces
                    )
                    raise CliError(
                        "Choose the Space to connect to with --space ID:\n"
                        + lines
                    )
                space_id = str(spaces[0]["id"]) if spaces else None
            created = client.create_link(desktop_id, space_id, hours)
            session_id, token = parse_link_url(str(created["url"]))
            link = RemoteLink(session_id=session_id, link_token=token)
            info = client.link_info(link)
    link = RemoteLink(
        session_id=link.session_id,
        link_token=link.link_token,
        title=str(info.get("title") or ""),
        space_name=str(info.get("space_name") or ""),
    )
    save_link(link)
    if ctx.as_json:
        ctx.emit({"link": link.session_id, **info})
        return
    click.echo(
        f"Connected. Link {link.session_id} to Space "
        f"{link.space_name or '-'} is saved on this machine."
    )


@remote_group.command(name="disconnect")
@_link_option
@pass_context
def remote_disconnect(ctx: Context, link_ref: str | None) -> None:
    """Turn a remote link off for everyone and forget it here."""

    link = resolve_link(link_ref)
    with _cloud(ctx) as client:
        client.revoke_link(link)
    forget_link(link.session_id)
    if ctx.as_json:
        ctx.emit({"link": link.session_id, "revoked": True})
    else:
        click.echo(f"Link {link.session_id} is turned off.")


@remote_group.command(name="sessions")
@_link_option
@pass_context
def remote_sessions(ctx: Context, link_ref: str | None) -> None:
    """List the Sessions in the link's Space."""

    link = resolve_link(link_ref)
    with _cloud(ctx) as client:
        info = client.link_info(link)
        items = client.link_sessions(link)
    current = info.get("current_project_id") or info.get("project_id")
    if ctx.as_json:
        ctx.emit({"current": current, "sessions": items})
        return
    if not items:
        click.echo("This Space has no Session yet.")
        return
    for item in items:
        marker = "*" if item.get("id") == current else " "
        click.echo(
            f"{marker} {item.get('id'):<40} "
            f"{status_word(item.get('status')):<12} "
            f"{str(item.get('name') or '')[:50]}"
        )
    click.echo("* is the Session the link is on.")


@remote_group.command(name="status")
@_link_option
@_session_option
@pass_context
def remote_status(
    ctx: Context, link_ref: str | None, project_id: str | None
) -> None:
    """Show the Session's Tasks and anything they are waiting on."""

    link = resolve_link(link_ref)
    with _cloud(ctx) as client:
        target = _target(client, link, project_id)
        snapshot = client.snapshot(link, target["project_id"])
    runs = snapshot.get("runs") or []
    pending = pending_requests(list(snapshot.get("recent_events") or []))
    if ctx.as_json:
        ctx.emit(
            {
                "project_id": target["project_id"],
                "tasks": runs,
                "pending_interactions": pending,
            }
        )
        return
    click.echo(f"Session   {target['project_id']}")
    if not runs:
        click.echo("No Task yet.")
    for run in sorted(
        runs, key=lambda item: str(item.get("updated_at") or "")
    ):
        updated = run.get("updated_at")
        when = (
            format_time(updated)
            if isinstance(updated, (int, float))
            else updated
        )
        click.echo(
            f"Task      {run.get('run_id')}  "
            f"{status_word(run.get('status'))}  {str(when or '')[:19]}"
        )
    for item in pending:
        click.echo(f"  {interaction_summary(item)}")


@remote_group.command(name="follow")
@_link_option
@_session_option
@click.option("--task", "task_id", help="Task ID. Default: the latest one.")
@_waiting_option
@click.option("--verbose", is_flag=True, help="Show bookkeeping events too.")
@pass_context
def remote_follow(
    ctx: Context,
    link_ref: str | None,
    project_id: str | None,
    task_id: str | None,
    exit_when_waiting: bool | None,
    verbose: bool,
) -> None:
    """Print a Task's timeline and keep following it until it ends.

    The exit code reflects how the Task ended, as with "eigent follow".
    """

    link = resolve_link(link_ref)
    with _cloud(ctx) as client:
        target = _target(client, link, project_id)
        _follow_remote(
            ctx,
            client,
            link,
            target["project_id"],
            task_id=task_id,
            cursor=None,
            exit_when_waiting=exit_when_waiting,
            verbose=verbose,
        )


@remote_group.command(name="send")
@click.argument("text")
@_link_option
@_session_option
@click.option(
    "--follow",
    "follow_task",
    is_flag=True,
    help="Follow the new Task to the end.",
)
@_waiting_option
@click.option("--verbose", is_flag=True, help="Show bookkeeping events too.")
@pass_context
def remote_send(
    ctx: Context,
    text: str,
    link_ref: str | None,
    project_id: str | None,
    follow_task: bool,
    exit_when_waiting: bool | None,
    verbose: bool,
) -> None:
    """Send a message to the Session on your desktop.

    It starts a new Task there, or waits in line behind a running one.
    """

    if not text.strip():
        raise click.UsageError("TEXT is empty.")
    link = resolve_link(link_ref)
    with _cloud(ctx) as client:
        target = _target(client, link, project_id)
        cursor = int(
            client.snapshot(link, target["project_id"], event_limit=1).get(
                "current_cursor"
            )
            or 0
        )
        result = client.send_command(
            link,
            "user_message",
            {"content": text},
            target=target,
            client_request_id=f"cli-{uuid.uuid4()}",
        )
        new_task = result.get("next_task_id")
        if ctx.as_json:
            ctx.emit({"control": "message_sent", **result})
        else:
            click.echo(
                f"Sent. Task {new_task or '(pending)'} in Session "
                f"{target['project_id']}.",
                err=True,
            )
        if follow_task:
            _follow_remote(
                ctx,
                client,
                link,
                target["project_id"],
                task_id=new_task,
                cursor=cursor,
                exit_when_waiting=exit_when_waiting,
                verbose=verbose,
            )


def _decide(
    ctx: Context,
    link_ref: str | None,
    project_id: str | None,
    interaction_id: str | None,
    *,
    approval: bool,
    decision: dict[str, Any],
    scope: str | None = None,
    done: str,
) -> None:
    link = resolve_link(link_ref)
    with _cloud(ctx) as client:
        target = _target(client, link, project_id)
        request = _pick_request(
            pending_requests(
                _session_events(client, link, target["project_id"])
            ),
            interaction_id=interaction_id,
            approval=approval,
        )
        if scope is not None:
            offered = request["request"].get("allowed_scopes") or ["once"]
            if scope not in offered:
                raise CliError(
                    f"Scope {scope!r} is not offered for this approval. "
                    f"Offered: {', '.join(map(str, offered))}."
                )
        result = client.send_command(
            link,
            "interaction_decision",
            {
                "run_id": request["run_id"],
                "interaction_id": request["interaction_id"],
                "expected_version": int(request["version"] or 0),
                "action_digest": request["action_digest"],
                "decision": decision,
            },
            target=target,
            client_request_id=f"cli-{uuid.uuid4()}",
        )
    if ctx.as_json:
        ctx.emit(result)
    else:
        click.echo(f"{done}. Your desktop applies it when it receives it.")


@remote_group.command(name="answer")
@click.argument("text", required=False)
@click.option(
    "--option",
    "option_id",
    help="Pick one of the offered options instead of typing an answer.",
)
@click.option(
    "--interaction",
    "interaction_id",
    help="Which question, when the Session has more than one.",
)
@_link_option
@_session_option
@pass_context
def remote_answer(
    ctx: Context,
    text: str | None,
    option_id: str | None,
    interaction_id: str | None,
    link_ref: str | None,
    project_id: str | None,
) -> None:
    """Answer a question a Task on your desktop is waiting on."""

    if bool(text) == bool(option_id):
        raise click.UsageError("Give either an answer TEXT or --option.")
    _decide(
        ctx,
        link_ref,
        project_id,
        interaction_id,
        approval=False,
        decision={"option_id": option_id} if option_id else {"reply": text},
        done="Answer sent",
    )


def _remote_approval_command(approved: bool):
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
        help="Which approval, when the Session has more than one.",
    )
    @_link_option
    @_session_option
    @pass_context
    def command(
        ctx: Context,
        scope: str,
        interaction_id: str | None,
        link_ref: str | None,
        project_id: str | None,
    ) -> None:
        _decide(
            ctx,
            link_ref,
            project_id,
            interaction_id,
            approval=True,
            decision={
                "decision": "approved" if approved else "rejected",
                "scope": scope,
            },
            scope=scope,
            done="Approved" if approved else "Denied",
        )

    command.__doc__ = (
        "Approve the action a Task on your desktop is waiting on."
        if approved
        else "Deny the action a Task on your desktop is waiting on."
    )
    return remote_group.command(name="approve" if approved else "deny")(
        command
    )


remote_approve = _remote_approval_command(True)
remote_deny = _remote_approval_command(False)


@remote_group.command(name="stop")
@_link_option
@_session_option
@pass_context
def remote_stop(
    ctx: Context, link_ref: str | None, project_id: str | None
) -> None:
    """Stop the Task running in the Session on your desktop."""

    link = resolve_link(link_ref)
    with _cloud(ctx) as client:
        target = _target(client, link, project_id)
        result = client.send_command(
            link,
            "stop",
            {},
            target=target,
            client_request_id=f"cli-{uuid.uuid4()}",
        )
    if ctx.as_json:
        ctx.emit(result)
    else:
        click.echo(
            "Stop sent. Your desktop stops the Task when it receives it."
        )
