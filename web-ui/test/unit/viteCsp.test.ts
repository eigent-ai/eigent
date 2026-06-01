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

import { describe, expect, it, vi } from 'vitest';
import {
  applyRemoteControlDevRewrite,
  remoteControlCsp,
} from '../../remoteCsp';

describe('remote-control vite CSP', () => {
  it('includes the proxy HTTP and WebSocket origins in connect-src', () => {
    const csp = remoteControlCsp({ VITE_PROXY_URL: 'https://dev.eigent.ai' });

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain('connect-src');
    expect(csp).toContain('https://dev.eigent.ai');
    expect(csp).toContain('wss://dev.eigent.ai');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it('sets CSP header when rewriting remote-control routes to remote.html', () => {
    const req = { url: '/remote-control/rcs_test?t=legacy' };
    const headers = new Map<string, string>();
    const res = {
      setHeader: (key: string, value: string) => {
        headers.set(key, value);
      },
    };
    const next = vi.fn();

    const rewritten = applyRemoteControlDevRewrite(req, res, 'test-csp');
    next();

    expect(rewritten).toBe(true);
    expect(req.url).toBe('/remote.html?t=legacy');
    expect(headers.get('Content-Security-Policy')).toBe('test-csp');
    expect(next).toHaveBeenCalledOnce();
  });
});
