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

export type BrowserUrlValidationResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

const LOCAL_HOST_PATTERN =
  /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:\/|$)/i;

function looksLikeLocalHost(input: string): boolean {
  return LOCAL_HOST_PATTERN.test(input);
}

/**
 * Normalize user-entered destinations to a canonical HTTP(S) URL.
 * Bare hostnames default to HTTPS; localhost and IP-with-port use HTTP.
 */
export function normalizeBrowserUrl(input: string): BrowserUrlValidationResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: 'URL is required' };
  }

  const colonIndex = trimmed.indexOf(':');
  if (colonIndex > 0) {
    const afterColon = trimmed.slice(colonIndex + 1);
    if (afterColon.startsWith('//')) {
      if (!/^https?:\/\//i.test(trimmed)) {
        return { ok: false, error: 'Only HTTP and HTTPS URLs are supported' };
      }
    } else if (/^[a-z]/i.test(afterColon)) {
      return { ok: false, error: 'Only HTTP and HTTPS URLs are supported' };
    }
  }

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `${looksLikeLocalHost(candidate) ? 'http' : 'https'}://${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: 'Invalid URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only HTTP and HTTPS URLs are supported' };
  }

  return { ok: true, url: parsed.href };
}

/** Returns canonical href when valid, otherwise null. */
export function canonicalizeBrowserUrl(input: string): string | null {
  const result = normalizeBrowserUrl(input);
  if (!result.ok) return null;

  try {
    const parsed = new URL(result.url);
    if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.href;
  } catch {
    return result.url;
  }
}
