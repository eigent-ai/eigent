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

// Contract between the app window and the desktop host for the user's own
// model configurations. They are kept on this device only.

/**
 * Placeholder shown to the app window in place of a saved secret value.
 * Sending it back on save keeps the saved value.
 */
export const SAVED_VALUE_MARKER = '[saved on this device]';

/** Where secret values are kept: the OS key store, or memory until quit. */
export type ModelConfigurationStorage = 'secure' | 'session';

/**
 * `saved`: every secret this configuration needs can be read on this device.
 * `needed`: it was saved with secrets that this device can no longer read.
 * `not_required`: it has no secret values.
 */
export type ModelConfigurationKeyState = 'saved' | 'needed' | 'not_required';

/** What the app window may see. It never contains a secret value. */
export interface ModelConfigurationView {
  id: number;
  /** Identifier of the matching record on the server, when there is one. */
  server_id: number | null;
  provider_name: string;
  model_type: string;
  endpoint_url: string;
  /** Provider settings; saved secret values are replaced by the marker. */
  encrypted_config: Record<string, unknown>;
  prefer: boolean;
  /** 2 when the configuration passed validation and its key is readable. */
  is_valid: number;
  has_api_key: boolean;
  endpoint_has_secret: boolean;
  key_state: ModelConfigurationKeyState;
  updated_at: string;
}

export interface ModelConfigurationList {
  storage: ModelConfigurationStorage;
  /** Whether this account's earlier model list was already taken over. */
  imported: boolean;
  records: ModelConfigurationView[];
}

/** A model the account set up before keys were kept on the device. */
export interface ModelConfigurationImportRecord {
  /** Identifier the server knows the record by. It is kept on the device. */
  id: number;
  provider_name: string;
  model_type: string;
  endpoint_url: string;
  config: Record<string, unknown>;
  prefer: boolean;
  /** False for a model that runs without a key, such as a local one. */
  needs_key: boolean;
}

export interface ModelConfigurationScope {
  /** SHA-256 hex that names the signed-in account on this device. */
  account_scope: string;
}

export interface ModelConfigurationSaveRequest extends ModelConfigurationScope {
  /** Present when an existing configuration is edited. */
  id?: number;
  provider_name: string;
  model_type: string;
  endpoint_url: string;
  /** Omitted keeps the saved key of an edited configuration. */
  api_key?: string;
  config: Record<string, unknown>;
  /** Top-level `config` names the caller knows to be secret. */
  secret_fields?: string[];
  is_valid: boolean;
  prefer?: boolean;
}

export interface ModelConfigurationLookup extends ModelConfigurationScope {
  id: number;
}

export interface ModelConfigurationDefaultRequest extends ModelConfigurationScope {
  /** `null` clears the default. */
  id: number | null;
}

export interface ModelConfigurationImportRequest extends ModelConfigurationScope {
  records: ModelConfigurationImportRecord[];
}

export interface ModelConfigurationServerLinkRequest extends ModelConfigurationLookup {
  /** `null` forgets the link. */
  server_id: number | null;
}

/** The complete configuration, handed only to the local backend. */
export interface ResolvedModelConfiguration {
  id: number;
  provider_name: string;
  model_type: string;
  api_key: string;
  /** Endpoint as shown in the app window. */
  endpoint_url: string;
  /** Endpoint as saved, including any credentials inside it. */
  api_url: string;
  config: Record<string, unknown>;
}

/** Reference the app window sends in place of a key. */
export interface ModelCredentialReference {
  account_scope: string;
  credential_id: number;
}
