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
  describe('Single Agent event-time ownership', () => {
    const plan = (
      first: string,
      second: string,
      eventId: string,
      agent = 'single-1'
    ) =>
      receipt(
        'todo_state',
        {
          task_id: 'run-1',
          agent_id: agent,
          todos: [
            { id: `${agent}:one`, content: 'First task', status: first },
            { id: `${agent}:two`, content: 'Second task', status: second },
          ],
        },
        eventId
      );
    const result = (
      step: string,
      payload: Record<string, unknown>,
      id: string
    ) => receipt(step, { process_task_id: 'run-1', ...payload }, id);

    it('routes legacy results from each raw Todo snapshot without displaying running tasks', () => {
      const events = [
        plan('in_progress', 'pending', 'one'),
        result(
          'deactivate_toolkit',
          {
            agent_name: 'Agents.single_agent',
            toolkit_name: 'terminal',
            method_name: 'shell_exec',
            message: 'First output',
          },
          'tool-one'
        ),
        result('terminal', { output: 'First terminal' }, 'terminal-one'),
        plan('completed', 'running', 'two'),
        result('write_file', { relative_path: 'second.txt' }, 'file-two'),
        result('notice', { notice: 'Second notice' }, 'notice-two'),
        result(
          'deactivate_toolkit',
          {
            semantic: {},
            toolkit_name: 'terminal',
            tool_name: 'shell_exec',
            display_output: 'Second output',
          },
          'tool-two'
        ),
        plan('completed', 'completed', 'done'),
      ];
      const recovered = recoverCompletedRunDisplay(empty(), events, 'run-1');
      expect(recovered.taskRunning.map((item) => item.id)).toEqual([
        'single-1:one',
        'single-1:two',
      ]);
      expect(recovered.taskRunning[0]).toMatchObject({
        status: 'completed',
        terminal: ['First terminal'],
        toolkits: [{ message: 'First output' }],
      });
      expect(recovered.taskRunning[1]).toMatchObject({
        status: 'completed',
        fileList: [{ path: 'second.txt' }],
        toolkits: [{ message: 'Second notice' }, { message: 'Second output' }],
      });
      expect(recoverCompletedRunDisplay(recovered, events, 'run-1')).toEqual(
        recovered
      );
    });

    it('uses authored Step for a late typed completion and does not replay its legacy echo into the next Todo', () => {
      const events = [
        plan('running', 'pending', 'one'),
        receipt(
          'step.created',
          {
            step: {
              step_id: 'step-one',
              plan_item_id: 'single-1:one',
              owner: { kind: 'single_agent', agent_id: 'single-1' },
            },
          },
          'step'
        ),
        plan('completed', 'in_progress', 'two'),
        result(
          'deactivate_toolkit',
          {
            step_id: 'step-one',
            tool_call_id: 'call-one',
            semantic: {},
            toolkit_name: 'terminal',
            tool_name: 'shell_exec',
            display_output: 'Safe checkpoint',
          },
          'checkpoint'
        ),
        result(
          'deactivate_toolkit',
          {
            tool_call_id: 'call-one',
            agent_name: 'single_agent',
            toolkit_name: 'terminal',
            method_name: 'shell_exec',
            message: 'Raw legacy echo',
          },
          'echo'
        ),
        plan('completed', 'completed', 'done'),
      ];
      const recovered = recoverCompletedRunDisplay(empty(), events, 'run-1');
      expect(recovered.taskRunning[0].toolkits).toEqual([
        {
          toolkitName: 'terminal',
          toolkitMethods: 'shell_exec',
          toolkitStatus: 'completed',
          message: 'Safe checkpoint',
        },
      ]);
      expect(recovered.taskRunning[1].toolkits).toBeUndefined();
      expect(JSON.stringify(recovered)).not.toContain('Raw legacy echo');
      expect(recoverCompletedRunDisplay(recovered, events, 'run-1')).toEqual(
        recovered
      );
    });

    it('does not guess ownership before a plan, for foreign Run/Agent, or when no unique active Todo exists', () => {
      const tool = (payload: Record<string, unknown>, id: string) =>
        result(
          'deactivate_toolkit',
          {
            toolkit_name: 'terminal',
            method_name: 'shell_exec',
            message: 'Must not attach',
            ...payload,
          },
          id
        );
      const events = [
        tool({}, 'before-plan'),
        plan('running', 'pending', 'one'),
        tool({ agent_id: 'foreign-agent' }, 'foreign-agent'),
        tool(
          { process_task_id: 'foreign-run', agent_name: 'single_agent' },
          'foreign-run'
        ),
        tool(
          { run_id: 'foreign-run', process_task_id: 'single-1:one' },
          'foreign-direct'
        ),
        tool({ step_id: 'unknown-step' }, 'unknown-step'),
        plan('running', 'running', 'ambiguous'),
        tool({}, 'two-active'),
        plan('completed', 'completed', 'done'),
        tool({}, 'none-active'),
      ];
      const recovered = recoverCompletedRunDisplay(empty(), events, 'run-1');
      expect(recovered.taskRunning).toHaveLength(2);
      expect(allTasks(recovered).every((item) => !item.toolkits?.length)).toBe(
        true
      );
      expect(recoverCompletedRunDisplay(recovered, events, 'run-1')).toEqual(
        recovered
      );
    });

    it('requires an explicit matching owner when several Single Agents share a Run', () => {
      const events = [
        plan('running', 'pending', 'plan-a', 'single-a'),
        plan('running', 'pending', 'plan-b', 'single-b'),
        result('terminal', { output: 'Ambiguous' }, 'ambiguous'),
        result('terminal', { agent_id: 'single-b', output: 'B only' }, 'owned'),
        result(
          'notice',
          {
            process_task_id: 'single-a:one',
            agent_id: 'single-b',
            notice: 'Wrong owner',
          },
          'wrong-direct'
        ),
      ];
      const recovered = recoverCompletedRunDisplay(empty(), events, 'run-1');
      expect(
        recovered.taskRunning.find((item) => item.id === 'single-b:one')
          ?.terminal
      ).toEqual(['B only']);
      expect(
        recovered.taskRunning.find((item) => item.id === 'single-a:one')
          ?.terminal
      ).toBeUndefined();
      expect(JSON.stringify(recovered)).not.toContain('Wrong owner');
      expect(JSON.stringify(recovered)).not.toContain('Ambiguous');
    });
  });
  describe('retry and reassignment display ownership', () => {
    const retryEvents = (owner = 'agent-1', withOutput = true) => [
      receipt(
        'create_agent',
        { agent_id: 'agent-1', agent_name: 'developer_agent' },
        'created-a'
      ),
      receipt(
        'create_agent',
        { agent_id: 'agent-2', agent_name: 'browser_agent' },
        'created-b'
      ),
      receipt(
        'assign_task',
        {
          task_id: 'sub-1',
          assignee_id: 'agent-1',
          status: 'running',
          failure_count: 0,
        },
        'assigned-a'
      ),
      receipt(
        'deactivate_toolkit',
        {
          process_task_id: 'sub-1',
          toolkit_name: 'terminal',
          method_name: 'shell_exec',
          message: 'First attempt failed',
        },
        'old-tool'
      ),
      receipt(
        'task_state',
        {
          task_id: 'sub-1',
          status: 'failed',
          failure_count: 1,
          semantic: {},
          display_output: 'Failure excerpt',
        },
        'failed-a'
      ),
      receipt(
        'assign_task',
        {
          task_id: 'sub-1',
          assignee_id: owner,
          status: 'running',
          failure_count: 1,
        },
        'assigned-retry'
      ),
      receipt(
        'deactivate_toolkit',
        {
          process_task_id: 'sub-1',
          toolkit_name: 'terminal',
          method_name: 'shell_exec',
          message: 'Retry passed',
        },
        'new-tool'
      ),
      receipt(
        'task_state',
        {
          task_id: 'sub-1',
          status: 'completed',
          failure_count: 1,
          semantic: {},
          ...(withOutput
            ? {
                display_output: 'Successful retry',
                display_output_truncated: true,
              }
            : {}),
        },
        'completed-retry'
      ),
    ];
    const failedCurrent = () => {
      const current = stateWith(
        task({
          status: TaskStatus.FAILED,
          failure_count: 1,
          report: 'Full previous failure report',
          reportTruncated: false,
        })
      );
      const agent = {
        ...current.taskAssigning[0],
        status: 'failed' as const,
        tasks: [],
      };
      for (const item of allTasks(current)) item.agent = agent;
      current.taskAssigning[0].status = 'failed';
      return current;
    };

    it.each(['agent-1', 'agent-2'])(
      'replaces an old failure report and owner after retry on %s',
      (owner) => {
        const current = failedCurrent();
        const before = structuredClone(current);
        const events = retryEvents(owner);
        const result = recoverCompletedRunDisplay(current, events);
        expect(current).toEqual(before);
        for (const item of [...result.taskInfo, ...result.taskRunning]) {
          expect(item).toMatchObject({
            status: TaskStatus.COMPLETED,
            report: 'Successful retry…',
            reportTruncated: true,
            failure_count: 1,
            agent: { agent_id: owner, tasks: [] },
          });
          expect(item.reAssignTo).toBeUndefined();
        }
        const latestAgent = result.taskAssigning.find(
          (agent) => agent.agent_id === owner
        )!;
        expect(latestAgent.status).toBe('completed');
        expect(latestAgent.tasks[0]).toMatchObject({
          status: TaskStatus.COMPLETED,
          report: 'Successful retry…',
          agent: { agent_id: owner },
        });
        expect(latestAgent.tasks[0].toolkits).toEqual([
          {
            toolkitName: 'terminal',
            toolkitMethods: 'shell_exec',
            toolkitStatus: 'completed',
            message: 'Retry passed',
          },
        ]);
        if (owner === 'agent-2') {
          expect(result.taskAssigning[0].tasks[0]).toMatchObject({
            status: TaskStatus.FAILED,
            report: 'Full previous failure report',
            reAssignTo: latestAgent.name,
            agent: { agent_id: 'agent-1' },
          });
        }
        expect(() => JSON.stringify(result)).not.toThrow();
        expect(recoverCompletedRunDisplay(result, events)).toEqual(result);
      }
    );

    it('retains per-agent historical failure when reconstructing a reassignment from empty state', () => {
      const result = recoverCompletedRunDisplay(
        empty(),
        retryEvents('agent-2')
      );
      const [first, second] = result.taskAssigning;
      expect(first.tasks[0]).toMatchObject({
        status: TaskStatus.FAILED,
        report: 'Failure excerpt',
        reAssignTo: second.name,
        agent: { agent_id: 'agent-1' },
      });
      expect(second.tasks[0]).toMatchObject({
        status: TaskStatus.COMPLETED,
        report: 'Successful retry…',
        agent: { agent_id: 'agent-2' },
      });
      expect(first.tasks[0]).not.toBe(second.tasks[0]);
    });

    it.each([0, 1])(
      'uses failure_count to replace old success but preserve this successful attempt (existing count %s)',
      (count) => {
        const current = failedCurrent();
        for (const item of allTasks(current)) {
          item.status = TaskStatus.COMPLETED;
          item.failure_count = count;
          item.report = 'Full successful report';
        }
        const result = recoverCompletedRunDisplay(current, retryEvents());
        for (const item of allTasks(result)) {
          expect(item.report).toBe(
            count === 0 ? 'Successful retry…' : 'Full successful report'
          );
          expect(item.reportTruncated).toBe(count === 0);
        }
      }
    );

    it('clears the old failure rather than inventing a successful report for typed history without output', () => {
      const result = recoverCompletedRunDisplay(
        failedCurrent(),
        retryEvents('agent-1', false)
      );
      for (const item of allTasks(result)) {
        expect(item.status).toBe(TaskStatus.COMPLETED);
        expect(item.report).toBeUndefined();
        expect(item.reportTruncated).toBeUndefined();
      }
    });

    it.each([TaskStatus.RUNNING, TaskStatus.SKIPPED])(
      'replaces a retained failure report while the same-count retry is %s',
      (status) => {
        const current = failedCurrent();
        for (const item of allTasks(current)) item.status = status;
        const result = recoverCompletedRunDisplay(current, retryEvents());
        for (const item of allTasks(result))
          expect(item).toMatchObject({
            status: TaskStatus.COMPLETED,
            failure_count: 1,
            report: 'Successful retry…',
            reportTruncated: true,
          });
      }
    );

    it('restores the current owner when reassignment returns to an earlier agent', () => {
      const events = retryEvents('agent-2');
      events[events.length - 1].payload = {
        task_id: 'sub-1',
        status: 'failed',
        failure_count: 2,
        semantic: {},
        display_output: 'Second failure',
      };
      events.push(
        receipt(
          'assign_task',
          {
            task_id: 'sub-1',
            assignee_id: 'agent-1',
            failure_count: 2,
            status: 'running',
          },
          'back-to-a'
        ),
        receipt(
          'task_state',
          {
            task_id: 'sub-1',
            failure_count: 2,
            status: 'completed',
            semantic: {},
            display_output: 'Final A report',
          },
          'final-a'
        )
      );
      const result = recoverCompletedRunDisplay(empty(), events);
      expect(result.taskAssigning[0].tasks).toHaveLength(1);
      expect(result.taskAssigning[0].tasks[0]).toMatchObject({
        status: TaskStatus.COMPLETED,
        report: 'Final A report',
        agent: { agent_id: 'agent-1' },
      });
      expect(result.taskAssigning[0].tasks[0].reAssignTo).toBeUndefined();
      expect(result.taskAssigning[1].tasks[0]).toMatchObject({
        status: TaskStatus.FAILED,
        report: 'Second failure',
        reAssignTo: result.taskAssigning[0].name,
        agent: { agent_id: 'agent-2' },
      });
      expect(recoverCompletedRunDisplay(result, events)).toEqual(result);
    });
  });
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
        status: TaskStatus.COMPLETED,
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
