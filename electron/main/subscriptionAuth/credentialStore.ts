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

// Desktop-local encrypted credential store for Codex subscription tokens.
//
// Design (see docs/models/codex-subscription-auth-review.md):
//   - Token material is encrypted at rest with Electron `safeStorage`
//     (OS keychain backed) and never leaves the user's machine.
//   - Non-sensitive metadata (status, label, expiry) is stored in plaintext
//     alongside the ciphertext so the UI can render status without decrypting.
//   - File lives under ~/.eigent/<tempEmail>/codex-auth.json, mode 0600.
//
// This module is intentionally free of any Codex endpoint / OAuth-flow detail
// so it can land ahead of the P0-1 spike. It only persists/restores whatever
// credential the (later) OAuth flow produces.

import { safeStorage } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { CodexAccountStatusView, CodexCredential } from './types';

const FILE_NAME = 'codex-auth.json';
const FORMAT_VERSION = 1;

// Secret fields are encrypted; everything else is stored as plaintext metadata.
type SecretPayload = Pick<
  CodexCredential,
  'access_token' | 'refresh_token' | 'token_type'
>;

type MetaPayload = Omit<CodexCredential, keyof SecretPayload>;

interface OnDiskRecord {
  v: number;
  // base64 of safeStorage-encrypted JSON(SecretPayload)
  enc: string;
  meta: MetaPayload;
}

// Mirror of envUtil.getEnvPath's email → folder derivation, kept local so this
// module has no side effects at import time.
function tempEmail(email: string): string {
  return email
    .split('@')[0]
    .replace(/[\\/*?:"<>|\s]/g, '_')
    .replace('.', '_');
}

export function getCodexAuthDir(email: string): string {
  return path.join(os.homedir(), '.eigent', tempEmail(email));
}

export function getCodexAuthFilePath(email: string): string {
  return path.join(getCodexAuthDir(email), FILE_NAME);
}

function assertEncryptionAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS-level encryption (safeStorage) is unavailable; refusing to persist Codex tokens in plaintext.'
    );
  }
}

/** Persist a credential, encrypting the secret fields at rest. */
export function saveCodexCredential(
  email: string,
  credential: CodexCredential
): void {
  assertEncryptionAvailable();

  const secret: SecretPayload = {
    access_token: credential.access_token,
    refresh_token: credential.refresh_token ?? null,
    token_type: credential.token_type ?? null,
  };
  const meta: MetaPayload = {
    expires_at: credential.expires_at ?? null,
    account_label: credential.account_label ?? null,
    external_account_id: credential.external_account_id ?? null,
    scopes: credential.scopes ?? null,
    status: credential.status,
    last_error_code: credential.last_error_code ?? null,
    last_error_message: credential.last_error_message ?? null,
    updated_at: credential.updated_at ?? null,
  };

  const enc = safeStorage
    .encryptString(JSON.stringify(secret))
    .toString('base64');
  const record: OnDiskRecord = { v: FORMAT_VERSION, enc, meta };

  const dir = getCodexAuthDir(email);
  fs.mkdirSync(dir, { recursive: true });
  const file = getCodexAuthFilePath(email);
  fs.writeFileSync(file, JSON.stringify(record), { mode: 0o600 });
  // writeFileSync's mode only applies on create; enforce on existing files too.
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // best-effort on platforms without POSIX perms
  }
}

function readRecord(email: string): OnDiskRecord | null {
  const file = getCodexAuthFilePath(email);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as OnDiskRecord;
    if (!parsed || parsed.v !== FORMAT_VERSION || !parsed.enc) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Load and decrypt the full credential, or null if absent/unreadable. */
export function loadCodexCredential(email: string): CodexCredential | null {
  const record = readRecord(email);
  if (!record) return null;
  assertEncryptionAvailable();
  let secret: SecretPayload;
  try {
    const plaintext = safeStorage.decryptString(
      Buffer.from(record.enc, 'base64')
    );
    secret = JSON.parse(plaintext) as SecretPayload;
  } catch {
    // Ciphertext unreadable (e.g. keychain rotated / different machine).
    return null;
  }
  return { ...record.meta, ...secret };
}

/**
 * Read only the non-sensitive status view — no decryption, safe to hand to the
 * renderer. Returns a not_connected view when nothing is stored.
 */
export function getCodexAccountStatus(email: string): CodexAccountStatusView {
  const record = readRecord(email);
  if (!record) {
    return { connected: false, status: 'not_connected' };
  }
  const { meta } = record;
  return {
    connected:
      meta.status === 'connected' ||
      meta.status === 'connected_non_refreshable',
    status: meta.status,
    account_label: meta.account_label ?? null,
    expires_at: meta.expires_at ?? null,
    last_error_code: meta.last_error_code ?? null,
  };
}

/** Remove the stored credential (disconnect). Idempotent. */
export function clearCodexCredential(email: string): void {
  const file = getCodexAuthFilePath(email);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    // best-effort
  }
}
