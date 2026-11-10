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

import MCPDeleteDialog from '@/components/Settings/Connectors/components/MCPDeleteDialog';
import type { MCPUserItem } from '@/components/Settings/Connectors/components/types';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const target: MCPUserItem = {
  id: 1,
  mcp_id: 1,
  mcp_name: 'sequential-thinking',
  mcp_key: 'sequential-thinking',
  mcp_desc: 'Test connector',
  status: 1,
};

describe('MCPDeleteDialog', () => {
  it('portals the confirmation and scrim outside the connector section', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { container } = render(
      <div data-testid="connector-section">
        <MCPDeleteDialog
          open
          target={target}
          onCancel={onCancel}
          onConfirm={onConfirm}
          loading={false}
        />
      </div>
    );

    const dialog = screen.getByRole('dialog', {
      name: 'Confirm Delete',
    });
    expect(container).not.toContainElement(dialog);
    expect(dialog.previousElementSibling).toHaveClass(
      'fixed',
      'inset-0',
      'z-50'
    );

    const cancelButton = screen.getByRole('button', {
      name: 'Cancel',
    });
    const deleteButton = screen.getByRole('button', {
      name: 'Delete',
    });
    expect(cancelButton).toHaveAttribute('data-variant', 'ghost');
    expect(deleteButton).toHaveAttribute('data-variant', 'primary');
    expect(deleteButton).toHaveAttribute('data-tone', 'error');

    await user.click(deleteButton);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
