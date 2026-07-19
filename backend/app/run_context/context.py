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

import os
from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from pathlib import Path

THIRD_PARTY_OS_ENV_KEYS = ("CAMEL_LOG_DIR", "CAMEL_WORKDIR")


@dataclass(frozen=True)
class RunContext:
    """Task-scoped runtime values that must not live in process globals."""

    space_id: str
    project_id: str
    run_id: str
    task_id: str
    email: str
    user_id: str | None
    working_directory: Path
    task_output_root: Path
    camel_log_dir: Path
    binding_source: str
    workdir_mode: str | None
    browser_port: int
    cdp_url: str | None = None
    api_key: str | None = None
    api_base_url: str | None = None
    cloud_api_key: str | None = None
    server_url: str | None = None
    auth_header: str | None = None
    search_config: dict[str, str] = field(default_factory=dict)
    extra_env: dict[str, str] = field(default_factory=dict)

    def env_overrides(self) -> dict[str, str]:
        values: dict[str, str] = {
            "file_save_path": str(self.task_output_root),
            "browser_port": str(self.browser_port),
            "CAMEL_LOG_DIR": str(self.camel_log_dir),
            "CAMEL_WORKDIR": str(self.task_output_root),
        }
        if self.cdp_url:
            values["EIGENT_CDP_URL"] = self.cdp_url
        if self.api_key:
            values["OPENAI_API_KEY"] = self.api_key
        if self.api_base_url:
            values["OPENAI_API_BASE_URL"] = self.api_base_url
        if self.cloud_api_key:
            values["cloud_api_key"] = self.cloud_api_key
        if self.server_url:
            values["SERVER_URL"] = self.server_url
        values.update(
            {key: value for key, value in self.search_config.items() if value}
        )
        values.update(
            {key: value for key, value in self.extra_env.items() if value}
        )
        return values

    def env_value(self, key: str) -> str | None:
        return self.env_overrides().get(key)


current_run_context: ContextVar[RunContext | None] = ContextVar(
    "current_run_context", default=None
)


def get_current_run_context() -> RunContext | None:
    return current_run_context.get()


def get_run_env_override(key: str) -> str | None:
    context = get_current_run_context()
    if context is None:
        return None
    return context.env_value(key)


def apply_run_env_for_third_party(context: RunContext) -> None:
    """Publish the small env subset third-party libraries read directly.

    First-party code must use app.component.environment.env(), which reads
    RunContext before os.environ. Some third-party libraries, notably CAMEL's
    model logging, call os.environ.get(...) themselves and cannot see our
    ContextVar. Keep this shim intentionally tiny and auditable.
    """

    overrides = context.env_overrides()
    for key in THIRD_PARTY_OS_ENV_KEYS:
        value = overrides.get(key)
        if value:
            os.environ[key] = value


@contextmanager
def run_context_scope(context: RunContext) -> Iterator[RunContext]:
    token = current_run_context.set(context)
    try:
        yield context
    finally:
        current_run_context.reset(token)


async def stream_with_run_context(
    stream: AsyncIterator[str],
    context_getter: Callable[[], RunContext | None],
) -> AsyncIterator[str]:
    iterator = stream.__aiter__()
    while True:
        context = context_getter()
        if context is None:
            try:
                yield await iterator.__anext__()
            except StopAsyncIteration:
                return
            continue

        token = current_run_context.set(context)
        try:
            item = await iterator.__anext__()
        except StopAsyncIteration:
            return
        finally:
            current_run_context.reset(token)
        yield item
