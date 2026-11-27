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

import { SAVED_VALUE_MARKER } from './types';

/** Secret values keyed by the JSON pointer of the setting that holds them. */
export type SecretValues = Record<string, string>;

const SECRET_WORDS = new Set([
  'auth',
  'authorization',
  'key',
  'apikey',
  'secret',
  'token',
  'password',
  'passwd',
  'pwd',
  'credential',
  'credentials',
  'cookie',
  'signature',
  'bearer',
]);

const MAX_DEPTH = 8;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A setting name such as `aws_secret_access_key`, `X-Api-Key` or
 * `Authorization` holds a secret. Counters such as `max_tokens` do not: the
 * name is compared word by word.
 */
export function isSecretSettingName(name: string): boolean {
  return name
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .split(/[^A-Za-z0-9]+/u)
    .some((word) => SECRET_WORDS.has(word.toLowerCase()));
}

function pointer(path: string[]): string {
  return path
    .map((part) => `/${part.replace(/~/gu, '~0').replace(/\//gu, '~1')}`)
    .join('');
}

/**
 * Split provider settings into the part the app window may see and the secret
 * values. A marker in `input` keeps the value already saved at that place; a
 * marker with nothing saved behind it is dropped.
 */
export function splitSecretValues(
  input: Record<string, unknown>,
  secretFields: readonly string[],
  saved: SecretValues
): { visible: Record<string, unknown>; secrets: SecretValues } {
  const secrets: SecretValues = {};
  const flagged = new Set(secretFields);

  const walk = (
    value: Record<string, unknown>,
    path: string[]
  ): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [name, item] of Object.entries(value)) {
      const itemPath = [...path, name];
      if (isPlainObject(item)) {
        result[name] =
          itemPath.length >= MAX_DEPTH ? item : walk(item, itemPath);
        continue;
      }
      if (typeof item !== 'string') {
        result[name] = item;
        continue;
      }
      const place = pointer(itemPath);
      if (item === SAVED_VALUE_MARKER) {
        if (saved[place] !== undefined) {
          secrets[place] = saved[place];
          result[name] = SAVED_VALUE_MARKER;
        }
        continue;
      }
      const secret =
        isSecretSettingName(name) || (path.length === 0 && flagged.has(name));
      if (secret && item !== '') {
        secrets[place] = item;
        result[name] = SAVED_VALUE_MARKER;
      } else {
        result[name] = item;
      }
    }
    return result;
  };

  return { visible: walk(input, []), secrets };
}

/** Pointers of the markers in `visible`: the secret values it relies on. */
export function markedPlaces(visible: Record<string, unknown>): string[] {
  const places: string[] = [];
  const walk = (value: Record<string, unknown>, path: string[]) => {
    for (const [name, item] of Object.entries(value)) {
      const itemPath = [...path, name];
      if (isPlainObject(item)) {
        if (itemPath.length < MAX_DEPTH) walk(item, itemPath);
      } else if (item === SAVED_VALUE_MARKER) {
        places.push(pointer(itemPath));
      }
    }
  };
  walk(visible, []);
  return places;
}

/** Put the secret values back in place of their markers. */
export function mergeSecretValues(
  visible: Record<string, unknown>,
  secrets: SecretValues
): Record<string, unknown> {
  const walk = (
    value: Record<string, unknown>,
    path: string[]
  ): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [name, item] of Object.entries(value)) {
      const itemPath = [...path, name];
      if (isPlainObject(item)) {
        result[name] =
          itemPath.length >= MAX_DEPTH ? item : walk(item, itemPath);
      } else if (item === SAVED_VALUE_MARKER) {
        const saved = secrets[pointer(itemPath)];
        if (saved !== undefined) result[name] = saved;
      } else {
        result[name] = item;
      }
    }
    return result;
  };
  return walk(visible, []);
}

/**
 * Split an endpoint address into what the app window may show and whether the
 * address carries credentials: a sign-in part before the host, or a query.
 */
export function splitEndpoint(endpoint: string): {
  visible: string;
  hasSecret: boolean;
} {
  const trimmed = endpoint.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { visible: trimmed, hasSecret: false };
  }
  if (!parsed.username && !parsed.password && !parsed.search && !parsed.hash) {
    return { visible: trimmed, hasSecret: false };
  }
  return { visible: `${parsed.origin}${parsed.pathname}`, hasSecret: true };
}
