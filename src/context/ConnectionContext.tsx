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
 * ConnectionProvider: Phase 2 - config-driven Brain connection.
 * Resolves brainEndpoint (Electron: get-backend-port) and sets X-Channel.
 * getBaseURL in http.ts reads from connectionStore.
 */

import { getDefaultBrainEndpoint } from '@/api/http';
import { useHost } from '@/host';
import type { ConnectionChannel } from '@/store/connectionStore';
import {
  getConnectionConfig,
  setConnectionConfig,
} from '@/store/connectionStore';
import React, { useEffect } from 'react';

export {
  getConnectionConfig,
  setConnectionConfig,
} from '@/store/connectionStore';
export type {
  ConnectionChannel,
  ConnectionConfig,
} from '@/store/connectionStore';

interface ConnectionProviderProps {
  channel?: ConnectionChannel;
  children: React.ReactNode;
}

export function ConnectionProvider({
  channel = 'desktop',
  children,
}: ConnectionProviderProps) {
  const host = useHost();

  useEffect(() => {
    const hasDesktop = !!(host?.electronAPI && host?.ipcRenderer);
    const effectiveChannel = hasDesktop ? channel : 'web';
    setConnectionConfig({ channel: effectiveChannel });

    const resolveEndpoint = async () => {
      let resolvedEndpoint = '';
      if (hasDesktop && host?.electronAPI?.getBackendPort) {
        try {
          const port = await host.electronAPI.getBackendPort();
          if (port && port > 0) {
            resolvedEndpoint = `http://localhost:${port}`;
            setConnectionConfig({ brainEndpoint: resolvedEndpoint });
            return resolvedEndpoint;
          }
        } catch {
          // IPC not ready
        }
        return resolvedEndpoint;
      }
      // Web: VITE_BRAIN_ENDPOINT (dev default http://localhost:5001)
      const envEndpoint = getDefaultBrainEndpoint();
      if (envEndpoint && typeof envEndpoint === 'string') {
        resolvedEndpoint = envEndpoint.replace(/\/$/, '');
        setConnectionConfig({ brainEndpoint: resolvedEndpoint });
      } else if (effectiveChannel === 'web') {
        console.error(
          '[ConnectionProvider] VITE_BRAIN_ENDPOINT not set for production web mode'
        );
      }
      return resolvedEndpoint;
    };

    const ensureSessionId = async (endpoint: string) => {
      if (effectiveChannel !== 'web' || !endpoint) {
        return;
      }
      if (getConnectionConfig().sessionId) {
        return;
      }
      try {
        const response = await fetch(`${endpoint}/health`, {
          headers: { 'X-Channel': effectiveChannel },
        });
        const sessionId = response.headers.get('x-session-id');
        if (sessionId) {
          setConnectionConfig({ sessionId });
        }
      } catch {
        // Brain may not be ready yet; session will be created on the first request.
      }
    };

    resolveEndpoint().then((endpoint) => {
      if (endpoint) {
        void ensureSessionId(endpoint);
      }
    });
  }, [channel, host]);

  return <>{children}</>;
}
