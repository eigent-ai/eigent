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

import type { BrainStreamRelayBridge } from '@/api/brainStreamRelay';
import type {
  BrainStreamRelayOpenResult,
  BrainStreamRelayReadResult,
  BrainStreamRelayRequest,
} from '@/shared/brainStreamRelay';
import { expect, vi } from 'vitest';

export const RELAY_ORIGIN = 'http://localhost:5001';

interface Pending<T> {
  resolve(value: T): void;
  reject(error: unknown): void;
}

export type PendingOpen = {
  request: BrainStreamRelayRequest;
} & Pending<BrainStreamRelayOpenResult>;

export type PendingRead = {
  streamId: string;
} & Pending<BrainStreamRelayReadResult>;

/** A scripted preload bridge: each open and read waits for the test. */
export class FakeRelayBridge implements BrainStreamRelayBridge {
  readonly opens: PendingOpen[] = [];
  readonly reads: PendingRead[] = [];
  target: () => Promise<{ origins: string[] } | null> = async () => ({
    origins: [RELAY_ORIGIN, 'http://127.0.0.1:5001'],
  });

  brainStreamRelayTarget = vi.fn(() => this.target());
  brainStreamRelayOpen = vi.fn(
    (request: BrainStreamRelayRequest) =>
      new Promise<BrainStreamRelayOpenResult>((resolve, reject) =>
        this.opens.push({ request, resolve, reject })
      )
  );
  brainStreamRelayRead = vi.fn(
    (streamId: string) =>
      new Promise<BrainStreamRelayReadResult>((resolve, reject) =>
        this.reads.push({ streamId, resolve, reject })
      )
  );
  brainStreamRelayCancel = vi.fn(async (_streamId: string) => true);

  lastOpen(): PendingOpen {
    const open = this.opens.at(-1);
    if (!open) throw new Error('No relay open was requested');
    return open;
  }

  async nextOpen(count = 1): Promise<PendingOpen> {
    await vi.waitFor(() =>
      expect(this.opens.length).toBeGreaterThanOrEqual(count)
    );
    return this.opens[count - 1];
  }

  async nextRead(): Promise<PendingRead> {
    await vi.waitFor(() => expect(this.reads.length).toBeGreaterThan(0));
    return this.reads.shift()!;
  }
}

export const sseHead = (
  overrides: Partial<Extract<BrainStreamRelayOpenResult, { ok: true }>> = {}
): BrainStreamRelayOpenResult => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: [
    ['content-type', 'text/event-stream'],
    ['x-session-id', 'session-from-brain'],
  ],
  ...overrides,
});
