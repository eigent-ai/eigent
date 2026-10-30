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

import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { SplitButton } from '@/components/ui/split-button';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  // Floating UI's :modal query recurses in jsdom; these menus use ordinary DOM.
  const matches = Element.prototype.matches;
  vi.spyOn(Element.prototype, 'matches').mockImplementation(
    function (selector) {
      return selector === ':modal' ? false : matches.call(this, selector);
    }
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(disabled = false) {
  const primary = vi.fn();
  const secondary = vi.fn();
  render(
    <SplitButton
      label="Show in Finder"
      menuLabel="Open in"
      onClick={primary}
      disabled={disabled}
    >
      <DropdownMenuItem onSelect={secondary}>Default app</DropdownMenuItem>
    </SplitButton>
  );
  return { primary, secondary, user: userEvent.setup() };
}

describe('SplitButton', () => {
  it('keeps the primary action fixed after choosing a menu action', async () => {
    const { primary, secondary, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Show in Finder' }));
    expect(primary).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open in' }));
    expect(primary).toHaveBeenCalledOnce();
    await user.click(
      await screen.findByRole('menuitem', { name: 'Default app' })
    );
    expect(secondary).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Show in Finder' }));
    expect(primary).toHaveBeenCalledTimes(2);
  });
  it('opens from the keyboard and returns focus to the menu trigger on Escape', async () => {
    const { primary, user } = setup();
    const trigger = screen.getByRole('button', { name: 'Open in' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(
      await screen.findByRole('menuitem', { name: 'Default app' })
    ).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(primary).not.toHaveBeenCalled();
  });
  it('disables both click targets together', () => {
    setup(true);
    expect(
      screen.getByRole('button', { name: 'Show in Finder' })
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open in' })).toBeDisabled();
  });
});
