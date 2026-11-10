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

const normalizeUrlIdentity = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, '').toLowerCase();
  }
};

const normalizeIdentityPart = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

export function getAuthEnvironmentKey(): string {
  const parts = [
    `mode:${normalizeIdentityPart(import.meta.env.MODE)}`,
    `local:${normalizeIdentityPart(import.meta.env.VITE_USE_LOCAL_PROXY)}`,
    `base:${normalizeUrlIdentity(import.meta.env.VITE_BASE_URL)}`,
    `proxy:${normalizeUrlIdentity(import.meta.env.VITE_PROXY_URL)}`,
    `brain:${normalizeUrlIdentity(import.meta.env.VITE_BRAIN_ENDPOINT)}`,
    `stack:${normalizeIdentityPart(import.meta.env.VITE_STACK_PROJECT_ID)}`,
  ];
  const key = parts.filter(Boolean).join('|');
  return key || 'eigent:local-default';
}

const parseAuthEnvironmentKey = (key: string): Map<string, string> => {
  const parts = new Map<string, string>();
  for (const part of key.split('|')) {
    const separator = part.indexOf(':');
    if (separator > 0) {
      parts.set(part.slice(0, separator), part.slice(separator + 1));
    }
  }
  return parts;
};

/**
 * Names (never values) of the auth environment parts that differ between a
 * stored key and the current one, e.g. `['base', 'proxy']`. A stored sign-in
 * with no key at all reports `['unrecorded']`.
 */
export function changedAuthEnvironmentParts(
  storedKey: string | null | undefined,
  currentKey: string = getAuthEnvironmentKey()
): string[] {
  if (!storedKey) return ['unrecorded'];
  const stored = parseAuthEnvironmentKey(storedKey);
  const current = parseAuthEnvironmentKey(currentKey);
  const names = new Set([...stored.keys(), ...current.keys()]);
  return [...names].filter((name) => stored.get(name) !== current.get(name));
}

/** Log why a stored sign-in was cleared, naming only the changed parts. */
export function warnAuthClearedForEnvironment(changedParts: string[]): void {
  console.warn(
    `[authStore] Cleared sign-in because the build environment changed: ${
      changedParts.join(', ') || 'unknown'
    }`
  );
}

/** Non-secret ownership key for account-scoped background delivery. */
export function getAccountEnvironmentKey(auth: {
  user_id?: number | null;
  email?: string | null;
}): string {
  return JSON.stringify([
    getAuthEnvironmentKey(),
    auth.user_id != null
      ? `id:${auth.user_id}`
      : auth.email
        ? `email:${auth.email.trim().toLowerCase()}`
        : 'signed-out',
  ]);
}
