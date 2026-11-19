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

from enum import Enum


class Status(str, Enum):
    confirming = "confirming"
    confirmed = "confirmed"
    processing = "processing"
    done = "done"


DEFAULT_SUMMARY_PROMPT = (
    "\n\nAfter completing the task, provide an informative completion report "
    "inside one <summary></summary> block. The UI displays only the content "
    "inside that block, so put the entire final report there. Make its detail "
    "proportional to the work performed; never reduce a multi-step task to a "
    "one-line acknowledgement. Include:\n"
    "1. A direct outcome statement tied to the user's goal.\n"
    "2. A concrete account of the main work performed, including meaningful "
    "counts, scope, and important decisions when available.\n"
    "3. A bulleted list of key deliverables and user-visible results. If files "
    "were created or modified, state the total and list the most important "
    "workspace-relative paths using Markdown links; do not invent paths.\n"
    "4. Validation performed and its result, including any remaining caveats "
    "or follow-up actions.\n"
    "Use clear Markdown sections and a confident, professional tone. Prefer "
    "specific evidence over generic claims."
)
