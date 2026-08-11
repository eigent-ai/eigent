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

import { safeStorage } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  WorkspaceSecretLookup,
  WorkspaceSecretPutRequest,
  WorkspaceSecretPutResult,
  WorkspaceSecretScope,
  WorkspaceSecretStatus,
} from './types';

const FORMAT_VERSION = 1;
const VAULT_FILE_NAME = 'workspace-secret-vault.v1.json';
const MAX_VAULT_BYTES = 8 * 1024 * 1024;
export const MAX_WORKSPACE_SECRET_BYTES = 64 * 1024;

interface WorkspaceSecretCrypto {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}

interface EncryptedWorkspaceSecretRecord extends WorkspaceSecretScope {
  secret_ref: string;
  ciphertext: string;
  created_at: string;
  updated_at: string;
}

interface VaultDocument {
  version: 1;
  records: Record<string, EncryptedWorkspaceSecretRecord>;
}

interface VaultReadResult {
  document: VaultDocument | null;
  corrupted: boolean;
}

export interface WorkspaceSecretVaultOptions {
  rootDir?: string;
  crypto?: WorkspaceSecretCrypto;
  platform?: NodeJS.Platform;
  now?: () => Date;
  randomBytes?: (size: number) => Buffer;
}

export class WorkspaceSecretVaultError extends Error {}
export class WorkspaceSecretBindingMismatchError extends WorkspaceSecretVaultError {}
export class WorkspaceSecretNeedsRebindError extends WorkspaceSecretVaultError {}
export class WorkspaceSecretNotFoundError extends WorkspaceSecretVaultError {}

function defaultCrypto(): WorkspaceSecretCrypto {
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

function hasOnlySafeIdentityCharacters(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 256 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function assertScope(scope: WorkspaceSecretScope): void {
  if (!/^[a-f0-9]{64}$/u.test(scope.account_scope_digest)) {
    throw new WorkspaceSecretVaultError(
      'Workspace secret account scope digest is invalid'
    );
  }
  for (const [name, value] of Object.entries({
    space_id: scope.space_id,
    revision_id: scope.revision_id,
    slot_id: scope.slot_id,
  })) {
    if (!hasOnlySafeIdentityCharacters(value)) {
      throw new WorkspaceSecretVaultError(
        `Workspace secret ${name} is invalid`
      );
    }
  }
}

function sameScope(
  record: WorkspaceSecretScope,
  expected: WorkspaceSecretScope
): boolean {
  return (
    record.account_scope_digest === expected.account_scope_digest &&
    record.space_id === expected.space_id &&
    record.revision_id === expected.revision_id &&
    record.slot_id === expected.slot_id
  );
}

function isEncryptedRecord(
  value: unknown
): value is EncryptedWorkspaceSecretRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<EncryptedWorkspaceSecretRecord>;
  return (
    typeof record.secret_ref === 'string' &&
    typeof record.account_scope_digest === 'string' &&
    typeof record.space_id === 'string' &&
    typeof record.revision_id === 'string' &&
    typeof record.slot_id === 'string' &&
    typeof record.ciphertext === 'string' &&
    typeof record.created_at === 'string' &&
    typeof record.updated_at === 'string'
  );
}

export class WorkspaceSecretVault {
  readonly rootDir: string;
  readonly filePath: string;
  private readonly encryption: WorkspaceSecretCrypto;
  private readonly platform: NodeJS.Platform;
  private readonly now: () => Date;
  private readonly randomBytes: (size: number) => Buffer;

  constructor(options: WorkspaceSecretVaultOptions = {}) {
    this.rootDir =
      options.rootDir ?? path.join(os.homedir(), '.eigent', 'secure');
    this.filePath = path.join(this.rootDir, VAULT_FILE_NAME);
    this.encryption = options.crypto ?? defaultCrypto();
    this.platform = options.platform ?? process.platform;
    this.now = options.now ?? (() => new Date());
    this.randomBytes = options.randomBytes ?? crypto.randomBytes;
  }

  put(request: WorkspaceSecretPutRequest): WorkspaceSecretPutResult {
    assertScope(request);
    this.assertEncryptionAvailable();
    const valueBytes = Buffer.byteLength(request.value, 'utf8');
    if (valueBytes === 0 || valueBytes > MAX_WORKSPACE_SECRET_BYTES) {
      throw new WorkspaceSecretVaultError(
        'Workspace secret value size is invalid'
      );
    }

    const read = this.readDocument();
    if (read.corrupted) {
      throw new WorkspaceSecretNeedsRebindError(
        'Workspace secret vault is corrupted and must be recovered'
      );
    }
    const document = read.document ?? { version: FORMAT_VERSION, records: {} };
    // References are immutable commit candidates. Reusing one would let a
    // second renderer overwrite ciphertext before the Brain binding CAS wins.
    const secretRef = this.newSecretRef();
    const timestamp = this.now().toISOString();
    const record: EncryptedWorkspaceSecretRecord = {
      secret_ref: secretRef,
      account_scope_digest: request.account_scope_digest,
      space_id: request.space_id,
      revision_id: request.revision_id,
      slot_id: request.slot_id,
      ciphertext: this.encryption
        .encryptString(request.value)
        .toString('base64'),
      created_at: timestamp,
      updated_at: timestamp,
    };
    document.records[secretRef] = record;
    this.atomicWrite(document);
    return this.statusFromRecord(record, 'available');
  }

  status(lookup: WorkspaceSecretLookup): WorkspaceSecretStatus {
    assertScope(lookup);
    this.assertSecretRef(lookup.secret_ref);
    const read = this.readDocument();
    if (read.corrupted) {
      return { ...lookup, state: 'needs_rebind' };
    }
    const record = read.document?.records[lookup.secret_ref];
    if (!record) return { ...lookup, state: 'missing' };
    this.assertMatchingScope(record, lookup);
    if (!this.canDecrypt(record)) {
      return this.statusFromRecord(record, 'needs_rebind');
    }
    return this.statusFromRecord(record, 'available');
  }

  resolve(lookup: WorkspaceSecretLookup): string {
    assertScope(lookup);
    this.assertSecretRef(lookup.secret_ref);
    const read = this.readDocument();
    if (read.corrupted) {
      throw new WorkspaceSecretNeedsRebindError(
        'Workspace secret vault must be rebound'
      );
    }
    const record = read.document?.records[lookup.secret_ref];
    if (!record) {
      throw new WorkspaceSecretNotFoundError('Workspace secret is missing');
    }
    this.assertMatchingScope(record, lookup);
    this.assertEncryptionAvailable();
    try {
      return this.encryption.decryptString(
        Buffer.from(record.ciphertext, 'base64')
      );
    } catch {
      throw new WorkspaceSecretNeedsRebindError(
        'Workspace secret must be rebound'
      );
    }
  }

  delete(lookup: WorkspaceSecretLookup): WorkspaceSecretStatus {
    assertScope(lookup);
    this.assertSecretRef(lookup.secret_ref);
    const read = this.readDocument();
    if (read.corrupted) {
      throw new WorkspaceSecretNeedsRebindError(
        'Workspace secret vault must be recovered before deleting records'
      );
    }
    const document = read.document;
    const record = document?.records[lookup.secret_ref];
    if (!document || !record) return { ...lookup, state: 'missing' };
    this.assertMatchingScope(record, lookup);
    delete document.records[lookup.secret_ref];
    this.atomicWrite(document);
    return { ...lookup, state: 'missing' };
  }

  private assertEncryptionAvailable(): void {
    if (!this.encryption.isEncryptionAvailable()) {
      throw new WorkspaceSecretVaultError(
        'OS-level encryption is unavailable; refusing plaintext storage'
      );
    }
    if (
      this.platform === 'linux' &&
      this.encryption.getSelectedStorageBackend?.() === 'basic_text'
    ) {
      throw new WorkspaceSecretVaultError(
        'Linux safeStorage selected the insecure basic_text backend'
      );
    }
  }

  private canDecrypt(record: EncryptedWorkspaceSecretRecord): boolean {
    try {
      this.assertEncryptionAvailable();
      this.encryption.decryptString(Buffer.from(record.ciphertext, 'base64'));
      return true;
    } catch {
      return false;
    }
  }

  private assertMatchingScope(
    record: EncryptedWorkspaceSecretRecord,
    lookup: WorkspaceSecretLookup
  ): void {
    if (!sameScope(record, lookup)) {
      throw new WorkspaceSecretBindingMismatchError(
        'Workspace secret reference does not match its binding scope'
      );
    }
  }

  private assertSecretRef(value: string): void {
    if (!/^wsvault_[A-Za-z0-9_-]{32}$/u.test(value)) {
      throw new WorkspaceSecretVaultError(
        'Workspace secret reference is invalid'
      );
    }
  }

  private newSecretRef(): string {
    return `wsvault_${this.randomBytes(24).toString('base64url')}`;
  }

  private statusFromRecord(
    record: EncryptedWorkspaceSecretRecord,
    state: 'available'
  ): WorkspaceSecretPutResult;
  private statusFromRecord(
    record: EncryptedWorkspaceSecretRecord,
    state: 'needs_rebind'
  ): WorkspaceSecretStatus;
  private statusFromRecord(
    record: EncryptedWorkspaceSecretRecord,
    state: 'available' | 'needs_rebind'
  ): WorkspaceSecretStatus {
    return {
      secret_ref: record.secret_ref,
      account_scope_digest: record.account_scope_digest,
      space_id: record.space_id,
      revision_id: record.revision_id,
      slot_id: record.slot_id,
      state,
      created_at: record.created_at,
      updated_at: record.updated_at,
    };
  }

  private readDocument(): VaultReadResult {
    if (!fs.existsSync(this.filePath)) {
      return { document: null, corrupted: false };
    }
    try {
      const stat = fs.lstatSync(this.filePath);
      if (
        stat.isSymbolicLink() ||
        !stat.isFile() ||
        stat.size > MAX_VAULT_BYTES
      ) {
        return { document: null, corrupted: true };
      }
      const parsed = JSON.parse(
        fs.readFileSync(this.filePath, 'utf8')
      ) as Partial<VaultDocument>;
      if (
        parsed.version !== FORMAT_VERSION ||
        !parsed.records ||
        typeof parsed.records !== 'object'
      ) {
        return { document: null, corrupted: true };
      }
      for (const [secretRef, record] of Object.entries(parsed.records)) {
        if (
          !isEncryptedRecord(record) ||
          record.secret_ref !== secretRef ||
          !/^wsvault_[A-Za-z0-9_-]{32}$/u.test(secretRef)
        ) {
          return { document: null, corrupted: true };
        }
        assertScope(record);
      }
      return { document: parsed as VaultDocument, corrupted: false };
    } catch {
      return { document: null, corrupted: true };
    }
  }

  private ensureSecureDirectory(): void {
    if (fs.existsSync(this.rootDir)) {
      const stat = fs.lstatSync(this.rootDir);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new WorkspaceSecretVaultError(
          'Workspace secret vault directory is unsafe'
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

  private atomicWrite(document: VaultDocument): void {
    this.ensureSecureDirectory();
    const serialized = JSON.stringify(document);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_VAULT_BYTES) {
      throw new WorkspaceSecretVaultError('Workspace secret vault is full');
    }
    const temporaryPath = path.join(
      this.rootDir,
      `.${VAULT_FILE_NAME}.${process.pid}.${this.randomBytes(8).toString('hex')}.tmp`
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
      try {
        const directoryDescriptor = fs.openSync(this.rootDir, 'r');
        try {
          fs.fsyncSync(directoryDescriptor);
        } finally {
          fs.closeSync(directoryDescriptor);
        }
      } catch {
        // Directory fsync is unavailable on Windows and some filesystems.
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
