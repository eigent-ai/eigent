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

import { usePresenceFocusGuard } from '@/hooks/usePresenceFocusGuard';
import { render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

function Pane({ present = true, initialFocus = false, disabled = false }) {
  const ref = useRef<HTMLDivElement>(null);
  usePresenceFocusGuard(ref, present, initialFocus);
  return (
    <div ref={ref} data-testid="pane">
      <input aria-label="Field" disabled={disabled} />
      <button data-resource-editor-close>Close</button>
    </div>
  );
}

describe('usePresenceFocusGuard', () => {
  it('moves focus out before setting either hiding attribute', () => {
    const view = render(<Pane />);
    const pane = screen.getByTestId('pane');
    const field = screen.getByRole('textbox', { name: 'Field' });
    field.focus();
    const setAttribute = pane.setAttribute.bind(pane);
    const focusedDuringHiding: boolean[] = [];
    vi.spyOn(pane, 'setAttribute').mockImplementation((name, value) => {
      if (name === 'aria-hidden' || name === 'inert') {
        focusedDuringHiding.push(pane.contains(document.activeElement));
      }
      setAttribute(name, value);
    });
    view.rerender(<Pane present={false} />);
    expect(focusedDuringHiding).toEqual([false, false]);
    expect(pane).toHaveAttribute('aria-hidden', 'true');
    expect(pane).toHaveAttribute('inert');
    view.rerender(<Pane />);
    expect(pane).not.toHaveAttribute('aria-hidden');
    expect(pane).not.toHaveAttribute('inert');
  });

  it('leaves focus in the newly selected pane during rapid replacement', () => {
    const page = (present: boolean) => (
      <>
        <Pane present={present} />
        <button>Next pane</button>
      </>
    );
    const view = render(page(true));
    screen.getByRole('button', { name: 'Next pane' }).focus();
    view.rerender(page(false));
    expect(screen.getByRole('button', { name: 'Next pane' })).toHaveFocus();
  });

  it('focuses the first enabled field once and does not steal later focus', () => {
    const page = (disabled: boolean) => (
      <>
        <Pane initialFocus disabled={disabled} />
        <button>Elsewhere</button>
      </>
    );
    const view = render(page(false));
    expect(screen.getByRole('textbox', { name: 'Field' })).toHaveFocus();
    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    view.rerender(page(true));
    view.rerender(page(false));
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
  });

  it('uses the close control while loading and does not refocus after loading', () => {
    const view = render(<Pane initialFocus disabled />);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    view.rerender(<Pane initialFocus />);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });
});
