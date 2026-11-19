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

import { beforeEach, describe, expect, it } from 'vitest';

import {
  getRemoteControlBridgeError,
  setRemoteControlBridgeConnected,
  waitForRemoteControlBridgeConnected,
} from './remoteControl';

describe('remote control bridge state', () => {
  beforeEach(() => {
    setRemoteControlBridgeConnected(false, null);
  });

  it('resolves waiters immediately when registration is terminally rejected', async () => {
    const waiting = waitForRemoteControlBridgeConnected(5_000);

    setRemoteControlBridgeConnected(false, {
      code: 'device_owner_mismatch',
      message: 'Desktop device belongs to another user',
      retryable: false,
    });

    await expect(waiting).resolves.toBe(false);
    expect(getRemoteControlBridgeError()?.code).toBe('device_owner_mismatch');
  });

  it('clears a previous bridge error after registration succeeds', () => {
    setRemoteControlBridgeConnected(false, {
      code: 'device_owner_mismatch',
      message: 'Desktop device belongs to another user',
      retryable: false,
    });

    setRemoteControlBridgeConnected(true);

    expect(getRemoteControlBridgeError()).toBeNull();
  });
});
