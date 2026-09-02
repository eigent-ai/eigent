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

import {
  SkillSignInRequiredError,
  useSkillsStore,
  type Skill,
} from '@/store/skillsStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({
  user_id: 7 as number | null,
  email: 'preview@example.invalid' as string | null,
}));
const api = vi.hoisted(() => ({
  save: vi.fn(),
  remove: vi.fn(),
  scan: vi.fn(),
  load: vi.fn(),
  write: vi.fn(),
  read: vi.fn(),
}));
vi.mock('@/api/brain', () => ({
  skillConfigUpdate: api.save,
  skillDelete: api.remove,
  skillsScan: api.scan,
  skillConfigLoad: api.load,
  skillConfigInit: vi.fn().mockResolvedValue({ success: true }),
  skillConfigDelete: vi.fn().mockResolvedValue({ success: true }),
  skillConfigToggle: vi.fn(),
  skillWrite: api.write,
  skillRead: api.read,
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: { getState: () => auth },
}));
vi.mock('@/lib/skillToolkit', async (original) => ({
  ...(await original<typeof import('@/lib/skillToolkit')>()),
  hasSkillsFsApi: () => true,
}));
const skill: Skill = {
  id: 'disk-research',
  name: 'research',
  description: 'Find sources',
  skillDirName: 'research',
  filePath: 'research/SKILL.md',
  fileContent: '---\nname: research\ndescription: Find sources\n---\nBody',
  addedAt: 0,
  enabled: true,
  isExample: false,
  scope: { isGlobal: false, selectedAgents: ['research_agent'] },
};
describe('skill management failure handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.user_id = 7;
    auth.email = 'preview@example.invalid';
    useSkillsStore.setState({ skills: [skill] });
  });
  it('rolls back a rejected enable or access save and propagates the failure', async () => {
    api.save.mockResolvedValue({ success: false });
    await expect(
      useSkillsStore.getState().updateSkill(skill.id, { enabled: false })
    ).rejects.toThrow();
    expect(useSkillsStore.getState().skills).toEqual([skill]);
    api.save.mockRejectedValue(new Error('offline'));
    await expect(
      useSkillsStore.getState().updateSkill(skill.id, {
        scope: { isGlobal: true, selectedAgents: [] },
      })
    ).rejects.toThrow('offline');
    expect(useSkillsStore.getState().skills[0].scope).toEqual(skill.scope);
  });
  it('rolls back and asks for sign-in rather than showing an unsaved setting', async () => {
    auth.user_id = null;
    auth.email = null;
    await expect(
      useSkillsStore.getState().updateSkill(skill.id, { enabled: false })
    ).rejects.toBeInstanceOf(SkillSignInRequiredError);
    expect(useSkillsStore.getState().skills).toEqual([skill]);
    expect(api.save).not.toHaveBeenCalled();
  });

  it('does not remove a skill or claim success when disk deletion fails', async () => {
    api.remove.mockResolvedValue({ success: false });
    await expect(
      useSkillsStore.getState().deleteSkill(skill.id)
    ).rejects.toThrow();
    expect(useSkillsStore.getState().skills).toEqual([skill]);
  });
  it('keeps last known settings when a refresh cannot load agent access', async () => {
    api.scan.mockResolvedValue({
      success: true,
      skills: [
        {
          name: 'research',
          skillDirName: 'research',
          description: 'Find sources',
          path: 'research/SKILL.md',
        },
      ],
    });
    api.load.mockResolvedValue({ success: false });
    await expect(useSkillsStore.getState().syncFromDisk()).rejects.toThrow();
    expect(useSkillsStore.getState().skills).toEqual([skill]);
    expect(api.save).not.toHaveBeenCalled();
  });
  it('does not add an in-memory skill after a failed package write', async () => {
    api.write.mockResolvedValue({ success: false });
    await expect(useSkillsStore.getState().addSkill(skill)).rejects.toThrow();
    expect(useSkillsStore.getState().skills).toEqual([skill]);
  });

  it('restores the previous SKILL.md when re-adding a skill fails at config', async () => {
    api.read.mockResolvedValue({
      success: true,
      content: skill.fileContent,
    });
    api.write.mockResolvedValue({ success: true });
    api.save.mockResolvedValue({ success: false });
    await expect(useSkillsStore.getState().addSkill(skill)).rejects.toThrow();
    expect(api.write).toHaveBeenLastCalledWith('research', skill.fileContent);
    expect(useSkillsStore.getState().skills).toEqual([skill]);
  });

  it('removes a newly written package when config cannot be saved', async () => {
    api.read.mockRejectedValue(
      Object.assign(new Error('missing'), { status: 404 })
    );
    api.write.mockResolvedValue({ success: true });
    api.save.mockResolvedValue({ success: false });
    api.remove.mockResolvedValue({ success: true });
    await expect(
      useSkillsStore.getState().addSkill({
        ...skill,
        name: 'notes',
        skillDirName: 'notes',
        fileContent: '---\nname: notes\ndescription: Notes\n---\nBody',
      })
    ).rejects.toThrow();
    expect(api.remove).toHaveBeenCalledWith('notes');
    expect(useSkillsStore.getState().skills).toEqual([skill]);
  });
});
