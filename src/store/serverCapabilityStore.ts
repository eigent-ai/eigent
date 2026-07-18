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

import { proxyFetchGet } from '@/api/http';
import { create } from 'zustand';

const CAPABILITY_CACHE_TTL_MS = 60 * 1000;
let capabilityRefreshPromise: Promise<ServerCapabilities> | null = null;

export interface FeatureCapability {
  enabled: boolean;
  provider?: string | null;
  reason?: string | null;
}

export interface ServerCapabilities {
  features: {
    connector_gateway: FeatureCapability;
  };
}

type CapabilityStatus = 'idle' | 'loading' | 'ready' | 'error';

interface ServerCapabilityState {
  capabilities: ServerCapabilities;
  status: CapabilityStatus;
  lastFetchedAt: number;
  error: string | null;
  fetchCapabilities: (force?: boolean) => Promise<ServerCapabilities>;
  isConnectorGatewayEnabled: () => boolean;
}

const disabledCapabilities = (reason: string): ServerCapabilities => ({
  features: {
    connector_gateway: {
      enabled: false,
      provider: null,
      reason,
    },
  },
});

function normalizeCapabilities(raw: unknown): ServerCapabilities {
  const input = raw as Partial<ServerCapabilities> | undefined;
  const connectorGateway = input?.features?.connector_gateway;
  return {
    features: {
      connector_gateway: {
        enabled: connectorGateway?.enabled === true,
        provider:
          typeof connectorGateway?.provider === 'string'
            ? connectorGateway.provider
            : null,
        reason:
          typeof connectorGateway?.reason === 'string'
            ? connectorGateway.reason
            : null,
      },
    },
  };
}

export const useServerCapabilityStore = create<ServerCapabilityState>()(
  (set, get) => ({
    capabilities: disabledCapabilities('not_loaded'),
    status: 'idle',
    lastFetchedAt: 0,
    error: null,

    fetchCapabilities: async (force = false) => {
      if (import.meta.env.VITE_USE_LOCAL_PROXY === 'true') {
        const localCapabilities = disabledCapabilities('local_proxy');
        set({
          capabilities: localCapabilities,
          status: 'ready',
          lastFetchedAt: Date.now(),
          error: null,
        });
        return localCapabilities;
      }

      const state = get();
      const now = Date.now();
      if (
        !force &&
        state.status === 'ready' &&
        now - state.lastFetchedAt < CAPABILITY_CACHE_TTL_MS
      ) {
        return state.capabilities;
      }
      if (capabilityRefreshPromise) {
        return capabilityRefreshPromise;
      }

      capabilityRefreshPromise = (async () => {
        set({ status: 'loading', error: null });
        try {
          const capabilities = normalizeCapabilities(
            await proxyFetchGet('/api/v1/server/capabilities')
          );
          set({
            capabilities,
            status: 'ready',
            lastFetchedAt: Date.now(),
            error: null,
          });
          return capabilities;
        } catch (error: any) {
          const fallback = disabledCapabilities('capability_request_failed');
          set({
            capabilities: fallback,
            status: 'error',
            lastFetchedAt: Date.now(),
            error: error?.message || 'Failed to load server capabilities',
          });
          return fallback;
        } finally {
          capabilityRefreshPromise = null;
        }
      })();

      return capabilityRefreshPromise;
    },

    isConnectorGatewayEnabled: () =>
      import.meta.env.VITE_USE_LOCAL_PROXY !== 'true' &&
      get().capabilities.features.connector_gateway.enabled === true,
  })
);

export const getServerCapabilityStore = () =>
  useServerCapabilityStore.getState();
