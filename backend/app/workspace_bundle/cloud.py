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

"""Device-authenticated Cloud transport for Workspace Bundle installation."""

from __future__ import annotations

import hashlib
from typing import Any, Protocol
from urllib.parse import urlparse

import httpx


class WorkspaceBundleCloudError(RuntimeError):
    def __init__(self, status_code: int, detail: Any) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"Workspace Bundle Cloud API returned {status_code}")


class WorkspaceBundleCloudTransport(Protocol):
    async def get_owner_revision(
        self, bundle_id: str, revision_id: str
    ) -> dict[str, Any]: ...

    async def get_catalog_revision(
        self, publisher_namespace: str, slug: str, version: int
    ) -> dict[str, Any]: ...

    async def resolve_owner_revision(
        self, slug: str, version: int
    ) -> dict[str, Any]: ...

    async def install(
        self, space_id: str, bundle_id: str, revision_id: str
    ) -> dict[str, Any]: ...

    async def confirm_install(
        self, space_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]: ...

    async def get_environment(self, space_id: str) -> dict[str, Any]: ...

    async def upgrade(
        self,
        space_id: str,
        *,
        revision_id: str,
        expected_installed_revision_id: str,
        expected_version: int,
    ) -> dict[str, Any]: ...

    async def bind_connection(
        self, space_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]: ...

    async def download_asset(
        self, bundle_id: str, revision_id: str, asset_id: str
    ) -> bytes: ...

    async def upload_asset(
        self,
        bundle_id: str,
        revision_id: str,
        *,
        logical_path: str,
        content: bytes,
        media_type: str,
        provenance: str,
        executable: bool,
        expected_old_digest: str | None = None,
    ) -> dict[str, Any]: ...

    async def put_environment_projection(
        self, payload: dict[str, Any]
    ) -> dict[str, Any]: ...

    async def close(self) -> None: ...


class HttpWorkspaceBundleCloudTransport:
    MAX_ASSET_BYTES = 16 * 1024 * 1024

    def __init__(
        self,
        *,
        server_url: str,
        authorization: str,
        desktop_instance_id: str,
        timeout_seconds: float = 30.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = self._api_base(server_url)
        if not authorization.strip():
            raise ValueError("Cloud authorization is required")
        if not desktop_instance_id.strip():
            raise ValueError("Desktop instance id is required")
        self.headers = {
            "Authorization": authorization,
            "X-Desktop-Instance-ID": desktop_instance_id,
        }
        self.client = httpx.AsyncClient(
            timeout=timeout_seconds,
            transport=transport,
        )

    @staticmethod
    def _api_base(server_url: str) -> str:
        value = server_url.strip().rstrip("/")
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("server_url must be an absolute HTTP(S) URL")
        if value.endswith("/api/v1"):
            return value
        if value.endswith("/api"):
            return f"{value}/v1"
        return f"{value}/api/v1"

    async def _json(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        response = await self.client.request(
            method,
            f"{self.base_url}{path}",
            headers=self.headers,
            json=payload,
        )
        if response.is_error:
            try:
                detail: Any = response.json()
            except ValueError:
                detail = response.text[:2000]
            raise WorkspaceBundleCloudError(response.status_code, detail)
        result = response.json()
        if not isinstance(result, dict):
            raise WorkspaceBundleCloudError(
                502, "Workspace Bundle API returned a non-object response"
            )
        return result

    async def get_owner_revision(
        self, bundle_id: str, revision_id: str
    ) -> dict[str, Any]:
        return await self._json(
            "GET",
            f"/workspace-bundles/{bundle_id}/revisions/{revision_id}",
        )

    async def get_catalog_revision(
        self, publisher_namespace: str, slug: str, version: int
    ) -> dict[str, Any]:
        return await self._json(
            "GET",
            "/workspace-bundles/catalog/"
            f"{publisher_namespace}/{slug}/revisions/{version}",
        )

    async def resolve_owner_revision(
        self, slug: str, version: int
    ) -> dict[str, Any]:
        bundle = await self._json(
            "GET",
            f"/workspace-bundles:resolve?slug={slug}",
        )
        bundle_id = bundle.get("id")
        if not isinstance(bundle_id, str) or not bundle_id:
            raise WorkspaceBundleCloudError(
                502, "Workspace Bundle resolver returned an invalid bundle"
            )
        return await self._json(
            "GET",
            f"/workspace-bundles/{bundle_id}/revisions:resolve?version={version}",
        )

    async def install(
        self, space_id: str, bundle_id: str, revision_id: str
    ) -> dict[str, Any]:
        return await self._json(
            "POST",
            f"/spaces/{space_id}/bundle:install",
            {"bundle_id": bundle_id, "revision_id": revision_id},
        )

    async def confirm_install(
        self, space_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._json(
            "POST",
            f"/spaces/{space_id}/bundle:confirm-install",
            payload,
        )

    async def get_environment(self, space_id: str) -> dict[str, Any]:
        return await self._json("GET", f"/spaces/{space_id}/environment")

    async def upgrade(
        self,
        space_id: str,
        *,
        revision_id: str,
        expected_installed_revision_id: str,
        expected_version: int,
    ) -> dict[str, Any]:
        return await self._json(
            "POST",
            f"/spaces/{space_id}/bundle:upgrade",
            {
                "revision_id": revision_id,
                "expected_installed_revision_id": (
                    expected_installed_revision_id
                ),
                "expected_version": expected_version,
            },
        )

    async def bind_connection(
        self, space_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._json(
            "POST", f"/spaces/{space_id}/bindings", payload
        )

    async def download_asset(
        self, bundle_id: str, revision_id: str, asset_id: str
    ) -> bytes:
        descriptor = await self._json(
            "GET",
            f"/workspace-bundles/{bundle_id}/revisions/"
            f"{revision_id}/assets/{asset_id}:download",
        )
        url = descriptor.get("download_url")
        if not isinstance(url, str) or not url:
            raise WorkspaceBundleCloudError(502, "Asset URL is missing")
        expected_digest = descriptor.get("content_digest")
        expected_size = descriptor.get("size_bytes")
        if (
            not isinstance(expected_digest, str)
            or len(expected_digest) != 64
            or set(expected_digest) - set("0123456789abcdef")
            or not isinstance(expected_size, int)
            or isinstance(expected_size, bool)
            or expected_size < 0
            or expected_size > self.MAX_ASSET_BYTES
        ):
            raise WorkspaceBundleCloudError(
                502, "Asset integrity metadata is invalid"
            )
        total = 0
        digest = hashlib.sha256()
        chunks: list[bytes] = []
        async with self.client.stream("GET", url) as response:
            if response.is_error:
                raise WorkspaceBundleCloudError(
                    response.status_code, "Bundle asset download failed"
                )
            async for chunk in response.aiter_bytes():
                total += len(chunk)
                if total > self.MAX_ASSET_BYTES:
                    raise WorkspaceBundleCloudError(
                        413, "Bundle asset exceeds Desktop limit"
                    )
                digest.update(chunk)
                chunks.append(chunk)
        if total != expected_size or digest.hexdigest() != expected_digest:
            raise WorkspaceBundleCloudError(
                502, "Bundle asset failed integrity verification"
            )
        return b"".join(chunks)

    async def upload_asset(
        self,
        bundle_id: str,
        revision_id: str,
        *,
        logical_path: str,
        content: bytes,
        media_type: str,
        provenance: str,
        executable: bool,
        expected_old_digest: str | None = None,
    ) -> dict[str, Any]:
        if len(content) > self.MAX_ASSET_BYTES:
            raise ValueError("Bundle asset exceeds Desktop limit")
        filename = logical_path.rsplit("/", 1)[-1] or "bundle-asset"
        data = {
            "logical_path": logical_path.removeprefix("bundle://"),
            "provenance": provenance,
            "executable": str(executable).lower(),
        }
        if expected_old_digest is not None:
            data["expected_old_digest"] = expected_old_digest
        response = await self.client.post(
            f"{self.base_url}/workspace-bundles/{bundle_id}/revisions/"
            f"{revision_id}/assets",
            headers=self.headers,
            data=data,
            files={"file": (filename, content, media_type)},
        )
        if response.is_error:
            try:
                detail: Any = response.json()
            except ValueError:
                detail = response.text[:2000]
            raise WorkspaceBundleCloudError(response.status_code, detail)
        result = response.json()
        if not isinstance(result, dict):
            raise WorkspaceBundleCloudError(
                502, "Workspace Bundle API returned a non-object response"
            )
        return result

    async def put_environment_projection(
        self, payload: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._json("POST", "/sync/environment-specs", payload)

    async def close(self) -> None:
        await self.client.aclose()
