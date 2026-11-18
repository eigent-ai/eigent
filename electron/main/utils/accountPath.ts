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

/**
 * Where each account keeps its files under `~/.eigent`.
 *
 * Older versions named the folder after the part of the email before the `@`,
 * so `alice@personal.com` and `alice@work.com` shared `~/.eigent/alice` and
 * `~/.eigent/.env.alice`, and with them each other's API keys, MCP sign-ins and
 * Codex sign-in. An account now uses `user_<id>`, the same folder the backend
 * already uses for the account's skills config.
 *
 * The main process only receives an email from most callers, so it keeps a
 * small registry (`~/.eigent/account-folders.json`) from email to folder. The
 * renderer registers the signed-in account; until then, or if registering
 * fails, the old folder keeps being used, exactly as before.
 *
 * Registering copies the old folder's contents into the new one once. It never
 * moves or deletes the old folder: when two accounts shared it, nothing on disk
 * says which file belongs to whom, so each account gets a copy, and older app
 * versions keep working after a downgrade.
 *
 * Nothing here runs at import time, so `subscriptionAuth/credentialStore` can
 * import it without side effects.
 */

import log from 'electron-log';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ACCOUNT_REGISTRY_FILE = 'account-folders.json';
export const MIGRATION_MARKER_FILE = '.legacy-account-migration.json';

const REGISTRY_VERSION = 1;
const UNSAFE_CHARS = /[\\/*?:"<>|\s]/g;
const CANONICAL_DIR_NAME = /^user_[^\\/*?:"<>|\s]+$/;

/**
 * Folders under `~/.eigent` that belong to the app, not to an account. An
 * email such as `cache@example.com` used to map onto one of them; only the
 * account's own files are copied out of those.
 */
const SHARED_EIGENT_DIRS = new Set([
  'bin',
  'browser_profiles',
  'cache',
  'fallback',
  'memory',
  'migrations',
  'runtime',
  'skills',
  'tokens',
  'venvs',
  'workspaces',
]);

/** Files that are always the account's own, wherever they sit. */
function isAccountOwnedEntry(name: string): boolean {
  return name === 'codex-auth.json' || name.startsWith('mcp-remote-');
}

export function eigentDir(): string {
  return path.join(os.homedir(), '.eigent');
}

/**
 * The folder name older versions derived from an email. Kept exactly as it was
 * (including replacing only the first dot) so the old folder can be found.
 */
export function legacyAccountDirName(email: string): string {
  return email.split('@')[0].replace(UNSAFE_CHARS, '_').replace('.', '_');
}

/**
 * `user_<id>`, matching the backend's skills-config folder and the project
 * storage identity. Returns null when there is no usable id.
 */
export function accountDirNameForUserId(
  userId: string | number | null | undefined
): string | null {
  if (userId === null || userId === undefined) return null;
  const sanitized = String(userId)
    .trim()
    .replace(UNSAFE_CHARS, '_')
    .replace(/^\.+|\.+$/g, '');
  if (!sanitized) return null;
  const name = sanitized.startsWith('user_') ? sanitized : `user_${sanitized}`;
  return CANONICAL_DIR_NAME.test(name) && !name.includes('..') ? name : null;
}

function registryKey(email: string): string {
  return email.trim().toLowerCase();
}

interface AccountRegistry {
  v: number;
  accounts: Record<string, string>;
}

function registryPath(root: string): string {
  return path.join(root, ACCOUNT_REGISTRY_FILE);
}

function readRegistry(root: string): AccountRegistry {
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath(root), 'utf-8'));
    if (parsed && typeof parsed.accounts === 'object' && parsed.accounts) {
      return { v: REGISTRY_VERSION, accounts: { ...parsed.accounts } };
    }
  } catch {
    // Missing or unreadable: every account uses its old folder.
  }
  return { v: REGISTRY_VERSION, accounts: {} };
}

function writeRegistry(root: string, registry: AccountRegistry): void {
  fs.mkdirSync(root, { recursive: true });
  const target = registryPath(root);
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(registry, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/**
 * The folder name to use for an email: `user_<id>` once the account has been
 * registered and its old files copied, otherwise the old email-derived name.
 */
export function resolveAccountDirName(email: string): string {
  const registered = readRegistry(eigentDir()).accounts[registryKey(email)];
  if (typeof registered === 'string' && accountDirNameForUserId(registered)) {
    return registered;
  }
  return legacyAccountDirName(email);
}

export type MigrationStatus =
  'migrated' | 'nothing-to-migrate' | 'already-done' | 'failed';

export interface MigrationResult {
  status: MigrationStatus;
  from: string;
  copied: string[];
  skipped: string[];
  failed: string[];
  /** Another registered account used the same old folder. */
  sharedLegacyFolder: boolean;
}

function exists(target: string): boolean {
  return fs.lstatSync(target, { throwIfNoEntry: false }) !== undefined;
}

/** Copy next to the target, then rename, so a failure never leaves half a copy. */
function copyEntry(source: string, target: string): void {
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.migrating-${crypto.randomUUID()}`
  );
  try {
    fs.cpSync(source, temporary, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

/**
 * Copy what an account kept under its old folder into `user_<id>`, once.
 *
 * - `~/.eigent/.env.<old>` → `~/.eigent/.env.user_<id>`
 * - every entry in `~/.eigent/<old>/` → `~/.eigent/user_<id>/`
 *
 * Anything already present in the new place is left alone, so this never
 * overwrites newer data (the backend may already have put the skills config
 * there). The old folder is never changed. The marker is written only when
 * every entry was handled, so a failure is retried on the next start.
 */
export function migrateLegacyAccountData(
  email: string,
  dirName: string,
  otherRegisteredEmails: string[] = []
): MigrationResult {
  const root = eigentDir();
  const targetDir = path.join(root, dirName);
  const marker = path.join(targetDir, MIGRATION_MARKER_FILE);
  const from = legacyAccountDirName(email);
  const result: MigrationResult = {
    status: 'already-done',
    from,
    copied: [],
    skipped: [],
    failed: [],
    sharedLegacyFolder: otherRegisteredEmails.some(
      (other) => legacyAccountDirName(other) === from
    ),
  };
  if (exists(marker)) return result;

  // An empty old name meant `~/.eigent` itself, and a `user_*` old name is
  // another account's new folder: neither is this account's to copy.
  const hasLegacyLocation =
    from.length > 0 &&
    from !== '.' &&
    from !== '..' &&
    !from.startsWith('user_') &&
    from !== dirName;

  fs.mkdirSync(targetDir, { recursive: true });

  if (hasLegacyLocation) {
    const legacyEnv = path.join(root, `.env.${from}`);
    const targetEnv = path.join(root, `.env.${dirName}`);
    if (exists(legacyEnv)) {
      if (exists(targetEnv)) {
        result.skipped.push(path.basename(targetEnv));
      } else {
        try {
          copyEntry(legacyEnv, targetEnv);
          try {
            fs.chmodSync(targetEnv, 0o600);
          } catch {
            // best-effort on platforms without POSIX perms
          }
          result.copied.push(path.basename(targetEnv));
        } catch (error) {
          result.failed.push(path.basename(targetEnv));
          log.warn('[accountPath] could not copy the old env file', error);
        }
      }
    }

    const legacyDir = path.join(root, from);
    let entries: string[] = [];
    try {
      if (fs.statSync(legacyDir, { throwIfNoEntry: false })?.isDirectory()) {
        entries = fs.readdirSync(legacyDir);
      }
    } catch (error) {
      result.failed.push(from);
      log.warn('[accountPath] could not read the old account folder', error);
    }
    const appFolder = SHARED_EIGENT_DIRS.has(from.toLowerCase());
    for (const entry of entries) {
      if (entry === MIGRATION_MARKER_FILE) continue;
      if (appFolder && !isAccountOwnedEntry(entry)) continue;
      const target = path.join(targetDir, entry);
      if (exists(target)) {
        result.skipped.push(entry);
        continue;
      }
      try {
        copyEntry(path.join(legacyDir, entry), target);
        result.copied.push(entry);
      } catch (error) {
        result.failed.push(entry);
        log.warn(`[accountPath] could not copy ${entry}`, error);
      }
    }
  }

  if (result.failed.length > 0) {
    result.status = 'failed';
    return result;
  }

  result.status = result.copied.length > 0 ? 'migrated' : 'nothing-to-migrate';
  fs.writeFileSync(
    marker,
    JSON.stringify(
      {
        v: 1,
        from: hasLegacyLocation ? from : null,
        at: new Date().toISOString(),
        copied: result.copied,
        skipped: result.skipped,
        sharedLegacyFolder: result.sharedLegacyFolder,
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  return result;
}

export interface RegisterResult {
  dirName: string;
  migration: MigrationResult | null;
}

/**
 * Record which folder an account uses, copying its old files first.
 *
 * Never throws: on any failure the account keeps using its current folder and
 * the copy is tried again on the next start.
 */
export function registerAccountFolder(
  email: unknown,
  userId: unknown
): RegisterResult {
  const address = typeof email === 'string' ? email.trim() : '';
  const dirName =
    typeof userId === 'string' || typeof userId === 'number'
      ? accountDirNameForUserId(userId)
      : null;
  if (!address || !dirName) {
    return {
      dirName: address ? resolveAccountDirName(address) : '',
      migration: null,
    };
  }

  try {
    const root = eigentDir();
    const registry = readRegistry(root);
    const key = registryKey(address);
    const others = Object.keys(registry.accounts).filter((k) => k !== key);
    const migration = migrateLegacyAccountData(address, dirName, others);

    if (migration.status === 'failed') {
      log.warn(
        `[accountPath] kept the old folder for this account; ${migration.failed.length} item(s) could not be copied and will be retried`
      );
      return { dirName: resolveAccountDirName(address), migration };
    }
    if (migration.sharedLegacyFolder && migration.status === 'migrated') {
      log.warn(
        '[accountPath] another account used the same old folder; its files were copied to both accounts because their owner cannot be told apart'
      );
    }
    if (registry.accounts[key] !== dirName) {
      registry.accounts[key] = dirName;
      writeRegistry(root, registry);
    }
    if (migration.status === 'migrated') {
      log.info(
        `[accountPath] copied ${migration.copied.length} item(s) from the old account folder; ${migration.skipped.length} already present`
      );
    }
    return { dirName, migration };
  } catch (error) {
    log.warn('[accountPath] could not register the account folder', error);
    return { dirName: resolveAccountDirName(address), migration: null };
  }
}
