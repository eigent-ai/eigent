// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import type { ReviewFile } from './useReviewChanges';

export const REVIEW_FIXTURE_STORAGE_KEY = 'eigent-review-fixture';

/**
 * Dev-only sample changes for building/reviewing the diff UI without a
 * backend that records overlays. Enable from DevTools with
 * `localStorage.setItem('eigent-review-fixture', '1')` and hit Refresh;
 * remove the key to go back to real data.
 */
export function reviewFixtureEnabled(): boolean {
  return (
    import.meta.env.DEV &&
    typeof localStorage !== 'undefined' &&
    localStorage.getItem(REVIEW_FIXTURE_STORAGE_KEY) === '1'
  );
}

const GREETER_ORIGINAL = `def greet(name):
    return "Hello, " + name


def farewell(name):
    return "Bye " + name
`;

const GREETER_MODIFIED = `def greet(name: str) -> str:
    """Return a greeting string for the given name."""
    return f"Hello, {name}"


def farewell(name: str) -> str:
    """Return a farewell string for the given name."""
    return f"Bye {name}"


def shout(name: str) -> str:
    """Return an excited greeting for the given name."""
    return f"HEY {name.upper()}!"
`;

const CONFIG_ORIGINAL = `DEBUG = True
TIMEOUT = 30
`;

const CONFIG_MODIFIED = `DEBUG = False
TIMEOUT = 30
RETRIES = 3
`;

const UTILS_ADDED = `def snake_case(text: str) -> str:
    """Convert a string to snake_case."""
    return text.lower().replace(" ", "_")
`;

const LOGGER_DELETED = `# old module, should be removed
print("legacy")
`;

export const REVIEW_FIXTURE_FILES: ReviewFile[] = [
  {
    path: 'src/greeter.py',
    status: 'modified',
    absPath: '',
    bakPath: null,
    inline: { original: GREETER_ORIGINAL, modified: GREETER_MODIFIED },
  },
  {
    path: 'src/config.py',
    status: 'modified',
    absPath: '',
    bakPath: null,
    inline: { original: CONFIG_ORIGINAL, modified: CONFIG_MODIFIED },
  },
  {
    path: 'src/utils.py',
    status: 'added',
    absPath: '',
    bakPath: null,
    inline: { original: '', modified: UTILS_ADDED },
  },
  {
    path: 'src/logger.py',
    status: 'deleted',
    absPath: '',
    bakPath: null,
    inline: { original: LOGGER_DELETED, modified: '' },
  },
];
