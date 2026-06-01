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

import { getRemoteControlEventSocketUrl } from '@web/api/remoteControl';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('getRemoteControlEventSocketUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses same-origin WebSocket URL in local proxy mode', () => {
    vi.stubEnv('VITE_USE_LOCAL_PROXY', 'true');
    vi.stubEnv('VITE_PROXY_URL', 'http://localhost:3001');

    const expectedBase = window.location.origin.replace(/^http/, 'ws');

    expect(getRemoteControlEventSocketUrl('rcs_test')).toBe(
      `${expectedBase}/api/v1/remote-control/sessions/rcs_test/events/subscribe`
    );
  });

  it('uses VITE_PROXY_URL for WebSocket URL in cloud mode', () => {
    vi.stubEnv('VITE_USE_LOCAL_PROXY', 'false');
    vi.stubEnv('VITE_PROXY_URL', 'https://dev.eigent.ai');

    expect(getRemoteControlEventSocketUrl('rcs_test')).toBe(
      'wss://dev.eigent.ai/api/v1/remote-control/sessions/rcs_test/events/subscribe'
    );
  });
});
