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

import SkillsDashboard from '@/components/Settings/Skills/components/SkillsDashboard';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('Skills dashboard data availability', () => {
  it.each([
    { loading: true, hasErrors: false },
    { loading: false, hasErrors: true },
  ])('hides incomplete totals: %o', ({ loading, hasErrors }) => {
    render(
      <SkillsDashboard entries={[]} loading={loading} hasErrors={hasErrors} />
    );
    expect(screen.queryByRole('definition')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Skills overview')).not.toBeInTheDocument();
  });

  it('shows real zero totals for an empty, successfully loaded library', () => {
    render(<SkillsDashboard entries={[]} loading={false} hasErrors={false} />);
    expect(
      screen.getAllByRole('definition').map((node) => node.textContent)
    ).toEqual(['0', '0', '0', '0']);
  });
});
