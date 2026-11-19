import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DESKTOP_INSTANCE_ID_FILE = 'desktop-instance-id';
const VALID_DESKTOP_INSTANCE_ID = /^desk_[A-Za-z0-9_-]{16,128}$/;

export function getOrCreateDesktopInstanceId(
  userDataPath: string,
  legacyRendererId?: string | null
): string {
  const identityPath = path.join(userDataPath, DESKTOP_INSTANCE_ID_FILE);
  try {
    const existing = fs.readFileSync(identityPath, 'utf-8').trim();
    if (VALID_DESKTOP_INSTANCE_ID.test(existing)) return existing;
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const migrated = String(legacyRendererId || '').trim();
  const candidate = VALID_DESKTOP_INSTANCE_ID.test(migrated)
    ? migrated
    : `desk_${crypto.randomUUID().replaceAll('-', '')}`;
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
    if (!VALID_DESKTOP_INSTANCE_ID.test(winner)) {
      throw new Error('Desktop instance identity file is invalid');
    }
    return winner;
  }
}
