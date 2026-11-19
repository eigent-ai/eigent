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

from __future__ import annotations

import hashlib

import httpx
import pytest

from app.workspace_bundle.cloud import (
    HttpWorkspaceBundleCloudTransport,
    WorkspaceBundleCloudError,
)


@pytest.mark.asyncio
async def test_revision_reads_use_distinct_owner_and_public_catalog_paths():
    requested_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_paths.append(request.url.path)
        return httpx.Response(200, json={"id": "bundle-1@3"})

    cloud = HttpWorkspaceBundleCloudTransport(
        server_url="https://api.example.test",
        authorization="Bearer user",
        desktop_instance_id="desk-1",
        transport=httpx.MockTransport(handler),
    )
    try:
        await cloud.get_owner_revision("bundle-1", "bundle-1@3")
        await cloud.get_catalog_revision("publisher", "bundle-1", 3)
    finally:
        await cloud.close()

    assert requested_paths == [
        "/api/v1/workspace-bundles/bundle-1/revisions/bundle-1@3",
        "/api/v1/workspace-bundles/catalog/publisher/bundle-1/revisions/3",
    ]


@pytest.mark.asyncio
async def test_owner_revision_resolution_uses_exact_owner_scoped_slug_route():
    requested_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_urls.append(str(request.url))
        if request.url.path.endswith("/workspace-bundles:resolve"):
            return httpx.Response(
                200,
                json={
                    "id": "wb_opaque",
                    "publisher_namespace": "user-7",
                    "slug": "research-team",
                },
            )
        return httpx.Response(200, json={"id": "wbr_opaque", "revision": 3})

    cloud = HttpWorkspaceBundleCloudTransport(
        server_url="https://api.example.test",
        authorization="Bearer user",
        desktop_instance_id="desk-1",
        transport=httpx.MockTransport(handler),
    )
    try:
        revision = await cloud.resolve_owner_revision("research-team", 3)
    finally:
        await cloud.close()

    assert revision["id"] == "wbr_opaque"
    assert requested_urls == [
        "https://api.example.test/api/v1/workspace-bundles:resolve?slug=research-team",
        "https://api.example.test/api/v1/workspace-bundles/wb_opaque/revisions:resolve?version=3",
    ]


@pytest.mark.asyncio
async def test_asset_download_verifies_server_digest_and_size():
    content = b"reviewed bundle asset"
    digest = hashlib.sha256(content).hexdigest()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith(":download"):
            return httpx.Response(
                200,
                json={
                    "download_url": "https://assets.example.test/asset.bin",
                    "logical_path": "context/asset.bin",
                    "content_digest": digest,
                    "media_type": "application/octet-stream",
                    "size_bytes": len(content),
                },
            )
        return httpx.Response(200, content=content)

    cloud = HttpWorkspaceBundleCloudTransport(
        server_url="https://api.example.test",
        authorization="Bearer user",
        desktop_instance_id="desk-1",
        transport=httpx.MockTransport(handler),
    )
    try:
        assert (
            await cloud.download_asset("bundle-1", "bundle-1@1", "asset-1")
            == content
        )
    finally:
        await cloud.close()


@pytest.mark.asyncio
async def test_asset_download_rejects_content_that_does_not_match_descriptor():
    content = b"tampered bytes"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith(":download"):
            return httpx.Response(
                200,
                json={
                    "download_url": "https://assets.example.test/asset.bin",
                    "logical_path": "context/asset.bin",
                    "content_digest": hashlib.sha256(b"expected").hexdigest(),
                    "media_type": "application/octet-stream",
                    "size_bytes": len(content),
                },
            )
        return httpx.Response(200, content=content)

    cloud = HttpWorkspaceBundleCloudTransport(
        server_url="https://api.example.test",
        authorization="Bearer user",
        desktop_instance_id="desk-1",
        transport=httpx.MockTransport(handler),
    )
    try:
        with pytest.raises(WorkspaceBundleCloudError) as error:
            await cloud.download_asset("bundle-1", "bundle-1@1", "asset-1")
        assert error.value.detail == (
            "Bundle asset failed integrity verification"
        )
    finally:
        await cloud.close()
