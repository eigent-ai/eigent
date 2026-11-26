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
  buildSharedSession,
  listShareableFiles,
  REMOVED,
  sharedSnapshotToEvents,
  type ShareOptions,
  type ShareSourceRun,
} from '@/lib/sessionShare/buildSharedSession';
import {
  cleanSharedString,
  prepareCleanContext,
} from '@/lib/sessionShare/cleanSharedValue';
import { describe, expect, it } from 'vitest';

import { finishedRun, runEvent } from '../sessionReplay/fixtures';

const MAC_ROOT = '/Users/alice/Spaces/q3';
const WIN_ROOT = 'C:\\Users\\alice\\Spaces\\q3';

const defaults: ShareOptions = {
  runIds: ['run-1'],
  includeToolCalls: true,
  includeThinking: false,
  includedFiles: [],
};

function sourceRun(events = finishedRun('run-1')): ShareSourceRun {
  return {
    runId: 'run-1',
    status: 'completed',
    createdAt: '2026-11-01T10:00:00Z',
    events,
  };
}

function build(
  events: ReturnType<typeof finishedRun>,
  options: Partial<ShareOptions> = {},
  spaceRoot: string | null = MAC_ROOT
) {
  return buildSharedSession({
    title: 'Q3 report',
    runs: [sourceRun(events)],
    spaceRoot,
    options: { ...defaults, ...options },
  });
}

describe('cleanSharedString', () => {
  const mac = prepareCleanContext({
    spaceRoot: MAC_ROOT,
    includeThinking: false,
  });
  const win = prepareCleanContext({
    spaceRoot: WIN_ROOT,
    includeThinking: false,
  });

  it('makes paths inside the Space folder relative', () => {
    expect(cleanSharedString(`${MAC_ROOT}/out/report.md`, mac)).toBe(
      'out/report.md'
    );
    expect(cleanSharedString(`cd ${MAC_ROOT} && ls`, mac)).toBe('cd . && ls');
    expect(cleanSharedString(`${WIN_ROOT}\\out\\report.md`, win)).toBe(
      'out\\report.md'
    );
    expect(cleanSharedString('c:/users/alice/spaces/q3/a.txt', win)).toBe(
      'a.txt'
    );
    // JSON text inside a string doubles backslashes.
    expect(
      cleanSharedString(
        '{"path":"C:\\\\Users\\\\alice\\\\Spaces\\\\q3\\\\a.txt"}',
        win
      )
    ).toBe('{"path":"a.txt"}');
  });

  it('replaces other home folders with ~', () => {
    expect(cleanSharedString('/Users/alice/.ssh/config', mac)).toBe(
      '~/.ssh/config'
    );
    expect(cleanSharedString('see /home/bob/notes.txt', mac)).toBe(
      'see ~/notes.txt'
    );
    expect(cleanSharedString('C:\\Users\\bob\\Desktop\\x.png', mac)).toBe(
      '~\\Desktop\\x.png'
    );
  });

  it('does not treat a sibling folder as the Space folder', () => {
    expect(cleanSharedString(`${MAC_ROOT}-old/a.md`, mac)).toBe(
      '~/Spaces/q3-old/a.md'
    );
  });

  it('removes credentials from free text', () => {
    const cases: Array<[string, string]> = [
      ['key sk-ant-REDACTEDREDACTED123456 used', `key ${REMOVED} used`],
      [
        'Authorization: Bearer abc.def.ghi123',
        `Authorization: Bearer ${REMOVED}`,
      ],
      ['export OPENAI_API_KEY="abc123"', `export OPENAI_API_KEY=${REMOVED}`],
      ['GITHUB_TOKEN=ghp_aaaaaaaaaaaaaaaaaaaaaaaa', `GITHUB_TOKEN=${REMOVED}`],
      [
        'https://x.test/a?token=s3cr3t&page=2',
        `https://x.test/a?token=${REMOVED}&page=2`,
      ],
      ['{"api_key": "abc"}', `{"api_key": "${REMOVED}"}`],
      ['AKIAABCDEFGHIJKLMNOP', REMOVED],
    ];
    for (const [input, expected] of cases) {
      expect(cleanSharedString(input, mac)).toBe(expected);
    }
  });

  it('removes private key blocks', () => {
    const pem =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----';
    expect(cleanSharedString(`key:\n${pem}\nend`, mac)).toBe(
      `key:\n${REMOVED}\nend`
    );
  });
});

describe('buildSharedSession', () => {
  it('keeps the conversation and replaces Run ids with position keys', () => {
    const snapshot = build(finishedRun());
    expect(snapshot.schema_version).toBe(1);
    expect(snapshot.title).toBe('Q3 report');
    expect(snapshot.runs).toHaveLength(1);
    const [run] = snapshot.runs;
    expect(run.run_key).toBe('run-1');
    expect(run.events.map((event) => event.event_type)).toEqual([
      'run.attempt_started',
      'user.message',
      'tool.completed',
      'approval.requested',
      'approval.decided',
      'assistant.final',
      'run.completed',
    ]);
    expect(run.events[1].event_id).toBe('run-1:2');
  });

  it('only includes the chosen Runs', () => {
    const snapshot = buildSharedSession({
      title: 'Two runs',
      runs: [
        sourceRun(),
        {
          runId: 'run-secret',
          status: 'completed',
          createdAt: null,
          events: finishedRun('run-secret'),
        },
      ],
      spaceRoot: null,
      options: defaults,
    });
    expect(snapshot.runs).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toContain('run-secret');
  });

  it('drops raw model traffic and device-only events', () => {
    const snapshot = build([
      runEvent('user.message', { content: 'hi' }, 1),
      runEvent(
        'model.invocation.started',
        {
          request: { messages: [{ role: 'system', content: 'secret prompt' }] },
        },
        2
      ),
      runEvent('model.invocation.completed', { response: 'raw' }, 3),
      runEvent('run.environment_resolved', { local_path: '/Users/alice' }, 4),
      runEvent('execution.lease_acquired', {}, 5),
      runEvent('workspace.writer.acquired', { waited: true }, 6),
      runEvent('step.created', {}, 7, { legacyStep: 'request_usage' }),
      runEvent('assistant.final', { content: 'bye' }, 8),
    ]);
    const types = snapshot.runs[0].events.map((event) => event.event_type);
    expect(types).toEqual(['user.message', 'assistant.final']);
    expect(JSON.stringify(snapshot)).not.toContain('secret prompt');
  });

  it('leaves out tool calls when they are turned off', () => {
    const snapshot = build(
      [
        ...finishedRun(),
        runEvent('terminal.output', { output: 'ls' }, 8),
        runEvent('step.created', { content: 'x' }, 9, {
          legacyStep: 'activate_toolkit',
        }),
      ],
      { includeToolCalls: false }
    );
    const types = snapshot.runs[0].events.map((event) => event.event_type);
    expect(types).not.toContain('tool.completed');
    expect(types).not.toContain('terminal.output');
    expect(types).toContain('assistant.final');
    expect(snapshot.included.tool_calls).toBe(false);
  });

  it('leaves out thinking unless it is included', () => {
    const events = [
      runEvent(
        'assistant.final',
        {
          content: 'answer',
          reasoning_content: 'private chain',
          thinking: 'x',
        },
        1
      ),
    ];
    const without = build(events);
    expect(without.runs[0].events[0].payload).toEqual({ content: 'answer' });
    const withThinking = build(events, { includeThinking: true });
    expect(withThinking.runs[0].events[0].payload).toMatchObject({
      reasoning_content: 'private chain',
    });
  });

  it('removes credential fields and environment values', () => {
    const snapshot = build([
      runEvent(
        'tool.completed',
        {
          tool_name: 'http',
          request: {
            headers: { Authorization: 'Bearer zzz', Accept: 'text/html' },
            api_key: 'abc',
            env: { OPENAI_API_KEY: 'sk-live', HOME: '/Users/alice' },
          },
          password: '',
          max_tokens: 100,
        },
        1
      ),
    ]);
    const payload = snapshot.runs[0].events[0].payload as {
      request: Record<string, unknown>;
      password: unknown;
      max_tokens: unknown;
    };
    expect(payload.request.headers).toEqual({
      Accept: 'text/html',
      Authorization: REMOVED,
    });
    expect(payload.request.api_key).toBe(REMOVED);
    expect(payload.request.env).toEqual({
      HOME: REMOVED,
      OPENAI_API_KEY: REMOVED,
    });
    expect(payload.password).toBe('');
    expect(payload.max_tokens).toBe(100);
  });

  it('shares file contents only for chosen files, by relative path', () => {
    const events = [
      runEvent(
        'artifact.created',
        { path: `${MAC_ROOT}/out/report.md`, content: '# Report' },
        1
      ),
      runEvent(
        'artifact.created',
        { path: `${MAC_ROOT}/out/notes.md`, content: 'private notes' },
        2
      ),
    ];
    expect(listShareableFiles([sourceRun(events)], MAC_ROOT)).toEqual([
      'out/notes.md',
      'out/report.md',
    ]);
    const snapshot = build(events, { includedFiles: ['out/report.md'] });
    const [report, notes] = snapshot.runs[0].events;
    expect(report.payload).toEqual({
      content: '# Report',
      path: 'out/report.md',
    });
    expect(notes.payload).toEqual({ path: 'out/notes.md' });
    expect(snapshot.included.files).toEqual(['out/report.md']);
  });

  it('never contains the Space folder, the home folder or the user name', () => {
    const events = [
      runEvent(
        'user.message',
        {
          content: `Summarise ${MAC_ROOT}/data.csv`,
          attachments: [{ file_path: `${MAC_ROOT}/data.csv` }],
        },
        1
      ),
      runEvent(
        'tool.completed',
        { display_output: 'wrote /Users/alice/Downloads/x.pdf' },
        2
      ),
    ];
    const text = JSON.stringify(build(events));
    expect(text).not.toContain('/Users/');
    expect(text).not.toContain('alice');
  });

  it('is stable for the same input', () => {
    const first = JSON.stringify(build(finishedRun()));
    const second = JSON.stringify(build(finishedRun()));
    expect(second).toBe(first);
  });

  it('round-trips into projector events for the preview', () => {
    const snapshot = build(finishedRun());
    const events = sharedSnapshotToEvents(snapshot, 'preview');
    expect(events).toHaveLength(snapshot.runs[0].events.length);
    expect(events[1]).toMatchObject({
      projectId: 'preview',
      runId: 'run-1',
      runSequence: 2,
      eventType: 'user.message',
    });
  });
});
