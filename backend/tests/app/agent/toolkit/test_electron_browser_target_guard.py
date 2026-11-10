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

import json
import subprocess
from pathlib import Path

import pytest
from camel.toolkits.hybrid_browser_toolkit.ws_wrapper import (
    WebSocketBrowserWrapper as BaseWebSocketBrowserWrapper,
)

from app.agent.toolkit.hybrid_browser_toolkit import (
    HybridBrowserToolkit,
    WebSocketBrowserWrapper,
)


@pytest.mark.asyncio
async def test_owned_target_activates_node_guard_only_for_child_spawn(
    monkeypatch,
):
    observed: dict[str, str | None] = {}

    async def fake_start(_self):
        import os

        observed["node_options"] = os.environ.get("NODE_OPTIONS")

    monkeypatch.setattr(BaseWebSocketBrowserWrapper, "start", fake_start)
    monkeypatch.delenv("NODE_OPTIONS", raising=False)
    wrapper = WebSocketBrowserWrapper(
        {"ownedTargetUrl": ("about:blank#eigent-browser-toolkit=target-1")}
    )

    await wrapper.start()

    assert "electron_target_guard.cjs" in str(observed["node_options"])
    import os

    assert "NODE_OPTIONS" not in os.environ


def test_owned_target_cannot_be_cloned():
    toolkit = HybridBrowserToolkit(
        "project-1",
        cdp_url="http://127.0.0.1:9222",
        cdp_keep_current_page=True,
        owned_target_url="about:blank#eigent-browser-toolkit=target-1",
    )

    assert toolkit._ws_config["ownedTargetUrl"].endswith("target-1")
    with pytest.raises(RuntimeError, match="cannot be cloned"):
        toolkit.clone_for_new_session("other")


def test_pool_assigned_owned_target_is_copied_to_independent_clone():
    toolkit = HybridBrowserToolkit(
        "project-1",
        cdp_url="http://127.0.0.1:9222",
        cdp_keep_current_page=True,
        owned_target_url="about:blank#eigent-browser-toolkit=target-1",
    )
    toolkit._owned_target_url = "about:blank#eigent-browser-toolkit=target-2"
    toolkit._ws_config["ownedTargetUrl"] = toolkit._owned_target_url
    toolkit._allow_owned_target_clone = True

    cloned = toolkit.clone_for_new_session("other")

    assert cloned is not toolkit
    assert cloned._owned_target_url.endswith("target-2")
    assert cloned._ws_config["ownedTargetUrl"].endswith("target-2")
    assert cloned._allow_owned_target_clone is False


def test_node_guard_rebinds_before_any_action(tmp_path):
    fake_module = tmp_path / "fake-browser-runtime.cjs"
    fake_module.write_text(
        """
class Page {
  constructor(url) { this._url = url; }
  isClosed() { return false; }
  url() { return this._url; }
}
class Session {
  constructor() {
    this.main = new Page('http://localhost:5173/');
    this.owned = new Page('about:blank#eigent-browser-toolkit=7');
    this.context = { pages: () => [this.main] };
    this.ownedContext = { pages: () => [this.owned] };
    this.browser = { contexts: () => [this.context, this.ownedContext] };
    this.pages = new Map();
    this.consoleLogs = new Map();
    this.counter = 0;
    this.currentTabId = null;
    this.hasNavigatedBefore = false;
  }
  generateTabId() { return `tab-${++this.counter}`; }
  registerNewPage(id, page) { this.pages.set(id, page); }
  async ensureBrowser() {
    if (this.pages.size === 0) {
      const id = this.generateTabId();
      this.registerNewPage(id, this.main);
      this.currentTabId = id;
    }
  }
  async visitPage(url) {
    if (this.hasNavigatedBefore) {
      const page = new Page(url);
      const id = this.generateTabId();
      this.registerNewPage(id, page);
      this.currentTabId = id;
      return;
    }
    this.pages.get(this.currentTabId)._url = url;
    this.hasNavigatedBefore = true;
  }
}
class HybridBrowserToolkit {
  constructor(config = {}) { this.session = new Session(); this.config = config; }
}
module.exports = { HybridBrowserToolkit };
""",
        encoding="utf-8",
    )
    hook = (
        Path(__file__).parents[4]
        / "app"
        / "agent"
        / "toolkit"
        / "electron_target_guard.cjs"
    )
    script = f"""
const runtime = require({json.dumps(str(fake_module))});
const toolkit = new runtime.HybridBrowserToolkit({{
  ownedTargetUrl: 'about:blank#eigent-browser-toolkit=7'
}});
toolkit.session.ensureBrowser().then(async () => {{
  const page = toolkit.session.pages.get(toolkit.session.currentTabId);
  await toolkit.session.visitPage('https://first.example/');
  await toolkit.session.visitPage('https://second.example/');
  const finalPage = toolkit.session.pages.get(toolkit.session.currentTabId);
  process.stdout.write(JSON.stringify({{
    current: page.url(),
    final: finalPage.url(),
    main: toolkit.session.main.url(),
    count: toolkit.session.pages.size
  }}));
}}).catch((error) => {{ console.error(error); process.exit(1); }});
"""

    completed = subprocess.run(
        ["node", f"--require={hook}", "-e", script],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )

    assert json.loads(completed.stdout) == {
        "current": "https://second.example/",
        "final": "https://second.example/",
        "main": "http://localhost:5173/",
        "count": 1,
    }
