import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DESKTOP_INSTANCE_ID_FILE = 'desktop-instance-id';
const VALID_DESKTOP_INSTANCE_ID = /^desk_[A-Za-z0-9_-]{16,128}$/;

/**
 * Replace the identity file's content atomically: write a sibling temp file
 * then rename it over the target. rename is atomic on the same filesystem and
 * overwrites the corrupt file in one step, so no reader ever observes a
 * partially written id.
 */
function atomicWriteIdentity(identityPath: string, id: string): void {
  const tempPath = `${identityPath}.${process.pid}.${crypto
    .randomUUID()
    .replaceAll('-', '')}.tmp`;
  fs.writeFileSync(tempPath, id, { encoding: 'utf-8', mode: 0o600 });
  try {
    fs.renameSync(tempPath, identityPath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Best-effort cleanup; the rename failure is the real error.
    }
    throw error;
  }
}

export function getOrCreateDesktopInstanceId(
  userDataPath: string,
  legacyRendererId?: string | null
): string {
  const identityPath = path.join(userDataPath, DESKTOP_INSTANCE_ID_FILE);
  let existingInvalid = false;
  try {
    const existing = fs.readFileSync(identityPath, 'utf-8').trim();
    if (VALID_DESKTOP_INSTANCE_ID.test(existing)) return existing;
    // The file exists but its content is corrupt. Previously this fell into
    // the wx write below, hit EEXIST, re-read the same bad content and threw —
    // bricking remote control until someone deleted the file by hand. Instead
    // mint a fresh id and atomically overwrite the corrupt one.
    existingInvalid = true;
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const migrated = String(legacyRendererId || '').trim();
  const candidate = VALID_DESKTOP_INSTANCE_ID.test(migrated)
    ? migrated
    : `desk_${crypto.randomUUID().replaceAll('-', '')}`;

  if (existingInvalid) {
    atomicWriteIdentity(identityPath, candidate);
    return candidate;
  }

  try {
    fs.writeFileSync(identityPath, candidate, {
      encoding: 'utf-8',
      flag: 'wx',
      mode: 0o600,
    });
    return candidate;
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
    const winner = fs.readFileSync(identityPath, 'utf-8').trim();
    // A concurrent creator won the race. Adopt its id when valid; if it wrote
    // corrupt content, atomically repair it rather than dead-ending.
    if (VALID_DESKTOP_INSTANCE_ID.test(winner)) return winner;
    atomicWriteIdentity(identityPath, candidate);
    return candidate;
  }
}
