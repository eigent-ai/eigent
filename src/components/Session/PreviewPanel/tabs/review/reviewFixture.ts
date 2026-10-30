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
 * `localStorage.setItem('eigent-review-fixture', '1')` and hit Refresh, or add
 * `?reviewFixture=1` to the development URL. Remove it to go back to real data.
 */
export function reviewFixtureEnabled(): boolean {
  return (
    import.meta.env.DEV &&
    ((typeof localStorage !== 'undefined' &&
      localStorage.getItem(REVIEW_FIXTURE_STORAGE_KEY) === '1') ||
      (typeof location !== 'undefined' &&
        new URLSearchParams(location.search).get('reviewFixture') === '1'))
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

const ORPHANED_MODIFIED = `def parse(payload: dict) -> dict:
    """The run recorded this as changed, but no backup survives."""
    return {key: value for key, value in payload.items() if value is not None}
`;

const README_ORIGINAL = `# Greeter

Call \`greet(name)\` to create a greeting.

## Example

\`\`\`python
print(greet("Ada"))
\`\`\`
`;

const README_MODIFIED = `# Greeter

Create friendly greetings and farewells with typed helpers.

## Example

\`\`\`python
print(greet("Ada"))
print(farewell("Ada"))
\`\`\`

> The public functions now include type annotations.
`;

const MANIFEST_ORIGINAL = `{
  "name": "greeter",
  "version": 1,
  "features": ["hello"]
}`;

const MANIFEST_MODIFIED = `{
  "name": "greeter",
  "version": 2,
  "features": ["hello", "farewell", "shout"],
  "typed": true
}`;

const PAGE_ORIGINAL = `<!doctype html>
<html><head><style>body{font-family:system-ui;padding:32px}h1{color:dimgray}</style></head>
<body><h1>Hello</h1><p>Welcome to Greeter.</p></body></html>`;

const PAGE_MODIFIED = `<!doctype html>
<html><head><style>body{font-family:system-ui;padding:32px}h1{color:seagreen}</style></head>
<body><h1>Hello, Ada</h1><p>Greeter now supports farewells and shout.</p></body></html>`;

export const REVIEW_FIXTURE_FILES: ReviewFile[] = [
  {
    id: 'fixture:src/greeter.py',
    path: 'src/greeter.py',
    status: 'modified',
    absPath: '',
    bakPath: null,
    inline: { original: GREETER_ORIGINAL, modified: GREETER_MODIFIED },
  },
  {
    id: 'fixture:src/config.py',
    path: 'src/config.py',
    status: 'modified',
    absPath: '',
    bakPath: null,
    inline: { original: CONFIG_ORIGINAL, modified: CONFIG_MODIFIED },
  },
  {
    id: 'fixture:src/utils.py',
    path: 'src/utils.py',
    status: 'added',
    absPath: '',
    bakPath: null,
    inline: { original: '', modified: UTILS_ADDED },
  },
  {
    id: 'fixture:src/logger.py',
    path: 'src/logger.py',
    status: 'deleted',
    absPath: '',
    bakPath: null,
    inline: { original: LOGGER_DELETED, modified: '' },
  },
  {
    // Modified, but the before-side backup is gone: the card must show the
    // current content plainly rather than tinting it all as additions.
    id: 'fixture:src/parser.py',
    path: 'src/parser.py',
    status: 'modified',
    absPath: '',
    bakPath: null,
    beforeUnavailable: true,
    inline: { original: '', modified: ORPHANED_MODIFIED },
  },
  {
    id: 'fixture:README.md',
    path: 'README.md',
    status: 'modified',
    absPath: '',
    bakPath: null,
    inline: { original: README_ORIGINAL, modified: README_MODIFIED },
  },
  {
    id: 'fixture:manifest.json',
    path: 'manifest.json',
    status: 'modified',
    absPath: '',
    bakPath: null,
    inline: { original: MANIFEST_ORIGINAL, modified: MANIFEST_MODIFIED },
  },
  {
    id: 'fixture:site/index.html',
    path: 'site/index.html',
    status: 'modified',
    absPath: '',
    bakPath: null,
    inline: { original: PAGE_ORIGINAL, modified: PAGE_MODIFIED },
  },
];
