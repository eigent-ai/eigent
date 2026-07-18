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

// PKCE + state generation for the Codex subscription OAuth flow.
// Pure crypto — no Electron / Codex-specific details, so this is safe to land
// ahead of the Codex endpoint spike (P0-1). RFC 7636 (S256) + RFC 6749 state.

import crypto from 'node:crypto';

function base64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * High-entropy code_verifier. RFC 7636 allows 43-128 chars from the unreserved
 * set; base64url of 32 random bytes yields 43 chars, all unreserved.
 */
export function generateCodeVerifier(): string {
  return base64Url(crypto.randomBytes(32));
}

/** S256 challenge = base64url(SHA256(verifier)). */
export function deriveCodeChallenge(codeVerifier: string): string {
  return base64Url(crypto.createHash('sha256').update(codeVerifier).digest());
}

/** Opaque anti-CSRF state value. */
export function generateState(): string {
  return base64Url(crypto.randomBytes(24));
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  state: string;
}

/** Generate a full PKCE pair plus a state value in one call. */
export function createPkcePair(): PkcePair {
  const codeVerifier = generateCodeVerifier();
  return {
    codeVerifier,
    codeChallenge: deriveCodeChallenge(codeVerifier),
    codeChallengeMethod: 'S256',
    state: generateState(),
  };
}
