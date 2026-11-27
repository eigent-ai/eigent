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

// The user's own model configurations, kept on this device.
//
// In the desktop app they live in the host's encrypted store: this window can
// save, list and remove them but never gets a key back. A run names a
// configuration by reference and the local backend reads its key.
//
// In a plain browser there is no such store. Configurations are then held in
// this page's memory until it is closed or reloaded, and nothing is written
// to disk or to a server.

import { createHost } from '@/host/createHost';
import type {
  ModelConfigurationImportRecord,
  ModelConfigurationList,
  ModelConfigurationSaveRequest,
  ModelConfigurationStorage,
  ModelConfigurationView,
  ModelCredentialReference,
} from '@/shared/modelConfiguration';

export { SAVED_VALUE_MARKER } from '@/shared/modelConfiguration';
export type {
  ModelConfigurationImportRecord,
  ModelConfigurationStorage,
  ModelConfigurationView,
  ModelCredentialReference,
} from '@/shared/modelConfiguration';

/**
 * A configuration as the app window uses it. In the desktop app it carries a
 * reference instead of a key. In a browser the page itself holds the key for
 * the session, because no local backend channel can read it.
 */
export type LocalModelConfiguration = ModelConfigurationView & {
  model_credential?: ModelCredentialReference;
  api_key?: string;
};

export interface LocalModelConfigurationList {
  storage: ModelConfigurationStorage | 'memory';
  imported: boolean;
  records: LocalModelConfiguration[];
}

export type ModelConfigurationInput = Omit<
  ModelConfigurationSaveRequest,
  'account_scope'
>;

/** The signed-in account whose models are meant. */
export type ModelAccount = { user_id?: number | null; email?: string | null };
type Account = ModelAccount;

const scopes = new Map<string, Promise<string>>();

function origin(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    return new URL(value.trim()).origin.toLowerCase();
  } catch {
    return value.trim().replace(/\/+$/, '').toLowerCase();
  }
}

/**
 * Which accounts an account id belongs to. A cloud account is named by the
 * sign-in project it lives in, so its saved models stay with it when the
 * address of the service changes. A self-hosted server has no such project:
 * its accounts are named by the server's address.
 */
function accountRealm(): string {
  const selfHosted = import.meta.env.VITE_USE_LOCAL_PROXY === 'true';
  const project = import.meta.env.VITE_STACK_PROJECT_ID;
  if (!selfHosted && typeof project === 'string' && project.trim())
    return `project:${project.trim().toLowerCase()}`;
  // Same order as the address the app sends its account requests to.
  const base = origin(import.meta.env.VITE_BASE_URL);
  const proxy = origin(import.meta.env.VITE_PROXY_URL);
  return `server:${(selfHosted ? base || proxy : proxy || base) || 'local'}`;
}

/** Digest that names the signed-in account on this device. */
export function modelAccountScope(account: Account): Promise<string> {
  const key = JSON.stringify([
    accountRealm(),
    account.user_id != null
      ? `id:${account.user_id}`
      : `email:${(account.email ?? '').trim().toLowerCase()}`,
  ]);
  let scope = scopes.get(key);
  if (!scope) {
    scope = crypto.subtle
      .digest(
        'SHA-256',
        new TextEncoder().encode(`eigent-model-account:${key}`)
      )
      .then((digest) =>
        Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0')
        ).join('')
      );
    scopes.set(key, scope);
    void scope.catch(() => scopes.delete(key));
  }
  return scope;
}

function signedIn(account: Account): boolean {
  return account.user_id != null || Boolean(account.email);
}

function desktopStore() {
  const api = createHost().electronAPI;
  return typeof api?.modelConfigurationList === 'function' ? api : null;
}

// ---- Browser fallback: this page's memory only ----

const UNSET_KEYS = new Set(['', 'not-required']);
const MEMORY_FIRST_ID = 2 ** 31;
type MemoryAccount = {
  nextId: number;
  imported: boolean;
  records: Map<number, LocalModelConfiguration>;
};
const memory = new Map<string, MemoryAccount>();

function memoryAccount(scope: string): MemoryAccount {
  let account = memory.get(scope);
  if (!account) {
    account = { nextId: MEMORY_FIRST_ID, imported: false, records: new Map() };
    memory.set(scope, account);
  }
  return account;
}

function memorySave(
  scope: string,
  input: ModelConfigurationInput
): LocalModelConfiguration {
  const account = memoryAccount(scope);
  const previous =
    input.id === undefined ? undefined : account.records.get(input.id);
  if (input.id !== undefined && !previous)
    throw new Error('Model configuration was not found');
  const apiKey = input.api_key ?? previous?.api_key ?? '';
  const hasKey = !UNSET_KEYS.has(apiKey.trim());
  const pending =
    previous?.key_state === 'needed' && input.api_key === undefined;
  const record: LocalModelConfiguration = {
    id: previous?.id ?? account.nextId++,
    server_id: previous?.server_id ?? null,
    provider_name: input.provider_name,
    model_type: input.model_type,
    endpoint_url: input.endpoint_url.trim(),
    encrypted_config: structuredClone(input.config),
    prefer: input.prefer ?? previous?.prefer ?? false,
    is_valid: input.is_valid && !pending ? 2 : 1,
    has_api_key: hasKey,
    endpoint_has_secret: false,
    key_state: pending ? 'needed' : hasKey ? 'saved' : 'not_required',
    updated_at: new Date().toISOString(),
    api_key: apiKey,
  };
  if (record.prefer)
    account.records.forEach((other) => {
      other.prefer = false;
    });
  account.records.set(record.id, record);
  return { ...record };
}

// ---- Public operations ----

export async function listLocalModelConfigurations(
  account: Account
): Promise<LocalModelConfigurationList> {
  if (!signedIn(account))
    return { storage: 'memory', imported: true, records: [] };
  const scope = await modelAccountScope(account);
  const store = desktopStore();
  if (!store) {
    const held = memoryAccount(scope);
    return {
      storage: 'memory',
      imported: held.imported,
      records: [...held.records.values()]
        .sort((left, right) => left.id - right.id)
        .map((record) => ({ ...record })),
    };
  }
  const list: ModelConfigurationList = await store.modelConfigurationList({
    account_scope: scope,
  });
  return {
    storage: list.storage,
    imported: list.imported,
    records: list.records.map((record) => ({
      ...record,
      model_credential: { account_scope: scope, credential_id: record.id },
    })),
  };
}

export async function saveLocalModelConfiguration(
  account: Account,
  input: ModelConfigurationInput
): Promise<LocalModelConfiguration> {
  if (!signedIn(account)) throw new Error('Sign in to save a model');
  const scope = await modelAccountScope(account);
  const store = desktopStore();
  if (!store) return memorySave(scope, input);
  const view: ModelConfigurationView = await store.modelConfigurationSave({
    ...input,
    account_scope: scope,
  });
  return {
    ...view,
    model_credential: { account_scope: scope, credential_id: view.id },
  };
}

export async function setLocalModelConfigurationDefault(
  account: Account,
  id: number | null
): Promise<void> {
  const scope = await modelAccountScope(account);
  const store = desktopStore();
  if (store) {
    await store.modelConfigurationSetDefault({ account_scope: scope, id });
    return;
  }
  memoryAccount(scope).records.forEach((record) => {
    record.prefer = record.id === id;
  });
}

export async function deleteLocalModelConfiguration(
  account: Account,
  id: number
): Promise<void> {
  const scope = await modelAccountScope(account);
  const store = desktopStore();
  if (store) {
    await store.modelConfigurationDelete({ account_scope: scope, id });
    return;
  }
  memoryAccount(scope).records.delete(id);
}

/** Take over the account's earlier model list, once and without keys. */
export async function importLocalModelConfigurations(
  account: Account,
  records: ModelConfigurationImportRecord[]
): Promise<void> {
  const scope = await modelAccountScope(account);
  const store = desktopStore();
  if (store) {
    await store.modelConfigurationImport({ account_scope: scope, records });
    return;
  }
  const held = memoryAccount(scope);
  if (held.imported || held.records.size > 0) return;
  let preferred = false;
  for (const item of records) {
    const prefer: boolean = item.prefer === true && !preferred;
    preferred ||= prefer;
    held.records.set(item.id, {
      id: item.id,
      server_id: item.id,
      provider_name: item.provider_name,
      model_type: item.model_type,
      endpoint_url: item.endpoint_url,
      encrypted_config: structuredClone(item.config),
      prefer,
      is_valid: !item.needs_key && item.model_type ? 2 : 1,
      has_api_key: false,
      endpoint_has_secret: false,
      key_state: item.needs_key ? 'needed' : 'not_required',
      updated_at: new Date().toISOString(),
      api_key: item.needs_key ? '' : 'not-required',
    });
  }
  held.imported = true;
}

export async function linkLocalModelConfiguration(
  account: Account,
  id: number,
  serverId: number | null
): Promise<void> {
  const scope = await modelAccountScope(account);
  const store = desktopStore();
  if (store) {
    await store.modelConfigurationSetServerId({
      account_scope: scope,
      id,
      server_id: serverId,
    });
    return;
  }
  const record = memoryAccount(scope).records.get(id);
  if (record) record.server_id = serverId;
}

/** Test seam: forget what the browser fallback holds. */
export function resetLocalModelConfigurationMemory(): void {
  memory.clear();
  scopes.clear();
}
