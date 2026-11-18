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

import { SessionSidePanel } from '@/components/Session/SidePanel';
import { SessionMode } from '@/types/constants';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/Session/SidePanel/components/ActivityPanel', () => ({
  SessionActivityPanel: ({ header }: { header?: ReactNode }) => (
    <div data-testid="activity-panel">{header}</div>
  ),
}));
vi.mock('@/hooks/useProjectEventRuntime', () => ({
  useProjectEventRuntime: () => ({
    projectId: null,
    hydration: { status: 'ready' },
  }),
}));

describe('SessionSidePanel', () => {
  it('renders Activity content without its own fold or expand controls', () => {
    render(
      <SessionSidePanel
        mode={SessionMode.SINGLE_AGENT}
        workforcePanelKey=""
        isSidePanelVisible
        onToggleSidePanel={vi.fn()}
        isExpandedOverlayOpen={false}
        onToggleExpandedOverlay={vi.fn()}
        onCloseExpandedOverlay={vi.fn()}
      />
    );
    expect(screen.getByTestId('activity-panel')).toHaveTextContent('Activity');
    // Summary folds from the Session header on every Session page.
    expect(
      screen.queryByRole('button', { name: /side panel/i })
    ).not.toBeInTheDocument();
  });
});
