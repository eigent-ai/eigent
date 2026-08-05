import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { getOrCreateDesktopInstanceId } from '../../../electron/main/desktopIdentity';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-device-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('main-process desktop identity', () => {
  it('atomically persists and reuses the first installation identity', () => {
    const directory = temporaryDirectory();
    const first = getOrCreateDesktopInstanceId(
      directory,
      'desk_migratedrendereridentity123'
    );
    const replay = getOrCreateDesktopInstanceId(
      directory,
      'desk_differentrendereridentity45'
    );

    expect(first).toBe('desk_migratedrendereridentity123');
    expect(replay).toBe(first);
    expect(
      fs.readFileSync(path.join(directory, 'desktop-instance-id'), 'utf-8')
    ).toBe(first);
  });

  it('generates a valid identity when no trusted migration value exists', () => {
    const identity = getOrCreateDesktopInstanceId(
      temporaryDirectory(),
      'browser-forgery'
    );

    expect(identity).toMatch(/^desk_[A-Za-z0-9_-]{16,128}$/);
  });
});
