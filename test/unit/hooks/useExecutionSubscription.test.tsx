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

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { activityLogStore, authStore, triggerStore } = vi.hoisted(() => ({
  activityLogStore: {
    addLog: vi.fn(),
  },
  authStore: {
    token: 'test-token',
  },
  triggerStore: {
    emitWebSocketEvent: vi.fn(),
    triggers: [],
    setWsConnectionStatus: vi.fn(),
    setLastPongTimestamp: vi.fn(),
    setWsReconnectCallback: vi.fn(),
  },
}));

vi.mock('@/store/activityLogStore', () => ({
  ActivityType: {
    TriggerExecuted: 'trigger_executed',
    ExecutionSuccess: 'execution_success',
    ExecutionFailed: 'execution_failed',
  },
  useActivityLogStore: () => activityLogStore,
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => authStore,
}));

vi.mock('@/store/triggerStore', () => ({
  useTriggerStore: () => triggerStore,
}));

vi.mock('@/lib/queryClient', () => ({
  queryClient: {
    invalidateQueries: vi.fn(),
    prefetchQuery: vi.fn(),
  },
  queryKeys: {
    triggers: {
      all: ['triggers'],
      configs: vi.fn(),
      list: vi.fn(),
    },
  },
}));

vi.mock('@/service/triggerApi', () => ({
  proxyFetchTriggerConfig: vi.fn(),
}));

vi.mock('@/i18n', () => ({
  default: {
    t: vi.fn((key: string) => key),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { useExecutionSubscription } from '@/hooks/useExecutionSubscription';

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  send = vi.fn();

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  close() {
    this.readyState = MockWebSocket.CLOSING;
  }

  emitClose(code = 1006, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

describe('useExecutionSubscription', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_BASE_URL', 'http://localhost:8000');
    vi.stubEnv('VITE_PROXY_URL', 'http://localhost:8000');
    vi.stubGlobal('WebSocket', MockWebSocket);
    MockWebSocket.instances = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('reactively reports connection state and reconnects after a close', () => {
    const { result, unmount } = renderHook(() =>
      useExecutionSubscription(true)
    );

    expect(result.current.isConnected).toBe(false);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    const firstSocket = MockWebSocket.instances[0];
    expect(firstSocket).toBeDefined();

    act(() => {
      firstSocket.open();
    });
    expect(result.current.isConnected).toBe(true);

    act(() => {
      firstSocket.emitClose();
    });
    expect(result.current.isConnected).toBe(false);

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(MockWebSocket.instances).toHaveLength(2);

    unmount();
  });
});
