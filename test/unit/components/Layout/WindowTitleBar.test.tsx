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
  host: null as null | { electronAPI: Record<string, unknown> },
}));

vi.mock('@/host', () => ({
  useHost: () => hostMocks.host,
}));

vi.mock('@/components/WindowControls', () => ({
  default: () => <div data-testid="window-controls" />,
}));

import { WindowTitleBar } from '@/components/Layout/WindowTitleBar';

describe('WindowTitleBar', () => {
  afterEach(() => {
    cleanup();
    hostMocks.host = null;
  });

  it('renders nothing outside the desktop host', () => {
    render(<WindowTitleBar />);

    expect(screen.queryByTestId('window-title-bar')).toBeNull();
  });

  it('renders a drag strip inside the window-controls safe area', () => {
    hostMocks.host = { electronAPI: {} };
    render(<WindowTitleBar />);

    const strip = screen.getByTestId('window-title-bar');
    const dragArea = strip.firstElementChild;
    expect(dragArea?.classList.contains('drag')).toBe(true);
    expect(dragArea?.classList.contains('window-chrome-safe-area')).toBe(true);
    expect(screen.getByTestId('window-controls')).toBeTruthy();
  });
});
