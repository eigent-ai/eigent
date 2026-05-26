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

/**
 * useIntegrationManagement — Unit Tests
 *
 * Covers:
 *  1. fetchInstalled — fetches configs on mount, updates state
 *  2. installed status — recalculates when items/configs change
 *  3. saveEnvAndConfig — POST/PUT logic, envWrite call
 *  4. processOauth — Slack and LinkedIn OAuth flows
 *  5. OAuth IPC listener — registers/unregisters correctly
 *  6. Pending OAuth — caches and replays when items arrive
 *  7. handleUninstall — deletes configs and cleans up tokens
 *  8. createMcpFromItem — builds MCP object from item
 *  9. callBackUrl — listens to oauth-callback-url IPC
 * 10. Stability — no render loop on repeated renders
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IntegrationItem } from '@/hooks/useIntegrationManagement';

const {
  mockProxyFetchGet,
  mockProxyFetchPost,
  mockProxyFetchPut,
  mockProxyFetchDelete,
  mockFetchPost,
  mockFetchDelete,
} = vi.hoisted(() => ({
  mockProxyFetchGet: vi.fn(),
  mockProxyFetchPost: vi.fn(),
  mockProxyFetchPut: vi.fn(),
  mockProxyFetchDelete: vi.fn(),
  mockFetchPost: vi.fn(),
  mockFetchDelete: vi.fn(),
}));

const { mockEmail, mockCheckAgentTool } = vi.hoisted(() => ({
  mockEmail: 'user@test.com',
  mockCheckAgentTool: vi.fn(),
}));

vi.mock('@/api/http', () => ({
  proxyFetchGet: mockProxyFetchGet,
  proxyFetchPost: mockProxyFetchPost,
  proxyFetchPut: mockProxyFetchPut,
  proxyFetchDelete: mockProxyFetchDelete,
  fetchPost: mockFetchPost,
  fetchDelete: mockFetchDelete,
  fetchGet: vi.fn(),
  fetchPut: vi.fn(),
  getBaseURL: vi.fn(),
  uploadFile: vi.fn(),
  waitForBackendReady: vi.fn().mockResolvedValue(true),
  checkBackendHealth: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: vi.fn((selector?: any) => {
    const state = { email: mockEmail, checkAgentTool: mockCheckAgentTool };
    return selector ? selector(state) : state;
  }),
}));

import { useIntegrationManagement } from '@/hooks/useIntegrationManagement';

const mockSlackItem: IntegrationItem = {
  key: 'Slack',
  name: 'Slack',
  desc: 'Slack integration',
  env_vars: ['SLACK_BOT_TOKEN'],
  onInstall: vi.fn(),
};

const mockLinkedinItem: IntegrationItem = {
  key: 'LinkedIn',
  name: 'LinkedIn',
  desc: 'LinkedIn integration',
  env_vars: ['LINKEDIN_ACCESS_TOKEN'],
  onInstall: vi.fn(),
};

const mockGoogleCalendarItem: IntegrationItem = {
  key: 'Google Calendar',
  name: 'Google Calendar',
  desc: 'Google Calendar integration',
  env_vars: ['GOOGLE_REFRESH_TOKEN'],
  onInstall: vi.fn(),
};

const mockNotionItem: IntegrationItem = {
  key: 'Notion',
  name: 'Notion',
  desc: 'Notion integration',
  env_vars: ['NOTION_API_KEY'],
  onInstall: vi.fn(),
};

function defaultItems(): IntegrationItem[] {
  return [mockSlackItem, mockLinkedinItem];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockProxyFetchGet.mockResolvedValue([]);
  mockProxyFetchPost.mockResolvedValue({});
  mockProxyFetchPut.mockResolvedValue({ success: true });
  mockProxyFetchDelete.mockResolvedValue({});
  mockFetchPost.mockResolvedValue({});
  mockFetchDelete.mockResolvedValue({});
});

describe('useIntegrationManagement', () => {
  it('renders without infinite loop', async () => {
    mockProxyFetchGet.mockResolvedValue([]);
    const { result } = renderHook(() => useIntegrationManagement([]));
    await waitFor(() => expect(mockProxyFetchGet).toHaveBeenCalled(), {
      timeout: 3000,
    });
    expect(result.current.configs).toEqual([]);
  });

  describe('fetchInstalled', () => {
    it('fetches configs on mount', async () => {
      const configs = [
        {
          id: 1,
          config_group: 'Slack',
          config_name: 'SLACK_BOT_TOKEN',
          config_value: 'xoxb-123',
        },
      ];
      mockProxyFetchGet.mockResolvedValue(configs);

      const { result } = renderHook(() => useIntegrationManagement([]));

      await waitFor(
        () => {
          expect(result.current.configs).toEqual(configs);
        },
        { timeout: 3000 }
      );

      expect(mockProxyFetchGet).toHaveBeenCalledWith('/api/v1/configs');
    });

    it('sets configs to empty array on fetch error', async () => {
      mockProxyFetchGet.mockRejectedValue(new Error('network'));

      const { result } = renderHook(() =>
        useIntegrationManagement(defaultItems())
      );

      await waitFor(() => {
        expect(result.current.configs).toEqual([]);
      });
    });

    it('sets configs to empty array when response is not an array', async () => {
      mockProxyFetchGet.mockResolvedValue({ not: 'an array' });

      const { result } = renderHook(() =>
        useIntegrationManagement(defaultItems())
      );

      await waitFor(() => {
        expect(result.current.configs).toEqual([]);
      });
    });

    it('exposes fetchInstalled for manual refresh', async () => {
      const { result } = renderHook(() =>
        useIntegrationManagement(defaultItems())
      );

      await waitFor(() => expect(mockProxyFetchGet).toHaveBeenCalled());

      mockProxyFetchGet.mockResolvedValue([
        { id: 2, config_group: 'X', config_name: 'Y', config_value: 'Z' },
      ]);

      await act(async () => {
        await result.current.fetchInstalled();
      });

      await waitFor(() => {
        expect(result.current.configs).toEqual([
          { id: 2, config_group: 'X', config_name: 'Y', config_value: 'Z' },
        ]);
      });
    });
  });

  describe('installed status', () => {
    it('marks Slack as installed when config exists', async () => {
      mockProxyFetchGet.mockResolvedValue([
        {
          config_group: 'Slack',
          config_name: 'SLACK_BOT_TOKEN',
          config_value: 'xoxb-123',
        },
      ]);

      const { result } = renderHook(() =>
        useIntegrationManagement([mockSlackItem])
      );

      await waitFor(() => {
        expect(result.current.installed['Slack']).toBe(true);
      });
    });

    it('marks Slack as not installed when no config', async () => {
      mockProxyFetchGet.mockResolvedValue([]);

      const { result } = renderHook(() =>
        useIntegrationManagement([mockSlackItem])
      );

      await waitFor(() => {
        expect(result.current.installed['Slack']).toBe(false);
      });
    });

    it('marks Google Calendar as installed only with refresh token', async () => {
      mockProxyFetchGet.mockResolvedValue([
        {
          config_group: 'Google Calendar',
          config_name: 'GOOGLE_CALENDAR_ID',
          config_value: 'cal@id',
        },
      ]);

      const { result } = renderHook(() =>
        useIntegrationManagement([mockGoogleCalendarItem])
      );

      await waitFor(() => {
        expect(result.current.installed['Google Calendar']).toBe(false);
      });
    });

    it('marks Google Calendar as installed with refresh token', async () => {
      mockProxyFetchGet.mockResolvedValue([
        {
          config_group: 'Google Calendar',
          config_name: 'GOOGLE_REFRESH_TOKEN',
          config_value: 'refresh-123',
        },
      ]);

      const { result } = renderHook(() =>
        useIntegrationManagement([mockGoogleCalendarItem])
      );

      await waitFor(() => {
        expect(result.current.installed['Google Calendar']).toBe(true);
      });
    });

    it('marks LinkedIn as installed with access token', async () => {
      mockProxyFetchGet.mockResolvedValue([
        {
          config_group: 'LinkedIn',
          config_name: 'LINKEDIN_ACCESS_TOKEN',
          config_value: 'at-123',
        },
      ]);

      const { result } = renderHook(() =>
        useIntegrationManagement([mockLinkedinItem])
      );

      await waitFor(() => {
        expect(result.current.installed['LinkedIn']).toBe(true);
      });
    });

    it('marks LinkedIn as not installed without access token', async () => {
      mockProxyFetchGet.mockResolvedValue([
        {
          config_group: 'LinkedIn',
          config_name: 'LINKEDIN_OTHER',
          config_value: 'x',
        },
      ]);

      const { result } = renderHook(() =>
        useIntegrationManagement([mockLinkedinItem])
      );

      await waitFor(() => {
        expect(result.current.installed['LinkedIn']).toBe(false);
      });
    });

    it('handles generic integration by config_group presence', async () => {
      mockProxyFetchGet.mockResolvedValue([
        {
          config_group: 'Notion',
          config_name: 'NOTION_API_KEY',
          config_value: 'ntn-123',
        },
      ]);

      const { result } = renderHook(() =>
        useIntegrationManagement([mockNotionItem])
      );

      await waitFor(() => {
        expect(result.current.installed['Notion']).toBe(true);
      });
    });
  });

  describe('saveEnvAndConfig', () => {
    it('POSTs new config when no existing config found', async () => {
      mockProxyFetchGet.mockResolvedValue([]);
      mockProxyFetchPost.mockResolvedValue({ success: true });

      const { result } = renderHook(() =>
        useIntegrationManagement(defaultItems())
      );
      await waitFor(() => expect(mockProxyFetchGet).toHaveBeenCalled());

      await act(async () => {
        await result.current.saveEnvAndConfig(
          'Slack',
          'SLACK_BOT_TOKEN',
          'xoxb-new'
        );
      });

      expect(mockProxyFetchPost).toHaveBeenCalledWith('/api/v1/configs', {
        config_group: 'Slack',
        config_name: 'SLACK_BOT_TOKEN',
        config_value: 'xoxb-new',
      });
    });

    it('PUTs existing config when config found', async () => {
      mockProxyFetchGet.mockResolvedValue([
        { id: 42, config_name: 'SLACK_BOT_TOKEN', config_value: 'old' },
      ]);

      const { result } = renderHook(() =>
        useIntegrationManagement(defaultItems())
      );
      await waitFor(() => expect(mockProxyFetchGet).toHaveBeenCalled());

      await act(async () => {
        await result.current.saveEnvAndConfig(
          'Slack',
          'SLACK_BOT_TOKEN',
          'xoxb-updated'
        );
      });

      expect(mockProxyFetchPut).toHaveBeenCalledWith('/api/v1/configs/42', {
        config_group: 'Slack',
        config_name: 'SLACK_BOT_TOKEN',
        config_value: 'xoxb-updated',
      });
    });

    it('handles "already exists" error by retrying with PUT', async () => {
      mockProxyFetchGet
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 99, config_name: 'SLACK_BOT_TOKEN' }]);
      mockProxyFetchPost.mockResolvedValue({
        detail: 'Config already exists for this user',
      });

      const { result } = renderHook(() =>
        useIntegrationManagement(defaultItems())
      );
      await waitFor(() => expect(mockProxyFetchGet).toHaveBeenCalled());

      await act(async () => {
        await result.current.saveEnvAndConfig(
          'Slack',
          'SLACK_BOT_TOKEN',
          'xoxb-new'
        );
      });

      expect(mockProxyFetchPut).toHaveBeenCalledWith('/api/v1/configs/99', {
        config_group: 'Slack',
        config_name: 'SLACK_BOT_TOKEN',
        config_value: 'xoxb-new',
      });
    });

    it('calls electronAPI.envWrite when available', async () => {
      const envWrite = vi.fn().mockResolvedValue(undefined);
      (global as any).electronAPI = { envWrite };

      mockProxyFetchGet.mockResolvedValue([]);
      mockProxyFetchPost.mockResolvedValue({});

      const { result } = renderHook(() =>
        useIntegrationManagement(defaultItems())
      );
      await waitFor(() => expect(mockProxyFetchGet).toHaveBeenCalled());

      await act(async () => {
        await result.current.saveEnvAndConfig(
          'Slack',
          'SLACK_BOT_TOKEN',
          'xoxb-val'
        );
      });

      expect(envWrite).toHaveBeenCalledWith('user@test.com', {
        key: 'SLACK_BOT_TOKEN',
        value: 'xoxb-val',
      });

      delete (global as any).electronAPI;
    });
  });

  describe('processOauth — Slack', () => {
    it('exchanges code for token and saves config', async () => {
      mockProxyFetchGet.mockResolvedValue([]);
      mockProxyFetchPost.mockResolvedValue({ access_token: 'xoxb-oauth' });

      const { result } = renderHook(() =>
        useIntegrationManagement([mockSlackItem])
      );
      await waitFor(() => expect(mockProxyFetchGet).toHaveBeenCalled());

      const handler = (global.ipcRenderer.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'oauth-authorized'
      )?.[1];

      expect(handler).toBeDefined();

      await act(async () => {
        await handler({}, { provider: 'Slack', code: 'auth-code-123' });
      });

      expect(mockProxyFetchPost).toHaveBeenCalledWith(
        '/api/v1/oauth/slack/token',
        {
          code: 'auth-code-123',
        }
      );
    });

    it('skips when provider not in items', async () => {
      const { result } = renderHook(() =>
        useIntegrationManagement([mockSlackItem])
      );
      await waitFor(() => expect(mockProxyFetchGet).toHaveBeenCalled());

      const handler = (global.ipcRenderer.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'oauth-authorized'
      )?.[1];

      const initialPostCount = mockProxyFetchPost.mock.calls.length;

      await act(async () => {
        await handler({}, { provider: 'GitHub', code: 'xyz' });
      });

      expect(mockProxyFetchPost.mock.calls.length).toBe(initialPostCount);
    });

    it('caches event when items are empty', async () => {
      const { result } = renderHook(() => useIntegrationManagement([]));
      await waitFor(() => expect(mockProxyFetchGet).toHaveBeenCalled());

      const handler = (global.ipcRenderer.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'oauth-authorized'
      )?.[1];

      await act(async () => {
        await handler({}, { provider: 'Slack', code: 'cached-code' });
      });

      const initialPostCount = mockProxyFetchPost.mock.calls.length;
      expect(initialPostCount).toBe(0);
    });

    it('handles OAuth failure gracefully', async () => {
      mockProxyFetchPost.mockRejectedValue(new Error('token exchange failed'));

      const { result } = renderHook(() =>
        useIntegrationManagement([mockSlackItem])
      );
      await waitFor(() => expect(mockProxyFetchGet).toHaveBeenCalled());

      const handler = (global.ipcRenderer.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'oauth-authorized'
      )?.[1];

      await act(async () => {
        await handler({}, { provider: 'Slack', code: 'fail-code' });
      });
    });

    it('ignores event without provider or code', async () => {
      const { result } = renderHook(() =>
        useIntegrationManagement([mockSlackItem])
      );
      await waitFor(() => expect(mockProxyFetchGet).toHaveBeenCalled());

      const handler = (global.ipcRenderer.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'oauth-authorized'
      )?.[1];

      const before = mockProxyFetchPost.mock.calls.length;

      await act(async () => {
        await handler({}, { provider: '', code: '' });
      });

      expect(mockProxyFetchPost.mock.calls.length).toBe(before);
    });
  });

  describe('processOauth — LinkedIn', () => {
    it('saves LinkedIn token via local backend and config', async () => {
      mockProxyFetchGet.mockResolvedValue([]);
      mockProxyFetchPost.mockResolvedValue({
        access_token: 'li-at',
        refresh_token: 'li-rt',
        expires_in: 3600,
      });

      const { result } = renderHook(() =>
        useIntegrationManagement([mockLinkedinItem])
      );
      await waitFor(() => expect(mockProxyFetchGet).toHaveBeenCalled());

      const handler = (global.ipcRenderer.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'oauth-authorized'
      )?.[1];

      await act(async () => {
        await handler({}, { provider: 'LinkedIn', code: 'li-code' });
      });

      expect(mockFetchPost).toHaveBeenCalledWith('/linkedin/save-token', {
        access_token: 'li-at',
        refresh_token: 'li-rt',
        expires_in: 3600,
      });
    });

    it('handles LinkedIn without access_token', async () => {
      mockProxyFetchPost.mockResolvedValue({});

      const { result } = renderHook(() =>
        useIntegrationManagement([mockLinkedinItem])
      );
      await waitFor(() => expect(mockProxyFetchGet).toHaveBeenCalled());

      const handler = (global.ipcRenderer.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'oauth-authorized'
      )?.[1];

      await act(async () => {
        await handler({}, { provider: 'LinkedIn', code: 'li-code' });
      });

      expect(mockFetchPost).not.toHaveBeenCalled();
    });
  });

  describe('IPC listener registration', () => {
    it('registers oauth-authorized and oauth-callback-url listeners', async () => {
      renderHook(() => useIntegrationManagement(defaultItems()));

      await waitFor(() => {
        const onCalls = (global.ipcRenderer.on as any).mock.calls.map(
          (c: any[]) => c[0]
        );
        expect(onCalls).toContain('oauth-authorized');
        expect(onCalls).toContain('oauth-callback-url');
      });
    });

    it('unregisters listeners on unmount', async () => {
      const { unmount } = renderHook(() =>
        useIntegrationManagement(defaultItems())
      );

      await waitFor(() => expect(global.ipcRenderer.on).toHaveBeenCalled());

      unmount();

      expect(global.ipcRenderer.off).toHaveBeenCalledWith(
        'oauth-authorized',
        expect.any(Function)
      );
      expect(global.ipcRenderer.off).toHaveBeenCalledWith(
        'oauth-callback-url',
        expect.any(Function)
      );
    });
  });

  describe('callBackUrl', () => {
    it('updates when oauth-callback-url event fires', async () => {
      const { result } = renderHook(() =>
        useIntegrationManagement(defaultItems())
      );

      await waitFor(() => expect(global.ipcRenderer.on).toHaveBeenCalled());

      const handler = (global.ipcRenderer.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'oauth-callback-url'
      )?.[1];

      act(() => {
        handler({}, { url: 'https://callback.example.com', provider: 'Slack' });
      });

      await waitFor(() => {
        expect(result.current.callBackUrl).toBe('https://callback.example.com');
      });
    });

    it('ignores event without url or provider', async () => {
      const { result } = renderHook(() =>
        useIntegrationManagement(defaultItems())
      );

      await waitFor(() => expect(global.ipcRenderer.on).toHaveBeenCalled());

      const handler = (global.ipcRenderer.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'oauth-callback-url'
      )?.[1];

      act(() => {
        handler({}, { url: '', provider: '' });
      });

      expect(result.current.callBackUrl).toBeNull();
    });
  });

  describe('handleUninstall', () => {
    it('deletes configs and calls envRemove', async () => {
      const envRemove = vi.fn().mockResolvedValue(undefined);
      (global as any).electronAPI = { envRemove };

      mockProxyFetchGet.mockResolvedValue([
        {
          id: 10,
          config_group: 'Slack',
          config_name: 'SLACK_BOT_TOKEN',
          config_value: 'xoxb',
        },
      ]);

      const { result } = renderHook(() =>
        useIntegrationManagement([mockSlackItem])
      );
      await waitFor(() => expect(result.current.configs.length).toBe(1));

      await act(async () => {
        await result.current.handleUninstall(mockSlackItem);
      });

      expect(mockCheckAgentTool).toHaveBeenCalledWith('Slack');
      expect(mockProxyFetchDelete).toHaveBeenCalledWith('/api/v1/configs/10');
      expect(envRemove).toHaveBeenCalledWith(
        'user@test.com',
        'SLACK_BOT_TOKEN'
      );

      delete (global as any).electronAPI;
    });

    it('cleans up Google Calendar tokens on uninstall', async () => {
      mockProxyFetchGet.mockResolvedValue([
        {
          id: 20,
          config_group: 'Google Calendar',
          config_name: 'GOOGLE_REFRESH_TOKEN',
          config_value: 'rt',
        },
      ]);

      const { result } = renderHook(() =>
        useIntegrationManagement([mockGoogleCalendarItem])
      );
      await waitFor(() => expect(result.current.configs.length).toBe(1));

      await act(async () => {
        await result.current.handleUninstall(mockGoogleCalendarItem);
      });

      expect(mockFetchDelete).toHaveBeenCalledWith(
        '/uninstall/tool/google_calendar'
      );
    });

    it('cleans up Notion tokens on uninstall', async () => {
      mockProxyFetchGet.mockResolvedValue([
        {
          id: 30,
          config_group: 'Notion',
          config_name: 'NOTION_API_KEY',
          config_value: 'ntn',
        },
      ]);

      const { result } = renderHook(() =>
        useIntegrationManagement([mockNotionItem])
      );
      await waitFor(() => expect(result.current.configs.length).toBe(1));

      await act(async () => {
        await result.current.handleUninstall(mockNotionItem);
      });

      expect(mockFetchDelete).toHaveBeenCalledWith('/uninstall/tool/notion');
    });

    it('cleans up LinkedIn tokens on uninstall', async () => {
      mockProxyFetchGet.mockResolvedValue([
        {
          id: 40,
          config_group: 'LinkedIn',
          config_name: 'LINKEDIN_ACCESS_TOKEN',
          config_value: 'at',
        },
      ]);

      const { result } = renderHook(() =>
        useIntegrationManagement([mockLinkedinItem])
      );
      await waitFor(() => expect(result.current.configs.length).toBe(1));

      await act(async () => {
        await result.current.handleUninstall(mockLinkedinItem);
      });

      expect(mockFetchDelete).toHaveBeenCalledWith('/uninstall/tool/linkedin');
    });

    it('removes configs from local state after uninstall', async () => {
      mockProxyFetchGet.mockResolvedValue([
        {
          id: 50,
          config_group: 'Slack',
          config_name: 'SLACK_BOT_TOKEN',
          config_value: 'xoxb',
        },
      ]);

      const { result } = renderHook(() =>
        useIntegrationManagement([mockSlackItem])
      );
      await waitFor(() => expect(result.current.configs.length).toBe(1));

      await act(async () => {
        await result.current.handleUninstall(mockSlackItem);
      });

      expect(result.current.configs).toEqual([]);
    });
  });

  describe('createMcpFromItem', () => {
    it('builds MCP object with empty env vars', async () => {
      const { result } = renderHook(() =>
        useIntegrationManagement(defaultItems())
      );
      await waitFor(() => expect(mockProxyFetchGet).toHaveBeenCalled());

      const mcp = result.current.createMcpFromItem(mockSlackItem, 7);

      expect(mcp).toEqual({
        name: 'Slack',
        key: 'Slack',
        install_command: {
          env: { SLACK_BOT_TOKEN: '' },
        },
        id: 7,
      });
    });

    it('handles item with multiple env vars', async () => {
      const multiEnvItem: IntegrationItem = {
        key: 'Custom',
        name: 'Custom',
        desc: 'Custom integration',
        env_vars: ['VAR_A', 'VAR_B', 'VAR_C'],
        onInstall: vi.fn(),
      };

      const { result } = renderHook(() =>
        useIntegrationManagement([multiEnvItem])
      );
      await waitFor(() => expect(mockProxyFetchGet).toHaveBeenCalled());

      const mcp = result.current.createMcpFromItem(multiEnvItem, 1);

      expect(mcp.install_command.env).toEqual({
        VAR_A: '',
        VAR_B: '',
        VAR_C: '',
      });
    });
  });

  describe('stability', () => {
    it('does not cause render loop on repeated renders', async () => {
      const items = defaultItems();

      const { result, rerender } = renderHook(
        ({ items }) => useIntegrationManagement(items),
        { initialProps: { items } }
      );

      await waitFor(() => expect(mockProxyFetchGet).toHaveBeenCalled());

      const initialOnCount = (global.ipcRenderer.on as any).mock.calls.length;

      rerender({ items: [...items] });
      rerender({ items: [...items] });
      rerender({ items: [...items] });

      await waitFor(() => {
        const newOnCalls =
          (global.ipcRenderer.on as any).mock.calls.length - initialOnCount;
        expect(newOnCalls).toBeLessThanOrEqual(4);
      });
    });

    it('processOauth callback identity is stable across renders', async () => {
      const items = defaultItems();

      const { result, rerender } = renderHook(
        ({ items }) => useIntegrationManagement(items),
        { initialProps: { items } }
      );

      await waitFor(() => expect(mockProxyFetchGet).toHaveBeenCalled());

      const firstFetchInstalled = result.current.fetchInstalled;
      const firstSaveEnv = result.current.saveEnvAndConfig;
      const firstUninstall = result.current.handleUninstall;
      const firstCreateMcp = result.current.createMcpFromItem;

      rerender({ items: [...items] });

      expect(result.current.fetchInstalled).toBe(firstFetchInstalled);
      expect(result.current.saveEnvAndConfig).toBe(firstSaveEnv);
      expect(result.current.handleUninstall).toBe(firstUninstall);
      expect(result.current.createMcpFromItem).toBe(firstCreateMcp);
    });
  });
});
