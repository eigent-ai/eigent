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

/**
 * IndexedDB-backed cache for reconstructed project chat state.
 *
 * Goal: avoid re-running the SSE playback for projects the user has already
 * opened in a previous session. On project open, hydrate from this cache
 * synchronously, then trigger a silent background refresh that compares the
 * server's `updated_at` against the cached value and invalidates the entry
 * if the project has moved on.
 *
 * Bump `PROJECT_CACHE_SCHEMA_VERSION` whenever the persisted shape changes
 * in a backward-incompatible way — all existing entries are then ignored
 * (and lazily replaced on the next successful replay).
 */

const DB_NAME = 'eigent';
const STORE_NAME = 'projectCache';
const DB_VERSION = 1;

/** Bump when CachedProject shape or chatStore Task interface changes. */
export const PROJECT_CACHE_SCHEMA_VERSION = 1;

export interface CachedTask {
  /** Anything stored on `chatStore.tasks[taskId]` that's safe to serialize. */
  taskState: unknown;
}

export interface CachedProject {
  schemaVersion: number;
  /** Server-reported last-activity timestamp for the project (ms). */
  serverUpdatedAt: number | null;
  /** Wall-clock time (ms) when we wrote this entry. */
  cachedAt: number;
  /** Ordered list of task IDs that make up this project's history. */
  taskIds: string[];
  /** Per-task chat state, keyed by task id. */
  tasks: Record<string, CachedTask>;
  /** Optional display name captured at write time. */
  projectName?: string;
}

type Scope = { userId: string | number; projectId: string };

function cacheKey({ userId, projectId }: Scope): string {
  return `${userId}|${projectId}`;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });

  // If this promise rejects, allow a retry on next call rather than caching
  // the failure indefinitely.
  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
}

async function runRequest<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const req = action(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getCachedProject(
  scope: Scope
): Promise<CachedProject | null> {
  try {
    const value = await runRequest<CachedProject | undefined>('readonly', (s) =>
      s.get(cacheKey(scope))
    );
    if (!value) return null;
    if (value.schemaVersion !== PROJECT_CACHE_SCHEMA_VERSION) {
      // Stale shape — drop it so we don't keep re-reading invalid data.
      void deleteCachedProject(scope).catch(() => undefined);
      return null;
    }
    return value;
  } catch (err) {
    console.warn('[projectCache] read failed:', err);
    return null;
  }
}

export async function putCachedProject(
  scope: Scope,
  entry: Omit<CachedProject, 'schemaVersion' | 'cachedAt'>
): Promise<void> {
  try {
    const value: CachedProject = {
      schemaVersion: PROJECT_CACHE_SCHEMA_VERSION,
      cachedAt: Date.now(),
      ...entry,
    };
    await runRequest<IDBValidKey>('readwrite', (s) =>
      s.put(value, cacheKey(scope))
    );
  } catch (err) {
    console.warn('[projectCache] write failed:', err);
  }
}

export async function deleteCachedProject(scope: Scope): Promise<void> {
  try {
    await runRequest<undefined>('readwrite', (s) => s.delete(cacheKey(scope)));
  } catch (err) {
    console.warn('[projectCache] delete failed:', err);
  }
}

/**
 * Clear all project cache entries. Pass `userId` to scope the wipe to a
 * single account (e.g., on logout); omit to nuke everything (debug/Settings).
 */
export async function clearAllCachedProjects(
  userId?: string | number
): Promise<void> {
  try {
    if (userId == null) {
      await runRequest<undefined>('readwrite', (s) => s.clear());
      return;
    }
    const prefix = `${userId}|`;
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) {
          resolve();
          return;
        }
        if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
          cursor.delete();
        }
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  } catch (err) {
    console.warn('[projectCache] clear failed:', err);
  }
}
