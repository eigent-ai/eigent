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

import path from 'node:path';

export function sanitizeStorageIdentity(identity: string): string {
  return identity
    .split('@')[0]
    .replace(/[\\/*?:"<>|\s]/g, '_')
    .replace(/^\.+|\.+$/g, '');
}

export function getProjectIdentityCandidates(
  email: string,
  userId?: string | number | null
): string[] {
  const candidates: string[] = [];
  if (userId !== undefined && userId !== null && userId !== '') {
    const rawUserId = String(userId);
    candidates.push(
      sanitizeStorageIdentity(
        rawUserId.startsWith('user_') ? rawUserId : `user_${rawUserId}`
      )
    );
  }
  candidates.push(sanitizeStorageIdentity(email));
  return [...new Set(candidates.filter(Boolean))];
}

export function resolveProjectStoragePath({
  homeDir,
  email,
  projectId,
  userId,
  existsSync,
}: {
  homeDir: string;
  email: string;
  projectId: string;
  userId?: string | number | null;
  existsSync: (path: string) => boolean;
}): string {
  const identities = getProjectIdentityCandidates(email, userId);
  const fallbackIdentity = identities[0] || sanitizeStorageIdentity(email);
  const fallbackPath = path.join(
    homeDir,
    'eigent',
    fallbackIdentity,
    `project_${projectId}`
  );

  for (const identity of identities) {
    const projectPath = path.join(
      homeDir,
      'eigent',
      identity,
      `project_${projectId}`
    );
    if (existsSync(projectPath)) {
      return projectPath;
    }
  }
  return fallbackPath;
}
