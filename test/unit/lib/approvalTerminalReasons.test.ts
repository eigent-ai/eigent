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
  approvalRecordedReason,
  interruptedRunDescription,
} from '@/lib/approvalPresentation';
import { normalizeLocalRunEvent } from '@/lib/projector';
import { adaptChatProjectionEvent } from '@/lib/projector/chat';
import { toTimelineCall } from '@/lib/projector/chat/presentation/timelineCalls';
import { reduceProjectedRun } from '@/lib/projector/reduce';
import { mergeRunSummary } from '@/lib/projector/runSummary';
import {
  RUN_TERMINAL_REASONS,
  runTerminalReason,
  runTerminalReasonText,
} from '@/lib/runTerminalReason';
import i18next from 'i18next';
import { describe, expect, it } from 'vitest';

import enChat from '@/i18n/locales/en-us/chat.json';

const event = (
  type: string,
  reason: string,
  sequence = 1,
  cause?: { terminal_reason: string; terminal_detail: string | null }
) =>
  normalizeLocalRunEvent(
    {
      event_id: `event-${sequence}`,
      run_id: 'run-1',
      sequence,
      run_version: sequence,
      event_type: type,
      payload: { approval_id: 'approval-1', reason, ...cause },
      created_at: sequence,
    },
    'project-1'
  );

const t = i18next.t.bind(i18next);

describe('durable approval terminal reasons', () => {
  it.each([
    ['approval.expired_rejected', 'tool_approval_expired', 'approval_expired'],
    ['approval.cancelled', 'tool_terminal_before_dispatch', 'runtime_lost'],
  ])(
    'projects the recorded cause of %s and keeps its raw reason out of Normal copy',
    (type, reason, terminalReason) => {
      const fact = event(type, reason, 1, {
        terminal_reason: terminalReason,
        terminal_detail: reason,
      });
      const run = reduceProjectedRun(undefined, fact);
      expect(run).toMatchObject({
        status: 'interrupted',
        terminalReason,
        terminalDetail: reason,
      });
      const projected = adaptChatProjectionEvent(fact);
      const node = projected.kind === 'display' ? projected.node : null;
      expect(node).toMatchObject({
        kind: 'interaction',
        reason,
        terminalReason,
      });
      if (!node) throw new Error('Missing receipt');
      const call = toTimelineCall({
        kind: 'node',
        id: node.id,
        runSequence: node.runSequence,
        node,
      });
      expect(call?.detail).toBe(
        runTerminalReasonText(runTerminalReason(terminalReason), t)
      );
      expect(call?.detail).not.toContain(reason);
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

  it('localizes every closed reason and nothing outside it', () => {
    for (const reason of RUN_TERMINAL_REASONS) {
      expect(enChat).toHaveProperty(`run-terminal-reason-${reason}`);
      expect(runTerminalReasonText(reason, t)).toBe(
        enChat[`run-terminal-reason-${reason}` as keyof typeof enChat]
      );
    }
    for (const raw of [
      'runtime.interrupted',
      'run_terminal:cancelled',
      'human_interaction_expired',
      'failed',
    ]) {
      expect(runTerminalReason(raw)).toBeNull();
    }
  });

  it('names the closed cause in the interrupted banner and never a raw reason', () => {
    const generic = t('chat.run-interrupted-description');
    expect(interruptedRunDescription(null, t)).toBe(generic);
    for (const reason of RUN_TERMINAL_REASONS) {
      expect(interruptedRunDescription(reason, t)).toBe(
        `${runTerminalReasonText(reason, t)} ${generic}`
      );
    }
    expect(interruptedRunDescription('approval_expired', t)).toContain(
      'requests new approval when needed'
    );
    expect(approvalRecordedReason('worker_cancelled', t)).toBe(
      'Recorded reason: worker_cancelled'
    );
  });

  it('takes the cause from the Run summary and clears it on Resume', () => {
    const run = mergeRunSummary(undefined, {
      run_id: 'run-1',
      project_id: 'project-1',
      status: 'interrupted',
      version: 4,
      updated_at: 100,
      terminal_reason: 'approval_expired',
      terminal_detail: 'approval_expired',
      latest_attempt: { attempt_number: 1, status: 'interrupted' },
    });
    expect(run).toMatchObject({
      terminalReason: 'approval_expired',
      terminalDetail: 'approval_expired',
    });
    expect(
      reduceProjectedRun(
        run,
        event('run.attempt_created', 'explicit_resume', 5)
      )
    ).toMatchObject({ terminalReason: null, terminalDetail: null });
  });

  it('treats an unknown or legacy summary cause as unknown', () => {
    for (const terminal_reason of [null, 'runtime.interrupted']) {
      expect(
        mergeRunSummary(undefined, {
          run_id: 'run-1',
          project_id: 'project-1',
          status: 'interrupted',
          version: 5,
          updated_at: 200,
          terminal_reason,
          terminal_detail: null,
        })?.terminalReason
      ).toBeNull();
    }
  });

  it('keeps the first cause while the Run stays stopped, as the Brain does', () => {
    const expired = reduceProjectedRun(
      undefined,
      event('approval.expired_rejected', 'approval_expired', 3, {
        terminal_reason: 'approval_expired',
        terminal_detail: 'approval_expired',
      })
    );
    const restarted = reduceProjectedRun(
      expired,
      event('runtime.interrupted', 'brain_restart', 4, {
        terminal_reason: 'brain_restart',
        terminal_detail: 'brain_restart',
      })
    );
    expect(restarted).toMatchObject({
      status: 'interrupted',
      terminalReason: 'approval_expired',
    });
  });

  it('projects a reached deadline as timed_out with its recorded detail', () => {
    expect(
      reduceProjectedRun(
        undefined,
        event('run.deadline_reached', 'persisted_run_deadline_reached', 2, {
          terminal_reason: 'deadline_exceeded',
          terminal_detail: 'persisted_run_deadline_reached',
        })
      )
    ).toMatchObject({
      status: 'timed_out',
      terminalReason: 'deadline_exceeded',
      terminalDetail: 'persisted_run_deadline_reached',
    });
  });

  it('does not let a late approval cancellation reopen a manually cancelled Run', () => {
    const cancelled = reduceProjectedRun(
      undefined,
      event('run.cancelled', 'explicit_cancel', 5, {
        terminal_reason: 'user_cancelled',
        terminal_detail: 'explicit_cancel',
      })
    );
    const late = reduceProjectedRun(
      cancelled,
      event('approval.cancelled', 'tool_terminal_before_dispatch', 6)
    );
    expect(late.status).toBe('cancelled');
    expect(late.terminalReason).toBe('user_cancelled');
  });
});
