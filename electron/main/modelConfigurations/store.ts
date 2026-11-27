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

// Device-local store for the user's own model configurations.
//
//   - A configuration and its key live on this device only. Nothing here is
//     sent to a server.
//   - Secret values (the API key, secret provider settings, credentials inside
//     an endpoint address) are encrypted with Electron `safeStorage`, which
//     uses the operating system's key store. The rest of a configuration is
//     plain metadata so the list can be shown without decrypting anything.
//   - The app window can save, list and remove configurations. It never gets
//     a secret value back; only the local backend can resolve one.
//   - Without a usable OS key store, secret values are kept in memory until
//     the app quits instead of being written to disk in plain text.

import { safeStorage } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  markedPlaces,
  mergeSecretValues,
  splitEndpoint,
  splitSecretValues,
  type SecretValues,
} from './secretValues';
import type {
  ModelConfigurationDefaultRequest,
  ModelConfigurationImportRequest,
  ModelConfigurationKeyState,
  ModelConfigurationList,
  ModelConfigurationLookup,
  ModelConfigurationSaveRequest,
  ModelConfigurationServerLinkRequest,
  ModelConfigurationStorage,
  ModelConfigurationView,
  ResolvedModelConfiguration,
} from './types';

const FORMAT_VERSION = 1;
const FILE_NAME = 'model-configurations.v1.json';
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_RECORDS_PER_ACCOUNT = 512;
const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_KEY_BYTES = 16 * 1024;
const VALID = 2;
const NOT_VALID = 1;
const UNSET_KEYS = new Set(['', 'not-required']);

/**
 * Identifiers issued on this device start above the largest 32-bit integer,
 * so one can never equal an identifier that a server issued. A model taken
 * over from the account's earlier list keeps its server identifier, so the
 * Sessions, Spaces and workers that point at it keep working.
 */
export const FIRST_DEVICE_CONFIGURATION_ID = 2 ** 31;

interface ModelConfigurationCrypto {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}

interface SecretPayload {
  api_key: string;
  /** Present only when the endpoint address itself carries credentials. */
  endpoint_url?: string;
  values: SecretValues;
}

interface StoredRecord {
  id: number;
  server_id: number | null;
  /** Taken over without its key: the user has to enter it on this device. */
  pending_key: boolean;
  provider_name: string;
  model_type: string;
  endpoint_url: string;
  endpoint_has_secret: boolean;
  config: Record<string, unknown>;
  has_api_key: boolean;
  /** What stands in for the key when none is needed, such as `not-required`. */
  api_key_placeholder: string;
  prefer: boolean;
  is_valid: boolean;
  /** base64 of the encrypted `SecretPayload`; null when none is on disk. */
  secret: string | null;
  created_at: string;
  updated_at: string;
}

interface AccountDocument {
  next_id: number;
  imported: boolean;
  records: Record<string, StoredRecord>;
}

interface StoreDocument {
  version: 1;
  accounts: Record<string, AccountDocument>;
}

export interface ModelConfigurationStoreOptions {
  rootDir?: string;
  crypto?: ModelConfigurationCrypto;
  platform?: NodeJS.Platform;
  now?: () => Date;
  randomBytes?: (size: number) => Buffer;
}

export class ModelConfigurationError extends Error {
  constructor(
    readonly code:
      | 'invalid_request'
      | 'not_found'
      | 'key_required'
      | 'limit_reached'
      | 'storage_failed',
    message: string
  ) {
    super(message);
    this.name = 'ModelConfigurationError';
  }
}

function defaultCrypto(): ModelConfigurationCrypto {
  return {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (value) => safeStorage.encryptString(value),
    decryptString: (value) => safeStorage.decryptString(value),
    getSelectedStorageBackend:
      typeof safeStorage.getSelectedStorageBackend === 'function'
        ? () => safeStorage.getSelectedStorageBackend()
        : undefined,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertScope(scope: unknown): asserts scope is string {
  if (typeof scope !== 'string' || !/^[a-f0-9]{64}$/u.test(scope)) {
    throw new ModelConfigurationError(
      'invalid_request',
      'Model configuration account scope is invalid'
    );
  }
}

function isServerId(id: unknown): id is number {
  return (
    typeof id === 'number' &&
    Number.isInteger(id) &&
    id >= 1 &&
    id < FIRST_DEVICE_CONFIGURATION_ID
  );
}

function assertId(id: unknown): asserts id is number {
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) {
    throw new ModelConfigurationError(
      'not_found',
      'Model configuration was not found on this device'
    );
  }
}

function text(value: unknown, name: string, max: number, min = 0): string {
  if (
    typeof value !== 'string' ||
    value.length < min ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    throw new ModelConfigurationError(
      'invalid_request',
      `Model configuration ${name} is invalid`
    );
  }
  return value;
}

function isStoredRecord(value: unknown): value is StoredRecord {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === 'number' &&
    Number.isSafeInteger(value.id) &&
    value.id >= 1 &&
    (value.server_id === null || isServerId(value.server_id)) &&
    typeof value.pending_key === 'boolean' &&
    typeof value.provider_name === 'string' &&
    typeof value.model_type === 'string' &&
    typeof value.endpoint_url === 'string' &&
    typeof value.endpoint_has_secret === 'boolean' &&
    isPlainObject(value.config) &&
    typeof value.has_api_key === 'boolean' &&
    typeof value.api_key_placeholder === 'string' &&
    typeof value.prefer === 'boolean' &&
    typeof value.is_valid === 'boolean' &&
    (value.secret === null || typeof value.secret === 'string') &&
    typeof value.created_at === 'string' &&
    typeof value.updated_at === 'string'
  );
}

export class ModelConfigurationStore {
  readonly rootDir: string;
  readonly filePath: string;
  private readonly encryption: ModelConfigurationCrypto;
  private readonly platform: NodeJS.Platform;
  private readonly now: () => Date;
  private readonly randomBytes: (size: number) => Buffer;
  /** Secret values of this run, used when the OS key store is unusable. */
  private readonly sessionSecrets = new Map<string, SecretPayload>();
  /** Set when the file on disk could not be read as a store document. */
  private unreadableFile = false;

  constructor(options: ModelConfigurationStoreOptions = {}) {
    this.rootDir =
      options.rootDir ?? path.join(os.homedir(), '.eigent', 'secure');
    this.filePath = path.join(this.rootDir, FILE_NAME);
    this.encryption = options.crypto ?? defaultCrypto();
    this.platform = options.platform ?? process.platform;
    this.now = options.now ?? (() => new Date());
    this.randomBytes = options.randomBytes ?? crypto.randomBytes;
  }

  storage(): ModelConfigurationStorage {
    return this.canEncrypt() ? 'secure' : 'session';
  }

  list(accountScope: string): ModelConfigurationList {
    assertScope(accountScope);
    const account = this.readDocument().accounts[accountScope];
    const records = Object.values(account?.records ?? {})
      .sort((left, right) => left.id - right.id)
      .map((record) => this.view(accountScope, record));
    return {
      storage: this.storage(),
      imported: Boolean(account?.imported),
      records,
    };
  }

  /**
   * Take over the model list an account had before keys were kept on the
   * device. Runs once per account, and only while nothing is saved for it.
   * The taken-over models carry no key: each one asks for it again.
   */
  importRecords(request: ModelConfigurationImportRequest): void {
    if (!isPlainObject(request) || !Array.isArray(request.records)) {
      throw new ModelConfigurationError(
        'invalid_request',
        'Model configuration request is invalid'
      );
    }
    assertScope(request.account_scope);
    const document = this.readDocument();
    const account = (document.accounts[request.account_scope] ??= {
      next_id: FIRST_DEVICE_CONFIGURATION_ID,
      imported: false,
      records: {},
    });
    if (account.imported || Object.keys(account.records).length > 0) return;
    const timestamp = this.now().toISOString();
    let preferred = false;
    for (const item of request.records.slice(0, MAX_RECORDS_PER_ACCOUNT)) {
      if (
        !isPlainObject(item) ||
        !isServerId(item.id) ||
        account.records[String(item.id)] ||
        typeof item.provider_name !== 'string' ||
        !item.provider_name ||
        item.provider_name.length > 128 ||
        typeof item.model_type !== 'string' ||
        item.model_type.length > 256 ||
        typeof item.endpoint_url !== 'string' ||
        item.endpoint_url.length > 2048 ||
        !isPlainObject(item.config)
      ) {
        continue;
      }
      // Nothing secret is expected here; anything that looks like a secret,
      // or a credential inside the address, is dropped instead of kept.
      const endpoint = splitEndpoint(item.endpoint_url);
      const { visible } = splitSecretValues(item.config, [], {});
      const config = mergeSecretValues(visible, {});
      if (Buffer.byteLength(JSON.stringify(config), 'utf8') > MAX_CONFIG_BYTES)
        continue;
      const needsKey = item.needs_key !== false;
      const prefer: boolean = item.prefer === true && !preferred;
      preferred ||= prefer;
      account.records[String(item.id)] = {
        id: item.id,
        server_id: item.id,
        pending_key: needsKey,
        provider_name: item.provider_name,
        model_type: item.model_type,
        endpoint_url: endpoint.visible,
        endpoint_has_secret: false,
        config,
        has_api_key: false,
        api_key_placeholder: needsKey ? '' : 'not-required',
        prefer,
        is_valid: !needsKey && item.model_type !== '',
        secret: null,
        created_at: timestamp,
        updated_at: timestamp,
      };
    }
    account.imported = true;
    this.atomicWrite(document);
  }

  /** Remember which server record mirrors a configuration, or forget it. */
  setServerId(request: ModelConfigurationServerLinkRequest): void {
    if (!isPlainObject(request)) {
      throw new ModelConfigurationError(
        'invalid_request',
        'Model configuration request is invalid'
      );
    }
    assertScope(request.account_scope);
    assertId(request.id);
    if (request.server_id !== null && !isServerId(request.server_id)) {
      throw new ModelConfigurationError(
        'invalid_request',
        'Model configuration server link is invalid'
      );
    }
    const document = this.readDocument();
    const record =
      document.accounts[request.account_scope]?.records[String(request.id)];
    if (!record) {
      throw new ModelConfigurationError(
        'not_found',
        'Model configuration was not found on this device'
      );
    }
    record.server_id = request.server_id;
    this.atomicWrite(document);
  }

  save(request: ModelConfigurationSaveRequest): ModelConfigurationView {
    if (!isPlainObject(request)) {
      throw new ModelConfigurationError(
        'invalid_request',
        'Model configuration request is invalid'
      );
    }
    assertScope(request.account_scope);
    const providerName = text(request.provider_name, 'provider', 128, 1);
    const modelType = text(request.model_type, 'model', 256, 1);
    const endpointInput = text(request.endpoint_url, 'endpoint', 2048).trim();
    if (!isPlainObject(request.config)) {
      throw new ModelConfigurationError(
        'invalid_request',
        'Model configuration settings are invalid'
      );
    }
    const secretFields = Array.isArray(request.secret_fields)
      ? request.secret_fields.filter(
          (name): name is string => typeof name === 'string'
        )
      : [];
    if (
      request.api_key !== undefined &&
      (typeof request.api_key !== 'string' ||
        Buffer.byteLength(request.api_key, 'utf8') > MAX_KEY_BYTES)
    ) {
      throw new ModelConfigurationError(
        'invalid_request',
        'Model configuration key is invalid'
      );
    }
    if (typeof request.is_valid !== 'boolean') {
      throw new ModelConfigurationError(
        'invalid_request',
        'Model configuration state is invalid'
      );
    }

    const document = this.readDocument();
    const account = (document.accounts[request.account_scope] ??= {
      next_id: FIRST_DEVICE_CONFIGURATION_ID,
      imported: false,
      records: {},
    });
    let previous: StoredRecord | undefined;
    if (request.id !== undefined) {
      assertId(request.id);
      previous = account.records[String(request.id)];
      if (!previous) {
        throw new ModelConfigurationError(
          'not_found',
          'Model configuration was not found on this device'
        );
      }
    } else if (Object.keys(account.records).length >= MAX_RECORDS_PER_ACCOUNT) {
      throw new ModelConfigurationError(
        'limit_reached',
        'Too many model configurations are saved on this device'
      );
    }
    const saved = previous
      ? this.readSecret(request.account_scope, previous)
      : null;

    const { visible, secrets } = splitSecretValues(
      request.config,
      secretFields,
      saved?.values ?? {}
    );
    if (Buffer.byteLength(JSON.stringify(visible), 'utf8') > MAX_CONFIG_BYTES) {
      throw new ModelConfigurationError(
        'invalid_request',
        'Model configuration settings are too large'
      );
    }

    // An unchanged visible address keeps the saved full address behind it.
    let endpoint = splitEndpoint(endpointInput);
    let endpointSecret: string | undefined = endpoint.hasSecret
      ? endpointInput
      : undefined;
    if (
      previous?.endpoint_has_secret &&
      !endpoint.hasSecret &&
      endpoint.visible === previous.endpoint_url &&
      saved?.endpoint_url
    ) {
      endpoint = { visible: previous.endpoint_url, hasSecret: true };
      endpointSecret = saved.endpoint_url;
    }

    const hasApiKey =
      request.api_key !== undefined
        ? !UNSET_KEYS.has(request.api_key.trim())
        : Boolean(previous?.has_api_key);
    const placeholder = hasApiKey
      ? ''
      : request.api_key !== undefined
        ? request.api_key.trim()
        : (previous?.api_key_placeholder ?? '');
    const payload: SecretPayload = {
      api_key: !hasApiKey
        ? ''
        : request.api_key !== undefined
          ? request.api_key
          : (saved?.api_key ?? ''),
      ...(endpointSecret ? { endpoint_url: endpointSecret } : {}),
      values: secrets,
    };

    const timestamp = this.now().toISOString();
    const id = previous?.id ?? account.next_id;
    const record: StoredRecord = {
      id,
      server_id: previous?.server_id ?? null,
      // Sending a key, or saying that none is needed, completes the setup.
      pending_key:
        Boolean(previous?.pending_key) && request.api_key === undefined,
      provider_name: providerName,
      model_type: modelType,
      endpoint_url: endpoint.visible,
      endpoint_has_secret: endpoint.hasSecret,
      config: visible,
      has_api_key: hasApiKey,
      api_key_placeholder: placeholder,
      prefer: request.prefer ?? previous?.prefer ?? false,
      is_valid: request.is_valid,
      secret: null,
      created_at: previous?.created_at ?? timestamp,
      updated_at: timestamp,
    };
    const key = this.sessionKey(request.account_scope, id);
    if (this.canEncrypt()) {
      record.secret = this.encryption
        .encryptString(JSON.stringify(payload))
        .toString('base64');
      this.sessionSecrets.delete(key);
    } else {
      this.sessionSecrets.set(key, payload);
    }
    if (!previous) account.next_id = id + 1;
    if (record.prefer) {
      for (const other of Object.values(account.records)) other.prefer = false;
    }
    account.records[String(id)] = record;
    this.atomicWrite(document);
    return this.view(request.account_scope, record);
  }

  setDefault(request: ModelConfigurationDefaultRequest): void {
    if (!isPlainObject(request)) {
      throw new ModelConfigurationError(
        'invalid_request',
        'Model configuration request is invalid'
      );
    }
    assertScope(request.account_scope);
    const document = this.readDocument();
    const account = document.accounts[request.account_scope];
    if (request.id !== null) {
      assertId(request.id);
      if (!account?.records[String(request.id)]) {
        throw new ModelConfigurationError(
          'not_found',
          'Model configuration was not found on this device'
        );
      }
    }
    if (!account) return;
    for (const record of Object.values(account.records)) {
      record.prefer = record.id === request.id;
    }
    this.atomicWrite(document);
  }

  delete(lookup: ModelConfigurationLookup): void {
    if (!isPlainObject(lookup)) {
      throw new ModelConfigurationError(
        'invalid_request',
        'Model configuration request is invalid'
      );
    }
    assertScope(lookup.account_scope);
    assertId(lookup.id);
    const document = this.readDocument();
    const account = document.accounts[lookup.account_scope];
    this.sessionSecrets.delete(
      this.sessionKey(lookup.account_scope, lookup.id)
    );
    if (!account?.records[String(lookup.id)]) return;
    delete account.records[String(lookup.id)];
    this.atomicWrite(document);
  }

  /** Complete configuration for the local backend. Never sent to the window. */
  resolve(lookup: ModelConfigurationLookup): ResolvedModelConfiguration {
    if (!isPlainObject(lookup)) {
      throw new ModelConfigurationError(
        'invalid_request',
        'Model configuration request is invalid'
      );
    }
    assertScope(lookup.account_scope);
    assertId(lookup.id);
    return this.resolveRecord(
      lookup.account_scope,
      this.readDocument().accounts[lookup.account_scope]?.records[
        String(lookup.id)
      ]
    );
  }

  /** Same as `resolve`, for a caller that only knows the server record. */
  resolveByServerId(
    accountScope: string,
    serverId: number
  ): ResolvedModelConfiguration {
    assertScope(accountScope);
    const records = isServerId(serverId)
      ? Object.values(
          this.readDocument().accounts[accountScope]?.records ?? {}
        ).filter((record) => record.server_id === serverId)
      : [];
    // Two local configurations for one server record cannot be told apart.
    return this.resolveRecord(
      accountScope,
      records.length === 1 ? records[0] : undefined
    );
  }

  private resolveRecord(
    accountScope: string,
    record: StoredRecord | undefined
  ): ResolvedModelConfiguration {
    if (!record) {
      throw new ModelConfigurationError(
        'not_found',
        'Model configuration was not found on this device'
      );
    }
    const secret = this.readSecret(accountScope, record);
    if (this.keyState(record, secret) === 'needed') {
      throw new ModelConfigurationError(
        'key_required',
        'The key for this model must be entered again on this device'
      );
    }
    return {
      id: record.id,
      provider_name: record.provider_name,
      model_type: record.model_type,
      api_key: record.has_api_key
        ? (secret?.api_key ?? '')
        : record.api_key_placeholder,
      endpoint_url: record.endpoint_url,
      api_url: secret?.endpoint_url ?? record.endpoint_url,
      config: mergeSecretValues(record.config, secret?.values ?? {}),
    };
  }

  private sessionKey(accountScope: string, id: number): string {
    return `${accountScope}:${id}`;
  }

  private canEncrypt(): boolean {
    try {
      if (!this.encryption.isEncryptionAvailable()) return false;
      // Linux falls back to a fixed password when no keyring is running.
      return !(
        this.platform === 'linux' &&
        this.encryption.getSelectedStorageBackend?.() === 'basic_text'
      );
    } catch {
      return false;
    }
  }

  private readSecret(
    accountScope: string,
    record: StoredRecord
  ): SecretPayload | null {
    const held = this.sessionSecrets.get(
      this.sessionKey(accountScope, record.id)
    );
    if (held) return held;
    if (!record.secret || !this.canEncrypt()) return null;
    try {
      const parsed: unknown = JSON.parse(
        this.encryption.decryptString(Buffer.from(record.secret, 'base64'))
      );
      if (
        !isPlainObject(parsed) ||
        typeof parsed.api_key !== 'string' ||
        !isPlainObject(parsed.values) ||
        Object.values(parsed.values).some((item) => typeof item !== 'string')
      ) {
        return null;
      }
      return {
        api_key: parsed.api_key,
        ...(typeof parsed.endpoint_url === 'string'
          ? { endpoint_url: parsed.endpoint_url }
          : {}),
        values: parsed.values as SecretValues,
      };
    } catch {
      // The OS key changed, or the file came from another device.
      return null;
    }
  }

  private keyState(
    record: StoredRecord,
    secret: SecretPayload | null
  ): ModelConfigurationKeyState {
    const places = markedPlaces(record.config);
    if (record.pending_key) return 'needed';
    if (
      !record.has_api_key &&
      !record.endpoint_has_secret &&
      places.length === 0
    ) {
      return 'not_required';
    }
    if (
      !secret ||
      (record.has_api_key && UNSET_KEYS.has(secret.api_key.trim())) ||
      (record.endpoint_has_secret && !secret.endpoint_url) ||
      places.some((place) => secret.values[place] === undefined)
    ) {
      return 'needed';
    }
    return 'saved';
  }

  private view(
    accountScope: string,
    record: StoredRecord
  ): ModelConfigurationView {
    const keyState = this.keyState(
      record,
      this.readSecret(accountScope, record)
    );
    return {
      id: record.id,
      server_id: record.server_id,
      provider_name: record.provider_name,
      model_type: record.model_type,
      endpoint_url: record.endpoint_url,
      encrypted_config: structuredClone(record.config),
      prefer: record.prefer,
      is_valid: record.is_valid && keyState !== 'needed' ? VALID : NOT_VALID,
      has_api_key: record.has_api_key,
      endpoint_has_secret: record.endpoint_has_secret,
      key_state: keyState,
      updated_at: record.updated_at,
    };
  }

  private readDocument(): StoreDocument {
    const empty = (): StoreDocument => ({
      version: FORMAT_VERSION,
      accounts: {},
    });
    this.unreadableFile = false;
    if (!fs.existsSync(this.filePath)) return empty();
    try {
      const stat = fs.lstatSync(this.filePath);
      if (
        stat.isSymbolicLink() ||
        !stat.isFile() ||
        stat.size > MAX_FILE_BYTES
      ) {
        throw new Error('unsafe file');
      }
      const parsed: unknown = JSON.parse(
        fs.readFileSync(this.filePath, 'utf8')
      );
      if (
        !isPlainObject(parsed) ||
        parsed.version !== FORMAT_VERSION ||
        !isPlainObject(parsed.accounts)
      ) {
        throw new Error('unknown format');
      }
      for (const [scope, account] of Object.entries(parsed.accounts)) {
        assertScope(scope);
        if (
          !isPlainObject(account) ||
          typeof account.next_id !== 'number' ||
          !Number.isSafeInteger(account.next_id) ||
          account.next_id < FIRST_DEVICE_CONFIGURATION_ID ||
          typeof account.imported !== 'boolean' ||
          !isPlainObject(account.records)
        ) {
          throw new Error('unknown format');
        }
        for (const [id, record] of Object.entries(account.records)) {
          if (
            !isStoredRecord(record) ||
            String(record.id) !== id ||
            record.id >= account.next_id
          ) {
            throw new Error('unknown format');
          }
        }
      }
      return parsed as unknown as StoreDocument;
    } catch {
      // An unreadable file must not lock the user out of their models. It is
      // kept aside on the next save and the list starts empty.
      this.unreadableFile = true;
      return empty();
    }
  }

  private ensureSecureDirectory(): void {
    if (fs.existsSync(this.rootDir)) {
      const stat = fs.lstatSync(this.rootDir);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new ModelConfigurationError(
          'storage_failed',
          'Model configuration directory is unsafe'
        );
      }
    } else {
      fs.mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
    }
    try {
      fs.chmodSync(this.rootDir, 0o700);
    } catch {
      // Windows and some filesystems do not implement POSIX permissions.
    }
  }

  private keepUnreadableFileAside(): void {
    if (!this.unreadableFile) return;
    this.unreadableFile = false;
    try {
      fs.renameSync(this.filePath, `${this.filePath}.unreadable`);
    } catch {
      fs.rmSync(this.filePath, { force: true });
    }
  }

  private atomicWrite(document: StoreDocument): void {
    this.ensureSecureDirectory();
    const serialized = JSON.stringify(document);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_FILE_BYTES) {
      throw new ModelConfigurationError(
        'limit_reached',
        'Too many model configurations are saved on this device'
      );
    }
    this.keepUnreadableFileAside();
    const temporaryPath = path.join(
      this.rootDir,
      `.${FILE_NAME}.${process.pid}.${this.randomBytes(8).toString('hex')}.tmp`
    );
    let descriptor: number | null = null;
    try {
      descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
      fs.writeFileSync(descriptor, serialized, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      fs.renameSync(temporaryPath, this.filePath);
      try {
        fs.chmodSync(this.filePath, 0o600);
      } catch {
        // Best effort on filesystems without POSIX permissions.
      }
    } finally {
      if (descriptor !== null) fs.closeSync(descriptor);
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // The successful rename already removed the temporary path.
      }
    }
  }
}
