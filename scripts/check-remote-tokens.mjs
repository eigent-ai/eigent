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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE_TOKEN_PATH = resolve('src/style/token.css');
const REMOTE_TOKEN_PATH = resolve('web-ui/src/styles/remote-tokens.css');
const REMOTE_TOKEN_HEADER = `/* Vendored design tokens for the standalone web-ui. Source of truth: src/style/token.css. Run npm run check:remote-tokens after token changes. */\n`;

const sourceTokens = readFileSync(SOURCE_TOKEN_PATH, 'utf8');
const remoteTokens = readFileSync(REMOTE_TOKEN_PATH, 'utf8');
const normalizedRemoteTokens = remoteTokens.startsWith(REMOTE_TOKEN_HEADER)
  ? remoteTokens.slice(REMOTE_TOKEN_HEADER.length)
  : remoteTokens;

if (normalizedRemoteTokens !== sourceTokens) {
  console.error(
    [
      'Remote control design tokens are out of sync.',
      `Source: ${SOURCE_TOKEN_PATH}`,
      `Remote: ${REMOTE_TOKEN_PATH}`,
      'Update web-ui/src/styles/remote-tokens.css from src/style/token.css, preserving the keep-in-sync header.',
    ].join('\n')
  );
  process.exit(1);
}

console.log('Remote control design tokens are in sync.');
