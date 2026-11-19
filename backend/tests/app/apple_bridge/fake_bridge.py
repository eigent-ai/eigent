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

"""A stand-in for eigent-apple-bridge that runs anywhere.

It follows the same start-up protocol (token on stdin, port as the first
line of output, exit when stdin closes) and answers like the real bridge.
The first argument picks a behaviour:

- ``ok``: Apple Intelligence is ready.
- any availability reason, such as ``apple_intelligence_off``: the model is
  unavailable for that reason.
- ``crash``: exits with an error before printing a port.
- ``silent``: never prints a port.
- ``idle-exit``: prints a port, then exits cleanly as after an idle stop.
"""

import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

token = sys.stdin.readline().strip()
mode = sys.argv[1] if len(sys.argv) > 1 else "ok"

if mode == "crash":
    sys.exit(3)
if mode == "silent":
    sys.stdin.read()
    sys.exit(0)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _rejected(self):
        if self.headers.get("Origin") is not None:
            self._send(403, {"error": {"code": "forbidden_origin"}})
            return True
        if self.headers.get("Host") != f"127.0.0.1:{port}":
            self._send(403, {"error": {"code": "forbidden_host"}})
            return True
        if self.headers.get("Authorization") != f"Bearer {token}":
            self._send(401, {"error": {"code": "invalid_api_key"}})
            return True
        return False

    def do_GET(self):
        if self._rejected():
            return
        if self.path != "/v1/health":
            self._send(404, {"error": {"code": "not_found"}})
            return
        ready = mode == "ok"
        self._send(
            200,
            {
                "status": "ok",
                "models": [
                    {
                        "id": "apple-on-device",
                        "status": "available" if ready else "unavailable",
                        **({} if ready else {"reason": mode}),
                        **({"context_size": 4096} if ready else {}),
                        "capabilities": ["text"] if ready else [],
                    }
                ],
            },
        )

    def do_POST(self):
        if self._rejected():
            return
        length = int(self.headers.get("Content-Length", "0"))
        request = json.loads(self.rfile.read(length))
        if mode != "ok":
            self._send(
                503, {"error": {"code": mode, "message": "Unavailable."}}
            )
            return
        if request.get("tools"):
            self._send(400, {"error": {"code": "tools_unsupported"}})
            return
        self._send(
            200,
            {
                "id": "chatcmpl-fake",
                "object": "chat.completion",
                "created": 0,
                "model": request["model"],
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "ready"},
                        "finish_reason": "stop",
                    }
                ],
            },
        )


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
port = server.server_address[1]
print(port, flush=True)
if mode == "idle-exit":
    sys.exit(0)


def stop_when_stdin_closes():
    sys.stdin.read()
    server.shutdown()


threading.Thread(target=stop_when_stdin_closes, daemon=True).start()
server.serve_forever()
