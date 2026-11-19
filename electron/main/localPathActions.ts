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
import {
  authorizeLocalFilePath,
  isExecutableBundlePath,
  isExecutableExternalOpenPath,
} from './localFileSecurity';

export type LocalPathActionResult =
  | { success: true }
  | { success: false; error: string };

export type AuthorizedLocalNode = {
  success: true;
  path: string;
  kind: 'file' | 'directory';
  mode: number;
};

type LocalNodeAuthorizationResult =
  | AuthorizedLocalNode
  | { success: false; error: string };

export interface LocalPathShell {
  openPath: (targetPath: string) => Promise<string>;
  showItemInFolder: (targetPath: string) => void;
}

/** Remember an exact real path with bounded least-recently-used eviction. */
export function rememberBoundedPathGrant(
  grants: Set<string>,
  realPath: string,
  limit: number
): void {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('Path grant limit must be a positive safe integer');
  }
  grants.delete(realPath);
  grants.add(realPath);
  while (grants.size > limit) {
    const oldest = grants.values().next().value;
    if (oldest === undefined) break;
    grants.delete(oldest);
  }
}

function authorizationError(reason: 'invalid' | 'missing' | 'outside-roots') {
  if (reason === 'invalid') return 'Invalid local path';
  if (reason === 'missing') return 'Path does not exist';
  return 'Path is outside the active workspace';
}

/** Classify an already-authorized real path as a revealable file or folder. */
async function describeLocalNode(
  realPath: string
): Promise<LocalNodeAuthorizationResult> {
  const stats = await fsp.stat(realPath).catch(() => null);
  if (!stats) return { success: false, error: 'Path does not exist' };
  if (!stats.isFile() && !stats.isDirectory()) {
    return { success: false, error: 'Unsupported local path type' };
  }

  return {
    success: true,
    path: realPath,
    kind: stats.isDirectory() ? 'directory' : 'file',
    mode: stats.mode,
  };
}

/** Resolve and authorize one existing file-system node inside an active Space. */
export async function authorizeWorkspaceLocalNode(
  targetPath: string,
  workspaceRoots: Iterable<string>
): Promise<LocalNodeAuthorizationResult> {
  const authorization = await authorizeLocalFilePath(
    targetPath,
    workspaceRoots
  );
  if (!authorization.allowed) {
    return {
      success: false,
      error: authorizationError(authorization.reason),
    };
  }

  return describeLocalNode(authorization.filePath);
}

/**
 * Authorize a node the renderer may reveal in the OS file manager.
 *
 * Two independent grants are accepted: containment in an active Space root,
 * and an exact path the user themselves chose in the native file dialog. The
 * second grant keeps chat attachments stored outside the workspace revealable
 * without widening the workspace boundary for every other operation.
 */
export async function authorizeRevealableLocalNode(
  targetPath: string,
  workspaceRoots: Iterable<string>,
  userSelectedPaths: ReadonlySet<string> = new Set()
): Promise<LocalNodeAuthorizationResult> {
  const workspaceNode = await authorizeWorkspaceLocalNode(
    targetPath,
    workspaceRoots
  );
  if (workspaceNode.success || userSelectedPaths.size === 0) {
    return workspaceNode;
  }

  const realPath = await fsp.realpath(targetPath).catch(() => null);
  if (!realPath || !userSelectedPaths.has(realPath)) return workspaceNode;

  return describeLocalNode(realPath);
}

/** Open a folder itself, or reveal and highlight an exact file. */
export async function revealAuthorizedLocalNode(
  node: AuthorizedLocalNode,
  targetShell: LocalPathShell
): Promise<LocalPathActionResult> {
  // A macOS `.app` is a directory, so `shell.openPath` would launch it rather
  // than browse it. Bundles are highlighted in their parent folder instead,
  // exactly like files -- revealing never executes agent-authored output.
  if (node.kind === 'file' || isExecutableBundlePath(node.path)) {
    targetShell.showItemInFolder(node.path);
    return { success: true };
  }

  const error = await targetShell.openPath(node.path);
  return error ? { success: false, error } : { success: true };
}

export async function revealWorkspaceLocalNode(
  targetPath: string,
  workspaceRoots: Iterable<string>,
  targetShell: LocalPathShell
): Promise<LocalPathActionResult> {
  const node = await authorizeWorkspaceLocalNode(targetPath, workspaceRoots);
  if (!node.success) return node;
  return revealAuthorizedLocalNode(node, targetShell);
}

/** Reveal a Space file or a path the user picked in the native file dialog. */
export async function revealUserVisibleLocalNode(
  targetPath: string,
  workspaceRoots: Iterable<string>,
  userSelectedPaths: ReadonlySet<string>,
  targetShell: LocalPathShell
): Promise<LocalPathActionResult> {
  const node = await authorizeRevealableLocalNode(
    targetPath,
    workspaceRoots,
    userSelectedPaths
  );
  if (!node.success) return node;
  return revealAuthorizedLocalNode(node, targetShell);
}

/** Open a non-executable workspace file with its OS-default application. */
export async function openWorkspaceLocalFile(
  targetPath: string,
  workspaceRoots: Iterable<string>,
  targetShell: LocalPathShell
): Promise<LocalPathActionResult> {
  const node = await authorizeWorkspaceLocalNode(targetPath, workspaceRoots);
  if (!node.success) return node;
  if (node.kind !== 'file') {
    return { success: false, error: 'Path is not a file' };
  }
  if (isExecutableExternalOpenPath(node.path, node.mode)) {
    targetShell.showItemInFolder(node.path);
    return {
      success: false,
      error: 'Executable files cannot be opened from an agent result',
    };
  }

  const error = await targetShell.openPath(node.path);
  return error ? { success: false, error } : { success: true };
}
