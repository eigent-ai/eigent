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

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hostMocks = vi.hoisted(() => ({
  platform: 'win32',
}));

vi.mock('@/host', () => ({
  useHost: () => ({
    electronAPI: { getPlatform: () => hostMocks.platform },
  }),
}));

import { SessionWindowTopBar } from '@/components/SessionWindow/SessionWindowTopBar';

describe('SessionWindowTopBar', () => {
  afterEach(() => {
    cleanup();
    hostMocks.platform = 'win32';
  });

  it('keeps its actions clear of the native Windows caption buttons', () => {
    render(
      <SessionWindowTopBar spaceId="space-1" onOpenInMainWindow={vi.fn()} />
    );

    const bar = document.getElementById('titlebar');
    expect(bar?.classList.contains('drag')).toBe(true);
    expect(bar?.classList.contains('window-chrome-safe-area')).toBe(true);
    // The safe area sets the width, so the bar must not also pin to the right.
    expect(bar?.classList.contains('right-0')).toBe(false);
    expect(
      screen.getByRole('button', { name: /open in main window/i })
    ).toBeTruthy();
  });

  it('draws no in-app window controls on Windows', () => {
    render(
      <SessionWindowTopBar spaceId="space-1" onOpenInMainWindow={vi.fn()} />
    );

    expect(document.getElementById('window-controls')).toBeNull();
  });
});
