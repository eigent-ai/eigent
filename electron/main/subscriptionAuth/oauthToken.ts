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

export function expiresAtFromTokenPayload(payload: Record<string, unknown>) {
  if (typeof payload.expires_at === 'string') {
    return payload.expires_at;
  }
  const expiresIn = Number(payload.expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    return new Date(Date.now() + expiresIn * 1000).toISOString();
  }
  const accessToken = payload.access_token;
  if (typeof accessToken === 'string') {
    return expiresAtFromAccessToken(accessToken);
  }
  return null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
}

export function expiresAtFromAccessToken(token: string): string | null {
  const payload = decodeJwtPayload(token);
  const exp = Number(payload?.exp);
  if (!Number.isFinite(exp) || exp <= 0) {
    return null;
  }
  return new Date(exp * 1000).toISOString();
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function codexAccountMetadataFromAccessToken(token: string): {
  account_label: string | null;
  external_account_id: string | null;
} {
  const payload = decodeJwtPayload(token);
  const auth = readRecord(payload?.['https://api.openai.com/auth']);
  const profile = readRecord(payload?.['https://api.openai.com/profile']);
  const email = profile.email;
  const accountId = auth.chatgpt_account_id;
  return {
    account_label: typeof email === 'string' && email ? email : null,
    external_account_id:
      typeof accountId === 'string' && accountId ? accountId : null,
  };
}
