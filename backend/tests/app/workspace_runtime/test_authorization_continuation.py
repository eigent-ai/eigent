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

"""R15: successful worker checks cannot admit authority revoked on the loop."""

import asyncio
import threading
from dataclasses import replace
from pathlib import Path

import pytest

from app.permission_policy import PermissionProfileName
from app.workspace_runtime.service import AdmissionError
from tests.app.workspace_runtime import test_registration as reg

deployment = reg.deployment


def change_authority(d, entry, change):
    root = Path(d.projects["a"]["space_root"])
    if change == "account":
        d.context = None
    elif change == "permission":
        d.permission("one", PermissionProfileName.READ_ONLY)
    elif change == "binding":
        d.workspace_store.save_binding(
            "", "one", str(d.root / "other"), user_id="1"
        )
    elif change == "root":
        root.rename(root.with_name("previous-root"))
        root.mkdir()
    elif change == "repository":
        if (root / ".git").exists():
            (root / ".git").rename(root / ".previous-git")
        (root / ".git").mkdir()
    elif change == "policy":
        d.service.policies.revoke("a")
        d.service.policies.register("a", replace(entry.policy))
    else:
        assert change == "unchanged"


@pytest.mark.asyncio
@pytest.mark.parametrize("git", [False, True])
@pytest.mark.parametrize("path", ["api", "local"])
@pytest.mark.parametrize(
    "change",
    [
        "account",
        "permission",
        "binding",
        "root",
        "repository",
        "policy",
        "unchanged",
    ],
)
async def test_completed_worker_result_rechecks_authority(
    deployment, monkeypatch, git, path, change
):
    # The account/permission API cases reproduce the original R15 probes:
    # gate after the ORIGINAL complete require succeeds, before its return.
    d = deployment
    d.project("a", git=git)
    envelope = await d.register("a")
    entry = d.registration.registered[envelope["configuration_revision"]]
    request_id = "continuation-" + change
    request = None
    if path == "local":
        await d.submit("a", request_id, envelope)
        request = d.service.admission.get(request_id)
    loop = asyncio.get_running_loop()
    entered, release = asyncio.Event(), threading.Event()
    target = d.service.policies if path == "api" else d.service
    method = "require" if path == "api" else "_policy"
    original = getattr(target, method)

    def complete_check(*args, **kwargs):
        result = original(*args, **kwargs)
        assert threading.current_thread() is not threading.main_thread()
        loop.call_soon_threadsafe(entered.set)
        assert release.wait(8), "test did not release completed worker"
        return result

    if git:
        identity = entry.provider._repository_identity

        def worker_identity():
            assert threading.current_thread() is not threading.main_thread()
            return identity()

        monkeypatch.setattr(
            entry.provider, "_repository_identity", worker_identity
        )
    monkeypatch.setattr(target, method, complete_check)
    pending = asyncio.create_task(
        d.client.post(
            "/projects/a/executions",
            json={
                "request_id": request_id,
                "kind": "start",
                "envelope": {**envelope, "prompt": "synthetic request"},
            },
        )
        if path == "api"
        else d.service._policy_local_async(request)
    )
    old_context = d.context
    try:
        await asyncio.wait_for(entered.wait(), 3)
        change_authority(d, entry, change)
        release.set()
        if path == "local" and change != "unchanged":
            with pytest.raises(AdmissionError):
                await asyncio.wait_for(pending, 3)
        else:
            result = await asyncio.wait_for(pending, 3)
            if path == "api":
                stored = d.service.admission.get(request_id)
                if change == "unchanged":
                    assert result.status_code == 202
                    assert stored.status == "pending"
                else:
                    assert result.status_code in (403, 503), result.text
                    assert stored is None
            else:
                assert result is entry.policy
    finally:
        release.set()
        await asyncio.gather(pending, return_exceptions=True)
        d.context = old_context


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["account", "permission", "policy"])
async def test_admission_rechecks_receipt_at_the_persistence_boundary(
    deployment, monkeypatch, change
):
    d = deployment
    d.project("a")
    envelope = await d.register("a")
    entry = d.registration.registered[envelope["configuration_revision"]]
    original = d.service.policies.require_authorization_async

    async def after_continuation(*args, **kwargs):
        receipt = await original(*args, **kwargs)
        change_authority(d, entry, change)
        return receipt

    monkeypatch.setattr(
        d.service.policies, "require_authorization_async", after_continuation
    )
    old_context = d.context
    try:
        result = await d.client.post(
            "/projects/a/executions",
            json={
                "request_id": "commit-fence",
                "kind": "start",
                "envelope": {**envelope, "prompt": "synthetic request"},
            },
        )
        assert result.status_code in (403, 503), result.text
        assert d.service.admission.get("commit-fence") is None
    finally:
        d.context = old_context
