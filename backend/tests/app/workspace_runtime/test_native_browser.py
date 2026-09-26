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

"""Opt-in local Chrome fixture; no model, account, or installed-app profile."""

import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

import pytest
import websockets

from app.agent.toolkit.hybrid_browser_toolkit import HybridBrowserToolkit
from app.workspace_runtime.bound_runtime import RuntimeBinding
from app.workspace_runtime.native_runtime import NativeAgentRuntime
from app.workspace_runtime.provider import WorkspaceHandle


@pytest.mark.asyncio
async def test_browser_downloads_and_shutdown_are_owned_per_run(
    tmp_path, monkeypatch
):
    chrome = Path(
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    )
    if sys.platform != "darwin" or not chrome.exists():
        pytest.skip("local browser fixture requires installed macOS Chrome")
    if os.environ.get("EIGENT_NATIVE_BROWSER_FIXTURE") != "1":
        pytest.skip("run the isolated browser smoke suite explicitly")
    from camel.toolkits.hybrid_browser_toolkit import ws_wrapper

    async def installed_dependencies(ts_dir):
        # Assert the existing runtime. Never run the dependency bootstrap.
        assert (Path(ts_dir) / "node_modules").is_dir()
        assert (Path(ts_dir) / "dist" / "index.js").is_file()
        return shutil.which("npm"), shutil.which("node")

    monkeypatch.setattr(
        ws_wrapper, "check_and_install_dependencies", installed_dependencies
    )

    class DownloadFixture(BaseHTTPRequestHandler):
        def do_GET(self):
            with (tmp_path / "http-requests.log").open("a") as requests:
                requests.write(self.path + "\n")
            name = self.path.strip("/").removesuffix(".txt")
            download = self.path.endswith(".txt")
            body = (
                name
                if download
                else f'<html><body><a download="output.txt" href="/{name}.txt">Download {name}</a></body></html>'
            )
            self.send_response(200)
            self.send_header(
                "Content-Type", "text/plain" if download else "text/html"
            )
            self.send_header("Content-Length", str(len(body.encode())))
            if download:
                self.send_header(
                    "Content-Disposition", 'attachment; filename="output.txt"'
                )
            self.end_headers()
            self.wfile.write(body.encode())

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), DownloadFixture)
    serving = threading.Thread(target=server.serve_forever)
    serving.start()
    with urlopen(
        f"http://127.0.0.1:{server.server_port}/preflight.txt", timeout=5
    ) as response:
        assert response.read() == b"preflight"
    profile = tmp_path / "chrome-profile"
    log = (tmp_path / "chrome.log").open("w")
    chrome_process = subprocess.Popen(
        [
            str(chrome),
            "--headless=new",
            f"--user-data-dir={profile}",
            "--remote-debugging-port=0",
            "--remote-debugging-address=127.0.0.1",
            "--disable-background-networking",
            "--disable-component-update",
            "--disable-sync",
            "--disable-default-apps",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-domain-reliability",
            "--no-proxy-server",
            "--host-resolver-rules=MAP * 127.0.0.1, EXCLUDE localhost",
            "about:blank",
        ],
        stdout=log,
        stderr=log,
        start_new_session=True,
    )
    browsers = []
    try:
        async with asyncio.timeout(15):
            while not (profile / "DevToolsActivePort").exists():
                assert chrome_process.poll() is None, (
                    tmp_path / "chrome.log"
                ).read_text()
                await asyncio.sleep(0.05)
        port = int(
            (profile / "DevToolsActivePort").read_text().splitlines()[0]
        )
        roots = [tmp_path / "first", tmp_path / "second"]
        for root in roots:
            root.mkdir()
            target_url = "about:blank#eigent-browser-toolkit=" + root.name
            with urlopen(
                Request(
                    f"http://127.0.0.1:{port}/json/new?{quote(target_url, safe='')}",
                    method="PUT",
                )
            ) as response:
                target = json.load(response)
                assert target["url"] == target_url
            async with websockets.connect(
                target["webSocketDebuggerUrl"]
            ) as cdp:
                for identifier, url in enumerate(
                    (
                        f"http://127.0.0.1:{server.server_port}/preflight-{root.name}",
                        target_url,
                    ),
                    1,
                ):
                    await cdp.send(
                        json.dumps(
                            {
                                "id": identifier,
                                "method": "Page.navigate",
                                "params": {"url": url},
                            }
                        )
                    )
                    async with asyncio.timeout(10):
                        while True:
                            reply = json.loads(await cdp.recv())
                            if reply.get("id") == identifier:
                                assert "error" not in reply, reply
                                break
        from app.service import task as task_module

        monkeypatch.setattr(
            task_module,
            "task_locks",
            {
                root.name: task_module.TaskLock(root.name, asyncio.Queue(), {})
                for root in roots
            },
        )

        async def noop():
            pass

        runtimes = [
            NativeAgentRuntime(
                RuntimeBinding(
                    root.name,
                    "attempt-" + root.name,
                    1,
                    WorkspaceHandle(
                        root.name, root, "attempt-" + root.name, 1, "snapshot"
                    ),
                    "test",
                    {},
                ),
                stop_resources=noop,
            )
            for root in roots
        ]

        async def download(runtime):
            root = runtime.binding.workspace.local_root
            toolkit = HybridBrowserToolkit(
                root.name,
                session_id=root.name,
                headless=True,
                stealth=False,
                cdp_url=f"http://127.0.0.1:{port}",
                connect_over_cdp=True,
                default_start_url=None,
                cdp_keep_current_page=True,
                owned_target_url="about:blank#eigent-browser-toolkit="
                + root.name,
                download_dir=str(root),
                cache_dir=str(root / ".cache"),
                browser_log_to_file=True,
                log_dir=str(root / "browser-logs"),
                user_data_dir=str(root / "unused-profile"),
            )
            browsers.append(toolkit)
            result = await toolkit.browser_visit_page(
                url=f"http://127.0.0.1:{server.server_port}/{root.name}"
            )
            (tmp_path / f"{root.name}-visit-result.json").write_text(
                json.dumps(result, default=str)
            )
            assert root.name in result.get("snapshot", ""), result
            reference = re.search(r"\[ref=([^\]]+)\]", result["snapshot"])
            assert reference, result
            result = await toolkit.browser_download_file(
                ref=reference.group(1)
            )
            (tmp_path / f"{root.name}-download-result.json").write_text(
                json.dumps(result, default=str)
            )
            assert (root / "output.txt").exists(), result
            assert (root / "output.txt").read_text() == root.name, result
            return toolkit

        results = await asyncio.gather(
            *(runtime.run(download) for runtime in runtimes),
            return_exceptions=True,
        )
        for result in results:
            if isinstance(result, BaseException):
                raise result
        first, second = results
        first_process, second_process = (
            first._ws_wrapper.process,
            second._ws_wrapper.process,
        )
        assert first_process.pid != second_process.pid
        await first.close()
        assert first_process.poll() is not None
        assert second_process.poll() is None
        assert chrome_process.poll() is None
        await second.browser_get_page_snapshot()
        await second.close()
        assert second_process.poll() is not None
        for runtime in runtimes:
            await runtime.stop()
        (tmp_path / "smoke-observations.json").write_text(
            json.dumps(
                {
                    "real_browser": True,
                    "real_model_io": False,
                    "private_downloads": [
                        str(root / "output.txt") for root in roots
                    ],
                    "peer_survives_close": True,
                },
                indent=2,
            )
            + "\n"
        )
    finally:
        await asyncio.gather(
            *(browser.close() for browser in browsers), return_exceptions=True
        )
        if chrome_process.poll() is None:
            chrome_process.terminate()
            try:
                await asyncio.to_thread(chrome_process.wait, timeout=5)
            except subprocess.TimeoutExpired:
                chrome_process.kill()
                await asyncio.to_thread(chrome_process.wait)
        log.close()
        server.shutdown()
        server.server_close()
        serving.join()
