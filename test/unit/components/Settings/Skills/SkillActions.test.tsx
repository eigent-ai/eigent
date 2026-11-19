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

import SkillActions from '@/components/Settings/Skills/components/SkillActions';
import type { SkillLibraryEntry } from '@/components/Settings/Skills/skillLibrary';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  setDeleteTarget: vi.fn(),
}));

vi.mock('@/hooks/useChatStoreAdapter', () => ({
  default: () => ({ projectStore: { createProject: mocks.createProject } }),
}));

vi.mock('@/components/Settings/Skills/SkillsProvider', () => ({
  useSkillsLibrary: () => ({
    setDeleteTarget: mocks.setDeleteTarget,
    loading: false,
    pendingIds: new Set<string>(),
  }),
}));

const entry: Exclude<SkillLibraryEntry, { kind: 'space' }> = {
  id: 'global:research',
  kind: 'global',
  name: 'research',
  description: 'Find sources',
  skill: {
    id: 'disk-research',
    name: 'research',
    skillDirName: 'research',
    description: 'Find sources',
    filePath: 'research/SKILL.md',
    fileContent: '',
    addedAt: 0,
    enabled: true,
    isExample: false,
    scope: { isGlobal: true, selectedAgents: [] },
  },
};

function openDropdown(trigger: HTMLElement) {
  const event = new MouseEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    ctrlKey: false,
  });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  fireEvent(trigger, event);
}

describe('Skill actions', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('offers chat and delete actions without a package download', () => {
    render(
      <MemoryRouter>
        <SkillActions entry={entry} />
      </MemoryRouter>
    );
    const actions = screen.getByRole('button', {
      name: 'Actions for research',
    });
    expect(actions).toHaveClass('!size-[var(--ds-button-sm-height)]');
    openDropdown(actions);
    const deleteItem = screen.getByRole('menuitem', { name: 'Delete Skill' });
    expect(deleteItem).toHaveClass('text-ds-text-error-default-default');
    expect(deleteItem.querySelector('svg')).toHaveClass(
      'text-ds-icon-error-default-default'
    );
    expect(
      screen.queryByRole('menuitem', { name: /download skill zip package/i })
    ).toBeNull();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  });
});
