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

import SkillDetail from '@/components/Settings/Skills/components/SkillDetail';
import type { SkillLibraryEntry } from '@/components/Settings/Skills/skillLibrary';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const entry: Exclude<SkillLibraryEntry, { kind: 'space' }> = {
  id: 'global:research',
  kind: 'global',
  name: 'research',
  description: 'This description belongs in the list, not the detail header.',
  skill: {
    id: 'disk-research',
    name: 'research',
    skillDirName: 'research',
    description: 'This description belongs in the list, not the detail header.',
    filePath: 'research/SKILL.md',
    fileContent: '',
    addedAt: 0,
    enabled: true,
    isExample: false,
    scope: { isGlobal: true, selectedAgents: [] },
  },
};

vi.mock('@/components/Settings/Skills/SkillsProvider', () => ({
  useSkillsLibrary: () => ({
    entries: [entry],
    loading: false,
    updateGlobal: vi.fn(),
    pendingIds: new Set<string>(),
    refresh: vi.fn(),
    refreshKey: 1,
    previewGeneration: 1,
  }),
}));

vi.mock('@/components/Settings/Skills/components/SkillAccessMenu', () => ({
  default: ({ className }: { className?: string }) => (
    <button type="button" className={className}>
      All agents
    </button>
  ),
}));

vi.mock('@/components/Settings/Skills/components/SkillActions', () => ({
  default: () => <button type="button">More actions</button>,
}));

vi.mock('@/components/Settings/Skills/components/SkillFiles', () => ({
  default: () => <div data-testid="skill-content">Skill document</div>,
}));

describe('Skill detail layout', () => {
  it('keeps type and access in the header and constrains the document content', () => {
    const { container } = render(<SkillDetail skillId={entry.id} />);
    expect(container.querySelector('header')).toHaveClass('px-ds-16');
    const header = container.querySelector(
      '[data-skill-detail] > header'
    ) as HTMLElement;

    expect(within(header).getByText('Global')).toBeInTheDocument();
    expect(within(header).getByText('All agents')).toBeInTheDocument();
    expect(
      within(header).getByRole('heading', { name: 'research', level: 1 })
    ).toHaveClass('!text-ds-text-base');
    expect(within(header).getByText('Global')).toHaveClass('h-ds-control-sm');
    expect(within(header).getByText('All agents')).toHaveClass(
      'h-ds-control-sm'
    );
    expect(
      header.querySelector('[data-skill-detail-enabled-control]')
    ).toHaveClass('h-ds-control-sm');
    expect(
      screen.queryByText(entry.description, { exact: true })
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('skill-content').parentElement).toHaveClass(
      'max-w-[76ch]'
    );
  });
});
