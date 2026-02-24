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

import json
from pathlib import Path

import click

CONFIG_PATH = Path.home() / ".eigent" / "cli-config.json"


def load_config() -> dict:
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    return {}


def save_config(cfg: dict) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(
        json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8"
    )


@click.group()
def config():
    """Manage Eigent CLI configuration (API keys, model, email …)."""
    ...


@config.command("set")
@click.option("--api-key", default=None, help="LLM API key")
@click.option(
    "--platform",
    default=None,
    help="Model platform (e.g. openai, anthropic, openai-compatible-model)",
)
@click.option(
    "--model",
    default=None,
    help="Model type (e.g. gpt-4o, claude-3-7-sonnet-20250219)",
)
@click.option("--api-url", default=None, help="Custom API base URL (optional)")
@click.option(
    "--email", default=None, help="Your email (used for file organization)"
)
def config_set(api_key, platform, model, api_url, email):
    """Set one or more configuration values."""
    cfg = load_config()
    if api_key:
        cfg["api_key"] = api_key
    if platform:
        cfg["platform"] = platform
    if model:
        cfg["model"] = model
    if api_url:
        cfg["api_url"] = api_url
    if email:
        cfg["email"] = email
    save_config(cfg)
    click.echo("✓ Config saved to ~/.eigent/cli-config.json")


@config.command("show")
def config_show():
    """Show current configuration."""
    cfg = load_config()
    if not cfg:
        click.echo(
            "No config found. Run `eigent config set --help` to get started."
        )
        return
    # Mask API key
    display = dict(cfg)
    if "api_key" in display and display["api_key"]:
        key = display["api_key"]
        display["api_key"] = (
            key[:8] + "..." + key[-4:] if len(key) > 12 else "***"
        )
    click.echo(json.dumps(display, indent=2, ensure_ascii=False))


@config.command("clear")
def config_clear():
    """Remove all saved configuration."""
    if CONFIG_PATH.exists():
        CONFIG_PATH.unlink()
        click.echo("✓ Config cleared.")
    else:
        click.echo("No config file found.")
