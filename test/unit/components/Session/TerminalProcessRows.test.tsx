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

import { ChooserTab } from '@/components/Session/PreviewPanel/tabs/ChooserTab';
import { TerminalProcessRows } from '@/components/Session/SidePanel/components/TerminalProcessRows';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HostProvider } from '@/host';
import { getSessionPreviewSlice, usePageTabStore } from '@/store/pageTabStore';
import {
  useTerminalProcessStore,
  type TerminalProcess,
} from '@/store/terminalProcessStore';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const http = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/api/http', () => ({
  fetchGet: () => new Promise(() => {}),
  fetchPost: http.post,
}));
vi.mock(
  '@/components/Session/PreviewPanel/tabs/terminal/useSessionTerminalSources',
  () => ({ useSessionTerminalSources: () => [] })
);
const source: TerminalProcess = {
  id: 'abc123',
  project_id: 'one',
  run_id: 'run',
  session_id: 'silent',
  agent_name: 'Agent',
  label: 'Silent command',
  status: 'running',
  can_stop: true,
  output: '',
  offset: 0,
  version: 0,
  url: null,
  stop_error: null,
  exit_code: null,
};
beforeEach(() => {
  http.post.mockReset();
  useTerminalProcessStore.setState({ projects: { one: [source] } });
  usePageTabStore.setState({
    sessionPreviewProjectId: 'one',
    sessionPreviewByProject: {},
  });
});
describe('Summary process controls', () => {
  it('opens a silent process, provides a sibling Stop control and retains stopped output', async () => {
    render(
      <HostProvider host={{ electronAPI: null, ipcRenderer: null }}>
        <TooltipProvider>
          <TerminalProcessRows projectId="one" />
        </TooltipProvider>
      </HostProvider>
    );
    const stop = screen.getByRole('button', { name: 'Stop Silent command' });
    expect(stop.parentElement?.closest('button')).toBeNull();
    http.post.mockResolvedValue({
      ...source,
      status: 'stopped',
      can_stop: false,
      output: 'last line',
    });
    fireEvent.click(stop);
    await waitFor(() =>
      expect(screen.getByText('Stopped')).toBeInTheDocument()
    );
    expect(
      getSessionPreviewSlice(usePageTabStore.getState()).tabs
    ).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /Silent command/ }));
    expect(getSessionPreviewSlice(usePageTabStore.getState())).toMatchObject({
      open: true,
      tabs: [{ agentSourceId: 'process:abc123' }],
    });
    expect(useTerminalProcessStore.getState().projects.one[0].output).toBe(
      'last line'
    );
  });
  it('offers four direct view options with inline shortcuts and no heading', () => {
    const choose = vi.fn();
    render(
      <TooltipProvider>
        <ChooserTab onChoose={choose} />
      </TooltipProvider>
    );
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.queryByText('Open a new view')).not.toBeInTheDocument();
    expect(screen.queryByText('From this session')).not.toBeInTheDocument();
    const keycaps = document.querySelectorAll('kbd');
    expect(keycaps).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: /^Browser\b/ }).querySelector('kbd')
    ).toBe(keycaps[0]);
    expect(
      screen.getByRole('button', { name: /^Terminal\b/ }).querySelector('kbd')
    ).toBe(keycaps[1]);
    expect(
      screen.getByRole('button', { name: /^File\b/ }).querySelector('kbd')
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: /^Review\b/ }).querySelector('kbd')
    ).toBeNull();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(document.querySelector('.lucide-chevron-right')).toBeNull();
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveClass('hover:bg-ds-neutral-default-hover');
      expect(button).toHaveClass('hover:border-ds-hairline-default-hover');
    }
    for (const button of screen.getAllByRole('button')) fireEvent.click(button);
    expect(choose.mock.calls.map((call) => call[0])).toEqual([
      'browser',
      'file',
      'review',
      'terminal',
    ]);
  });
});
