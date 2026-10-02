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

interface ProjectWorkspaceRootState {
  activeSpaceId: string | null;
  projectIdIndex: Record<string, string>;
  spaces: Record<string, { rootPath?: string | null }>;
}

/**
 * Resolve the trusted local root for the Project currently shown in a Space.
 *
 * Server hydration or snapshot replacement can temporarily omit the persisted
 * Project index. The runtime Project still owns the same Space binding during
 * that window, so it can resolve the registered root without falling back to
 * an unrelated active Space.
 */
export function selectProjectWorkspaceRoot(
  state: ProjectWorkspaceRootState,
  projectId?: string | null,
  runtimeSpaceId?: string | null
): string | null {
  const indexedSpaceId = projectId ? state.projectIdIndex[projectId] : null;
  // Both bindings name the same Project. Refuse to guess if hydration exposes
  // conflicting ownership rather than resolving a relative path in a different
  // Space that happens to contain a file with the same name.
  if (indexedSpaceId && runtimeSpaceId && indexedSpaceId !== runtimeSpaceId) {
    return null;
  }
  const spaceId = projectId
    ? indexedSpaceId || runtimeSpaceId
    : runtimeSpaceId || state.activeSpaceId;
  return spaceId ? state.spaces[spaceId]?.rootPath || null : null;
}
