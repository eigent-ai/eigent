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

import { useMarkSessionOutcomeSeen } from '@/hooks/useMarkSessionOutcomeSeen';
import { runProjectionStore } from '@/lib/runEvents/projectionStore';
import { presentationForKind } from '@/lib/sessionNavLead';
import {
  isSessionOutcomeSeen,
  markSessionOutcomeSeen,
} from '@/lib/sessionOutcome';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSessionControlsStore } from '@/store/sessionControlsStore';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'eigent-seen-session-outcomes';
let projectId: string;
let sessionNumber = 0;

const seen = (kind: 'finished' | 'error' | 'running' = 'finished') =>
  isSessionOutcomeSeen(
    projectId,
    kind,
    useSessionControlsStore.getState().seenOutcomes
  );

function setRun(runId: string, status: string, updatedAt: number) {
  runProjectionStore.upsertRunSummaries(projectId, [
    {
      project_id: projectId,
      run_id: runId,
      status,
      version: 1,
      updated_at: updatedAt,
    },
  ]);
}

function setLead(kind: 'finished' | 'error' | 'running' | 'hitl') {
  useProjectRuntimeStore.setState({
    navLeadByProjectId: { [projectId]: presentationForKind(kind) },
  });
}

describe('Session outcome read state', () => {
  beforeEach(() => {
    projectId = `outcome-session-${++sessionNumber}`;
    localStorage.removeItem(STORAGE_KEY);
    useSessionControlsStore.setState({ seenOutcomes: {} });
    useProjectRuntimeStore.setState({ navLeadByProjectId: {} });
  });

  afterEach(() => vi.restoreAllMocks());

  it('remembers a read result across restarts', () => {
    setRun('run-1', 'completed', 1_000);
    setLead('finished');
    expect(seen()).toBe(false);

    markSessionOutcomeSeen(projectId);

    expect(seen()).toBe(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      [projectId]: 'run-1:completed',
    });
  });

  it('shows the next Run’s result as new, even with the same status', () => {
    setRun('run-1', 'completed', 1_000);
    setLead('finished');
    markSessionOutcomeSeen(projectId);

    setRun('run-2', 'completed', 2_000);

    expect(seen()).toBe(false);
  });

  it('does not record live work or an open question as read', () => {
    setRun('run-1', 'waiting_for_user', 1_000);
    setLead('hitl');
    markSessionOutcomeSeen(projectId);
    setLead('running');
    markSessionOutcomeSeen(projectId);

    expect(useSessionControlsStore.getState().seenOutcomes).toEqual({});
    expect(seen('running')).toBe(false);
  });

  it('reads a result that lands while the Session is on screen', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    setRun('run-1', 'running', 1_000);
    setLead('running');
    renderHook(() => useMarkSessionOutcomeSeen(projectId));

    act(() => {
      setRun('run-1', 'completed', 2_000);
      setLead('finished');
    });

    expect(seen()).toBe(true);
  });

  it('waits for the window to come back before reading a result', () => {
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    setRun('run-1', 'failed', 1_000);
    setLead('error');
    renderHook(() => useMarkSessionOutcomeSeen(projectId));
    expect(seen('error')).toBe(false);

    hasFocus.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(seen('error')).toBe(true);
  });
});
