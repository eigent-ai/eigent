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

import KeyboardShortcutsDialog from '@/components/Dialog/KeyboardShortcutsDialog';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

describe('KeyboardShortcutsDialog', () => {
  it('renders macOS key symbols and platform-specific window commands', () => {
    render(
      <KeyboardShortcutsDialog open onOpenChange={vi.fn()} platform="darwin" />
    );

    const dialog = screen.getByRole('dialog', { name: 'Keyboard Shortcuts' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveStyle({ transformOrigin: 'center' });
    expect(dialog.style.transform).toContain('translate(-50%, -50%)');
    expect(dialog).not.toHaveClass(
      'slide-in-from-left-1/2',
      'slide-in-from-top-[48%]'
    );
    expect(
      screen.getByLabelText('Keyboard Shortcuts: ⌘+/')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Minimize: ⌘+M')).toBeInTheDocument();
    expect(screen.getByLabelText('Quit Eigent: ⌘+Q')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Toggle Chat / Trajectory View: ⌘+⇧+L')
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Open Browser in Preview: ⌘+⇧+B')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Go to Home Page: ⌘+⇧+H')).toBeInTheDocument();

    const keycaps = document.querySelectorAll('kbd');
    expect(keycaps.length).toBeGreaterThan(0);
    keycaps.forEach((keycap) => {
      expect(keycap).toHaveClass('h-5', 'border-0', 'ring-1');
      expect(keycap).not.toHaveClass('shadow-sm', 'py-0.5');
    });

    const workspace = screen.getByRole('region', {
      name: 'Workspace',
    });
    expect(
      Array.from(workspace?.querySelectorAll('li') ?? []).map((row) =>
        row.textContent?.replace(/\s/g, '')
      )
    ).toEqual([
      'GotoWorkspace⌘1',
      'GotoFiles⌘2',
      'GotoAutomations⌘3',
      'GotoDispatch⌘4',
      'GotoConfiguration⌘5',
      'Newsession⌘N',
    ]);
  });

  it('renders Windows redo and full-screen shortcuts without mac-only rows', () => {
    render(
      <KeyboardShortcutsDialog open onOpenChange={vi.fn()} platform="win32" />
    );

    expect(
      screen.getByLabelText('Keyboard Shortcuts: Ctrl+/')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Redo: Ctrl+Y')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Toggle Full Screen: F11')
    ).toBeInTheDocument();
    expect(screen.queryByText('Quit Eigent')).not.toBeInTheDocument();
  });

  it('uses one scrollable column with bordered 36px rows', () => {
    render(
      <KeyboardShortcutsDialog open onOpenChange={vi.fn()} platform="linux" />
    );

    const list = document.querySelector('[data-keyboard-shortcuts-list]');
    expect(list).toHaveClass('flex', 'flex-col');
    expect(list).not.toHaveClass('sm:grid-cols-2');

    const rows = document.querySelectorAll('[data-keyboard-shortcut-row]');
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((row) => expect(row).toHaveClass('h-9', 'border-b-[1px]'));
    expect(list?.parentElement).toHaveClass('overflow-y-auto');
  });
});
