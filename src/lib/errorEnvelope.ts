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

/** Read untrusted errors without invoking accessors or following prototypes. */
export function ownErrorField(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value')
      ? descriptor.value
      : undefined;
  } catch {
    // Revoked proxies and descriptor traps are not diagnostic data.
    return undefined;
  }
}

export const ERROR_DEPTH_LIMIT = 6;
export const ERROR_NODE_LIMIT = 32;
export const ERROR_TEXT_LIMIT = 8192;

/**
 * A deliberately small JSON / Python-literal grammar. No identifiers, calls,
 * attribute access, evaluation, or global searches inside diagnostic strings.
 * Unknown keys can be parsed, but only the caller's allowlisted paths are read.
 */
export function parseErrorLiteral(source: string, depth: number): unknown {
  let offset = 0;
  let nodes = ERROR_NODE_LIMIT;
  const invalid = () => {
    throw new Error('Invalid diagnostic literal');
  };
  const whitespace = () => {
    while (/\s/.test(source[offset] ?? '') && offset < source.length) offset++;
  };
  const string = (): string => {
    const quote = source[offset++];
    let result = '';
    while (offset < source.length) {
      let char = source[offset++];
      if (char === quote) return result;
      if (char.charCodeAt(0) < 32) invalid();
      if (char === '\\') {
        char = source[offset++];
        const escapes: Record<string, string> = {
          '\\': '\\',
          '"': '"',
          "'": "'",
          '/': '/',
          n: '\n',
          r: '\r',
          t: '\t',
          b: '\b',
          f: '\f',
        };
        if (Object.hasOwn(escapes, char)) char = escapes[char];
        else if (char === 'u' || char === 'x') {
          const size = char === 'u' ? 4 : 2;
          const hex = source.slice(offset, offset + size);
          if (hex.length !== size || !/^[0-9a-f]+$/i.test(hex)) invalid();
          char = String.fromCharCode(parseInt(hex, 16));
          offset += size;
        } else invalid();
      }
      result += char;
    }
    return invalid();
  };
  const parse = (level: number): unknown => {
    if (--nodes < 0 || level > ERROR_DEPTH_LIMIT) return invalid();
    whitespace();
    const char = source[offset];
    if (char === '"' || char === "'") return string();
    if (char === '{' || char === '[') {
      const object = char === '{';
      const end = object ? '}' : ']';
      const value: Record<string, unknown> | unknown[] = object
        ? Object.create(null)
        : [];
      offset++;
      whitespace();
      if (source[offset] === end) {
        offset++;
        return value;
      }
      while (offset < source.length) {
        let key = '';
        if (object) {
          whitespace();
          if (source[offset] !== '"' && source[offset] !== "'") invalid();
          key = string();
          if (Object.hasOwn(value, key)) invalid();
          whitespace();
          if (source[offset++] !== ':') invalid();
        }
        const child = parse(level + 1);
        if (object) (value as Record<string, unknown>)[key] = child;
        else (value as unknown[]).push(child);
        whitespace();
        if (source[offset] === end) {
          offset++;
          return value;
        }
        if (source[offset++] !== ',') invalid();
        whitespace();
        if (source[offset] === end) {
          offset++;
          return value;
        }
      }
      return invalid();
    }
    const scalar =
      /^(?:None|null|True|true|False|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        source.slice(offset)
      );
    if (!scalar) return invalid();
    offset += scalar[0].length;
    if (['None', 'null'].includes(scalar[0])) return null;
    if (['True', 'true'].includes(scalar[0])) return true;
    if (['False', 'false'].includes(scalar[0])) return false;
    const number = Number(scalar[0]);
    return Number.isFinite(number) ? number : invalid();
  };
  if (source.length > ERROR_TEXT_LIMIT) return invalid();
  const result = parse(depth);
  whitespace();
  if (offset !== source.length) return invalid();
  return result;
}
