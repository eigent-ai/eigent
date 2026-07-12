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

/**
 * Hosts that default to plain HTTP when no scheme is typed: loopback and
 * RFC 1918 private-network targets (dev servers, LAN devices). Everything
 * else — including public IPs — defaults to HTTPS.
 */
const LOOPBACK_OR_PRIVATE_HOST_PATTERN =
  /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d+)?(?:\/|$)/i;

/** Where non-URL input is sent as a search query. */
const WEB_SEARCH_URL = 'https://www.google.com/search?q=';

/**
 * Scheme-less input we can navigate to directly: a dotted hostname or IP,
 * localhost, a bracketed IPv6 literal, or a bare host:port — with or without
 * a path. Anything else (plain words, questions) becomes a web search.
 */
function looksNavigable(input: string): boolean {
  if (/\s/.test(input)) return false;
  const host = input.split(/[/?#]/, 1)[0] ?? '';
  return (
    host.includes('.') ||
    /^localhost(?::\d+)?$/i.test(host) ||
    /^\[[0-9a-f:.]+\](?::\d+)?$/i.test(host) ||
    /^[a-z0-9-]+:\d+$/i.test(host)
  );
}

/**
 * Normalize user-entered destinations to a canonical HTTP(S) URL.
 * Bare hostnames default to HTTPS; loopback/private hosts use HTTP. Input
 * that isn't URL-shaped becomes a web search, like a real address bar —
 * except explicit non-HTTP schemes, which are rejected outright.
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
    } else if (/^[a-z]/i.test(afterColon) && !/\s/.test(trimmed)) {
      return { ok: false, error: 'Only HTTP and HTTPS URLs are supported' };
    }
  }

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    if (!looksNavigable(candidate)) {
      return {
        ok: true,
        url: `${WEB_SEARCH_URL}${encodeURIComponent(trimmed)}`,
      };
    }
    candidate = `${LOOPBACK_OR_PRIVATE_HOST_PATTERN.test(candidate) ? 'http' : 'https'}://${candidate}`;
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
