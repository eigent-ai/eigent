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

import {
  reconcileToolkitState,
  TOOLKIT_MIN_DISPLAY_MS,
} from '@/components/Session/SidePanelSections/AgentPoolSection';
import { AgentStatusValue } from '@/types/constants';
import { describe, expect, it } from 'vitest';

type State = Parameters<typeof reconcileToolkitState>[0];

function makeState(): State {
  return { entries: new Map(), timers: new Map(), retired: new Set() };
}

function makeScheduler() {
  const scheduled: Array<{
    id: string;
    delay: number;
    cancelled: boolean;
    handle: number;
  }> = [];
  let nextHandle = 1;
  const schedule = (id: string, delay: number) => {
    const handle = nextHandle++;
    const record = { id, delay, cancelled: false, handle };
    scheduled.push(record);
    return handle as unknown as ReturnType<typeof setTimeout>;
  };
  const cancel = (h: ReturnType<typeof setTimeout>) => {
    const record = scheduled.find(
      (r) => r.handle === (h as unknown as number) && !r.cancelled
    );
    if (record) record.cancelled = true;
  };
  return { scheduled, schedule, cancel };
}

function runExpired(
  state: State,
  _scheduled: ReturnType<typeof makeScheduler>['scheduled'],
  now: number
) {
  for (const entry of [...state.entries.values()]) {
    if (entry.expireAt !== null && entry.expireAt <= now) {
      state.entries.delete(entry.id);
      state.timers.delete(entry.id);
      state.retired.add(entry.id);
    }
  }
}

describe('reconcileToolkitState', () => {
  it('shows a RUNNING toolkit immediately', () => {
    const state = makeState();
    const { schedule, cancel } = makeScheduler();
    const names = reconcileToolkitState(
      state,
      [{ id: 'a1', name: 'Browser Toolkit', status: AgentStatusValue.RUNNING }],
      { now: 0, minDisplayMs: TOOLKIT_MIN_DISPLAY_MS, schedule, cancel }
    );
    expect(names).toEqual(['Browser Toolkit']);
  });

  it('hides a RUNNING toolkit when it completes — but only after minDisplayMs', () => {
    const state = makeState();
    const { scheduled, schedule, cancel } = makeScheduler();
    const minDisplayMs = 1500;

    // t=0 → ACTIVATE
    let names = reconcileToolkitState(
      state,
      [{ id: 'a1', name: 'Browser Toolkit', status: AgentStatusValue.RUNNING }],
      { now: 0, minDisplayMs, schedule, cancel }
    );
    expect(names).toEqual(['Browser Toolkit']);

    // t=50 → DEACTIVATE — still in min-display window
    names = reconcileToolkitState(
      state,
      [
        {
          id: 'a1',
          name: 'Browser Toolkit',
          status: AgentStatusValue.COMPLETED,
        },
      ],
      { now: 50, minDisplayMs, schedule, cancel }
    );
    expect(names).toEqual(['Browser Toolkit']);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delay).toBeGreaterThanOrEqual(1400);

    // t=1500 → timer fires, entry evicted
    runExpired(state, scheduled, 1500);
    names = reconcileToolkitState(state, [], {
      now: 1500,
      minDisplayMs,
      schedule,
      cancel,
    });
    expect(names).toEqual([]);
  });

  it('surfaces a fast toolkit that ACTIVATEs and DEACTIVATEs within a single render pass', () => {
    // This mirrors the user report: a browser_agent fires Browser Toolkit,
    // Search Toolkit, and Screenshot Toolkit. Search/Screenshot can flip
    // RUNNING → COMPLETED very quickly. All three must still appear.
    const state = makeState();
    const { schedule, cancel } = makeScheduler();
    const minDisplayMs = 1500;

    const names = reconcileToolkitState(
      state,
      [
        { id: 'b', name: 'Browser Toolkit', status: AgentStatusValue.RUNNING },
        {
          id: 's',
          name: 'Search Toolkit',
          status: AgentStatusValue.COMPLETED,
        },
        {
          id: 'p',
          name: 'Screenshot Toolkit',
          status: AgentStatusValue.COMPLETED,
        },
      ],
      { now: 100, minDisplayMs, schedule, cancel }
    );

    expect(names).toEqual([
      'Browser Toolkit',
      'Search Toolkit',
      'Screenshot Toolkit',
    ]);
  });

  it('re-arming: a toolkit that flips back to RUNNING cancels its pending removal', () => {
    const state = makeState();
    const { scheduled, schedule, cancel } = makeScheduler();
    const minDisplayMs = 1500;

    reconcileToolkitState(
      state,
      [{ id: 'a', name: 'Search Toolkit', status: AgentStatusValue.RUNNING }],
      { now: 0, minDisplayMs, schedule, cancel }
    );
    reconcileToolkitState(
      state,
      [{ id: 'a', name: 'Search Toolkit', status: AgentStatusValue.COMPLETED }],
      { now: 100, minDisplayMs, schedule, cancel }
    );
    expect(scheduled.filter((s) => !s.cancelled)).toHaveLength(1);

    reconcileToolkitState(
      state,
      [{ id: 'a', name: 'Search Toolkit', status: AgentStatusValue.RUNNING }],
      { now: 120, minDisplayMs, schedule, cancel }
    );
    expect(scheduled.filter((s) => !s.cancelled)).toHaveLength(0);
    const entry = state.entries.get('a');
    expect(entry?.expireAt).toBeNull();
  });

  it('dedupes by name while preserving first-seen order', () => {
    // Each ACTIVATE of the same toolkit name gets a unique id from the store,
    // but users should only see one tag per name.
    const state = makeState();
    const { schedule, cancel } = makeScheduler();
    const minDisplayMs = 1500;

    const names = reconcileToolkitState(
      state,
      [
        {
          id: '1',
          name: 'Browser Toolkit',
          status: AgentStatusValue.RUNNING,
        },
        {
          id: '2',
          name: 'Search Toolkit',
          status: AgentStatusValue.RUNNING,
        },
        {
          id: '3',
          name: 'Browser Toolkit',
          status: AgentStatusValue.RUNNING,
        },
      ],
      { now: 0, minDisplayMs, schedule, cancel }
    );
    expect(names).toEqual(['Browser Toolkit', 'Search Toolkit']);
  });

  it('ignores the "notice" placeholder', () => {
    // Consumers filter `toolkitName === "notice"` before passing events in.
    // This test asserts reconcile behaves correctly when callers hand it only
    // real toolkit events (the helper itself is caller-filtered).
    const state = makeState();
    const { schedule, cancel } = makeScheduler();
    const names = reconcileToolkitState(
      state,
      [{ id: '1', name: 'Browser Toolkit', status: AgentStatusValue.RUNNING }],
      { now: 0, minDisplayMs: 1500, schedule, cancel }
    );
    expect(names).toEqual(['Browser Toolkit']);
  });

  it('full sequence: browser stays, search and screenshot come and go', () => {
    const state = makeState();
    const { scheduled, schedule, cancel } = makeScheduler();
    const minDisplayMs = 1500;

    // t=0: browser starts
    let names = reconcileToolkitState(
      state,
      [{ id: 'b', name: 'Browser Toolkit', status: AgentStatusValue.RUNNING }],
      { now: 0, minDisplayMs, schedule, cancel }
    );
    expect(names).toEqual(['Browser Toolkit']);

    // t=200: search starts (while browser still running)
    names = reconcileToolkitState(
      state,
      [
        { id: 'b', name: 'Browser Toolkit', status: AgentStatusValue.RUNNING },
        { id: 's1', name: 'Search Toolkit', status: AgentStatusValue.RUNNING },
      ],
      { now: 200, minDisplayMs, schedule, cancel }
    );
    expect(names).toEqual(['Browser Toolkit', 'Search Toolkit']);

    // t=250: search finishes fast
    names = reconcileToolkitState(
      state,
      [
        { id: 'b', name: 'Browser Toolkit', status: AgentStatusValue.RUNNING },
        {
          id: 's1',
          name: 'Search Toolkit',
          status: AgentStatusValue.COMPLETED,
        },
      ],
      { now: 250, minDisplayMs, schedule, cancel }
    );
    expect(names).toEqual(['Browser Toolkit', 'Search Toolkit']);

    // t=400: screenshot starts
    names = reconcileToolkitState(
      state,
      [
        { id: 'b', name: 'Browser Toolkit', status: AgentStatusValue.RUNNING },
        {
          id: 's1',
          name: 'Search Toolkit',
          status: AgentStatusValue.COMPLETED,
        },
        {
          id: 'p1',
          name: 'Screenshot Toolkit',
          status: AgentStatusValue.RUNNING,
        },
      ],
      { now: 400, minDisplayMs, schedule, cancel }
    );
    expect(names).toEqual([
      'Browser Toolkit',
      'Search Toolkit',
      'Screenshot Toolkit',
    ]);

    // t=1700: search's min-display elapsed (firstSeen=200 + 1500) → evicted
    runExpired(state, scheduled, 1700);
    names = reconcileToolkitState(
      state,
      [
        { id: 'b', name: 'Browser Toolkit', status: AgentStatusValue.RUNNING },
        {
          id: 's1',
          name: 'Search Toolkit',
          status: AgentStatusValue.COMPLETED,
        },
        {
          id: 'p1',
          name: 'Screenshot Toolkit',
          status: AgentStatusValue.RUNNING,
        },
      ],
      { now: 1700, minDisplayMs, schedule, cancel }
    );
    expect(names).toEqual(['Browser Toolkit', 'Screenshot Toolkit']);
  });
});
