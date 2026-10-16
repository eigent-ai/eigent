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

import { McpConnectorNotice } from '@/components/ChatBox/McpConnectorNotice';
import { McpOAuthControls } from '@/components/Settings/Connectors/components/McpOAuthControls';
import { clearMcpOAuthProbeCache, mcpConnectorIssue } from '@/lib/mcpOAuth';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
  probe: vi.fn(),
  status: vi.fn(),
  signin: vi.fn(),
  signout: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('@/host', () => ({
  useHost: () => ({ electronAPI: window.electronAPI }),
}));
vi.mock('@/api/brain', () => ({
  mcpList: mocks.list,
  mcpUpdate: mocks.update,
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: Function) =>
    selector({ email: 'alice@example.com' }),
}));
const props = {
  name: 'Astrocade',
  url: 'https://mcp.astrocade.com/mcp',
  enabled: true,
};
const identity = {
  account: 'alice@example.com',
  name: props.name,
  url: props.url,
};
beforeEach(() => {
  vi.clearAllMocks();
  clearMcpOAuthProbeCache();
  mocks.list.mockResolvedValue({
    mcpServers: { Astrocade: { url: props.url, auth: { type: 'oauth' } } },
  });
  mocks.update.mockResolvedValue({ success: true });
  mocks.probe.mockResolvedValue({ requiresAuth: true });
  mocks.status.mockResolvedValue({ state: 'signin_required' });
  mocks.signin.mockResolvedValue({ state: 'connected' });
  mocks.signout.mockResolvedValue({ state: 'signin_required' });
  mocks.cancel.mockResolvedValue({ state: 'signin_required' });
  Object.assign(window.electronAPI, {
    mcpOAuthProbe: mocks.probe,
    mcpOAuthStatus: mocks.status,
    mcpOAuthSignIn: mocks.signin,
    mcpOAuthSignOut: mocks.signout,
    mcpOAuthCancel: mocks.cancel,
  });
});

describe('MCP OAuth connector actions', () => {
  it('shows a warning and supports sign-in then sign-out without exposing credentials', async () => {
    render(<McpOAuthControls {...props} />);
    expect(await screen.findByText('Sign-in required')).toHaveAttribute(
      'data-tone',
      'warning'
    );
    mocks.status.mockResolvedValue({ state: 'connected' });
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Connected')).toHaveAttribute(
      'data-tone',
      'success'
    );
    expect(mocks.signin).toHaveBeenCalledWith(identity);
    mocks.status.mockResolvedValue({ state: 'signin_required' });
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(mocks.signout).toHaveBeenCalledWith(identity);
    expect(
      await screen.findByRole('button', { name: 'Sign in' })
    ).toBeEnabled();
  });

  it('allows cancellation while the system browser is open', async () => {
    let resolve!: (value: object) => void;
    mocks.signin.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    render(<McpOAuthControls {...props} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Sign in' })
    );
    expect(await screen.findByText('Waiting for sign-in…')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mocks.cancel).toHaveBeenCalledWith(identity);
    await act(async () =>
      resolve({ state: 'signin_required', error: 'cancelled' })
    );
    expect(
      await screen.findByRole('button', { name: 'Sign in' })
    ).toBeEnabled();
  });

  it('never offers or marks OAuth when a 401 has no usable OAuth metadata', async () => {
    mocks.list.mockResolvedValue({
      mcpServers: {
        Astrocade: {
          url: props.url,
          headers: { Authorization: 'Bearer api-key' },
        },
      },
    });
    mocks.probe.mockResolvedValue({
      requiresAuth: true,
      error: 'invalid_metadata',
    });
    render(<McpOAuthControls {...props} />);
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.signin).not.toHaveBeenCalled();
  });

  it('shares one probe between list and detail controls', async () => {
    mocks.list.mockResolvedValue({ mcpServers: {} });
    mocks.probe.mockResolvedValue({ requiresAuth: false });
    render(
      <>
        <McpOAuthControls {...props} />
        <McpOAuthControls {...props} />
      </>
    );
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    act(() => window.dispatchEvent(new Event('mcp-oauth-changed')));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(4));
    expect(mocks.probe).toHaveBeenCalledTimes(1);
  });

  it('explains unavailable encryption and offers reconnect', async () => {
    mocks.status.mockResolvedValue({
      state: 'error',
      error: 'encryption_unavailable',
    });
    render(<McpOAuthControls {...props} />);
    expect(
      await screen.findByText(/Unlock or configure your system keyring/)
    ).toBeVisible();
    expect(screen.getByText('Error')).toHaveAttribute('data-tone', 'error');
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeEnabled();
  });

  it('repairs an older OAuth remote while preserving its static headers', async () => {
    mocks.list.mockResolvedValue({
      mcpServers: {
        Astrocade: { url: props.url, headers: { 'X-Custom': 'keep' } },
      },
    });
    render(<McpOAuthControls {...props} />);
    await screen.findByRole('button', { name: 'Sign in' });
    expect(mocks.update).toHaveBeenCalledWith('Astrocade', {
      url: props.url,
      headers: { 'X-Custom': 'keep' },
      auth: { type: 'oauth' },
    });
  });

  it('retries a failed probe without marking an unauthenticated remote as OAuth', async () => {
    mocks.list.mockResolvedValue({
      mcpServers: { Astrocade: { url: props.url } },
    });
    mocks.probe
      .mockResolvedValueOnce({ error: 'network' })
      .mockResolvedValue({ requiresAuth: false });
    const { container } = render(<McpOAuthControls {...props} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(mocks.signin).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('leaves public remote connectors unchanged', async () => {
    mocks.list.mockResolvedValue({ mcpServers: {} });
    mocks.probe.mockResolvedValue({ requiresAuth: false });
    const { container } = render(<McpOAuthControls {...props} />);
    await waitFor(() => expect(mocks.probe).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe('Task connector notices', () => {
  it('names the connector and signs in through the same desktop flow', async () => {
    render(
      <McpConnectorNotice
        issue={{ name: 'Astrocade', reason: 'signin_required' }}
      />
    );
    expect(screen.getByText('Astrocade needs you to sign in.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByText(
        'Astrocade is connected. Resume the Task to use its tools.'
      )
    ).toBeVisible();
    expect(mocks.signin).toHaveBeenCalledWith(identity);
  });

  it('does not convert a static-key connector to OAuth after a 401', async () => {
    mocks.list.mockResolvedValue({
      mcpServers: {
        Internal: {
          url: 'https://internal.example.com/mcp',
          headers: { Authorization: 'Bearer api-key' },
        },
      },
    });
    mocks.probe.mockResolvedValue({ requiresAuth: false });
    render(
      <McpConnectorNotice
        issue={{ name: 'Internal', reason: 'mcp_auth_failed' }}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByText(/does not support automatic client registration/)
    ).toBeVisible();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.signin).not.toHaveBeenCalled();
  });

  it('marks the connector as OAuth only after a successful sign-in', async () => {
    mocks.list.mockResolvedValue({
      mcpServers: { Astrocade: { url: props.url } },
    });
    mocks.signin.mockResolvedValueOnce({
      state: 'error',
      error: 'unsupported_provider',
    });
    render(
      <McpConnectorNotice
        issue={{ name: 'Astrocade', reason: 'mcp_auth_failed' }}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(mocks.signin).toHaveBeenCalledTimes(1));
    expect(mocks.update).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByText(
        'Astrocade is connected. Resume the Task to use its tools.'
      )
    ).toBeVisible();
    expect(mocks.update).toHaveBeenCalledWith('Astrocade', {
      url: props.url,
      auth: { type: 'oauth' },
    });
  });

  it('retains an actionable local-device explanation for cloud or missing configurations', async () => {
    mocks.list.mockResolvedValue({ mcpServers: {} });
    render(
      <McpConnectorNotice
        issue={{ name: 'Astrocade', reason: 'signin_required' }}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/device running Eigent/)).toBeVisible();
    expect(mocks.signin).not.toHaveBeenCalled();
  });

  it('reads structured notices and pinned errors including encoded connector names', () => {
    expect(
      mcpConnectorIssue(
        'mcp_connector_unavailable:{"name":"A:B, C","reason":"signin_required"}'
      )
    ).toEqual({ name: 'A:B, C', reason: 'signin_required' });
    expect(
      mcpConnectorIssue('Setup required (mcp_oauth_required:A%3AB%2C%20C)')
    ).toEqual({ name: 'A:B, C', reason: 'signin_required' });
    expect(
      mcpConnectorIssue(
        'Setup required: mcp_oauth_unavailable:Astrocade:network'
      )
    ).toEqual({ name: 'Astrocade', reason: 'network' });
    expect(mcpConnectorIssue('mcp_connector_unavailable:invalid')).toBeNull();
  });
});
