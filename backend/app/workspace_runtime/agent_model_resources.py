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

"""Explicit SDK clients and an already loaded tokenizer for one Agent.

No tokenizer download/cache discovery is performed here. Deployment supplies
the loaded, code-owned counter; absence is a capability/configuration failure.
Only async OpenAI Chat Completions without telemetry or SDK ambient settings
is currently supported. This does not claim general third-party isolation.
"""

from __future__ import annotations

import copy
import hashlib

from .agent_configuration import AgentConfigurationUnavailable


class LoadedOpenAITokenizer:
    def __init__(self, counter):
        from camel.utils.token_counting import OpenAITokenCounter
        from tiktoken import Encoding

        if (
            type(counter) is not OpenAITokenCounter
            or type(counter.encoding) is not Encoding
        ):
            raise AgentConfigurationUnavailable("loaded_tokenizer_required")
        self._counter = copy.copy(counter)
        self.reference = "tokenizer:" + self._digest()

    def _digest(self):
        counter = self._counter
        encoding = counter.encoding
        digest = hashlib.sha256()
        digest.update(
            repr(
                (
                    counter.model,
                    counter.tokens_per_message,
                    counter.tokens_per_name,
                    encoding.name,
                    encoding._pat_str,
                )
            ).encode()
        )
        for token, rank in sorted(encoding._mergeable_ranks.items()):
            digest.update(len(token).to_bytes(4, "big"))
            digest.update(token)
            digest.update(rank.to_bytes(4, "big"))
        for token, rank in sorted(encoding._special_tokens.items()):
            digest.update(repr((token, rank)).encode())
        return digest.hexdigest()

    def for_model(self, model_type):
        from camel.types import UnifiedModelType

        if (
            self._counter.model
            != UnifiedModelType(model_type).value_for_tiktoken
            or self.reference != "tokenizer:" + self._digest()
        ):
            raise AgentConfigurationUnavailable("tokenizer_binding_changed")
        return copy.copy(self._counter)


def require_supported_instrumentation():
    import camel.agents.chat_agent as chat_module
    import camel.models.base_model as base_module
    import camel.models.openai_model as model_module
    from camel.utils import track_agent
    from camel.utils.langfuse import observe

    if (
        chat_module.observe is not observe
        or base_module.observe is not observe
        or model_module.observe is not observe
        or chat_module.track_agent is not track_agent
        or track_agent.__module__.startswith("agentops")
    ):
        raise AgentConfigurationUnavailable("agent_telemetry_unsupported")


class AgentModelResources:
    def __init__(
        self,
        *,
        options,
        tokenizer,
        provider_capability,
        authorize,
        refresh_authorization=None,
        context_source=None,
        journal=None,
    ):
        import httpx
        from openai import AsyncOpenAI, OpenAI

        from app.run_runtime.owned_tasks import current_owned_tasks

        owner = current_owned_tasks()
        if owner is None:
            raise AgentConfigurationUnavailable("agent_task_scope_required")
        require_supported_instrumentation()
        self.authorize = authorize
        self.refresh_authorization = refresh_authorization
        self.provider_capability = provider_capability
        self.counter = tokenizer.for_model(options.model_type)
        self.context_source = context_source
        self.journal = journal
        self.model_type = options.model_type
        self.context = None
        self.sync_client = None
        self.async_client = None
        settings = {
            "api_key": options.api_key,
            "base_url": options.api_url,
            "organization": "",
            "project": "",
            "webhook_secret": "",
            "timeout": options.extra_params["timeout"],
            "max_retries": options.extra_params["max_retries"],
        }
        # Both SDK clients are explicit. HTTPX will not discover host proxies
        # or TLS settings from the process environment.
        sync_http = httpx.Client(trust_env=False)
        try:
            self.sync_client = OpenAI(**settings, http_client=sync_http)
        except BaseException:
            sync_http.close()
            raise
        async_http = None
        try:
            async_http = httpx.AsyncClient(trust_env=False)
            self.async_client = AsyncOpenAI(**settings, http_client=async_http)
        except BaseException:
            self.sync_client.close()
            if async_http is not None:
                owner.create_task(async_http.aclose())
            raise

    def constructor_arguments(self):
        self.authorize()
        require_supported_instrumentation()
        return {
            "client": self.sync_client,
            "async_client": self.async_client,
            "token_counter": self.counter,
        }

    def bind(self, model):
        # CAMEL initializes logging fields from the environment in __init__.
        # Suppress those instance writers before the first model request.
        model._log_enabled = False
        model._log_model_config_dict_enabled = False
        if self.context_source is not None:
            from camel.types import UnifiedModelType

            from .agent_context import AgentContext

            if (
                str(model.model_type) != self.model_type
                or model.token_limit
                != UnifiedModelType(self.model_type).token_limit
            ):
                raise AgentConfigurationUnavailable(
                    "context_model_binding_changed"
                )
            self.context = AgentContext(
                source=self.context_source,
                journal=self.journal,
                counter=self.counter,
                model_type=self.model_type,
                model_window=model.token_limit,
            )

            def guarded(original):
                async def dispatch(**kwargs):
                    return await self.context.dispatch(
                        original,
                        self.async_client,
                        self.authorize_action,
                        kwargs,
                    )

                return dispatch

            completions = self.async_client.chat.completions
            completions.create = guarded(completions.create)
            # In the supported SDK beta.chat.completions aliases chat.completions.
            # Install parse once, independently of the create request path.
            parsing = self.async_client.beta.chat.completions
            parsing.parse = guarded(parsing.parse)
        original = model.arun

        async def authorized_arun(*args, **kwargs):
            await self.authorize_action()
            require_supported_instrumentation()
            return await original(*args, **kwargs)

        def reject_sync(*_args, **_kwargs):
            raise AgentConfigurationUnavailable(
                "synchronous_model_unsupported"
            )

        model.arun = authorized_arun
        model.run = reject_sync
        return model

    async def authorize_action(self):
        if self.refresh_authorization is not None:
            await self.refresh_authorization()
        self.authorize()

    async def close(self):
        try:
            if self.async_client is not None:
                await self.async_client.close()
        finally:
            if self.sync_client is not None:
                self.sync_client.close()
