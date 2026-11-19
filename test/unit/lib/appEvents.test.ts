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

describe('app event bus', () => {
  it('buffers startup events until the edition adapter subscribes', async () => {
    vi.resetModules();
    const events = await import('@/lib/events/appEvents');
    const received: Array<{ name: string; properties: unknown }> = [];

    events.recordSignInFailed({ reason: 'startup_race', method: 'token' });
    const unsubscribe = events.subscribeAppEvents(
      (event) => {
        received.push({
          name: event.name,
          properties: event.properties,
        });
      },
      { replayBuffered: true, consumeBuffered: true }
    );

    expect(received).toEqual([
      {
        name: 'signin_failed',
        properties: { reason: 'startup_race', method: 'token' },
      },
    ]);

    unsubscribe();
  });

  it('does not replay one buffered event to later subscribers twice', async () => {
    vi.resetModules();
    const events = await import('@/lib/events/appEvents');
    const firstSubscriber = vi.fn();
    const secondSubscriber = vi.fn();

    events.recordFeatureUsed('skills', { action: 'create' });
    const unsubscribeFirst = events.subscribeAppEvents(firstSubscriber, {
      replayBuffered: true,
      consumeBuffered: true,
    });
    const unsubscribeSecond = events.subscribeAppEvents(secondSubscriber, {
      replayBuffered: true,
    });

    expect(firstSubscriber).toHaveBeenCalledTimes(1);
    expect(secondSubscriber).not.toHaveBeenCalled();

    unsubscribeFirst();
    unsubscribeSecond();
  });

  it('keeps buffering until a replay consumer drains the startup buffer', async () => {
    vi.resetModules();
    const events = await import('@/lib/events/appEvents');
    const passiveSubscriber = vi.fn();
    const adapterSubscriber = vi.fn();

    const unsubscribePassive = events.subscribeAppEvents(passiveSubscriber);

    events.recordUserIdentityAvailable({
      id: 42,
      email: 'user@example.com',
      username: 'user',
    });
    const unsubscribeAdapter = events.subscribeAppEvents(adapterSubscriber, {
      replayBuffered: true,
      consumeBuffered: true,
    });

    expect(passiveSubscriber).toHaveBeenCalledTimes(1);
    expect(adapterSubscriber).toHaveBeenCalledTimes(1);
    expect(adapterSubscriber.mock.calls[0][0]).toMatchObject({
      name: 'user_identity_available',
      properties: {
        id: 42,
        email: 'user@example.com',
        username: 'user',
      },
    });

    unsubscribePassive();
    unsubscribeAdapter();
  });

  it('keeps dispatching when one listener throws', async () => {
    vi.resetModules();
    const events = await import('@/lib/events/appEvents');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const healthySubscriber = vi.fn();

    const unsubscribeBroken = events.subscribeAppEvents(() => {
      throw new Error('listener failed');
    });
    const unsubscribeHealthy = events.subscribeAppEvents(healthySubscriber);

    events.recordFeatureUsed('triggers', { action: 'create' });

    expect(healthySubscriber).toHaveBeenCalledTimes(1);
    expect(healthySubscriber.mock.calls[0][0]).toMatchObject({
      name: 'feature_used',
      properties: { feature: 'triggers', action: 'create' },
    });

    unsubscribeBroken();
    unsubscribeHealthy();
    consoleError.mockRestore();
  });
});

describe('app event classifiers', () => {
  it('keeps error and task category labels low-cardinality', async () => {
    const { classifyError, classifyTaskCategory } =
      await import('@/lib/events/appEventClassifiers');

    expect(classifyError('Backend is not ready')).toBe('backend_unavailable');
    expect(classifyError('fetch timeout')).toBe('network');
    expect(classifyTaskCategory('debug a TypeScript API')).toBe('coding');
    expect(classifyTaskCategory('compare market research')).toBe('research');
  });
});
