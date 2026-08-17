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

import { NavTab } from '@/components/Layout/AppSidebar/NavTab';

describe('NavTab', () => {
  afterEach(cleanup);

  it('keeps disabled navigation focusable and exposes its reason', () => {
    render(
      <>
        <span id="context-description">
          Start a task or select a project to bind a folder
        </span>
        <NavTab
          active={false}
          disabled
          onClick={vi.fn()}
          leading={<span aria-hidden>icon</span>}
          label="Context"
          ariaLabel="Context"
          ariaDescribedBy="context-description"
          tooltip="Start a task or select a project to bind a folder"
        />
      </>
    );

    const contextTab = screen.getByRole('button', { name: 'Context' });
    expect(contextTab).toHaveAttribute('aria-disabled', 'true');
    expect(contextTab).not.toBeDisabled();
    expect(contextTab).toHaveAttribute(
      'aria-describedby',
      'context-description'
    );
    expect(contextTab).toHaveAccessibleDescription(
      'Start a task or select a project to bind a folder'
    );
  });
});
