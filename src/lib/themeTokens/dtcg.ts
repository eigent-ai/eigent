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

type JsonObject = Record<string, unknown>;

export type DtcgLeafToken = {
  path: string;
  value: unknown;
  type?: string;
  extensions?: Record<string, unknown>;
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isObject(base) || !isObject(override)) {
    return deepClone(override);
  }
  const out: JsonObject = deepClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (key === '$extends') continue;
    const existing = out[key];
    out[key] =
      isObject(existing) && isObject(value)
        ? (deepMerge(existing, value) as JsonObject)
        : deepClone(value);
  }
  return out;
}

function getByPath(root: JsonObject, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  let current: unknown = root;
  for (const part of parts) {
    if (!isObject(current) || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function resolveExtendsRec(
  root: JsonObject,
  node: unknown,
  path: string,
  stack: Set<string>
): unknown {
  if (!isObject(node)) return node;

  const extendsPath =
    typeof node.$extends === 'string'
      ? node.$extends.trim().replace(/^\{|\}$/g, '')
      : null;

  if (extendsPath) {
    const stackKey = `${path} -> ${extendsPath}`;
    if (stack.has(stackKey)) {
      throw new Error(`Circular $extends detected at "${path}"`);
    }
    stack.add(stackKey);
    const base = getByPath(root, extendsPath);
    if (!isObject(base)) {
      throw new Error(
        `$extends target "${extendsPath}" not found for "${path}"`
      );
    }
    const resolvedBase = resolveExtendsRec(root, base, extendsPath, stack);
    const merged = deepMerge(resolvedBase, node);
    stack.delete(stackKey);
    return resolveExtendsRec(root, merged, path, stack);
  }

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = resolveExtendsRec(
      root,
      value,
      path ? `${path}.${key}` : key,
      stack
    );
  }
  return out;
}

export function resolveExtends<T extends JsonObject>(root: T): T {
  const cloned = deepClone(root);
  return resolveExtendsRec(cloned, cloned, '', new Set<string>()) as T;
}

function flattenRec(
  node: unknown,
  path: string[],
  output: DtcgLeafToken[]
): void {
  if (!isObject(node)) return;

  if ('$value' in node) {
    output.push({
      path: path.join('.'),
      value: node.$value,
      type: typeof node.$type === 'string' ? node.$type : undefined,
      extensions: isObject(node.$extensions)
        ? (node.$extensions as Record<string, unknown>)
        : undefined,
    });
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    flattenRec(value, [...path, key], output);
  }
}

export function flattenDtcgTokens(tree: JsonObject): DtcgLeafToken[] {
  const output: DtcgLeafToken[] = [];
  flattenRec(tree, [], output);
  return output;
}

export function resolveAliasReferences<T>(
  value: T,
  lookup: (path: string) => unknown
): T {
  if (typeof value === 'string') {
    return value.replace(/\{([^}]+)\}/g, (_m, tokenPath: string) => {
      const resolved = lookup(tokenPath.trim());
      return resolved == null ? '' : String(resolved);
    }) as T;
  }
  return value;
}
