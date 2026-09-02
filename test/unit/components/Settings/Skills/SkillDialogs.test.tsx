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

import SkillDeleteDialog from '@/components/Settings/Skills/components/SkillDeleteDialog';
import {
  SkillsProvider,
  useSkillsLibrary,
} from '@/components/Settings/Skills/SkillsProvider';
import type { Skill } from '@/store/skillsStore';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  importZip: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  skillState: {
    skills: [],
    syncFromDisk: vi.fn(),
    addSkill: vi.fn(),
    deleteSkill: vi.fn(),
    updateSkill: vi.fn(),
  },
  spaceState: { spaces: {}, projectsBySpaceId: {} },
}));

vi.mock('@/api/http', () => ({ getBaseURL: vi.fn().mockResolvedValue('') }));
vi.mock('@/api/brain', () => ({ skillImportZip: mocks.importZip }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/service/workspaceConfigurationApi', () => ({
  fetchWorkspaceConfiguration: vi.fn(),
}));
vi.mock('@/store/skillsStore', async (importOriginal) => ({
  SkillSignInRequiredError: (
    await importOriginal<typeof import('@/store/skillsStore')>()
  ).SkillSignInRequiredError,
  useSkillsStore: Object.assign(
    (
      selector: (state: typeof mocks.skillState) => unknown = (state) => state
    ) => selector(mocks.skillState),
    { getState: () => mocks.skillState }
  ),
}));
vi.mock('@/store/spaceStore', () => ({
  isUnconfiguredPlaceholderSpace: () => false,
  useSpaceStore: (selector: (state: typeof mocks.spaceState) => unknown) =>
    selector(mocks.spaceState),
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (
    selector: (state: { email: string; user_id: number }) => unknown
  ) => selector({ email: 'preview@example.invalid', user_id: 7 }),
}));
vi.mock('@/lib/events/appEvents', () => ({ recordFeatureUsed: vi.fn() }));

const skill: Skill = {
  id: 'disk-research',
  name: 'research',
  description: 'Find sources',
  skillDirName: 'research',
  filePath: 'research/SKILL.md',
  fileContent: '',
  addedAt: 0,
  enabled: true,
  isExample: false,
  scope: { isGlobal: true, selectedAgents: [] },
};

function UploadButton() {
  const { openUpload, loading } = useSkillsLibrary();
  return (
    <button onClick={openUpload} disabled={loading}>
      Upload skill
    </button>
  );
}

describe('Skill dialogs inside the redesigned library', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.skillState.syncFromDisk.mockResolvedValue(undefined);
  });

  it('keeps ZIP replacement confirmation alive after the upload dialog closes', async () => {
    mocks.importZip
      .mockResolvedValueOnce({
        success: false,
        conflicts: [{ folderName: 'research', skillName: 'research' }],
      })
      .mockResolvedValueOnce({ success: true });
    render(
      <MemoryRouter>
        <SkillsProvider active>
          <UploadButton />
        </SkillsProvider>
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Upload skill' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Upload skill' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add skill' });
    const file = new File(['zip'], 'research.zip', { type: 'application/zip' });
    const buffer = new ArrayBuffer(3);
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.resolve(buffer),
    });
    fireEvent.change(dialog.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });

    const confirmation = await screen.findByRole('alertdialog', {
      name: 'Replace "research" skill?',
    });
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Add skill' })
      ).not.toBeInTheDocument()
    );
    fireEvent.click(
      within(confirmation).getByRole('button', { name: 'Update and replace' })
    );

    await waitFor(() =>
      expect(mocks.importZip).toHaveBeenNthCalledWith(2, buffer, ['research'])
    );
    await waitFor(() =>
      expect(mocks.skillState.syncFromDisk).toHaveBeenCalledTimes(2)
    );
  });

  it('reports an installed ZIP as added even when the follow-up refresh fails', async () => {
    // The package is already on disk; a failed refresh is a stale list, and
    // calling it a failed import would send the user back to re-import it.
    mocks.importZip.mockResolvedValue({ success: true });
    mocks.skillState.syncFromDisk.mockRejectedValue(new Error('offline'));
    render(
      <MemoryRouter>
        <SkillsProvider active>
          <UploadButton />
        </SkillsProvider>
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Upload skill' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Upload skill' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add skill' });
    const file = new File(['zip'], 'research.zip', { type: 'application/zip' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.resolve(new ArrayBuffer(3)),
    });
    fireEvent.change(dialog.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        'Skill added successfully!'
      )
    );
    expect(mocks.toast.error).not.toHaveBeenCalledWith(
      'Failed to add skill. Please try again.'
    );
    expect(mocks.toast.warning).toHaveBeenCalledWith(
      'Global skills could not be refreshed.'
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Add skill' })
      ).not.toBeInTheDocument()
    );
  });

  it('keeps a failed deletion open for retry instead of closing synchronously', async () => {
    const cancelled = vi.fn();
    const confirmed = vi.fn();
    mocks.skillState.deleteSkill
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    function DeleteDialog() {
      const [open, setOpen] = useState(true);
      return (
        <SkillDeleteDialog
          open={open}
          skill={skill}
          onCancel={() => {
            cancelled();
            setOpen(false);
          }}
          onConfirm={() => {
            confirmed();
            setOpen(false);
          }}
        />
      );
    }
    render(<DeleteDialog />);
    const dialog = screen.getByRole('alertdialog', { name: /delete skill/i });
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
    fireEvent.click(confirm);

    await waitFor(() => expect(confirm).toBeEnabled());
    await waitFor(() =>
      expect(
        screen.getByRole('alertdialog', { name: /delete skill/i })
      ).toBeVisible()
    );
    expect(cancelled).not.toHaveBeenCalled();
    expect(confirmed).not.toHaveBeenCalled();

    fireEvent.click(confirm);
    await waitFor(() => expect(confirmed).toHaveBeenCalledTimes(1));
    expect(cancelled).not.toHaveBeenCalled();
  });
});
