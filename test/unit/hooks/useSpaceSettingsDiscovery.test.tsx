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

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { modelsMock, globalMock, connectorsMock, detailMock } = vi.hoisted(
  () => ({
    modelsMock: vi.fn(),
    globalMock: vi.fn(),
    connectorsMock: vi.fn(),
    detailMock: vi.fn(),
  })
);
vi.mock('@/service/spaceSettingsDiscovery', () => ({
  discoverSpaceModels: modelsMock,
  discoverGlobalSpaceResources: globalMock,
  discoverSpaceConnectors: connectorsMock,
  discoverSpaceConnectorDetails: detailMock,
}));

import { useSpaceSettingsDiscovery } from '@/hooks/useSpaceSettingsDiscovery';
import type { SpaceConnectorCandidate } from '@/service/spaceSettingsDiscovery';

const connector = (service: string): SpaceConnectorCandidate => ({
  value: service,
  service,
  label: service,
  source: 'connector_catalog',
  availability: 'available',
  connected: false,
  supportedGrants: [],
});
const pending = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const options = {
  spaceId: 'space-1',
  identity: { email: 'fixture@example.com', userId: 7 },
  editorKey: 'skill-new',
};

describe('useSpaceSettingsDiscovery', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    modelsMock.mockResolvedValue({ items: [], unavailableSources: [] });
    globalMock.mockResolvedValue({ skills: [], mcpServers: [] });
    connectorsMock.mockResolvedValue({ items: [], hasMore: false });
  });

  it('keeps independent empty/error catalogs and retries without exposing diagnostics', async () => {
    modelsMock.mockRejectedValueOnce(
      new Error('/fixture/private/path?api_key=fixture-secret')
    );
    const { result } = renderHook(() => useSpaceSettingsDiscovery(options));
    await waitFor(() => expect(result.current.models.status).toBe('error'));
    expect(result.current.models.error).toBe('discovery_unavailable');
    expect(result.current.skills.status).toBe('empty');
    expect(result.current.connectors.status).toBe('empty');
    act(() => result.current.models.retry());
    await waitFor(() => expect(result.current.models.status).toBe('empty'));
    expect(modelsMock).toHaveBeenCalledTimes(2);
    expect(globalMock).toHaveBeenCalledTimes(1);
  });

  it('loads global resources for an empty Space without requesting a Bundle', async () => {
    globalMock.mockResolvedValue({
      skills: [
        { value: 'registry://global/skills/fixture', label: 'Global skill' },
      ],
      mcpServers: [{ value: 'global-mcp', label: 'Global MCP' }],
    });
    const { result } = renderHook(() => useSpaceSettingsDiscovery(options));
    await waitFor(() => expect(result.current.skills.status).toBe('ready'));
    expect(result.current.skills.items[0].label).toBe('Global skill');
    expect(result.current.mcpServers.items[0].label).toBe('Global MCP');
    expect(globalMock).toHaveBeenCalledWith(options.identity);
  });

  it('retains healthy models alongside a visible partial-source warning and clears it on retry', async () => {
    const healthy = { value: 'provider://cloud/healthy', label: 'Healthy' };
    modelsMock.mockResolvedValueOnce({
      items: [healthy],
      unavailableSources: ['provider_catalog'],
    });
    const { result } = renderHook(() => useSpaceSettingsDiscovery(options));
    await waitFor(() => expect(result.current.models.status).toBe('ready'));
    expect(result.current.models.items).toEqual([healthy]);
    expect(result.current.models.error).toBe('model_catalog_partial');
    modelsMock.mockResolvedValueOnce({
      items: [healthy],
      unavailableSources: [],
    });
    act(() => result.current.models.retry());
    await waitFor(() => expect(result.current.models.error).toBeNull());
    await waitFor(() => expect(result.current.models.status).toBe('ready'));
    expect(result.current.models.items).toEqual([healthy]);
  });

  it('shows disabled connector service explicitly and can recover on retry', async () => {
    connectorsMock.mockRejectedValueOnce(
      new Error('connector_catalog_disabled')
    );
    const { result } = renderHook(() => useSpaceSettingsDiscovery(options));
    await waitFor(() => expect(result.current.connectors.status).toBe('error'));
    expect(result.current.connectors.error).toBe('connector_catalog_disabled');
    connectorsMock.mockResolvedValueOnce({
      items: [connector('github')],
      hasMore: false,
    });
    act(() => result.current.connectors.retry());
    await waitFor(() => expect(result.current.connectors.status).toBe('ready'));
    expect(result.current.connectors.error).toBeNull();
  });

  it('updates empty first-page status once a later page contains a selectable connector', async () => {
    connectorsMock.mockResolvedValueOnce({ items: [], hasMore: true });
    const { result } = renderHook(() => useSpaceSettingsDiscovery(options));
    await waitFor(() => expect(result.current.connectors.status).toBe('empty'));
    connectorsMock.mockResolvedValueOnce({
      items: [connector('github')],
      hasMore: false,
    });
    await act(() => result.current.connectors.loadMore());
    expect(result.current.connectors.status).toBe('ready');
    expect(result.current.connectors.items).toEqual([connector('github')]);
    expect(result.current.connectors.hasMore).toBe(false);
  });

  it('preserves previous connector pages on failure, stops repeated paging, and reloads all pages after retry', async () => {
    connectorsMock.mockResolvedValueOnce({
      items: [connector('github')],
      hasMore: true,
    });
    const { result } = renderHook(() => useSpaceSettingsDiscovery(options));
    await waitFor(() => expect(result.current.connectors.status).toBe('ready'));
    connectorsMock.mockRejectedValueOnce(
      new Error('/private/path?api_key=secret')
    );
    await act(() => result.current.connectors.loadMore());
    expect(result.current.connectors.items).toEqual([connector('github')]);
    expect(result.current.connectors.error).toBe('discovery_unavailable');
    expect(result.current.connectors.loadingMore).toBe(false);
    await act(() => result.current.connectors.loadMore());
    expect(connectorsMock).toHaveBeenCalledTimes(2);
    connectorsMock.mockResolvedValueOnce({
      items: [connector('github')],
      hasMore: true,
    });
    act(() => result.current.connectors.retry());
    await waitFor(() => expect(result.current.connectors.status).toBe('ready'));
    expect(result.current.connectors.error).toBeNull();
    connectorsMock.mockResolvedValueOnce({
      items: [connector('slack')],
      hasMore: false,
    });
    await act(() => result.current.connectors.loadMore());
    expect(result.current.connectors.items.map((item) => item.value)).toEqual([
      'github',
      'slack',
    ]);
    expect(result.current.connectors.page).toBe(2);
    expect(result.current.connectors.hasMore).toBe(false);
    expect(connectorsMock.mock.calls).toEqual([
      ['', 1],
      ['', 2],
      ['', 1],
      ['', 2],
    ]);
  });

  it.each([
    { ...options, spaceId: 'space-2' },
    {
      ...options,
      identity: { ...options.identity, email: 'other@example.com' },
    },
    { ...options, identity: { ...options.identity, userId: 8 } },
    { ...options, editorKey: 'skill-other' },
  ])('quarantines late discovery when scope changes to %j', async (next) => {
    const oldModels = pending<{
      items: unknown[];
      unavailableSources: string[];
    }>();
    const oldBundle = pending<{ skills: unknown[]; mcpServers: unknown[] }>();
    const oldConnectors = pending<{
      items: SpaceConnectorCandidate[];
      hasMore: boolean;
    }>();
    modelsMock.mockReturnValueOnce(oldModels.promise);
    globalMock.mockReturnValueOnce(oldBundle.promise);
    connectorsMock.mockReturnValueOnce(oldConnectors.promise);
    const { result, rerender } = renderHook(
      (props) => useSpaceSettingsDiscovery(props),
      { initialProps: options }
    );
    rerender(next);
    await waitFor(() => expect(result.current.models.status).toBe('empty'));
    await act(async () => {
      oldModels.resolve({
        items: [{ value: 'old-model' }],
        unavailableSources: ['provider_catalog'],
      });
      oldBundle.resolve({
        skills: [{ value: 'old-skill' }],
        mcpServers: [{ value: 'old-mcp' }],
      });
      oldConnectors.resolve({
        items: [connector('old-connector')],
        hasMore: true,
      });
    });
    expect(result.current.models.items).toEqual([]);
    expect(result.current.skills.items).toEqual([]);
    expect(result.current.mcpServers.items).toEqual([]);
    expect(result.current.connectors.items).toEqual([]);
  });

  it('loads searchable pages once, deduplicates results, and discards an old search page', async () => {
    connectorsMock.mockResolvedValueOnce({
      items: [connector('github')],
      hasMore: true,
    });
    const { result } = renderHook(() => useSpaceSettingsDiscovery(options));
    await waitFor(() => expect(result.current.connectors.status).toBe('ready'));
    const page = pending<{
      items: SpaceConnectorCandidate[];
      hasMore: boolean;
    }>();
    connectorsMock.mockReturnValueOnce(page.promise);
    act(() => {
      void result.current.connectors.loadMore();
      void result.current.connectors.loadMore();
    });
    expect(connectorsMock).toHaveBeenCalledTimes(2);
    await act(async () =>
      page.resolve({
        items: [connector('github'), connector('slack')],
        hasMore: true,
      })
    );
    expect(result.current.connectors.items.map((item) => item.value)).toEqual([
      'github',
      'slack',
    ]);
    const oldPage = pending<{
      items: SpaceConnectorCandidate[];
      hasMore: boolean;
    }>();
    connectorsMock.mockReturnValueOnce(oldPage.promise);
    act(() => {
      void result.current.connectors.loadMore();
    });
    connectorsMock.mockResolvedValueOnce({
      items: [connector('calendar')],
      hasMore: false,
    });
    act(() => result.current.setConnectorQuery('calendar'));
    await waitFor(() =>
      expect(result.current.connectors.items[0]?.value).toBe('calendar')
    );
    await act(async () =>
      oldPage.resolve({ items: [connector('old')], hasMore: false })
    );
    expect(result.current.connectors.items.map((item) => item.value)).toEqual([
      'calendar',
    ]);
    expect(connectorsMock).toHaveBeenLastCalledWith('calendar', 1);
  });

  it('discards stale connector details on a newer selection and editor change', async () => {
    const { result, rerender } = renderHook(
      (props) => useSpaceSettingsDiscovery(props),
      { initialProps: options }
    );
    await waitFor(() => expect(result.current.connectors.status).toBe('empty'));
    const oldDetail = pending<SpaceConnectorCandidate>();
    detailMock
      .mockReturnValueOnce(oldDetail.promise)
      .mockResolvedValueOnce(connector('slack'));
    let oldRequest!: Promise<SpaceConnectorCandidate | null>;
    act(() => {
      oldRequest = result.current.connectors.fetchDetails('github');
    });
    await act(async () => {
      expect(await result.current.connectors.fetchDetails('slack')).toEqual(
        connector('slack')
      );
    });
    await act(async () => {
      oldDetail.resolve(connector('github'));
      expect(await oldRequest).toBeNull();
    });
    const nextDetail = pending<SpaceConnectorCandidate>();
    detailMock.mockReturnValueOnce(nextDetail.promise);
    act(() => {
      oldRequest = result.current.connectors.fetchDetails('github');
    });
    rerender({ ...options, editorKey: 'connector-new' });
    await act(async () => {
      nextDetail.resolve(connector('github'));
      expect(await oldRequest).toBeNull();
    });
    expect(result.current.connectors.detailStatus).toBe('idle');
  });

  it('does not discover when the editor/page is disabled or identity is missing', () => {
    const { result } = renderHook(() =>
      useSpaceSettingsDiscovery({ ...options, enabled: false })
    );
    expect(result.current.models.status).toBe('idle');
    renderHook(() =>
      useSpaceSettingsDiscovery({ spaceId: 'space-1', identity: null })
    );
    expect(modelsMock).not.toHaveBeenCalled();
    expect(globalMock).not.toHaveBeenCalled();
    expect(connectorsMock).not.toHaveBeenCalled();
  });
});
