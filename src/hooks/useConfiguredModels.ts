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

import { createHost } from '@/host/createHost';
import {
  fetchConfiguredProviders,
  MODEL_CONFIGURATIONS_CHANGED,
  type ConfiguredProvider,
} from '@/lib/configuredModels';
import { useAuthStore } from '@/store/authStore';
import { useCloudModelStore } from '@/store/cloudModelStore';
import { useModelVisibilityStore } from '@/store/modelVisibilityStore';
import { useCallback, useEffect, useRef, useState } from 'react';

const EMPTY_IDS: string[] = [];
export function useConfiguredModels() {
  const { email, token, user_id } = useAuthStore();
  const account = String(user_id || email || 'local');
  const cloudModels = useCloudModelStore((state) => state.models);
  const fetchCloudModels = useCloudModelStore(
    (state) => state.fetchCloudModels
  );
  const hidden = useModelVisibilityStore(
    (state) => state.hiddenByAccount[account] ?? EMPTY_IDS
  );
  const setHidden = useModelVisibilityStore((state) => state.setHidden);
  const [state, setState] = useState<{
    account: string;
    records: ConfiguredProvider[];
    loading: boolean;
    error: boolean;
  }>({ account, records: [], loading: true, error: false });
  const [codex, setCodex] = useState({
    account,
    connected: false,
    accountLabel: '',
  });
  const request = useRef({ generation: 0 });
  const refresh = useCallback(async () => {
    const generation = ++request.current.generation;
    setState((old) => ({ ...old, loading: true, error: false }));
    try {
      const records = await fetchConfiguredProviders();
      if (generation === request.current.generation)
        setState({ account, records, loading: false, error: false });
    } catch {
      if (generation === request.current.generation)
        setState({ account, records: [], loading: false, error: true });
    }
  }, [account]);
  useEffect(() => {
    const pending = request.current;
    void refresh();
    window.addEventListener(MODEL_CONFIGURATIONS_CHANGED, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      pending.generation++;
      window.removeEventListener(MODEL_CONFIGURATIONS_CHANGED, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh, token]);
  useEffect(() => {
    if (import.meta.env.VITE_USE_LOCAL_PROXY !== 'true')
      void fetchCloudModels();
  }, [fetchCloudModels]);
  useEffect(() => {
    let active = true;
    const refreshStatus = async () => {
      try {
        const status = email
          ? await createHost().electronAPI?.codexSubscriptionStatus?.(email)
          : null;
        if (active)
          setCodex({
            account,
            connected: Boolean(status?.connected),
            accountLabel: status?.account_label ?? '',
          });
      } catch {
        if (active) setCodex({ account, connected: false, accountLabel: '' });
      }
    };
    void refreshStatus();
    const ipc = createHost().ipcRenderer;
    ipc?.on?.('subscription-auth:codex-status-changed', refreshStatus);
    window.addEventListener(MODEL_CONFIGURATIONS_CHANGED, refreshStatus);
    return () => {
      active = false;
      ipc?.off?.('subscription-auth:codex-status-changed', refreshStatus);
      window.removeEventListener(MODEL_CONFIGURATIONS_CHANGED, refreshStatus);
    };
  }, [account, email]);
  return {
    records: state.account === account ? state.records : [],
    loading: state.account !== account || state.loading,
    error: state.account === account && state.error,
    refresh,
    cloudModels,
    hidden,
    cloudAvailable: import.meta.env.VITE_USE_LOCAL_PROXY !== 'true',
    setHidden: (id: string, value: boolean) => setHidden(account, id, value),
    codexConnected: codex.account === account && codex.connected,
    codexAccountLabel: codex.account === account ? codex.accountLabel : '',
  };
}
