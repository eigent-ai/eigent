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
        await cloud.get_catalog_revision("bundle-1", "bundle-1@3")
    finally:
        await cloud.close()

    assert requested_paths == [
        "/api/v1/workspace-bundles/bundle-1/revisions/bundle-1@3",
        "/api/v1/workspace-bundles/catalog/bundle-1/revisions/bundle-1@3",
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
