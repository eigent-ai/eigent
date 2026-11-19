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

import {
  proxyFetchDelete,
  proxyFetchGet,
  proxyFetchPatch,
  proxyFetchPost,
} from '@/api/http';
import type { SharedSessionSnapshot } from '@/lib/sessionShare/buildSharedSession';

/**
 * Client for Shared Session links. The account server stores each snapshot
 * and serves the public, read-only copy; this module only creates and
 * manages the owner's links.
 */
const BASE = '/api/v1/shared-sessions';

/** Days a link lasts; `null` means until the owner stops it. */
export type ShareExpiry = 1 | 7 | 30 | null;
export const SHARE_EXPIRY_OPTIONS: readonly ShareExpiry[] = [1, 7, 30, null];

export interface SharedSessionLink {
  shareId: string;
  url: string;
  title: string;
  createdAt: string | null;
  expiresAt: string | null;
  stopped: boolean;
  version: number;
}

export class SharedSessionUnavailableError extends Error {
  constructor() {
    super('Shared Session links are not available on this server.');
    this.name = 'SharedSessionUnavailableError';
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function parseSharedSessionLink(value: unknown): SharedSessionLink {
  const record =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  const shareId = text(record.share_id);
  const url = text(record.url);
  if (!shareId || !url || !/^https?:\/\//i.test(url)) {
    throw new Error('The server returned an incomplete share link.');
  }
  return {
    shareId,
    url,
    title: text(record.title) ?? '',
    createdAt: text(record.created_at),
    expiresAt: text(record.expires_at),
    stopped: record.stopped === true,
    version:
      typeof record.version === 'number' && Number.isFinite(record.version)
        ? record.version
        : 1,
  };
}

function rethrow(error: unknown): never {
  const failure = error as {
    status?: unknown;
    response?: { status?: unknown };
  } | null;
  const status = failure?.status ?? failure?.response?.status;
  if (status === 404 || status === 405 || status === 501) {
    throw new SharedSessionUnavailableError();
  }
  throw error;
}

/**
 * Upload a snapshot. With `shareId`, publish it as a new version under the
 * same link.
 */
export async function createSharedSessionLink(request: {
  projectId: string;
  snapshot: SharedSessionSnapshot;
  expiresInDays: ShareExpiry;
  shareId?: string;
}): Promise<SharedSessionLink> {
  try {
    const response = await proxyFetchPost(BASE, {
      project_id: request.projectId,
      title: request.snapshot.title,
      expires_in_days: request.expiresInDays,
      snapshot: request.snapshot,
      ...(request.shareId ? { share_id: request.shareId } : {}),
    });
    return parseSharedSessionLink(response);
  } catch (error) {
    rethrow(error);
  }
}

export async function listSharedSessionLinks(
  projectId: string
): Promise<SharedSessionLink[]> {
  try {
    const response = (await proxyFetchGet(BASE, {
      project_id: projectId,
    })) as { items?: unknown } | null;
    const items = Array.isArray(response?.items) ? response.items : [];
    return items.flatMap((item) => {
      try {
        return [parseSharedSessionLink(item)];
      } catch {
        return [];
      }
    });
  } catch (error) {
    rethrow(error);
  }
}

export async function updateSharedSessionExpiry(
  shareId: string,
  expiresInDays: ShareExpiry
): Promise<SharedSessionLink> {
  try {
    return parseSharedSessionLink(
      await proxyFetchPatch(`${BASE}/${encodeURIComponent(shareId)}`, {
        expires_in_days: expiresInDays,
      })
    );
  } catch (error) {
    rethrow(error);
  }
}

export async function stopSharedSessionLink(
  shareId: string
): Promise<SharedSessionLink> {
  try {
    return parseSharedSessionLink(
      await proxyFetchPost(`${BASE}/${encodeURIComponent(shareId)}/stop`)
    );
  } catch (error) {
    rethrow(error);
  }
}

export async function deleteSharedSessionLink(shareId: string): Promise<void> {
  try {
    await proxyFetchDelete(`${BASE}/${encodeURIComponent(shareId)}`);
  } catch (error) {
    rethrow(error);
  }
}
