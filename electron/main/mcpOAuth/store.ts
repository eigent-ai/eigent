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
import { normalizeServerUrl } from './discovery';
import {
  McpOAuthError,
  type McpOAuthCredential,
  type McpOAuthIdentity,
} from './types';

export function identityKey(identity: McpOAuthIdentity): string {
  if (
    !identity ||
    typeof identity.account !== 'string' ||
    !identity.account.trim() ||
    typeof identity.name !== 'string' ||
    !identity.name.trim() ||
    typeof identity.url !== 'string' ||
    identity.account.length > 512 ||
    identity.name.length > 512 ||
    identity.url.length > 4096
  ) {
    throw new McpOAuthError('invalid_request');
  }
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        identity.account.trim().toLowerCase(),
        identity.name,
        normalizeServerUrl(identity.url),
      ])
    )
    .digest('hex');
}

export class McpOAuthStore {
  constructor(
    private readonly directory = path.join(
      os.homedir(),
      '.eigent',
      'mcp-oauth'
    ),
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  assertAvailable(): void {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (this.platform === 'linux' &&
        safeStorage.getSelectedStorageBackend?.() === 'basic_text')
    ) {
      throw new McpOAuthError('encryption_unavailable');
    }
  }

  read(identity: McpOAuthIdentity): McpOAuthCredential | null {
    const file = path.join(this.directory, `${identityKey(identity)}.enc`);
    if (!fs.existsSync(file)) return null;
    this.assertAvailable();
    try {
      const credential = JSON.parse(
        safeStorage.decryptString(fs.readFileSync(file))
      ) as McpOAuthCredential;
      if (
        !credential.access_token ||
        !credential.client_id ||
        !Number.isFinite(credential.expires_at) ||
        credential.resource !== normalizeServerUrl(identity.url)
      )
        throw new Error();
      return credential;
    } catch {
      throw new McpOAuthError('signin_required');
    }
  }

  write(identity: McpOAuthIdentity, credential: McpOAuthCredential): void {
    this.assertAvailable();
    const file = path.join(this.directory, `${identityKey(identity)}.enc`);
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    let encrypted: Buffer;
    try {
      encrypted = safeStorage.encryptString(JSON.stringify(credential));
    } catch {
      throw new McpOAuthError('encryption_unavailable');
    }
    try {
      fs.writeFileSync(temporary, encrypted, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

  delete(identity: McpOAuthIdentity): void {
    fs.rmSync(path.join(this.directory, `${identityKey(identity)}.enc`), {
      force: true,
    });
  }
}
