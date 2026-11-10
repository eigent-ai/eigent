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

import { TooltipProvider, TooltipSimple } from '@/components/ui/tooltip';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

describe('TooltipSimple', () => {
  it('removes vertical padding for compact shortcut content', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <TooltipSimple content="Command B" compact variant="instant">
          <button type="button">Toggle sidebar</button>
        </TooltipSimple>
      </TooltipProvider>
    );

    await user.hover(screen.getByRole('button', { name: 'Toggle sidebar' }));
    await screen.findByRole('tooltip');
    const visibleContent = document.querySelector('[data-side]');
    expect(visibleContent).toHaveClass('py-0', 'text-ds-text-meta');
    expect(visibleContent).not.toHaveClass('text-xs', 'leading-4');
  });

  it('does not restore a stale open tooltip when it is re-enabled', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TooltipProvider delayDuration={0}>
        <TooltipSimple content="Project name" enabled variant="instant">
          <button type="button">Project</button>
        </TooltipSimple>
      </TooltipProvider>
    );

    await user.hover(screen.getByRole('button', { name: 'Project' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Project name'
    );

    rerender(
      <TooltipProvider delayDuration={0}>
        <TooltipSimple content="Project name" enabled={false} variant="instant">
          <button type="button">Project</button>
        </TooltipSimple>
      </TooltipProvider>
    );

    await waitFor(() =>
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    );

    rerender(
      <TooltipProvider delayDuration={0}>
        <TooltipSimple content="Project name" enabled variant="instant">
          <button type="button">Project</button>
        </TooltipSimple>
      </TooltipProvider>
    );

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    await user.unhover(screen.getByRole('button', { name: 'Project' }));
    await user.hover(screen.getByRole('button', { name: 'Project' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Project name'
    );
  });
  it('closes when a dialog opens over the hovered trigger', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <TooltipSimple content="Full session name" variant="instant">
          <button type="button">Session</button>
        </TooltipSimple>
      </TooltipProvider>
    );

    await user.hover(screen.getByRole('button', { name: 'Session' }));
    await screen.findByRole('tooltip');

    // The pointer never leaves the trigger, as when a shortcut opens a dialog.
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'alertdialog');
    act(() => {
      document.body.appendChild(dialog);
    });

    await waitFor(() =>
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    );
    dialog.remove();
  });

  it('stays open inside a dialog that was already open', async () => {
    const user = userEvent.setup();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    render(
      <TooltipProvider delayDuration={0}>
        <TooltipSimple content="Copy link" variant="instant">
          <button type="button">Copy</button>
        </TooltipSimple>
      </TooltipProvider>,
      { container: dialog }
    );

    await user.hover(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Copy link');
    // Unrelated content inside the dialog does not count as a new dialog.
    act(() => {
      dialog.appendChild(document.createElement('p'));
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    dialog.remove();
  });
});
