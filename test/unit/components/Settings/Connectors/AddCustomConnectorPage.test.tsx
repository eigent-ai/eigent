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

import AddCustomConnectorPage from '@/components/Settings/Connectors/components/AddCustomConnectorPage';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  install: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  probe: vi.fn(),
  signin: vi.fn(),
  cancel: vi.fn(),
  installed: vi.fn(),
  back: vi.fn(),
}));
vi.mock('@/host', () => ({
  useHost: () => ({ electronAPI: window.electronAPI }),
}));
vi.mock('@/api/brain', () => ({
  mcpInstall: mocks.install,
  mcpRemove: vi.fn(),
}));
vi.mock('@/api/http', () => ({
  proxyFetchPost: mocks.post,
  proxyFetchPut: mocks.put,
  proxyFetchDelete: vi.fn(),
  proxyFetchGet: vi.fn(),
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: Function) =>
    selector({ email: 'alice@example.com' }),
}));
vi.mock('@/components/Settings/SettingsHeaderContext', () => ({
  useSettingsHeader: () => ({ setHeaderOverride: vi.fn() }),
}));
vi.mock('@/lib/monacoWorkers', () => ({ ensureMonacoWorkers: vi.fn() }));
vi.mock('@monaco-editor/loader', () => ({ default: { config: vi.fn() } }));
vi.mock('@monaco-editor/react', () => ({ default: () => null }));
vi.mock('monaco-editor', () => ({}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.post.mockResolvedValue({ mcp_user: { id: 12 } });
  mocks.put.mockResolvedValue({});
  mocks.install.mockResolvedValue({ success: true });
  mocks.probe.mockResolvedValue({ requiresAuth: true });
  mocks.signin.mockResolvedValue({ state: 'connected' });
  Object.assign(window.electronAPI, {
    mcpOAuthProbe: mocks.probe,
    mcpOAuthSignIn: mocks.signin,
    mcpOAuthCancel: mocks.cancel,
  });
});
async function fillRemote() {
  render(
    <AddCustomConnectorPage
      embedded
      customType="remote"
      customMcps={[]}
      onBack={mocks.back}
      onInstalled={mocks.installed}
    />
  );
  await userEvent.type(
    screen.getByPlaceholderText('My remote MCP'),
    'Astrocade'
  );
  await userEvent.type(
    screen.getByPlaceholderText('https://example.com/mcp'),
    'https://mcp.astrocade.com/mcp'
  );
  await userEvent.click(screen.getByRole('button', { name: 'Install' }));
}

it('saves only the OAuth marker and opens browser sign-in after remote install', async () => {
  await fillRemote();
  expect(mocks.install).toHaveBeenCalledWith('Astrocade', {
    url: 'https://mcp.astrocade.com/mcp',
    auth: { type: 'oauth' },
  });
  expect(mocks.signin).toHaveBeenCalledWith({
    account: 'alice@example.com',
    name: 'Astrocade',
    url: 'https://mcp.astrocade.com/mcp',
  });
  expect(mocks.installed).toHaveBeenCalled();
});

it('saves after network probe failure and leaves retry available in the connector list', async () => {
  mocks.probe.mockResolvedValue({ error: 'network' });
  await fillRemote();
  expect(mocks.install).toHaveBeenCalledWith('Astrocade', {
    url: 'https://mcp.astrocade.com/mcp',
  });
  expect(mocks.signin).not.toHaveBeenCalled();
  expect(mocks.installed).toHaveBeenCalled();
});

it('can cancel the automatic sign-in without losing the installed connector', async () => {
  let resolve!: (value: object) => void;
  mocks.signin.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  await fillRemote();
  await screen.findByText('Waiting for sign-in…');
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(mocks.cancel).toHaveBeenCalled();
  await act(async () =>
    resolve({ state: 'signin_required', error: 'cancelled' })
  );
  expect(mocks.installed).toHaveBeenCalled();
});
