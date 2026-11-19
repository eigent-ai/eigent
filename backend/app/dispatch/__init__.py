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
"""Brain-owned Task start, for clients with no renderer.

The Desktop renderer assembles every ``POST /chat`` body itself: model
credentials, Space, Session mode. A terminal or a script has none of that, so
``POST /v1/tasks`` takes a prompt and a folder and the Brain resolves the
rest. Execution goes through the same admission path as ``/chat``.
"""
