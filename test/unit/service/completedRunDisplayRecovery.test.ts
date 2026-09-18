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

import { recoverCompletedRunDisplay } from '@/service/completedRunDisplayRecovery';
import type { TerminalDisplayEvent } from '@/service/runUsageReconciliation';
import { TaskStatus } from '@/types/constants';
import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import completedDisplayFixture from '../../fixtures/completed-run-display.json';

type DisplayState = Parameters<typeof recoverCompletedRunDisplay>[0];
const empty = (): DisplayState => ({
  taskAssigning: [],
  taskRunning: [],
  taskInfo: [],
});
const receipt = (
  step: string,
  payload: Record<string, unknown>,
  eventId = step
): TerminalDisplayEvent => ({ eventId, step, payload });
const task = (overrides: Partial<TaskInfo> = {}): TaskInfo => ({
  id: 'sub-1',
  content: 'Original task',
  status: TaskStatus.RUNNING,
  ...overrides,
});
const stateWith = (existing: TaskInfo): DisplayState => ({
  taskAssigning: [
    {
      agent_id: 'agent-1',
      name: 'Developer',
      type: 'developer_agent',
      status: 'running',
      tasks: [existing],
      log: [],
    },
  ],
  taskRunning: [existing],
  taskInfo: [existing],
});
const allTasks = (state: DisplayState) => [
  ...state.taskInfo,
  ...state.taskRunning,
  ...state.taskAssigning.flatMap((agent) => agent.tasks),
];

describe('recoverCompletedRunDisplay', () => {
  it('keeps internal workers hidden even when a later assignment refers to their id', () => {
    const hidden = [
      'mcp_agent',
      'new_worker_agent',
      'task_agent',
      'task_summary_agent',
      'coordinator_agent',
      'question_confirm_agent',
    ];
    const events = hidden.flatMap((name) => [
      receipt(
        'create_agent',
        { agent_id: name, agent_name: name },
        `${name}:created`
      ),
      receipt(
        'assign_task',
        {
          assignee_id: name,
          task_id: `${name}:task`,
          content: 'Internal work',
        },
        `${name}:assigned`
      ),
    ]);
    events.push(
      receipt(
        'create_agent',
        { agent_id: 'visible', agent_name: 'developer_agent' },
        'visible'
      )
    );
    const result = recoverCompletedRunDisplay(empty(), events);
    expect(result.taskAssigning).toHaveLength(1);
    expect(result.taskAssigning[0]).toMatchObject({
      agent_id: 'visible',
      name: i18next.t('chat.developer-agent', {
        defaultValue: 'Developer agent',
      }),
      type: 'developer_agent',
    });
  });
  it('recovers real typed assignments, redacted reports and tool results from initially absent structure', () => {
    const events = completedDisplayFixture.events
      .filter((item) =>
        [
          'create_agent',
          'assign_task',
          'task_state',
          'deactivate_toolkit',
        ].includes(item.legacy_step || '')
      )
      .map((item) => receipt(item.legacy_step!, item.payload, item.event_id));
    const current = empty();
    const recovered = recoverCompletedRunDisplay(current, events);
    expect(current).toEqual(empty());
    expect(recovered.taskAssigning).toHaveLength(1);
    expect(recovered.taskAssigning[0]).toMatchObject({
      agent_id: 'agent-1',
      name: 'Developer Agent',
      status: 'completed',
    });
    expect(recovered.taskAssigning[0].tasks).toHaveLength(1);
    for (const item of allTasks(recovered)) {
      expect(item).toMatchObject({
        id: 'sub-1',
        content: 'Create the report',
        status: TaskStatus.COMPLETED,
        failure_count: 1,
        agent: { agent_id: 'agent-1', tasks: [], status: 'completed' },
        report:
          'Report ready\n  Validation passed.\nSaved <device-home>/private/report.md\ntoken=[REDACTED]',
        reportTruncated: false,
        toolkits: [
          {
            toolkitName: 'terminal',
            toolkitMethods: 'shell_exec',
            message: 'Validation passed.',
            toolkitStatus: 'completed',
          },
        ],
      });
    }
    expect(recoverCompletedRunDisplay(recovered, events)).toEqual(recovered);
  });

  it('restores task-to-agent navigation with a non-circular snapshot when existing tasks lack their agent', () => {
    const current = stateWith(task({ agent: undefined }));
    const result = recoverCompletedRunDisplay(current, [
      receipt('assign_task', {
        task_id: 'sub-1',
        assignee_id: 'agent-1',
        content: 'Original task',
      }),
    ]);
    for (const item of allTasks(result)) {
      expect(item.agent).toMatchObject({
        agent_id: 'agent-1',
        name: 'Developer',
        status: 'completed',
        tasks: [],
      });
      expect(item.agent).not.toBe(result.taskAssigning[0]);
    }
    expect(result.taskAssigning[0].tasks).toHaveLength(1);
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(current.taskInfo[0].agent).toBeUndefined();
  });

  it.each([false, true])(
    'preserves existing complete reports and their own truncation flag (flag present: %s)',
    (withFlag) => {
      const existing = task({
        report: 'Complete multiline report\nAll verification evidence',
        ...(withFlag ? { reportTruncated: false } : {}),
      });
      const current = stateWith(existing);
      const before = structuredClone(current);
      const result = recoverCompletedRunDisplay(current, [
        receipt('task_state', {
          task_id: 'sub-1',
          status: 'completed',
          semantic: {},
          display_output: 'Shorter recovered excerpt',
          display_output_truncated: true,
        }),
      ]);
      expect(current).toEqual(before);
      for (const item of allTasks(result)) {
        expect(item.report).toBe(existing.report);
        expect(item.reportTruncated).toBe(withFlag ? false : undefined);
        expect(Object.hasOwn(item, 'reportTruncated')).toBe(withFlag);
      }
    }
  );

  it.each(['Excerpt', 'Excerpt…'])(
    'marks an actually recovered truncated report without duplicating its ellipsis: %s',
    (output) => {
      const result = recoverCompletedRunDisplay(stateWith(task()), [
        receipt('task_state', {
          task_id: 'sub-1',
          status: 'completed',
          display_output: output,
          display_output_truncated: true,
        }),
      ]);
      for (const item of allTasks(result)) {
        expect(item.report).toBe('Excerpt…');
        expect(item.reportTruncated).toBe(true);
      }
    }
  );

  it('supports legacy result/content/state but never invents an old typed report from display_summary or raw fields', () => {
    const result = recoverCompletedRunDisplay(empty(), [
      receipt(
        'task_state',
        {
          task_id: 'legacy',
          content: 'Legacy content',
          state: 'DONE',
          result: 'Legacy report',
        },
        'legacy'
      ),
      receipt(
        'task_state',
        {
          task_id: 'old-typed',
          display_input: 'Typed content',
          status: 'completed',
          semantic: {},
          display_summary: 'Subtask completed',
          result: 'Not a typed display field',
        },
        'typed'
      ),
      receipt(
        'task_state',
        {
          task_id: 'new-typed',
          status: 'failed',
          semantic: {},
          display_output: 'token=[REDACTED]',
          result: 'token=secret',
        },
        'new'
      ),
    ]);
    expect(result.taskInfo).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'legacy',
          content: 'Legacy content',
          status: TaskStatus.COMPLETED,
          report: 'Legacy report',
        }),
        expect.objectContaining({
          id: 'old-typed',
          content: 'Typed content',
          status: TaskStatus.COMPLETED,
        }),
        expect.objectContaining({
          id: 'new-typed',
          status: TaskStatus.FAILED,
          report: 'token=[REDACTED]',
        }),
      ])
    );
    expect(
      result.taskInfo.find((item) => item.id === 'old-typed')?.report
    ).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('token=secret');
    expect(JSON.stringify(result)).not.toContain('Not a typed display field');
  });

  it('deduplicates toolkit receipts and preserves existing input without appending it twice', () => {
    const existing = task({
      toolkits: [
        {
          toolkitName: 'terminal',
          toolkitMethods: 'shell_exec',
          message: 'npm test',
          toolkitStatus: 'running',
        },
      ],
    });
    const current = stateWith(existing);
    const output = {
      process_task_id: 'sub-1',
      toolkit_name: 'terminal',
      method_name: 'shell_exec',
      message: 'Tests passed',
    };
    const events = [
      receipt('deactivate_toolkit', output, 'one'),
      receipt('deactivate_toolkit', output, 'two'),
      receipt('deactivate_toolkit', output, 'one'),
    ];
    const result = recoverCompletedRunDisplay(current, events);
    for (const item of allTasks(result))
      expect(item.toolkits).toEqual([
        {
          toolkitName: 'terminal',
          toolkitMethods: 'shell_exec',
          message: 'npm test\nTests passed',
          toolkitStatus: 'completed',
        },
      ]);
    expect(current.taskInfo[0].toolkits?.[0].message).toBe('npm test');
    expect(recoverCompletedRunDisplay(result, events)).toEqual(result);
    const withoutInput = recoverCompletedRunDisplay(empty(), [
      receipt('assign_task', {
        task_id: 'sub-1',
        assignee_id: 'agent-1',
        content: 'Task',
      }),
      ...events,
    ]);
    for (const item of allTasks(withoutInput))
      expect(item.toolkits).toHaveLength(1);
  });

  it('settles an existing same-output tool receipt and uses only redacted typed output', () => {
    const current = stateWith(
      task({
        toolkits: [
          {
            toolkitName: 'terminal',
            toolkitMethods: 'shell_exec',
            message: 'token=[REDACTED]',
            toolkitStatus: 'running',
          },
        ],
      })
    );
    const result = recoverCompletedRunDisplay(current, [
      receipt('deactivate_toolkit', {
        process_task_id: 'sub-1',
        toolkit_name: 'terminal',
        method_name: 'shell_exec',
        semantic: {},
        display_output: 'token=[REDACTED]',
        message: 'token=secret',
      }),
      receipt(
        'deactivate_toolkit',
        {
          process_task_id: 'sub-1',
          toolkit_name: 'old',
          method_name: 'tool',
          semantic: {},
          message: 'No safe display',
        },
        'old'
      ),
    ]);
    for (const item of allTasks(result))
      expect(item.toolkits).toEqual([
        {
          toolkitName: 'terminal',
          toolkitMethods: 'shell_exec',
          message: 'token=[REDACTED]',
          toolkitStatus: 'completed',
        },
      ]);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('No safe display');
  });

  it('merges terminal, file and notice facts idempotently without executing any control projection', () => {
    const events = [
      receipt('terminal', {
        process_task_id: 'sub-1',
        output: 'All tests passed',
      }),
      receipt('write_file', {
        process_task_id: 'sub-1',
        relative_path: 'output/report.md',
      }),
      receipt('notice', { process_task_id: 'sub-1', notice: 'Report saved' }),
      receipt('new_task_state', { task_id: 'sub-2', content: 'Never execute' }),
      receipt('activate_toolkit', {
        process_task_id: 'sub-1',
        toolkit_name: 'terminal',
        method_name: 'shell_exec',
        message: 'Never run',
      }),
    ];
    const result = recoverCompletedRunDisplay(empty(), events);
    expect(result.taskInfo).toHaveLength(1);
    expect(result.taskInfo[0]).toMatchObject({
      id: 'sub-1',
      status: TaskStatus.SKIPPED,
      terminal: ['All tests passed'],
      fileList: [
        {
          name: 'report.md',
          path: 'output/report.md',
          relativePath: 'output/report.md',
          localPathAvailable: false,
        },
      ],
      toolkits: [
        {
          toolkitName: 'notice',
          message: 'Report saved',
          toolkitStatus: 'completed',
        },
      ],
    });
    expect(recoverCompletedRunDisplay(result, events)).toEqual(result);
  });

  it('projects unfinished todos as skipped and never starts agents or task execution', () => {
    const current = stateWith(
      task({ status: TaskStatus.COMPLETED, report: 'Done' })
    );
    const result = recoverCompletedRunDisplay(current, [
      receipt('todo_state', {
        agent_id: 'agent-1',
        todos: [
          { id: 'sub-1', content: 'Original task', status: 'in_progress' },
          { id: 'sub-2', content: 'Not executed', status: 'pending' },
          { id: 'sub-3', content: 'Finished', status: 'completed' },
        ],
      }),
    ]);
    expect(result.taskAssigning[0].status).toBe('completed');
    for (const item of allTasks(result))
      expect(item.agent?.agent_id).toBe('agent-1');
    expect(result.taskInfo.map((item) => item.status)).toEqual([
      TaskStatus.COMPLETED,
      TaskStatus.SKIPPED,
      TaskStatus.COMPLETED,
    ]);
    for (const item of allTasks(result))
      expect(item.status).not.toBe(TaskStatus.RUNNING);
    expect(recoverCompletedRunDisplay(result, [])).toBe(result);
  });
});
