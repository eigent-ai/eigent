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
"""dlopen every native library under a directory and classify failures.

Run with the pack's own Python (`python -I dlopen_all.py <dir>`). Each library
is loaded with RTLD_LAZY | RTLD_LOCAL, which maps it and runs the kernel and
dyld code-signature, Gatekeeper and library-validation checks without
initialising the Python module. Failures caused by missing symbols are normal
for some extension modules and are reported but not counted as policy
failures. Exit code 1 means at least one load was refused by system policy.
"""

import ctypes
import json
import os
import sys

POLICY_MARKERS = (
    'system policy',
    'code signature',
    'not valid for use in process',
    'library validation',
    'quarantine',
    'mapping process and mapped file (non-platform) have different team ids',
)


def main() -> int:
    root = sys.argv[1]
    mode = os.RTLD_LAZY | os.RTLD_LOCAL
    total = 0
    loaded = 0
    policy = []
    other = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            if not (name.endswith('.so') or name.endswith('.dylib')):
                continue
            path = os.path.join(dirpath, name)
            if os.path.islink(path):
                continue
            total += 1
            try:
                ctypes.CDLL(path, mode=mode)
                loaded += 1
            except OSError as exc:
                message = str(exc)
                rel = os.path.relpath(path, root)
                if any(marker in message.lower() for marker in POLICY_MARKERS):
                    policy.append({'path': rel, 'error': message[:400]})
                else:
                    other.append({'path': rel, 'error': message[:200]})
    print(
        json.dumps(
            {
                'total': total,
                'loaded': loaded,
                'policy_failures': len(policy),
                'other_failures': len(other),
                'policy_examples': policy[:20],
                'other_examples': other[:10],
            },
            indent=2,
        )
    )
    return 1 if policy else 0


if __name__ == '__main__':
    sys.exit(main())
