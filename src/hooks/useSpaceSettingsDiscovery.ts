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
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import {
  discoverSpaceBundleResources,
  discoverSpaceConnectorDetails,
  discoverSpaceConnectors,
  discoverSpaceModels,
  type SpaceBundleDiscovery,
  type SpaceConnectorCandidate,
} from '@/service/spaceSettingsDiscovery';
import type { WorkspaceConfigurationIdentity } from '@/service/workspaceConfigurationApi';

export type SpaceDiscoveryStatus =
  'idle' | 'loading' | 'ready' | 'empty' | 'error';

export interface SpaceDiscoveryCatalog<T> {
  items: T[];
  status: SpaceDiscoveryStatus;
  error: string | null;
  retry: () => void;
}

interface CatalogState<T> {
  scope: string;
  data: T | null;
  status: SpaceDiscoveryStatus;
  error: string | null;
}

function useCatalog<T>(
  scope: string,
  enabled: boolean,
  load: () => Promise<T>
) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<CatalogState<T>>({
    scope: '',
    data: null,
    status: 'idle',
    error: null,
  });
  const activeScope = useRef(scope);
  useLayoutEffect(() => {
    activeScope.current = scope;
  }, [scope]);
  useEffect(() => {
    let current = true;
    setState({
      scope,
      data: null,
      status: enabled ? 'loading' : 'idle',
      error: null,
    });
    if (enabled) {
      void load().then(
        (data) => {
          if (current && activeScope.current === scope)
            setState({ scope, data, status: 'ready', error: null });
        },
        () => {
          // Network diagnostics can contain local paths or server response bodies.
          if (current && activeScope.current === scope)
            setState({
              scope,
              data: null,
              status: 'error',
              error: 'discovery_unavailable',
            });
        }
      );
    }
    return () => {
      current = false;
    };
  }, [scope, enabled, load, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return {
    ...(state.scope === scope
      ? state
      : {
          scope,
          data: null,
          status: enabled ? ('loading' as const) : ('idle' as const),
          error: null,
        }),
    retry,
  };
}

const catalog = <T>(
  state: {
    status: SpaceDiscoveryStatus;
    error: string | null;
    retry: () => void;
  },
  items: T[]
): SpaceDiscoveryCatalog<T> => ({
  items,
  status:
    state.status === 'ready' && items.length === 0 ? 'empty' : state.status,
  error: state.error,
  retry: state.retry,
});

interface ConnectorState {
  scope: string;
  items: SpaceConnectorCandidate[];
  status: SpaceDiscoveryStatus;
  error: string | null;
  page: number;
  hasMore: boolean;
  loadingMore: boolean;
  detailStatus: SpaceDiscoveryStatus;
  detailError: string | null;
}

const initialConnectors = (
  scope: string,
  enabled: boolean
): ConnectorState => ({
  scope,
  items: [],
  status: enabled ? 'loading' : 'idle',
  error: null,
  page: 0,
  hasMore: false,
  loadingMore: false,
  detailStatus: 'idle',
  detailError: null,
});

function useConnectorCatalog(scope: string, enabled: boolean) {
  const [search, setSearch] = useState({ scope, query: '' });
  const query = search.scope === scope ? search.query : '';
  const requestScope = JSON.stringify([scope, query]);
  const activeScope = useRef(requestScope);
  useLayoutEffect(() => {
    activeScope.current = requestScope;
  }, [requestScope]);
  const requestSequence = useRef(0);
  const detailSequence = useRef(0);
  const invalidateRequests = useCallback(() => {
    ++requestSequence.current;
    ++detailSequence.current;
  }, []);
  const loadingMoreRef = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [stored, setStored] = useState<ConnectorState>(() =>
    initialConnectors(requestScope, enabled)
  );
  const state =
    stored.scope === requestScope
      ? stored
      : initialConnectors(requestScope, enabled);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    ++detailSequence.current;
    loadingMoreRef.current = false;
    setStored(initialConnectors(requestScope, enabled));
    if (!enabled) return;
    void discoverSpaceConnectors(query, 1).then(
      (result) => {
        if (
          activeScope.current !== requestScope ||
          requestSequence.current !== sequence
        )
          return;
        setStored({
          ...initialConnectors(requestScope, enabled),
          ...result,
          page: 1,
          status: result.items.length ? 'ready' : 'empty',
        });
      },
      () => {
        if (
          activeScope.current !== requestScope ||
          requestSequence.current !== sequence
        )
          return;
        setStored({
          ...initialConnectors(requestScope, enabled),
          status: 'error',
          error: 'discovery_unavailable',
        });
      }
    );
    return invalidateRequests;
  }, [enabled, requestScope, query, attempt, invalidateRequests]);

  const loadMore = useCallback(async () => {
    if (
      !enabled ||
      !state.hasMore ||
      state.loadingMore ||
      loadingMoreRef.current ||
      state.scope !== activeScope.current
    )
      return;
    loadingMoreRef.current = true;
    const sequence = requestSequence.current;
    const nextPage = state.page + 1;
    setStored((current) => ({ ...current, loadingMore: true, error: null }));
    try {
      const result = await discoverSpaceConnectors(query, nextPage);
      if (
        activeScope.current !== requestScope ||
        requestSequence.current !== sequence
      )
        return;
      setStored((current) => ({
        ...current,
        items: Array.from(
          new Map(
            [...current.items, ...result.items].map((item) => [
              item.value,
              item,
            ])
          ).values()
        ),
        hasMore: result.hasMore,
        page: nextPage,
        loadingMore: false,
      }));
    } catch {
      if (
        activeScope.current !== requestScope ||
        requestSequence.current !== sequence
      )
        return;
      setStored((current) => ({
        ...current,
        loadingMore: false,
        error: 'discovery_unavailable',
      }));
    } finally {
      if (
        activeScope.current === requestScope &&
        requestSequence.current === sequence
      )
        loadingMoreRef.current = false;
    }
  }, [
    enabled,
    state.hasMore,
    state.loadingMore,
    state.scope,
    state.page,
    query,
    requestScope,
  ]);

  const fetchDetails = useCallback(
    async (service: string): Promise<SpaceConnectorCandidate | null> => {
      if (!enabled || activeScope.current !== requestScope) return null;
      const sequence = ++detailSequence.current;
      setStored((current) => ({
        ...current,
        detailStatus: 'loading',
        detailError: null,
      }));
      try {
        const item = await discoverSpaceConnectorDetails(service);
        if (
          activeScope.current !== requestScope ||
          detailSequence.current !== sequence
        )
          return null;
        setStored((current) => ({
          ...current,
          items: current.items.map((candidate) =>
            candidate.service === service ? item : candidate
          ),
          detailStatus: 'ready',
          detailError: null,
        }));
        return item;
      } catch {
        if (
          activeScope.current !== requestScope ||
          detailSequence.current !== sequence
        )
          return null;
        setStored((current) => ({
          ...current,
          detailStatus: 'error',
          detailError: 'discovery_unavailable',
        }));
        return null;
      }
    },
    [enabled, requestScope]
  );
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const setQuery = useCallback(
    (value: string) => setSearch({ scope, query: value }),
    [scope]
  );

  return { ...state, query, loadMore, fetchDetails, retry, setQuery };
}

/** Discovery owns only transient metadata, never configuration or global selection. */
export function useSpaceSettingsDiscovery({
  spaceId,
  identity,
  enabled = true,
  editorKey = '',
}: {
  spaceId?: string | null;
  identity: WorkspaceConfigurationIdentity | null;
  enabled?: boolean;
  editorKey?: string;
}) {
  const email = identity?.email ?? '';
  const userId = identity?.userId ?? null;
  const active = enabled && Boolean(spaceId && email);
  const scope = JSON.stringify([
    spaceId ?? '',
    email,
    userId,
    editorKey,
    active,
  ]);
  const loadBundle = useCallback(
    () => discoverSpaceBundleResources(spaceId ?? '', { email, userId }),
    [spaceId, email, userId]
  );
  const models = useCatalog(scope, active, discoverSpaceModels);
  const resources = useCatalog<SpaceBundleDiscovery>(scope, active, loadBundle);
  const connectors = useConnectorCatalog(scope, active);

  return {
    models: catalog(models, models.data ?? []),
    skills: catalog(resources, resources.data?.skills ?? []),
    mcpServers: catalog(resources, resources.data?.mcpServers ?? []),
    connectors,
    setConnectorQuery: connectors.setQuery,
  };
}
