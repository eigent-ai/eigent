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

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceWidgetPreview } from '../../../src/components/Widget/WorkspaceWidgetPreview';

vi.mock('../../../src/api/http', () => ({
  getBaseURL: vi.fn().mockResolvedValue('http://localhost:5001'),
}));
vi.mock('@/api/http', () => ({
  getBaseURL: vi.fn().mockResolvedValue('http://localhost:5001'),
}));

describe('WorkspaceWidgetPreview', () => {
  it('renders the Eigent widget shell with semantic token classes', async () => {
    render(
      <WorkspaceWidgetPreview
        widget={{
          exists: true,
          manifest: { name: 'Search Console Dashboard' },
          previewHtml: '<div>Preview</div>',
          previewUrl: '/files/preview/alice/project-1/widget/preview.html',
        }}
        onOpen={() => {}}
      />
    );

    const button = screen.getByRole('button', {
      name: /open search console dashboard/i,
    });
    expect(button.className).toContain('rounded-2xl');
    expect(button.className).toContain('bg-ds-bg-neutral-subtle-default');
    expect(button.className).toContain(
      'border-ds-border-neutral-subtle-disabled'
    );
    expect(button.className).toContain('text-ds-text-neutral-default-default');
    await waitFor(() =>
      expect(
        screen.getByTitle('Search Console Dashboard preview')
      ).toBeInTheDocument()
    );
  });

  it('opens the widget when the preview shell is clicked', async () => {
    const onOpen = vi.fn();
    render(
      <WorkspaceWidgetPreview
        widget={{
          exists: true,
          manifest: { name: 'Search Console Dashboard' },
          previewHtml: '<div>Preview</div>',
        }}
        onOpen={onOpen}
      />
    );

    await userEvent.click(
      screen.getByRole('button', { name: /open search console dashboard/i })
    );

    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
