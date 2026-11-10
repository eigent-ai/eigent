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
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

const EMPTY_IDS: string[] = [];
type InventoryState = {
  key: string;
  records: ConfiguredProvider[];
  loading: boolean;
  error: boolean;
  loaded: boolean;
};
const emptyInventory: InventoryState = {
  key: '',
  records: [],
  loading: true,
  error: false,
  loaded: false,
};
let inventoryState = emptyInventory;
let generation = 0;
let pending: { key: string; promise: Promise<void> } | null = null;
const listeners = new Set<() => void>();

function setInventory(next: InventoryState) {
  inventoryState = next;
  listeners.forEach((listener) => listener());
}

function loadInventory(key: string, force = false): Promise<void> {
  if (pending?.key === key) return pending.promise;
  if (!force && inventoryState.key === key && inventoryState.loaded)
    return Promise.resolve();
  const request = ++generation;
  const previous = inventoryState.key === key ? inventoryState : emptyInventory;
  setInventory({
    ...previous,
    key,
    loading: !previous.loaded,
    error: false,
  });
  const promise = fetchConfiguredProviders()
    .then((records) => {
      if (request === generation)
        setInventory({
          key,
          records,
          loading: false,
          error: false,
          loaded: true,
        });
    })
    .catch(() => {
      if (request === generation)
        setInventory({
          ...inventoryState,
          loading: false,
          error: true,
          loaded: true,
        });
    })
    .finally(() => {
      if (pending?.promise === promise) pending = null;
    });
  pending = { key, promise };
  return promise;
}

function refreshInventory() {
  if (inventoryState.key) void loadInventory(inventoryState.key, true);
}

function subscribeInventory(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener(MODEL_CONFIGURATIONS_CHANGED, refreshInventory);
    window.addEventListener('focus', refreshInventory);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener(
        MODEL_CONFIGURATIONS_CHANGED,
        refreshInventory
      );
      window.removeEventListener('focus', refreshInventory);
      generation++;
      pending = null;
      inventoryState = emptyInventory;
    }
  };
}

const getInventorySnapshot = () => inventoryState;
export function useConfiguredModels() {
  const { email, token, user_id } = useAuthStore();
  const account = String(user_id || email || 'local');
  const key = `${account}:${token || ''}`;
  const cloudModels = useCloudModelStore((state) => state.models);
  const fetchCloudModels = useCloudModelStore(
    (state) => state.fetchCloudModels
  );
  const hidden = useModelVisibilityStore(
    (state) => state.hiddenByAccount[account] ?? EMPTY_IDS
  );
  const setHidden = useModelVisibilityStore((state) => state.setHidden);
  const state = useSyncExternalStore(
    subscribeInventory,
    getInventorySnapshot,
    getInventorySnapshot
  );
  const [codex, setCodex] = useState({
    account,
    connected: false,
    accountLabel: '',
  });
  const refresh = useCallback(() => loadInventory(key, true), [key]);
  useEffect(() => {
    void loadInventory(key);
  }, [key]);
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
    records: state.key === key ? state.records : [],
    loading: state.key !== key || state.loading,
    error: state.key === key && state.error,
    refresh,
    cloudModels,
    hidden,
    cloudAvailable: import.meta.env.VITE_USE_LOCAL_PROXY !== 'true',
    setHidden: (id: string, value: boolean) => setHidden(account, id, value),
    codexConnected: codex.account === account && codex.connected,
    codexAccountLabel: codex.account === account ? codex.accountLabel : '',
  };
}
