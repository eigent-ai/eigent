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
  cancelSessionExecution,
  createSessionMessageIntent,
  fetchExecutionArtifacts,
  fetchSessionExecutionRoute,
  fetchSessionExecutions,
  readExecutionArtifact,
  sendSessionExecutionNow,
} from '@/service/executionApi';
import { hydrateProjectEventStore } from '@/service/projectEventStoreHydration';
import {
  createWorkspaceSessionDraft,
  sessionMessageConfiguration,
  submitSessionMessage,
  submitWorkspaceSessionDraft,
} from '@/service/sessionMessage';
import { useAuthStore } from '@/store/authStore';
import { setConnectionConfig } from '@/store/connectionStore';
import { getProjectEventStore } from '@/store/projectEventStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useProjectStore } from '@/store/projectStore';
import {
  getSessionExecutionState,
  observeSessionExecution,
  requireLegacyExecution,
  resetSessionExecutionStore,
} from '@/store/sessionExecutionStore';
import { SPACE_SCHEMA_VERSION, useSpaceStore } from '@/store/spaceStore';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/host/createHost', () => ({
  createHost: () => ({
    electronAPI: {
      getLocalControlCapability: async () => 'synthetic-local-control',
    },
    ipcRenderer: null,
  }),
}));
vi.mock('@/lib/notifyError', () => ({
  reportError: () => 'task',
  notifyError: vi.fn(),
}));
vi.mock('@/components/Toast/storageToast', () => ({
  showStorageToast: vi.fn(),
}));

interface Stats {
  wire: Array<{
    run: string;
    url: string;
    body: { messages: Array<{ role: string; content: unknown }> };
  }>;
  counts: Record<string, number>;
  finals: Array<{ run_id: string; state: string }>;
  requests: Array<{ request_id: string; status: string }>;
}
interface Reply {
  status: number;
  headers: Record<string, string>;
  body: string;
}
let child: ChildProcessWithoutNullStreams;
let sequence = 0;
const waiting = new Map<
  number,
  { resolve: (value: any) => void; reject: (error: Error) => void }
>();
let stderr = '';
let loseAcknowledgement = false;
let pauseNextSave: Promise<void> | null = null;
const calls: Array<{ method: string; path: string; body?: string }> = [];
const ipc = <T = unknown>(value: Record<string, unknown>): Promise<T> =>
  new Promise((resolve, reject) => {
    const id = ++sequence;
    waiting.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ ...value, id }) + '\n');
  });
const stats = () => ipc<Stats>({ kind: 'stats' });
async function until(check: () => Promise<boolean>, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('IPC condition timed out: ' + stderr.slice(-10000));
}
const settled = (id: string) =>
  until(async () =>
    (await stats()).finals.some(
      (row) => row.run_id === id && row.state === 'settled'
    )
  );
async function space(id: string, git: boolean) {
  await ipc({ kind: 'space', space: id, git });
  useSpaceStore.getState().upsertSpaces([
    {
      id,
      name: id,
      sourceType: 'folder',
      rootPath: '/synthetic/' + id,
      status: 'active',
      schemaVersion: SPACE_SCHEMA_VERSION,
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
}

beforeAll(async () => {
  const root = process.cwd();
  child = spawn(
    path.join(root, 'backend/.venv/bin/python'),
    [
      '-u',
      '-B',
      path.join(root, 'test/integration/fixtures/session_execution_bridge.py'),
    ],
    {
      cwd: path.join(root, 'backend'),
      env: {
        PATH: '/usr/bin:/bin',
        PYTHONPATH: '.',
        PYTHONDONTWRITEBYTECODE: '1',
        PYTEST_DISABLE_PLUGIN_AUTOLOAD: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_TERMINAL_PROMPT: '0',
      },
    }
  );
  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });
  child.on('exit', (code) => {
    waiting.forEach((promise) =>
      promise.reject(new Error(`Bridge exited ${code}: ${stderr}`))
    );
    waiting.clear();
  });
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.startsWith('@IPC ')) return;
    const value = JSON.parse(line.slice(5));
    const pending = waiting.get(value.id);
    waiting.delete(value.id);
    if (value.error)
      pending?.reject(new Error(value.error + '\n' + stderr.slice(-5000)));
    else pending?.resolve(value.result);
  });
  useAuthStore.setState({ token: 'synthetic-account-secret', user_id: 1 });
  setConnectionConfig({
    brainEndpoint: 'http://synthetic-brain',
    channel: 'desktop',
  });
  vi.stubGlobal(
    'fetch',
    async (input: string | URL | Request, options: RequestInit = {}) => {
      const url = new URL(String(input), 'http://synthetic-account');
      const request = {
        method: options.method ?? 'GET',
        path: url.pathname + url.search,
        body: options.body as string | undefined,
      };
      calls.push(request);
      if (request.method === 'PATCH' && pauseNextSave) {
        const gate = pauseNextSave;
        pauseNextSave = null;
        await gate;
      }
      const result = await ipc<Reply>({
        kind: 'http',
        ...request,
        headers: Object.fromEntries(new Headers(options.headers).entries()),
      });
      if (
        loseAcknowledgement &&
        request.method === 'POST' &&
        /\/executions$/.test(request.path) &&
        result.status === 202
      ) {
        loseAcknowledgement = false;
        throw new TypeError('Synthetic lost acknowledgement');
      }
      return new Response(Uint8Array.from(Buffer.from(result.body, 'base64')), {
        status: result.status,
        headers: result.headers,
      });
    }
  );
  await ipc({ kind: 'history', enabled: true });
}, 30000);

afterAll(async () => {
  resetSessionExecutionStore();
  if (child && child.exitCode === null) {
    child.stdin.write(JSON.stringify({ kind: 'close' }) + '\n');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill(), 10000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  vi.unstubAllGlobals();
});

describe('production TS transport → real Python ASGI execution', () => {
  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    'overlaps across Sessions; Git=%s cross-Space=%s',
    async (git, cross) => {
      const name = `space-${git}-${cross}`;
      await space(name, git);
      if (cross) await space(name + '-other', git);
      const a = createWorkspaceSessionDraft(name, 'write A', 'medium');
      const b = createWorkspaceSessionDraft(
        cross ? name + '-other' : name,
        'write B',
        'medium'
      );
      // Lost response reuses both the Session and request, resolving GET before retry.
      loseAcknowledgement = true;
      await expect(submitWorkspaceSessionDraft(a)).rejects.toThrow(
        'lost acknowledgement'
      );
      const beforeRetry = calls.length;
      await submitWorkspaceSessionDraft(a);
      expect(
        calls
          .slice(beforeRetry)
          .some(
            (call) => call.method === 'POST' && /\/executions$/.test(call.path)
          )
      ).toBe(false);
      await submitWorkspaceSessionDraft(b);
      const scope = a.intent.scope;
      const stop = observeSessionExecution(scope);
      await until(
        async () => getSessionExecutionState(scope).requests.length === 1
      );
      stop();
      await ipc({ kind: 'start' });
      await until(async () => {
        const current = await stats();
        return Boolean(
          current.counts[a.intent.requestId] &&
          current.counts[b.intent.requestId]
        );
      });
      await ipc({ kind: 'release', run: a.intent.requestId });
      await ipc({ kind: 'release', run: b.intent.requestId });
      await settled(a.intent.requestId);
      await settled(b.intent.requestId);
      const remount = observeSessionExecution(scope);
      await until(
        async () =>
          getSessionExecutionState(scope).requests[0]?.settlement === 'settled'
      );
      remount();
      expect(
        (await stats()).requests.filter(
          (row) => row.request_id === a.intent.requestId
        )
      ).toHaveLength(1);
      await expect(requireLegacyExecution(scope)).rejects.toThrow(
        'managed_execution_required'
      );
      const firstFile = (
        await fetchExecutionArtifacts(scope, a.intent.requestId)
      ).artifacts[0];
      expect(
        await (
          await readExecutionArtifact(
            scope,
            a.intent.requestId,
            firstFile.artifact_id
          )
        ).text()
      ).toBe(a.intent.requestId);

      const first = createSessionMessageIntent(
        scope,
        'write next',
        'follow_up'
      );
      const second = createSessionMessageIntent(
        scope,
        'write last',
        'follow_up'
      );
      await submitSessionMessage(
        first,
        sessionMessageConfiguration(scope.projectId)
      );
      await submitSessionMessage(
        second,
        sessionMessageConfiguration(scope.projectId)
      );
      await until(async () => Boolean((await stats()).counts[first.requestId]));
      expect((await stats()).counts[second.requestId]).toBeUndefined();
      await ipc({ kind: 'release', run: first.requestId });
      await settled(first.requestId);
      await until(async () =>
        Boolean((await stats()).counts[second.requestId])
      );
      await ipc({ kind: 'release', run: second.requestId });
      await settled(second.requestId);
      const lastFile = (await fetchExecutionArtifacts(scope, second.requestId))
        .artifacts[0];
      expect(firstFile.filename).toBe(lastFile.filename);
      expect(firstFile.content_digest).not.toBe(lastFile.content_digest);
      expect(
        await (
          await readExecutionArtifact(
            scope,
            a.intent.requestId,
            firstFile.artifact_id
          )
        ).text()
      ).toBe(a.intent.requestId);
      expect(
        await (
          await readExecutionArtifact(
            scope,
            second.requestId,
            lastFile.artifact_id
          )
        ).text()
      ).toBe(second.requestId);
      const wire = (await stats()).wire;
      const request = wire.find((item) => item.run === first.requestId)!;
      expect(request.url).toBe(
        'https://model.example.test/authorized/v1/chat/completions'
      );
      expect(JSON.stringify(request.body.messages)).toContain(
        'Saved ' + a.intent.requestId
      );
      expect(
        request.body.messages.filter(
          (message) =>
            message.role === 'user' && message.content === 'write next'
        )
      ).toHaveLength(1);
      await hydrateProjectEventStore({
        projectId: scope.projectId,
        expectedAccountKey: scope.accountKey,
      });
      const snapshot = getProjectEventStore(scope.projectId).getSnapshot();
      await hydrateProjectEventStore({
        projectId: scope.projectId,
        expectedAccountKey: scope.accountKey,
      });
      expect(getProjectEventStore(scope.projectId).getSnapshot().chat).toEqual(
        snapshot.chat
      );
    },
    60000
  );

  it('awaits the real settings save before registration and freezes the Run configuration', async () => {
    await space('configuration-race', false);
    const draft = createWorkspaceSessionDraft(
      'configuration-race',
      'initial settings',
      'medium'
    );
    await submitWorkspaceSessionDraft(draft);
    await until(async () =>
      Boolean((await stats()).counts[draft.intent.requestId])
    );
    await ipc({ kind: 'release', run: draft.intent.requestId });
    await settled(draft.intent.requestId);
    let release!: () => void;
    pauseNextSave = new Promise<void>((resolve) => {
      release = resolve;
    });
    useProjectStore
      .getState()
      .setProjectThinkingEffort(draft.intent.scope.projectId, 'high');
    const next = createSessionMessageIntent(
      draft.intent.scope,
      'new settings',
      'follow_up'
    );
    const before = calls.length;
    const submission = submitSessionMessage(
      next,
      sessionMessageConfiguration(draft.intent.scope.projectId)
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls.slice(before).some((call) => call.method === 'POST')).toBe(
      false
    );
    expect(
      (await fetchSessionExecutions(draft.intent.scope)).items
    ).toHaveLength(1);
    release();
    await submission;
    expect(next.body?.envelope.thinking_effort).toBe('high');
    expect(draft.intent.body?.envelope.thinking_effort).toBe('medium');
    expect(next.body?.envelope.configuration_revision).not.toBe(
      draft.intent.body?.envelope.configuration_revision
    );
    await until(async () => Boolean((await stats()).counts[next.requestId]));
    await ipc({ kind: 'release', run: next.requestId });
    await settled(next.requestId);
  }, 30000);

  it('Send now and Stop drain through settlement; cancelled pending never starts; flag never downgrades', async () => {
    await space('control', false);
    const draft = createWorkspaceSessionDraft('control', 'hold', 'medium');
    await submitWorkspaceSessionDraft(draft);
    const scope = draft.intent.scope;
    await until(async () =>
      Boolean((await stats()).counts[draft.intent.requestId])
    );
    const next = createSessionMessageIntent(
      scope,
      'interrupt and write',
      'follow_up'
    );
    const cancelled = createSessionMessageIntent(
      scope,
      'cancel before start',
      'follow_up'
    );
    await submitSessionMessage(
      next,
      sessionMessageConfiguration(scope.projectId)
    );
    await submitSessionMessage(
      cancelled,
      sessionMessageConfiguration(scope.projectId)
    );
    await cancelSessionExecution(scope, cancelled.requestId);
    const operation = crypto.randomUUID();
    await sendSessionExecutionNow(scope, next.requestId, operation);
    await sendSessionExecutionNow(scope, next.requestId, operation);
    await until(async () => Boolean((await stats()).counts[next.requestId]));
    expect(
      (await stats()).finals.find(
        (row) => row.run_id === draft.intent.requestId
      )?.state
    ).toBe('settled');
    await cancelSessionExecution(scope, next.requestId);
    await settled(next.requestId);
    expect((await stats()).counts[cancelled.requestId]).toBeUndefined();
    await ipc({ kind: 'flag', enabled: false });
    expect(await fetchSessionExecutionRoute(scope)).toMatchObject({
      route: 'managed',
      entry_enabled: false,
    });
    await expect(requireLegacyExecution(scope)).rejects.toThrow(
      'managed_execution_required'
    );
    useAuthStore.setState({ user_id: 2 });
    await expect(fetchSessionExecutions(scope)).rejects.toThrow(
      'account_changed'
    );
    useAuthStore.setState({ user_id: 1 });
    await ipc({ kind: 'flag', enabled: true });
    expect(
      useProjectRuntimeStore.getState().getProjectById(scope.projectId)
    ).toBeDefined();
  }, 30000);
});
