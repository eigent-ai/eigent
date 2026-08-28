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

import { ShortcutTooltipContent } from '@/components/ui/shortcut-tooltip';
import { HostProvider } from '@/host';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('ShortcutTooltipContent', () => {
  it('renders the platform-specific shortcut as a keyboard tag', () => {
    render(
      <HostProvider
        host={
          {
            electronAPI: { getPlatform: () => 'darwin' },
          } as never
        }
      >
        <ShortcutTooltipContent
          label="Toggle sidebar"
          shortcutId="toggle-workspace-sidebar"
        />
      </HostProvider>
    );

    const label = screen.getByText('Toggle sidebar');
    expect(label).toBeInTheDocument();
    expect(label).not.toHaveClass('leading-4');
    expect(label.parentElement).toHaveClass('text-ds-text-meta');
    expect(label.parentElement).not.toHaveClass('leading-4');
    expect(label.parentElement?.parentElement).not.toHaveClass('my-2');
    const keycap = screen.getByText('⌘B');
    expect(keycap.tagName).toBe('KBD');
    expect(keycap).toHaveClass(
      'h-4',
      'border-0',
      'bg-ds-neutral-strong-default',
      'ring-1'
    );
    expect(keycap).not.toHaveClass('shadow-sm', 'py-0.5');
  });

  it('supports local Return shortcuts that are not app-global', () => {
    render(
      <ShortcutTooltipContent
        label="Always allow"
        shortcutLabel="Shift+Return"
      />
    );

    expect(screen.getByText('Shift+Return')).toHaveClass('h-4');
  });
});
