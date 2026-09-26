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

"""Keep MCP transport entry and exit on one live task for a native Run.

The CAMEL compatibility client suppresses cleanup exceptions and enters its
AnyIO transport in a temporary task. Native settlement needs explicit cleanup
evidence; transport scopes must also exit on the task that entered them.
"""

import asyncio

from camel.toolkits import MCPToolkit
from camel.utils.mcp_client import MCPClient, TransportType


class OwnedMCPClient(MCPClient):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._owner_task = None
        self._close_requested = None
        self._cleanup_failure = None

    async def _establish_connection(self):
        if self._owner_task is not None and not self._owner_task.done():
            raise RuntimeError("MCP transport already has a live owner")
        if self._cleanup_failure is not None:
            raise RuntimeError(
                "MCP transport cleanup requires attention"
            ) from self._cleanup_failure
        ready = asyncio.get_running_loop().create_future()
        self._close_requested = asyncio.Event()

        async def own_transport():
            try:
                transports = [self.transport_type]
                if (
                    self.transport_type == TransportType.STREAMABLE_HTTP
                    and self.config.type is None
                ):
                    transports.append(TransportType.SSE)
                for transport in transports:
                    try:
                        await self._try_connect(transport)
                        break
                    except Exception:
                        # Keep CAMEL's HTTP-to-SSE compatibility, but never
                        # replace a transport whose cleanup is unproven.
                        if (
                            self._cleanup_failure is not None
                            or transport == transports[-1]
                        ):
                            raise
                ready.set_result(None)
                await self._close_requested.wait()
            except BaseException as exc:
                if not ready.done():
                    ready.set_exception(exc)
                raise
            finally:
                await self._close_owned_connection()

        self._owner_task = asyncio.create_task(own_transport())
        try:
            await asyncio.shield(ready)
        except BaseException:
            self._close_requested.set()
            await asyncio.shield(
                asyncio.gather(self._owner_task, return_exceptions=True)
            )
            raise

    async def _cleanup_connection(self):
        if asyncio.current_task() is self._owner_task:
            await self._close_owned_connection()
        elif self._owner_task is not None:
            self._close_requested.set()
            results = await asyncio.shield(
                asyncio.gather(self._owner_task, return_exceptions=True)
            )
            if self._cleanup_failure is not None:
                raise RuntimeError(
                    "MCP writer cleanup failed"
                ) from self._cleanup_failure
            # A failed handshake is already reported by connect. Closing it
            # is safe only if the transport's strict cleanup succeeded.
            if any(
                isinstance(result, asyncio.CancelledError)
                for result in results
            ):
                raise RuntimeError("MCP transport owner was abandoned")

    async def _close_owned_connection(self):
        failures = []
        for attribute in ("_session", "_connection_context"):
            resource = getattr(self, attribute)
            if resource is None:
                continue
            try:
                await resource.__aexit__(None, None, None)
                setattr(self, attribute, None)
            except BaseException as exc:
                failures.append(exc)
        self._tools = []
        if failures:
            self._cleanup_failure = failures[0]
            raise RuntimeError("MCP transport could not settle") from failures[
                0
            ]


class OwnedMCPToolkit(MCPToolkit):
    def _create_client_from_config(self, name, cfg):
        return OwnedMCPClient(cfg, timeout=self.timeout)

    async def _disconnect_all_clients(self):
        failures = []
        for client in self.clients:
            try:
                await client.__aexit__(None, None, None)
            except BaseException as exc:
                failures.append(exc)
        if failures:
            raise RuntimeError("MCP resources have not settled") from failures[
                0
            ]
        self._connected_clients = []

    async def disconnect(self):
        await self._disconnect_all_clients()
        self._is_connected = False
