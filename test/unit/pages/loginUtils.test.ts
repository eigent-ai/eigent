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
  DESKTOP_LOGIN_CALLBACK_URL,
  getExternalLoginUrl,
  getWebLoginCallbackUrl,
} from '../../../src/pages/loginUtils';

describe('loginUtils', () => {
  it('builds the web login callback URL against the current origin', () => {
    expect(getWebLoginCallbackUrl('http://localhost:5173')).toBe(
      'http://localhost:5173/login'
    );
    expect(getWebLoginCallbackUrl('https://example.com/app')).toBe(
      'https://example.com/login'
    );
  });

  it('keeps the desktop callback URL on the custom protocol', () => {
    expect(DESKTOP_LOGIN_CALLBACK_URL).toBe('eigent://auth/callback');
  });

  it('encodes the external login callback URL correctly', () => {
    expect(getExternalLoginUrl('http://localhost:5173/login?from=web')).toBe(
      'https://www.eigent.ai/signin?callbackUrl=http%3A%2F%2Flocalhost%3A5173%2Flogin%3Ffrom%3Dweb'
    );
  });
});
