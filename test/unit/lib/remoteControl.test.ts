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
  isRemoteControlAlreadyGoneError,
  parseRemoteControlLinkToken,
} from '@/lib/remoteControl';

describe('parseRemoteControlLinkToken', () => {
  it('reads the canonical fragment token', () => {
    expect(
      parseRemoteControlLinkToken(
        'https://remote.eigent.ai/remote-control/rcs_test#t=fragment-token'
      )
    ).toBe('fragment-token');
  });

  it('falls back to query token for legacy links', () => {
    expect(
      parseRemoteControlLinkToken('/remote-control/rcs_test?t=query-token')
    ).toBe('query-token');
  });

  it('returns empty string when the token is absent', () => {
    expect(parseRemoteControlLinkToken('/remote-control/rcs_test')).toBe('');
  });
});

describe('isRemoteControlAlreadyGoneError', () => {
  it('treats 410 (already revoked/expired) as already gone', () => {
    expect(isRemoteControlAlreadyGoneError({ status: 410 })).toBe(true);
  });

  it('treats 404 (session not found) as already gone', () => {
    expect(isRemoteControlAlreadyGoneError({ status: 404 })).toBe(true);
  });

  it('does not treat other errors as already gone', () => {
    expect(isRemoteControlAlreadyGoneError({ status: 403 })).toBe(false);
    expect(isRemoteControlAlreadyGoneError({ status: 400 })).toBe(false);
    expect(isRemoteControlAlreadyGoneError({ status: 500 })).toBe(false);
  });

  it('handles errors without a status (e.g. network failures)', () => {
    expect(isRemoteControlAlreadyGoneError(new Error('Network error'))).toBe(
      false
    );
    expect(isRemoteControlAlreadyGoneError(null)).toBe(false);
    expect(isRemoteControlAlreadyGoneError(undefined)).toBe(false);
  });
});
