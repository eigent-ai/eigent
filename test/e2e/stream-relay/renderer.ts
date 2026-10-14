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

import { getBrainStreamRelayBridge } from '@/api/brainStreamRelay';
import { sseTransport } from '@/api/http';
import { setConnectionConfig } from '@/store/connectionStore';

// Drives the production sseTransport against the stand-in Brain.
const brain = new URLSearchParams(location.search).get('brain')!;
setConnectionConfig({ brainEndpoint: brain, channel: 'desktop' });

interface StreamState {
  controller: AbortController;
  events: string[];
  error?: string;
}

const streams = new Map<number, StreamState>();

Object.assign(window, {
  relayTest: {
    hasRelayBridge: () => getBrainStreamRelayBridge() !== null,
    open(count: number) {
      for (let index = 0; index < count; index += 1) {
        const state: StreamState = {
          controller: new AbortController(),
          events: [],
        };
        streams.set(index, state);
        void sseTransport({
          url: `/runs/run-${index}/stream?after_sequence=0`,
          method: 'GET',
          signal: state.controller.signal,
          onmessage: (event) => {
            state.events.push(event.data);
          },
          onerror: (error) => {
            state.error = String(error);
            throw error;
          },
        }).catch((error) => {
          state.error = String(error);
        });
      }
    },
    abort(index: number) {
      streams.get(index)?.controller.abort();
    },
    events: () =>
      Object.fromEntries(
        [...streams].map(([index, state]) => [index, state.events])
      ),
    errors: () =>
      [...streams.values()]
        .map((state) => state.error)
        .filter((error): error is string => Boolean(error)),
    /** An ordinary request to the same Brain host, as the app makes. */
    async status(timeoutMs: number) {
      const started = performance.now();
      try {
        const response = await fetch(`${brain}/status`, {
          signal: AbortSignal.timeout(timeoutMs),
        });
        const body = (await response.json()) as { subscriber_count: number };
        return {
          ok: true,
          ms: Math.round(performance.now() - started),
          subscribers: body.subscriber_count,
        };
      } catch (error) {
        return {
          ok: false,
          ms: Math.round(performance.now() - started),
          error: String(error),
        };
      }
    },
  },
});
document.body.dataset.ready = 'true';
