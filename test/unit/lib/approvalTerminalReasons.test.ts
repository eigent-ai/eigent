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

import { presentChatSemanticEntities } from '@/components/ChatBox/EventTimeline/presentationPolicy';
import {
  approvalTerminalReason,
  interruptedRunDescription,
} from '@/lib/approvalPresentation';
import { normalizeLocalRunEvent } from '@/lib/projector';
import { adaptChatProjectionEvent } from '@/lib/projector/chat';
import { toTimelineCall } from '@/lib/projector/chat/presentation/timelineCalls';
import { reduceProjectedRun } from '@/lib/projector/reduce';
import { mergeRunSummary } from '@/lib/projector/runSummary';
import i18next from 'i18next';
import { describe, expect, it } from 'vitest';

const event = (type: string, reason: string, sequence = 1) =>
  normalizeLocalRunEvent(
    {
      event_id: `event-${sequence}`,
      run_id: 'run-1',
      sequence,
      run_version: sequence,
      event_type: type,
      payload: { approval_id: 'approval-1', reason },
      created_at: sequence,
    },
    'project-1'
  );

describe('durable approval terminal reasons', () => {
  it.each([
    ['approval.expired_rejected', 'tool_approval_expired'],
    ['approval.cancelled', 'tool_terminal_before_dispatch'],
  ])(
    'retains the actual %s reason in the live Run and timeline receipt',
    (type, reason) => {
      const fact = event(type, reason);
      const run = reduceProjectedRun(undefined, fact);
      expect(run).toMatchObject({
        status: 'interrupted',
        terminalReason: reason,
      });
      const projected = adaptChatProjectionEvent(fact);
      const node = projected.kind === 'display' ? projected.node : null;
      expect(node).toMatchObject({ kind: 'interaction', reason });
      if (!node) throw new Error('Missing receipt');
      const call = toTimelineCall({
        kind: 'node',
        id: node.id,
        runSequence: node.runSequence,
        node,
      });
      expect(call?.detail).toBeTruthy();
      if (type === 'approval.cancelled')
        expect(call?.detail).not.toMatch(/expired/i);
    }
  );

  it('keeps the terminal reason when request and decision are composed into one replay receipt', () => {
    const facts = [
      event('approval.requested', '', 1),
      event('approval.cancelled', 'tool_terminal_before_dispatch', 2),
    ];
    const nodes = facts.flatMap((fact) => {
      const projected = adaptChatProjectionEvent(fact);
      return projected.kind === 'display' ? [projected.node] : [];
    });
    const receipts = presentChatSemanticEntities(nodes).filter(
      (node) => node.kind === 'interaction'
    );
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      status: 'cancelled',
      reason: 'tool_terminal_before_dispatch',
      resolutionEventId: 'event-2',
    });
  });

  it('names only mapped approval causes in the interrupted banner', () => {
    const t = i18next.t.bind(i18next);
    for (const reason of [
      'worker_cancelled',
      'runtime.interrupted',
      'brain_restart',
      null,
    ]) {
      expect(interruptedRunDescription(reason, t)).toBe(
        t('chat.run-interrupted-description')
      );
    }
    expect(approvalTerminalReason('worker_cancelled', t)).toBe(
      'Recorded reason: worker_cancelled'
    );
    const expired = interruptedRunDescription('approval_expired', t);
    expect(expired).toContain('re-evaluates');
    expect(expired).toContain('requests new approval when needed');
    expect(expired).toContain(t('chat.run-interrupted-description'));
  });

  it('preserves an approval expiry reconciled at startup from the Run summary', () => {
    const run = mergeRunSummary(undefined, {
      run_id: 'run-1',
      project_id: 'project-1',
      status: 'interrupted',
      version: 4,
      updated_at: 100,
      latest_attempt: {
        attempt_number: 1,
        status: 'interrupted',
        outcome: 'approval_expired',
        timeout_reason: null,
      },
    });
    expect(run?.terminalReason).toBe('approval_expired');
    expect(
      reduceProjectedRun(
        run,
        event('run.attempt_created', 'explicit_resume', 5)
      ).terminalReason
    ).toBeNull();
  });

  it('does not carry an old expiry into a different Attempt restored without a reason', () => {
    const first = mergeRunSummary(undefined, {
      run_id: 'run-1',
      project_id: 'project-1',
      status: 'interrupted',
      version: 2,
      updated_at: 100,
      latest_attempt: {
        attempt_number: 1,
        status: 'interrupted',
        outcome: 'approval_expired',
      },
    });
    const next = mergeRunSummary(first, {
      run_id: 'run-1',
      project_id: 'project-1',
      status: 'interrupted',
      version: 5,
      updated_at: 200,
      latest_attempt: {
        attempt_number: 2,
        status: 'interrupted',
        outcome: null,
        timeout_reason: null,
      },
    });
    expect(next?.terminalReason).toBeNull();
  });

  it('does not let a late approval cancellation reopen a manually cancelled Run', () => {
    const cancelled = reduceProjectedRun(
      undefined,
      event('run.cancelled', 'user_request', 5)
    );
    const late = reduceProjectedRun(
      cancelled,
      event('approval.cancelled', 'tool_terminal_before_dispatch', 6)
    );
    expect(late.status).toBe('cancelled');
    expect(late.terminalReason).toBe('user_request');
  });
});
