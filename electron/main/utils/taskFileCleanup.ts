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

import fs from 'node:fs';
import path from 'node:path';
import { sanitizeStorageIdentity } from './projectStoragePath';

export interface TaskFileCleanupResult {
  success: boolean;
  deletedPaths: string[];
  error?: string;
}

function component(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w-]+$/.test(value)) {
    throw new Error('Invalid storage identifier');
  }
  return value;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** Check every ancestor, including the leaf. Never follow storage symlinks. */
function directoryExists(home: string, target: string): boolean {
  const relative = path.relative(home, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Cleanup path is outside storage');
  }
  let current = home;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error('Cleanup path is not an owned directory');
      }
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }
  return true;
}

function contains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    !relative || (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function boundWorkspaceRoots(home: string, identities: string[]): string[] {
  const roots: string[] = [];
  for (const identity of identities) {
    const bindings = path.join(
      home,
      '.eigent',
      'workspaces',
      identity,
      'spaces'
    );
    if (!directoryExists(home, bindings)) continue;
    for (const entry of fs.readdirSync(bindings)) {
      if (!entry.endsWith('.json')) continue;
      const file = path.join(bindings, entry);
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size > 1024 * 1024) {
        throw new Error('Unsafe workspace binding');
      }
      const binding = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof binding.workspace_root !== 'string') {
        throw new Error('Invalid workspace binding');
      }
      const root = path.resolve(
        binding.workspace_root.replace(/^~(?=[/\\]|$)/, home)
      );
      roots.push(root);
      try {
        roots.push(fs.realpathSync(root));
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
  }
  return roots;
}

/**
 * Delete only the requested task's app-owned outputs/logs. Unlike the read
 * resolver, deletion must never search other Projects or use a workspace's
 * working_directory (which may be a shared Space or a user-selected folder).
 */
export function deleteOwnedTaskFiles({
  homeDir,
  email,
  taskId,
  projectId,
  userId,
  spaceId,
}: {
  homeDir: string;
  email: string;
  taskId: string;
  projectId?: string;
  userId?: string | number | null;
  spaceId?: string;
}): TaskFileCleanupResult {
  const deletedPaths: string[] = [];
  try {
    const home = fs.realpathSync(homeDir);
    component(taskId);
    if (projectId !== undefined) component(projectId);
    if (spaceId !== undefined) component(spaceId);
    const normalizedTask = component(taskId.replace(/^task_/, ''));
    const taskNames = [
      ...new Set([`task_${normalizedTask}`, `task_${taskId}`]),
    ];
    const identities: string[] = [];
    if (userId !== undefined && userId !== null && userId !== '') {
      // Match Brain's runtime_owner_key, not the read resolver's email-first
      // lookup or a lossy sanitization of an untrusted identifier.
      identities.push(`user_${component(String(userId))}`);
    }
    if (typeof email !== 'string') throw new Error('Missing storage identity');
    const legacyIdentity = sanitizeStorageIdentity(email);
    // Skip a legacy email prefix that could alias another account's canonical
    // root or a shared storage namespace. Without a userId, a user_* prefix is
    // Brain's own owner key and stays a valid candidate.
    const ambiguousLegacyIdentity =
      /^(workspace|workspaces|spaces|runtime)$/i.test(legacyIdentity) ||
      (/^user_/i.test(legacyIdentity) && identities.length > 0);
    if (legacyIdentity && !ambiguousLegacyIdentity) {
      identities.push(legacyIdentity);
    }
    if (!identities.length) throw new Error('Missing storage identity');

    const targets = new Set<string>();
    const containers = new Set<string>();
    for (const identity of new Set(identities)) {
      for (const root of ['eigent', '.eigent']) {
        const ownerRoot = path.join(home, root, identity);
        for (const taskName of taskNames) {
          // Legacy pre-Project paths are task-scoped, never owner-scoped.
          targets.add(path.join(ownerRoot, taskName));
          if (projectId) {
            const projectRoot = path.join(ownerRoot, `project_${projectId}`);
            targets.add(path.join(projectRoot, taskName));
            containers.add(projectRoot);
          }
        }
      }
      if (projectId && spaceId) {
        const projectRoot = path.join(
          home,
          '.eigent',
          identity,
          'spaces',
          spaceId,
          'projects',
          projectId
        );
        const runsRoot = path.join(projectRoot, 'runs');
        // workspace_paths.run_output_root uses the raw task/run id.
        targets.add(path.join(runsRoot, taskId));
        containers.add(runsRoot);
        containers.add(projectRoot);
      }
    }

    const sharedRoots = boundWorkspaceRoots(home, identities);
    const overlapsSharedRoot = (target: string) =>
      sharedRoots.some(
        (root) => contains(root, target) || contains(target, root)
      );
    // Validate the whole plan before any destructive action. Re-check at each
    // removal as well; rmSync unlinks nested symlinks without following them.
    for (const target of targets) {
      if (directoryExists(home, target) && overlapsSharedRoot(target)) {
        throw new Error('Cleanup would remove shared workspace files');
      }
    }
    for (const target of targets) {
      if (!directoryExists(home, target)) continue;
      fs.rmSync(target, { recursive: true, force: true });
      deletedPaths.push(target);
    }
    for (const container of containers) {
      if (overlapsSharedRoot(container)) continue;
      if (!directoryExists(home, container)) continue;
      try {
        // Never recursively remove a Session container: a nonempty container
        // can still contain another task or user-authored/shared files.
        fs.rmdirSync(container);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(code ?? ''))
          throw error;
      }
    }
    // Already absent is successful, including retries after partial cleanup.
    return { success: true, deletedPaths };
  } catch (error) {
    return {
      success: false,
      deletedPaths,
      error: error instanceof Error ? error.message : 'File cleanup failed',
    };
  }
}
