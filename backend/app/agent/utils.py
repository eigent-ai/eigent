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

import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.run_context import get_current_run_context


def current_time_str(
    tz_name: str | None = None, now: datetime.datetime | None = None
) -> str:
    """Read the clock at attempt creation, with an explicit local zone."""
    zone = None
    if tz_name:
        try:
            zone = ZoneInfo(tz_name)
        except (ZoneInfoNotFoundError, ValueError):
            pass
    instant = now if now is not None else datetime.datetime.now(datetime.UTC)
    local = instant.astimezone(zone)
    offset = local.strftime("%z")
    offset = f"{offset[:3]}:{offset[3:]}"
    name = getattr(zone, "key", None) or local.tzname() or "local"
    return f"{local:%Y-%m-%d %H:00:00} {name} ({local.tzname()}, UTC{offset})"


def agent_current_time(options, *, task_id: str | None = None) -> str:
    """Keep every agent in an attempt on the same immutable clock snapshot."""
    context = get_current_run_context()
    if (
        context is not None
        and context.task_id == (task_id or options.task_id)
        and context.project_id == options.project_id
        and context.prompt_current_time is not None
    ):
        return context.prompt_current_time
    return current_time_str(options.timezone)


def refresh_agent_current_time(agent, current_time: str) -> None:
    """Refresh a retained agent only at a new Run boundary, before reset."""
    previous = getattr(agent, "_prompt_current_time", None)
    original = getattr(agent, "_original_system_message", None)
    if (
        isinstance(previous, str)
        and previous != current_time
        and original is not None
    ):
        agent.update_system_message(
            original.create_new_instance(
                original.content.replace(previous, current_time)
            ),
            reset_memory=False,
        )
        agent._prompt_current_time = current_time
