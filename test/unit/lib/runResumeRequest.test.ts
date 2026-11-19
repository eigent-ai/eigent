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
  beginResumeRequest,
  finishResumeRequest,
  pendingResumeRequest,
} from '@/lib/runResumeRequest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const owner = {
  accountKey: 'account-a',
  projectId: 'project-1',
  runId: 'run-1',
};
const interrupted = {
  run_id: 'run-1',
  project_id: 'project-1',
  status: 'interrupted',
  updated_at: 1,
  latest_attempt: { attempt_number: 1, status: 'interrupted' },
};
const pending = (id: string) => ({
  ...interrupted,
  status: 'pending',
  latest_attempt: {
    attempt_number: 2,
    status: 'pending',
    resume_request_id: id,
  },
});
beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

it('keeps an unknown ACK identity when reconciliation still reports the preceding interruption', () => {
  const id = beginResumeRequest(owner, interrupted);
  finishResumeRequest(owner, id, false);
  expect(beginResumeRequest(owner, interrupted)).toBe(id);
  finishResumeRequest(owner, id, true);
});

it('recovers a pending ACK after module reload without treating it as a new action', async () => {
  const id = beginResumeRequest(owner, interrupted);
  // A renderer exit cannot run its catch/finally. Only the durable ticket is
  // available in the next renderer, with no old in-flight memory state.
  vi.resetModules();
  const reloaded = await import('@/lib/runResumeRequest');
  expect(reloaded.pendingResumeRequest(owner, pending(id))).toBe(id);
  expect(reloaded.beginResumeRequest(owner, pending(id))).toBe(id);
  reloaded.finishResumeRequest(owner, id, true);
});

it('rotates only after the newer Attempt has canonically ended', () => {
  const id = beginResumeRequest(owner, interrupted);
  finishResumeRequest(owner, id, false);
  const next = beginResumeRequest(owner, {
    ...pending(id),
    status: 'interrupted',
    latest_attempt: { ...pending(id).latest_attempt, status: 'interrupted' },
  });
  expect(next).not.toBe(id);
  finishResumeRequest(owner, next, true);
});

it('does not clear another account, Project, Run, or newer request on late completion', () => {
  const id = beginResumeRequest(owner, interrupted);
  finishResumeRequest(owner, id, false);
  for (const different of [
    { ...owner, accountKey: 'b' },
    { ...owner, projectId: 'p-2' },
    { ...owner, runId: 'r-2' },
  ])
    finishResumeRequest(different, id, true);
  finishResumeRequest(owner, 'older-request', true);
  expect(pendingResumeRequest(owner, pending(id))).toBe(id);
  finishResumeRequest(owner, id, true);
});

it.each(['getItem', 'setItem'] as const)(
  'preserves retry identity when sessionStorage.%s throws',
  (method) => {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    const id = beginResumeRequest(owner, interrupted);
    finishResumeRequest(owner, id, false);
    expect(pendingResumeRequest(owner, pending(id))).toBe(id);
    expect(beginResumeRequest(owner, pending(id))).toBe(id);
    finishResumeRequest(owner, id, true);
    expect(pendingResumeRequest(owner, pending(id))).toBeNull();
  }
);
