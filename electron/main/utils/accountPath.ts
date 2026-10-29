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

import { createHash } from 'crypto';

/**
 * Derivation of the on-disk account directory from an email address.
 *
 * This lives in its own module, with no import-time side effects, so both
 * `envUtil` and `subscriptionAuth/credentialStore` can use it. They used to
 * carry identical copies of the same expression, which is how they drifted.
 */

import { platform } from 'os';

/**
 * The previous derivation, kept only to locate directories created before the
 * fix so they can be migrated. It is deliberately not used for anything new.
 *
 * It discarded the domain entirely and replaced only the first dot, so
 * `alice@personal.com`, `alice@work.com` and `alice@corp.internal` all mapped
 * to `alice` and shared one `.env` file holding three accounts' credentials.
 */
export function legacyAccountDirName(email: string): string {
  return email
    .split('@')[0]
    .replace(/[\\/*?:"<>|\s]/g, '_')
    .replace('.', '_');
}

/**
 * Control characters, spaces, and everything unsafe in a path component on
 * Windows or POSIX. Spaces are included deliberately: they are legal in a POSIX
 * name but need quoting in every shell and are rejected at the tail on Windows.
 */
const UNSAFE = /[\u0000-\u0020\u007f<>:"/\\|?*]/g;

/** Windows additionally rejects trailing dots and spaces. */
const WINDOWS_UNSAFE_TAIL = /[. ]+$/;

/** Reserved device names on Windows. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Longest readable portion of the directory name, before the hash suffix. */
const MAX_READABLE_LENGTH = 64;

/**
 * Build the account directory name for an email address.
 *
 * The result stays greppable — the address is right there in the path — while
 * being distinct for every address. That combination is what the previous
 * expression gave up: it was readable but not distinct, and where the two
 * requirements conflict, distinctness wins, because the directory holds one
 * account's API keys.
 *
 * The name is `<readable>~<hash>`:
 *
 * - `readable` is the address with characters that are unsafe on Windows or
 *   POSIX replaced, so a path stays recognisable when debugging.
 * - `hash` is a truncated SHA-256 of the exact original address. Sanitisation
 *   is lossy — `a/b@x.com` and `a_b@x.com` both sanitise to `a_b@x.com` — so
 *   the readable part alone cannot guarantee the paths differ. Including a
 *   digest of the untouched input makes the mapping injective, which is what
 *   keeps one account from reading another's credentials.
 *
 * @param email - The account's email address, used verbatim for the hash.
 * @returns A single, filesystem-safe path component.
 */
export function accountDirName(email: string): string {
  const digest = createHash('sha256')
    .update(email, 'utf8')
    .digest('hex')
    .slice(0, 12);

  const readable = email
    .normalize('NFKC')
    .replace(UNSAFE, '_')
    // Leading dots would create hidden files and `..` would escape the parent.
    .replace(/^\.+/, '_')
    .replace(WINDOWS_UNSAFE_TAIL, '')
    .slice(0, MAX_READABLE_LENGTH)
    .replace(WINDOWS_UNSAFE_TAIL, '');

  const safe = readable.length > 0 ? readable : 'account';

  // `~` is valid on both platforms and cannot appear in an email address, so
  // it can never be confused with the readable part.
  return `${safe}~${digest}`;
}

/** Whether the current platform needs the extra Windows name restrictions. */
function needsWindowsRestrictions(): boolean {
  return platform() === 'win32';
}

/**
 * Assert a derived name is usable as a path component on this platform.
 *
 * Kept separate so the rules that only apply on Windows are not applied to
 * POSIX, where they would needlessly mangle ordinary addresses.
 */
export function assertUsableAccountDirName(name: string): void {
  if (name.length === 0) {
    throw new Error('Account directory name must not be empty');
  }
  if (name === '.' || name === '..' || name.startsWith('../')) {
    throw new Error(`Refusing to use ${name} as an account directory`);
  }
  if (needsWindowsRestrictions() && WINDOWS_RESERVED.test(name)) {
    throw new Error(`Refusing to use reserved name ${name} on Windows`);
  }
}
