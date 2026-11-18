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

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(process.cwd(), 'electron/main/index.ts'),
  'utf8'
);

function handler(channel: string): string {
  const start = source.indexOf(`'${channel}'`);
  expect(start, channel).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('});', start));
}

describe('Session window wiring', () => {
  it('lets only the main window open Session windows, for valid targets', () => {
    const open = handler('session-window:open');
    expect(open).toMatch(/if \(!isMainRendererFrame\(event\)\)/u);
    expect(open).toContain('isSessionWindowTarget(target)');
  });

  it('hands a Session back only from its own window main frame', () => {
    const back = handler('session-window:return-to-main');
    expect(back).toContain('targetForContents(event.sender.id)');
    expect(back).toContain('event.senderFrame !== event.sender.mainFrame');
  });

  it('relays messages only from app window main frames', () => {
    expect(handler('session-window:post')).toContain(
      'if (!isAppRendererFrame(event)) return;'
    );
  });

  it('keeps Settings-only surfaces with the main window', () => {
    expect(handler('select-agent-plugin-source')).toContain(
      'assertMainRendererSender(event)'
    );
    expect(source).toMatch(
      /registerWorkspaceSecretIpcHandlers\([\s\S]*?assertMainRendererSender/u
    );
  });

  it('gives Session windows the main window guards and recovery', () => {
    const create = source.slice(
      source.indexOf('function createSessionAppWindow('),
      source.indexOf('function checkBackendHealth(')
    );
    for (const guard of [
      'installPreviewGuestGuards(sessionWindow)',
      'setupExternalLinkHandling(sessionWindow)',
      "'render-process-gone'",
      "'did-fail-load'",
      'SUBFRAME_LOAD_FAILED_CHANNEL',
      '...appWindowChromeOptions()',
    ])
      expect(create).toContain(guard);
  });

  it('keeps the saved Session window list when the app quits', () => {
    expect(source).toMatch(
      /markAppQuitInProgress\(\);[\s\S]{0,200}sessionWindows\?\.markQuitting\(\);/u
    );
  });
});
