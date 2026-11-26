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

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hostMocks = vi.hoisted(() => ({
  host: null as null | { electronAPI: Record<string, unknown> },
}));

vi.mock('@/host', () => ({
  useHost: () => hostMocks.host,
}));

vi.mock('@/components/ui/tooltip', () => ({
  TooltipSimple: ({ children }: { children: React.ReactNode }) => children,
}));

import { WindowsAppMenuButton } from '@/components/TopBar/WindowsAppMenuButton';

describe('WindowsAppMenuButton', () => {
  afterEach(() => {
    cleanup();
    hostMocks.host = null;
  });

  it('renders nothing on macOS and Linux', () => {
    hostMocks.host = { electronAPI: { openWindowAppMenu: vi.fn() } };

    render(<WindowsAppMenuButton platform="darwin" />);
    render(<WindowsAppMenuButton platform="linux" />);

    expect(screen.queryByTestId('windows-app-menu-button')).toBeNull();
  });

  it('renders nothing when the host cannot open the menu', () => {
    hostMocks.host = { electronAPI: {} };

    render(<WindowsAppMenuButton platform="win32" />);

    expect(screen.queryByTestId('windows-app-menu-button')).toBeNull();
  });

  it('opens the application menu under its own bottom-left corner on Windows', () => {
    const openWindowAppMenu = vi.fn();
    hostMocks.host = { electronAPI: { openWindowAppMenu } };

    render(<WindowsAppMenuButton platform="win32" />);
    const button = screen.getByTestId('windows-app-menu-button');
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.classList.contains('no-drag')).toBe(true);
    button.getBoundingClientRect = () =>
      ({ left: 8, bottom: 36, top: 8, right: 36 }) as DOMRect;

    fireEvent.click(button);

    expect(openWindowAppMenu).toHaveBeenCalledWith({ x: 8, y: 36 });
  });
});
