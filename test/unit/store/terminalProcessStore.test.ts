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

import { openTerminalProcessPreview } from '@/lib/terminalPreview';
import { getSessionPreviewSlice, usePageTabStore } from '@/store/pageTabStore';
import {
  useTerminalProcessStore,
  type TerminalProcess,
} from '@/store/terminalProcessStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/api/http', () => ({ fetchGet: http.get, fetchPost: http.post }));
const process: TerminalProcess = {
  id: 'abcd1234',
  project_id: 'one',
  run_id: 'run',
  session_id: 'server',
  agent_name: 'Agent',
  label: 'Server',
  status: 'running',
  can_stop: true,
  output: 'ready\n',
  offset: 0,
  version: 1,
  url: 'http://localhost:3000/',
  stop_error: null,
  exit_code: null,
};
beforeEach(() => {
  http.get.mockReset();
  http.post.mockReset();
  useTerminalProcessStore.setState({ projects: { one: [{ ...process }] } });
  usePageTabStore.setState({
    sessionPreviewProjectId: 'one',
    sessionPreviewByProject: {},
  });
});
describe('terminal processes', () => {
  it('keeps output when an unchanged version omits it; a missing owner becomes unavailable', async () => {
    const previous = useTerminalProcessStore.getState().projects.one;
    http.get.mockResolvedValueOnce({
      processes: [{ ...process, output: undefined }],
    });
    await useTerminalProcessStore.getState().refresh('one');
    expect(useTerminalProcessStore.getState().projects.one[0].output).toBe(
      'ready\n'
    );
    expect(useTerminalProcessStore.getState().projects.one).toBe(previous);
    http.get.mockResolvedValueOnce({ processes: [] });
    await useTerminalProcessStore.getState().refresh('one');
    expect(useTerminalProcessStore.getState().projects.one[0]).toMatchObject({
      status: 'unavailable',
      can_stop: false,
      output: 'ready\n',
    });
  });
  it('does not let a stale poll resurrect a process after confirmed stop', async () => {
    let resolvePoll!: (value: unknown) => void;
    http.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePoll = resolve;
        })
    );
    const poll = useTerminalProcessStore.getState().refresh('one');
    http.post.mockResolvedValue({
      ...process,
      status: 'stopped',
      can_stop: false,
    });
    await useTerminalProcessStore.getState().stop('one', process.id);
    resolvePoll({ processes: [process] });
    await poll;
    expect(useTerminalProcessStore.getState().projects.one[0].status).toBe(
      'stopped'
    );
  });
  it('deduplicates stop while pending and permits retry after failure', async () => {
    let rejectStop!: (value: unknown) => void;
    http.post.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectStop = reject;
        })
    );
    const stopping = useTerminalProcessStore.getState().stop('one', process.id);
    await useTerminalProcessStore.getState().stop('one', process.id);
    expect(http.post).toHaveBeenCalledTimes(1);
    rejectStop(new Error('offline'));
    await stopping;
    expect(useTerminalProcessStore.getState().projects.one[0]).toMatchObject({
      status: 'running',
      stop_error: 'stop-failed',
    });
    http.post.mockResolvedValue({
      ...process,
      status: 'stopped',
      can_stop: false,
    });
    await useTerminalProcessStore.getState().stop('one', process.id);
    expect(http.post).toHaveBeenCalledTimes(2);
  });
  it('shares navigation between Summary and timeline without crossing Session ownership', () => {
    openTerminalProcessPreview(process);
    openTerminalProcessPreview(process);
    expect(
      getSessionPreviewSlice(usePageTabStore.getState()).tabs
    ).toHaveLength(1);
    usePageTabStore.getState().setSessionPreviewProject('two');
    openTerminalProcessPreview(process);
    expect(
      getSessionPreviewSlice(usePageTabStore.getState()).tabs
    ).toHaveLength(0);
  });
});
