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

import fsp from 'node:fs/promises';
import path from 'node:path';

const EXECUTABLE_FILE_EXTENSIONS = new Set([
  '.app',
  '.applescript',
  '.bat',
  '.cmd',
  '.com',
  '.command',
  '.desktop',
  '.dmg',
  '.exe',
  '.hta',
  '.jar',
  '.js',
  '.jse',
  '.lnk',
  '.msi',
  '.msp',
  '.pkg',
  '.ps1',
  '.reg',
  '.scpt',
  '.sh',
  '.url',
  '.vbs',
  '.vbe',
  '.wsf',
]);

export type LocalFileAuthorization =
  | { allowed: true; filePath: string }
  | { allowed: false; reason: 'invalid' | 'missing' | 'outside-roots' };

export function isMainRendererSender(
  senderId: number,
  mainRendererId: number | null | undefined
): boolean {
  return typeof mainRendererId === 'number' && senderId === mainRendererId;
}

function isPathInsideRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

/**
 * Authorize an existing path against real filesystem roots.
 *
 * Both the candidate and roots are resolved through realpath so a symlink
 * stored inside a workspace cannot escape to ~/.ssh, ~/.aws, or another
 * location outside the active Space.
 */
export async function authorizeLocalFilePath(
  candidatePath: string,
  allowedRoots: Iterable<string>
): Promise<LocalFileAuthorization> {
  if (!candidatePath || !path.isAbsolute(candidatePath)) {
    return { allowed: false, reason: 'invalid' };
  }

  let realCandidate: string;
  try {
    realCandidate = await fsp.realpath(candidatePath);
  } catch {
    return { allowed: false, reason: 'missing' };
  }

  for (const root of allowedRoots) {
    if (!root || !path.isAbsolute(root)) continue;
    try {
      const realRoot = await fsp.realpath(root);
      if (isPathInsideRoot(realCandidate, realRoot)) {
        return { allowed: true, filePath: realCandidate };
      }
    } catch {
      // A stale or missing workspace binding grants no access.
    }
  }

  return { allowed: false, reason: 'outside-roots' };
}

export function isExecutableExternalOpenPath(
  filePath: string,
  mode = 0
): boolean {
  return (
    EXECUTABLE_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase()) ||
    (mode & 0o111) !== 0
  );
}
