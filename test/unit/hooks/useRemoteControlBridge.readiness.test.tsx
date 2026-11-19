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

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const remoteControlMocks = vi.hoisted(() => ({
  getRemoteControlDesktopInstanceId: vi.fn(() =>
    Promise.resolve('desktop-instance')
  ),
  getRemoteControlWebSocketUrl: vi.fn(() =>
    Promise.resolve('wss://example.test/bridge')
  ),
  setRemoteControlBridgeConnected: vi.fn(),
}));

vi.mock('@/client/platform', () => ({
  isDesktop: () => true,
}));

vi.mock('@/lib/remoteControl', () => remoteControlMocks);

import { useRemoteControlBridge } from '@/hooks/useRemoteControlBridge';

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }
}

let sockets: MockWebSocket[] = [];

describe('useRemoteControlBridge backend readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sockets = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not advertise or connect the bridge until local Brain is ready', async () => {
    const { rerender, unmount } = renderHook(
      ({ backendReady }) =>
        useRemoteControlBridge('desktop-token', backendReady),
      { initialProps: { backendReady: false } }
    );

    await Promise.resolve();
    expect(sockets).toHaveLength(0);
    expect(
      remoteControlMocks.getRemoteControlDesktopInstanceId
    ).not.toHaveBeenCalled();

    rerender({ backendReady: true });

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });
    expect(sockets[0].url).toBe('wss://example.test/bridge');

    rerender({ backendReady: false });
    expect(sockets[0].close).toHaveBeenCalledTimes(1);
    unmount();
  });
});
