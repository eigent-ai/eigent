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

import AlertDialog from '@/components/ui/alertDialog';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

describe('AlertDialog', () => {
  it('uses the standard centered width and center-scale entrance', () => {
    render(
      <AlertDialog
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Delete Project"
        message="This action cannot be undone."
        confirmText="Delete"
        confirmVariant="secondary"
        confirmTone="error"
      />
    );

    const dialog = screen.getByRole('alertdialog', {
      name: 'Delete Project',
    });
    const viewport = document.querySelector('[data-alert-dialog-viewport]');

    expect(viewport).toHaveClass(
      'fixed',
      'inset-0',
      'grid',
      'place-items-center'
    );
    expect(dialog).toHaveClass('w-full', 'max-w-[400px]');
    expect(dialog).not.toHaveClass('top-1/2', 'left-1/2', 'max-w-md');
    expect(dialog).toHaveStyle({ transformOrigin: 'center' });
    expect(dialog.style.transform).toBe('scale(0.95)');

    const deleteButton = screen.getByRole('button', { name: 'Delete' });
    expect(deleteButton).toHaveAttribute('data-variant', 'secondary');
    expect(deleteButton).toHaveAttribute('data-tone', 'error');
    expect(deleteButton).toHaveClass('!text-ds-text-error-strong-default');
  });

  it('keeps the Rename Space form in the same centered shell', () => {
    render(
      <AlertDialog
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Rename Space"
        confirmText="Save"
      >
        <input aria-label="Space name" defaultValue="Design Space" />
      </AlertDialog>
    );

    const dialog = screen.getByRole('alertdialog', { name: 'Rename Space' });
    const viewport = document.querySelector('[data-alert-dialog-viewport]');

    expect(viewport).toHaveClass('fixed', 'inset-0', 'place-items-center');
    expect(dialog).toHaveClass('w-full', 'max-w-[400px]');
    expect(dialog).toHaveStyle({ transformOrigin: 'center' });
    expect(dialog.style.transform).toBe('scale(0.95)');
    expect(screen.getByRole('textbox', { name: 'Space name' })).toHaveValue(
      'Design Space'
    );
  });

  it('keeps the notice above the mask and interactive', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    render(
      <AlertDialog
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        title="Archive Project"
        confirmText="Archive"
      />
    );

    const overlay = document.querySelector('.alert-dialog');
    const viewport = document.querySelector('[data-alert-dialog-viewport]');

    expect(overlay).toHaveClass('z-[99]');
    expect(viewport).toHaveClass('z-[100]');

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
