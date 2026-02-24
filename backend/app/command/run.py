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

import asyncio
import json
import time

import click

from app.command.config import load_config


# ---------------------------------------------------------------------------
# Minimal mock so step_solve can call `await request.is_disconnected()`
# ---------------------------------------------------------------------------
class _MockRequest:
    async def is_disconnected(self) -> bool:
        return False


# ---------------------------------------------------------------------------
# SSE event pretty-printer
# ---------------------------------------------------------------------------
_IGNORED_STEPS = {"ping"}


def _print_event(step: str, data) -> None:
    if step in _IGNORED_STEPS:
        return

    if step == "task_state":
        tasks = data if isinstance(data, list) else [data]
        for t in tasks:
            status = t.get("status", "")
            content = t.get("content", "")
            if content:
                click.echo(f"  [{status}] {content}")

    elif step == "activate_agent":
        name = data.get("name", "") if isinstance(data, dict) else data
        click.secho(f"\n[Agent] {name}", fg="cyan", bold=True)

    elif step == "activate_toolkit":
        name = data.get("name", "") if isinstance(data, dict) else data
        click.echo(f"  [Tool] {name}")

    elif step == "assign_task":
        content = data.get("content", "") if isinstance(data, dict) else data
        click.echo(f"  -> {content}")

    elif step == "end":
        result = data.get("result", data) if isinstance(data, dict) else data
        click.secho("\n[Result] ----------------------------------------", fg="green")
        click.echo(str(result))

    elif step == "error":
        msg = (
            data.get("message", str(data))
            if isinstance(data, dict)
            else str(data)
        )
        click.secho(f"\n[Error] {msg}", fg="red")

    else:
        # Generic fallback
        raw = (
            json.dumps(data, ensure_ascii=False)
            if not isinstance(data, str)
            else data
        )
        if raw:
            click.echo(f"  [{step}] {raw[:200]}")


# ---------------------------------------------------------------------------
# Core async runner
# ---------------------------------------------------------------------------
async def _run_task(chat_data) -> None:
    from app.model.chat import Chat
    from app.service.chat_service import step_solve
    from app.service.task import (
        ActionImproveData,
        ActionStartData,
        ActionStopData,
        get_or_create_task_lock,
        set_current_task_id,
    )

    task_lock = get_or_create_task_lock(chat_data["project_id"])
    set_current_task_id(chat_data["project_id"], chat_data["task_id"])

    await task_lock.put_queue(
        ActionImproveData(
            data=chat_data["question"],
            new_task_id=chat_data["task_id"],
        )
    )

    options = Chat(**chat_data)
    request = _MockRequest()

    async for chunk in step_solve(options, request, task_lock):
        if not chunk or not chunk.startswith("data:"):
            continue
        try:
            payload = json.loads(chunk[len("data:") :].strip())
            step = payload.get("step", "")
            data = payload.get("data", "")

            # Complex task: auto-start execution after task decomposition
            if step == "to_sub_tasks":
                await task_lock.put_queue(ActionStartData())
                _print_event(step, data)
                continue

            # Simple question: wait_confirm is the final answer, stop the loop
            if step == "wait_confirm":
                content = data.get("content", "") if isinstance(data, dict) else str(data)
                click.secho("\n[Answer]", fg="green", bold=True)
                click.echo(content)
                await task_lock.put_queue(ActionStopData())
                continue

            _print_event(step, data)
        except json.JSONDecodeError:
            pass


# ---------------------------------------------------------------------------
# CLI command
# ---------------------------------------------------------------------------
@click.command()
@click.argument("question")
@click.option("--api-key", default=None, help="LLM API key (overrides config)")
@click.option(
    "--platform",
    default=None,
    help="Model platform, e.g. openai / anthropic / openai-compatible-model",
)
@click.option("--model", default=None, help="Model type, e.g. gpt-4o")
@click.option("--api-url", default=None, help="Custom API base URL")
@click.option("--email", default=None, help="Your email")
@click.option(
    "--project-id", default=None, help="Project ID (auto-generated if omitted)"
)
def run(question, api_key, platform, model, api_url, email, project_id):
    """Run an AI multi-agent task.

    \b
    Examples:
      uv run python cli.py run "Search for the latest AI news and summarize"
      uv run python cli.py run "Write a Python web scraper" --model gpt-4o --api-key sk-...
    """
    cfg = load_config()

    # Merge config file < CLI flags (CLI takes priority)
    resolved_api_key = api_key or cfg.get("api_key")
    resolved_platform = platform or cfg.get("platform", "openai")
    resolved_model = model or cfg.get("model", "gpt-4o")
    resolved_api_url = api_url or cfg.get("api_url") or None
    resolved_email = email or cfg.get("email", "cli@eigent.local")

    if not resolved_api_key:
        click.secho(
            "✗ No API key found. Set one with:\n"
            "  uv run python cli.py config set --api-key <YOUR_KEY>",
            fg="red",

        )
        raise SystemExit(1)

    ts = str(int(time.time() * 1000))
    resolved_project_id = project_id or f"cli-project-{ts}"
    task_id = f"cli-task-{ts}"

    chat_data = {
        "task_id": task_id,
        "project_id": resolved_project_id,
        "question": question,
        "email": resolved_email,
        "model_platform": resolved_platform,
        "model_type": resolved_model,
        "api_key": resolved_api_key,
        "api_url": resolved_api_url,
    }

    click.secho(f"\nEigent > {question}", fg="bright_white", bold=True)
    click.echo(f"Model : {resolved_platform}/{resolved_model}")
    click.echo("─" * 50)

    try:
        asyncio.run(_run_task(chat_data))
    except KeyboardInterrupt:
        click.secho("\n\nInterrupted.", fg="yellow")
