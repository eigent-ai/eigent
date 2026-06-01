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

type HeaderSetter = {
  setHeader: (key: string, value: string) => void;
};

type RewriteRequest = {
  url?: string;
};

export function originFromUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function websocketOriginFor(origin: string): string {
  const url = new URL(origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.origin;
}

export function remoteControlCsp(env: Record<string, string>): string {
  // Dev CSP intentionally widens connect-src for local development because the
  // remote page may need to connect to local Vite/API/WS ports. Production CSP
  // must be supplied by the static host and limited to the configured API origin.
  //
  // Vite's React plugin also injects an inline Fast Refresh preamble in dev.
  // If script-src blocks that preamble, React Refresh throws
  // "@vitejs/plugin-react can't detect preamble" and the page renders blank.
  // Keep this unsafe-inline allowance dev-only; do not copy it to production
  // CSP headers.
  const connectSrc = new Set<string>([
    "'self'",
    'http://localhost:*',
    'http://127.0.0.1:*',
    'ws://localhost:*',
    'ws://127.0.0.1:*',
  ]);
  const proxyOrigin = originFromUrl(env.VITE_PROXY_URL);
  if (proxyOrigin) {
    connectSrc.add(proxyOrigin);
    connectSrc.add(websocketOriginFor(proxyOrigin));
  }

  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${Array.from(connectSrc).join(' ')}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ].join('; ');
}

export function applyRemoteControlDevRewrite(
  req: RewriteRequest,
  res: HeaderSetter,
  csp: string
): boolean {
  const url = req.url || '';
  if (!url.startsWith('/remote-control')) {
    return false;
  }
  res.setHeader('Content-Security-Policy', csp);
  req.url = url.replace(/^\/remote-control[^?#]*/, '/remote.html');
  return true;
}
