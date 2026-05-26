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

/**
 * SkillsStore Unit Tests - Core Functionality
 *
 * Tests skillsStore operations:
 * - addSkill: creates skill with ID, filesystem write, config update
 * - updateSkill: updates state, config persistence, error revert
 * - deleteSkill: removes skill, example-skill guard, fs + config deletion
 * - toggleSkill: optimistic toggle, config persist, error revert
 * - getSkillsByType: filters by isExample flag
 * - syncFromDisk: loads from scan, applies config, registers new skills
 * - Persist partialize behavior
 * - getSkillsStore non-hook accessor
 */

import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before importing the module under test
// ---------------------------------------------------------------------------

const mockBuildSkillMd = vi.fn();
const mockHasSkillsFsApi = vi.fn();
const mockParseSkillMd = vi.fn();
const mockSkillNameToDirName = vi.fn();

vi.mock('@/lib/skillToolkit', () => ({
  buildSkillMd: (...args: unknown[]) => mockBuildSkillMd(...args),
  hasSkillsFsApi: () => mockHasSkillsFsApi(),
  parseSkillMd: (...args: unknown[]) => mockParseSkillMd(...args),
  skillNameToDirName: (...args: unknown[]) => mockSkillNameToDirName(...args),
}));

// Zustand store mock for authStore — supports getState()
const mockAuthState = {
  email: 'user@example.com' as string | null,
};

vi.mock('@/store/authStore', () => ({
  useAuthStore: {
    getState: () => ({ email: mockAuthState.email }),
    subscribe: vi.fn(),
  },
}));

// Electron API mocks
const mockSkillWrite = vi.fn();
const mockSkillDelete = vi.fn();
const mockSkillConfigUpdate = vi.fn();
const mockSkillConfigDelete = vi.fn();
const mockSkillConfigToggle = vi.fn();
const mockSkillConfigInit = vi.fn();
const mockSkillConfigLoad = vi.fn();
const mockSkillsScan = vi.fn();

beforeEach(() => {
  global.electronAPI = {
    skillWrite: mockSkillWrite,
    skillDelete: mockSkillDelete,
    skillConfigUpdate: mockSkillConfigUpdate,
    skillConfigDelete: mockSkillConfigDelete,
    skillConfigToggle: mockSkillConfigToggle,
    skillConfigInit: mockSkillConfigInit,
    skillConfigLoad: mockSkillConfigLoad,
    skillsScan: mockSkillsScan,
  };
});

// ---------------------------------------------------------------------------
// Import after mocks are in place
// ---------------------------------------------------------------------------

import { type Skill, useSkillsStore } from '../../../src/store/skillsStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Produce the minimal input shape required by addSkill. */
function createSkillInput(overrides: Partial<Skill> = {}) {
  return {
    name: 'Test Skill',
    description: 'A skill for testing',
    filePath: 'test-skill/SKILL.md',
    fileContent:
      '---\nname: Test Skill\ndescription: A skill for testing\n---\nBody',
    scope: { isGlobal: true, selectedAgents: [] },
    enabled: true,
    ...overrides,
  };
}

/** Produce a fully-formed Skill object (as if it came from the store). */
function createFullSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'skill-1700000000000-abc123def',
    name: 'Test Skill',
    description: 'A skill for testing',
    filePath: 'test-skill/SKILL.md',
    fileContent:
      '---\nname: Test Skill\ndescription: A skill for testing\n---\nBody',
    skillDirName: 'test-skill',
    addedAt: 1700000000000,
    scope: { isGlobal: true, selectedAgents: [] },
    enabled: true,
    isExample: false,
    ...overrides,
  };
}

/** Reset the skills store to empty and clear localStorage. */
function resetStore(): void {
  useSkillsStore.setState({ skills: [] });
  localStorage.clear();
}

/** Default mock setup: FS API available, auth email set. */
function defaultFsMocks(): void {
  mockHasSkillsFsApi.mockReturnValue(true);
  mockAuthState.email = 'user@example.com';
  mockParseSkillMd.mockReturnValue({
    name: 'Test Skill',
    description: 'A skill for testing',
    body: 'Body',
  });
  mockBuildSkillMd.mockReturnValue(
    '---\nname: Test Skill\ndescription: A skill for testing\n---\nBody'
  );
  mockSkillNameToDirName.mockReturnValue('test-skill');
  mockSkillWrite.mockResolvedValue(undefined);
  mockSkillDelete.mockResolvedValue(undefined);
  mockSkillConfigUpdate.mockResolvedValue(undefined);
  mockSkillConfigDelete.mockResolvedValue(undefined);
  mockSkillConfigToggle.mockResolvedValue({ success: true });
  mockSkillConfigInit.mockResolvedValue(undefined);
  mockSkillConfigLoad.mockResolvedValue({ success: true, config: null });
  mockSkillsScan.mockResolvedValue({ success: true, skills: [] });
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('SkillsStore', () => {
  beforeEach(() => {
    resetStore();
    defaultFsMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Initial State
  // =========================================================================
  describe('Initial State', () => {
    it('should start with an empty skills array', () => {
      expect(useSkillsStore.getState().skills).toEqual([]);
    });
  });

  // =========================================================================
  // addSkill
  // =========================================================================
  describe('addSkill', () => {
    it('should add a skill to the store with generated id, addedAt, and isExample=false', async () => {
      const input = createSkillInput();

      await act(async () => {
        await useSkillsStore.getState().addSkill(input);
      });

      const skills = useSkillsStore.getState().skills;
      expect(skills).toHaveLength(1);

      const added = skills[0];
      expect(added.id).toMatch(/^skill-\d+-[a-z0-9]+$/);
      expect(added.addedAt).toBeGreaterThan(0);
      expect(added.isExample).toBe(false);
      expect(added.name).toBe('Test Skill');
      expect(added.description).toBe('A skill for testing');
      expect(added.enabled).toBe(true);
      expect(added.scope).toEqual({ isGlobal: true, selectedAgents: [] });
    });

    it('should prepend new skills (most recent first)', async () => {
      const input1 = createSkillInput({ name: 'First' });
      const input2 = createSkillInput({ name: 'Second' });

      await act(async () => {
        await useSkillsStore.getState().addSkill(input1);
        await useSkillsStore.getState().addSkill(input2);
      });

      const skills = useSkillsStore.getState().skills;
      expect(skills).toHaveLength(2);
      expect(skills[0].name).toBe('Second');
      expect(skills[1].name).toBe('First');
    });

    it('should call skillWrite when hasSkillsFsApi is true', async () => {
      mockHasSkillsFsApi.mockReturnValue(true);

      await act(async () => {
        await useSkillsStore.getState().addSkill(createSkillInput());
      });

      expect(mockSkillWrite).toHaveBeenCalledTimes(1);
      expect(mockSkillWrite).toHaveBeenCalledWith(
        'test-skill',
        expect.any(String)
      );
    });

    it('should NOT call skillWrite when hasSkillsFsApi is false', async () => {
      mockHasSkillsFsApi.mockReturnValue(false);

      await act(async () => {
        await useSkillsStore.getState().addSkill(createSkillInput());
      });

      expect(mockSkillWrite).not.toHaveBeenCalled();
    });

    it('should use parsed metadata from parseSkillMd for skill content', async () => {
      mockParseSkillMd.mockReturnValue({
        name: 'Parsed Name',
        description: 'Parsed Description',
        body: 'Parsed Body',
      });
      mockBuildSkillMd.mockReturnValue('built-content');
      mockSkillNameToDirName.mockReturnValue('parsed-name');

      await act(async () => {
        await useSkillsStore.getState().addSkill(createSkillInput());
      });

      expect(mockParseSkillMd).toHaveBeenCalledWith(
        '---\nname: Test Skill\ndescription: A skill for testing\n---\nBody'
      );
      expect(mockBuildSkillMd).toHaveBeenCalledWith(
        'Parsed Name',
        'Parsed Description',
        'Parsed Body'
      );
      expect(mockSkillNameToDirName).toHaveBeenCalledWith('Parsed Name');

      const skill = useSkillsStore.getState().skills[0];
      expect(skill.filePath).toBe('parsed-name/SKILL.md');
      expect(skill.fileContent).toBe('built-content');
      expect(skill.skillDirName).toBe('parsed-name');
    });

    it('should fall back to skill.name when parseSkillMd returns no name', async () => {
      mockParseSkillMd.mockReturnValue({
        name: null,
        description: null,
        body: null,
      });
      mockSkillNameToDirName.mockReturnValue('test-skill');

      await act(async () => {
        await useSkillsStore
          .getState()
          .addSkill(createSkillInput({ name: 'Fallback Name' }));
      });

      expect(mockBuildSkillMd).toHaveBeenCalledWith(
        'Fallback Name',
        'A skill for testing',
        '---\nname: Test Skill\ndescription: A skill for testing\n---\nBody'
      );
    });

    it('should use skillDirName from input when provided', async () => {
      await act(async () => {
        await useSkillsStore
          .getState()
          .addSkill(createSkillInput({ skillDirName: 'custom-dir' }));
      });

      // skillNameToDirName should NOT be called since skillDirName is provided
      expect(mockSkillNameToDirName).not.toHaveBeenCalled();
      const skill = useSkillsStore.getState().skills[0];
      expect(skill.skillDirName).toBe('custom-dir');
    });

    it('should call skillConfigUpdate with user ID derived from email', async () => {
      mockAuthState.email = 'dev@test.com';

      await act(async () => {
        await useSkillsStore.getState().addSkill(createSkillInput());
      });

      // emailToUserId('dev@test.com') => 'dev'
      expect(mockSkillConfigUpdate).toHaveBeenCalledWith(
        'dev',
        'Test Skill',
        expect.objectContaining({
          enabled: true,
          scope: { isGlobal: true, selectedAgents: [] },
          isExample: false,
        })
      );
    });

    it('should NOT call skillConfigUpdate when email is null', async () => {
      mockAuthState.email = null;

      await act(async () => {
        await useSkillsStore.getState().addSkill(createSkillInput());
      });

      expect(mockSkillConfigUpdate).not.toHaveBeenCalled();
    });

    it('should add skill to store even if skillConfigUpdate fails', async () => {
      mockSkillConfigUpdate.mockRejectedValue(new Error('Config error'));

      await act(async () => {
        await useSkillsStore.getState().addSkill(createSkillInput());
      });

      const skills = useSkillsStore.getState().skills;
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('Test Skill');
    });

    it('should NOT call skillConfigUpdate when hasSkillsFsApi is false', async () => {
      mockHasSkillsFsApi.mockReturnValue(false);

      await act(async () => {
        await useSkillsStore.getState().addSkill(createSkillInput());
      });

      expect(mockSkillConfigUpdate).not.toHaveBeenCalled();
    });

    it('should add skill to store even if skillWrite rejects', async () => {
      mockSkillWrite.mockRejectedValue(new Error('Write error'));

      await act(async () => {
        await useSkillsStore.getState().addSkill(createSkillInput());
      });

      expect(useSkillsStore.getState().skills).toHaveLength(1);
    });
  });

  // =========================================================================
  // updateSkill
  // =========================================================================
  describe('updateSkill', () => {
    it('should update skill fields in the store', async () => {
      const skill = createFullSkill({ id: 'skill-1' });
      useSkillsStore.setState({ skills: [skill] });

      await act(async () => {
        await useSkillsStore.getState().updateSkill('skill-1', {
          description: 'Updated description',
        });
      });

      const updated = useSkillsStore.getState().skills[0];
      expect(updated.description).toBe('Updated description');
      expect(updated.name).toBe('Test Skill'); // unchanged
    });

    it('should do nothing when skill id is not found', async () => {
      const skill = createFullSkill({ id: 'skill-1' });
      useSkillsStore.setState({ skills: [skill] });

      await act(async () => {
        await useSkillsStore.getState().updateSkill('nonexistent', {
          description: 'Nope',
        });
      });

      expect(useSkillsStore.getState().skills[0].description).toBe(
        'A skill for testing'
      );
      expect(mockSkillConfigUpdate).not.toHaveBeenCalled();
    });

    it('should call skillConfigUpdate when updating scope', async () => {
      const skill = createFullSkill({ id: 'skill-1' });
      useSkillsStore.setState({ skills: [skill] });
      const newScope = { isGlobal: false, selectedAgents: ['agent-a'] };

      await act(async () => {
        await useSkillsStore.getState().updateSkill('skill-1', {
          scope: newScope,
        });
      });

      expect(mockSkillConfigUpdate).toHaveBeenCalledWith(
        'user',
        'Test Skill',
        expect.objectContaining({
          enabled: true,
          scope: newScope,
        })
      );
    });

    it('should call skillConfigUpdate when updating enabled', async () => {
      const skill = createFullSkill({ id: 'skill-1' });
      useSkillsStore.setState({ skills: [skill] });

      await act(async () => {
        await useSkillsStore.getState().updateSkill('skill-1', {
          enabled: false,
        });
      });

      expect(mockSkillConfigUpdate).toHaveBeenCalledWith(
        'user',
        'Test Skill',
        expect.objectContaining({ enabled: false })
      );
    });

    it('should NOT call skillConfigUpdate when updating non-scope/enabled fields', async () => {
      const skill = createFullSkill({ id: 'skill-1' });
      useSkillsStore.setState({ skills: [skill] });

      await act(async () => {
        await useSkillsStore.getState().updateSkill('skill-1', {
          description: 'Only description changed',
        });
      });

      expect(mockSkillConfigUpdate).not.toHaveBeenCalled();
    });

    it('should revert skill on skillConfigUpdate error', async () => {
      const skill = createFullSkill({ id: 'skill-1', enabled: true });
      useSkillsStore.setState({ skills: [skill] });
      mockSkillConfigUpdate.mockRejectedValue(new Error('Config fail'));

      await act(async () => {
        await useSkillsStore.getState().updateSkill('skill-1', {
          enabled: false,
        });
      });

      // Should revert to original enabled value
      const reverted = useSkillsStore.getState().skills[0];
      expect(reverted.enabled).toBe(true);
    });

    it('should NOT call skillConfigUpdate when hasSkillsFsApi is false', async () => {
      mockHasSkillsFsApi.mockReturnValue(false);
      const skill = createFullSkill({ id: 'skill-1' });
      useSkillsStore.setState({ skills: [skill] });

      await act(async () => {
        await useSkillsStore.getState().updateSkill('skill-1', {
          enabled: false,
        });
      });

      expect(mockSkillConfigUpdate).not.toHaveBeenCalled();
    });

    it('should NOT call skillConfigUpdate when userId is null (email is null)', async () => {
      mockAuthState.email = null;
      const skill = createFullSkill({ id: 'skill-1' });
      useSkillsStore.setState({ skills: [skill] });

      await act(async () => {
        await useSkillsStore.getState().updateSkill('skill-1', {
          enabled: false,
        });
      });

      expect(mockSkillConfigUpdate).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // deleteSkill
  // =========================================================================
  describe('deleteSkill', () => {
    it('should remove the skill from the store', async () => {
      const skill = createFullSkill({ id: 'skill-1' });
      useSkillsStore.setState({ skills: [skill] });

      await act(async () => {
        await useSkillsStore.getState().deleteSkill('skill-1');
      });

      expect(useSkillsStore.getState().skills).toHaveLength(0);
    });

    it('should do nothing when skill id is not found', async () => {
      const skill = createFullSkill({ id: 'skill-1' });
      useSkillsStore.setState({ skills: [skill] });

      await act(async () => {
        await useSkillsStore.getState().deleteSkill('nonexistent');
      });

      expect(useSkillsStore.getState().skills).toHaveLength(1);
    });

    it('should NOT delete example skills', async () => {
      const skill = createFullSkill({ id: 'skill-1', isExample: true });
      useSkillsStore.setState({ skills: [skill] });

      await act(async () => {
        await useSkillsStore.getState().deleteSkill('skill-1');
      });

      expect(useSkillsStore.getState().skills).toHaveLength(1);
      expect(mockSkillDelete).not.toHaveBeenCalled();
      expect(mockSkillConfigDelete).not.toHaveBeenCalled();
    });

    it('should call skillDelete with skillDirName when hasSkillsFsApi is true', async () => {
      const skill = createFullSkill({
        id: 'skill-1',
        skillDirName: 'my-skill',
      });
      useSkillsStore.setState({ skills: [skill] });

      await act(async () => {
        await useSkillsStore.getState().deleteSkill('skill-1');
      });

      expect(mockSkillDelete).toHaveBeenCalledWith('my-skill');
    });

    it('should NOT call skillDelete when skillDirName is undefined', async () => {
      const skill = createFullSkill({
        id: 'skill-1',
        skillDirName: undefined,
      });
      useSkillsStore.setState({ skills: [skill] });

      await act(async () => {
        await useSkillsStore.getState().deleteSkill('skill-1');
      });

      expect(mockSkillDelete).not.toHaveBeenCalled();
    });

    it('should NOT call skillDelete when hasSkillsFsApi is false', async () => {
      mockHasSkillsFsApi.mockReturnValue(false);
      const skill = createFullSkill({ id: 'skill-1' });
      useSkillsStore.setState({ skills: [skill] });

      await act(async () => {
        await useSkillsStore.getState().deleteSkill('skill-1');
      });

      expect(mockSkillDelete).not.toHaveBeenCalled();
    });

    it('should call skillConfigDelete with user ID and skill name', async () => {
      const skill = createFullSkill({ id: 'skill-1', name: 'My Skill' });
      useSkillsStore.setState({ skills: [skill] });

      await act(async () => {
        await useSkillsStore.getState().deleteSkill('skill-1');
      });

      expect(mockSkillConfigDelete).toHaveBeenCalledWith('user', 'My Skill');
    });

    it('should remove skill from store even if skillConfigDelete fails', async () => {
      const skill = createFullSkill({ id: 'skill-1' });
      useSkillsStore.setState({ skills: [skill] });
      mockSkillConfigDelete.mockRejectedValue(new Error('Config delete fail'));

      await act(async () => {
        await useSkillsStore.getState().deleteSkill('skill-1');
      });

      expect(useSkillsStore.getState().skills).toHaveLength(0);
    });

    it('should remove skill from store even if skillDelete rejects', async () => {
      const skill = createFullSkill({ id: 'skill-1' });
      useSkillsStore.setState({ skills: [skill] });
      mockSkillDelete.mockRejectedValue(new Error('FS delete fail'));

      await act(async () => {
        await useSkillsStore.getState().deleteSkill('skill-1');
      });

      expect(useSkillsStore.getState().skills).toHaveLength(0);
    });

    it('should NOT call skillConfigDelete when email is null', async () => {
      mockAuthState.email = null;
      const skill = createFullSkill({ id: 'skill-1' });
      useSkillsStore.setState({ skills: [skill] });

      await act(async () => {
        await useSkillsStore.getState().deleteSkill('skill-1');
      });

      // Skill is still removed from state
      expect(useSkillsStore.getState().skills).toHaveLength(0);
      expect(mockSkillConfigDelete).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // toggleSkill
  // =========================================================================
  describe('toggleSkill', () => {
    it('should toggle enabled from true to false', async () => {
      const skill = createFullSkill({ id: 'skill-1', enabled: true });
      useSkillsStore.setState({ skills: [skill] });

      await act(async () => {
        await useSkillsStore.getState().toggleSkill('skill-1');
      });

      expect(useSkillsStore.getState().skills[0].enabled).toBe(false);
    });

    it('should toggle enabled from false to true', async () => {
      const skill = createFullSkill({ id: 'skill-1', enabled: false });
      useSkillsStore.setState({ skills: [skill] });

      await act(async () => {
        await useSkillsStore.getState().toggleSkill('skill-1');
      });

      expect(useSkillsStore.getState().skills[0].enabled).toBe(true);
    });

    it('should do nothing when skill id is not found', async () => {
      const skill = createFullSkill({ id: 'skill-1', enabled: true });
      useSkillsStore.setState({ skills: [skill] });

      await act(async () => {
        await useSkillsStore.getState().toggleSkill('nonexistent');
      });

      expect(useSkillsStore.getState().skills[0].enabled).toBe(true);
    });

    it('should call skillConfigToggle with user ID, name, and new enabled value', async () => {
      const skill = createFullSkill({
        id: 'skill-1',
        name: 'Toggle Me',
        enabled: true,
      });
      useSkillsStore.setState({ skills: [skill] });

      await act(async () => {
        await useSkillsStore.getState().toggleSkill('skill-1');
      });

      expect(mockSkillConfigToggle).toHaveBeenCalledWith(
        'user',
        'Toggle Me',
        false
      );
    });

    it('should revert enabled on skillConfigToggle failure', async () => {
      const skill = createFullSkill({ id: 'skill-1', enabled: true });
      useSkillsStore.setState({ skills: [skill] });
      mockSkillConfigToggle.mockRejectedValue(new Error('Toggle fail'));

      await act(async () => {
        await useSkillsStore.getState().toggleSkill('skill-1');
      });

      // Should revert back to true
      expect(useSkillsStore.getState().skills[0].enabled).toBe(true);
    });

    it('should revert enabled when skillConfigToggle returns success: false', async () => {
      const skill = createFullSkill({ id: 'skill-1', enabled: false });
      useSkillsStore.setState({ skills: [skill] });
      mockSkillConfigToggle.mockResolvedValue({
        success: false,
        error: 'Permission denied',
      });

      await act(async () => {
        await useSkillsStore.getState().toggleSkill('skill-1');
      });

      // Should revert back to false
      expect(useSkillsStore.getState().skills[0].enabled).toBe(false);
    });

    it('should NOT call skillConfigToggle when hasSkillsFsApi is false', async () => {
      mockHasSkillsFsApi.mockReturnValue(false);
      const skill = createFullSkill({ id: 'skill-1', enabled: true });
      useSkillsStore.setState({ skills: [skill] });

      await act(async () => {
        await useSkillsStore.getState().toggleSkill('skill-1');
      });

      // UI still toggles
      expect(useSkillsStore.getState().skills[0].enabled).toBe(false);
      expect(mockSkillConfigToggle).not.toHaveBeenCalled();
    });

    it('should NOT call skillConfigToggle when email is null', async () => {
      mockAuthState.email = null;
      const skill = createFullSkill({ id: 'skill-1', enabled: true });
      useSkillsStore.setState({ skills: [skill] });

      await act(async () => {
        await useSkillsStore.getState().toggleSkill('skill-1');
      });

      // UI still toggles
      expect(useSkillsStore.getState().skills[0].enabled).toBe(false);
      expect(mockSkillConfigToggle).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getSkillsByType
  // =========================================================================
  describe('getSkillsByType', () => {
    it('should return only example skills when isExample=true', () => {
      const exampleSkill = createFullSkill({ id: 'ex-1', isExample: true });
      const userSkill = createFullSkill({ id: 'usr-1', isExample: false });
      useSkillsStore.setState({ skills: [exampleSkill, userSkill] });

      const result = useSkillsStore.getState().getSkillsByType(true);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('ex-1');
    });

    it('should return only user skills when isExample=false', () => {
      const exampleSkill = createFullSkill({ id: 'ex-1', isExample: true });
      const userSkill = createFullSkill({ id: 'usr-1', isExample: false });
      useSkillsStore.setState({ skills: [exampleSkill, userSkill] });

      const result = useSkillsStore.getState().getSkillsByType(false);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('usr-1');
    });

    it('should return empty array when no skills match', () => {
      const userSkill = createFullSkill({ id: 'usr-1', isExample: false });
      useSkillsStore.setState({ skills: [userSkill] });

      const result = useSkillsStore.getState().getSkillsByType(true);
      expect(result).toEqual([]);
    });

    it('should return empty array when store is empty', () => {
      const result = useSkillsStore.getState().getSkillsByType(false);
      expect(result).toEqual([]);
    });

    it('should return all skills when all match the type', () => {
      const s1 = createFullSkill({ id: 'ex-1', isExample: true, name: 'A' });
      const s2 = createFullSkill({ id: 'ex-2', isExample: true, name: 'B' });
      useSkillsStore.setState({ skills: [s1, s2] });

      const result = useSkillsStore.getState().getSkillsByType(true);
      expect(result).toHaveLength(2);
    });
  });

  // =========================================================================
  // syncFromDisk
  // =========================================================================
  describe('syncFromDisk', () => {
    it('should do nothing when hasSkillsFsApi is false', async () => {
      mockHasSkillsFsApi.mockReturnValue(false);

      await act(async () => {
        await useSkillsStore.getState().syncFromDisk();
      });

      expect(mockSkillsScan).not.toHaveBeenCalled();
    });

    it('should do nothing when skillsScan returns success=false', async () => {
      mockSkillsScan.mockResolvedValue({ success: false });

      await act(async () => {
        await useSkillsStore.getState().syncFromDisk();
      });

      expect(useSkillsStore.getState().skills).toEqual([]);
    });

    it('should do nothing when skillsScan returns no skills', async () => {
      mockSkillsScan.mockResolvedValue({ success: true, skills: null });

      await act(async () => {
        await useSkillsStore.getState().syncFromDisk();
      });

      expect(useSkillsStore.getState().skills).toEqual([]);
    });

    it('should call skillConfigInit with userId', async () => {
      mockAuthState.email = 'dev@test.com';
      mockSkillsScan.mockResolvedValue({ success: true, skills: [] });
      mockSkillConfigLoad.mockResolvedValue({ success: false });

      await act(async () => {
        await useSkillsStore.getState().syncFromDisk();
      });

      // emailToUserId('dev@test.com') => 'dev'
      expect(mockSkillConfigInit).toHaveBeenCalledWith('dev');
    });

    it('should load config via skillConfigLoad', async () => {
      mockAuthState.email = 'dev@test.com';
      mockSkillsScan.mockResolvedValue({ success: true, skills: [] });

      await act(async () => {
        await useSkillsStore.getState().syncFromDisk();
      });

      expect(mockSkillConfigLoad).toHaveBeenCalledWith('dev');
    });

    it('should create disk skills from scan results sorted by name', async () => {
      mockSkillConfigLoad.mockResolvedValue({
        success: true,
        config: { skills: {} },
      });
      mockSkillsScan.mockResolvedValue({
        success: true,
        skills: [
          {
            name: 'Zebra Skill',
            description: 'Last alphabetically',
            path: 'zebra-skill/SKILL.md',
            skillDirName: 'zebra-skill',
            isExample: false,
          },
          {
            name: 'Alpha Skill',
            description: 'First alphabetically',
            path: 'alpha-skill/SKILL.md',
            skillDirName: 'alpha-skill',
            isExample: false,
          },
        ],
      });

      await act(async () => {
        await useSkillsStore.getState().syncFromDisk();
      });

      const skills = useSkillsStore.getState().skills;
      expect(skills).toHaveLength(2);
      expect(skills[0].name).toBe('Alpha Skill');
      expect(skills[1].name).toBe('Zebra Skill');
    });

    it('should assign disk- prefix IDs based on skillDirName', async () => {
      mockSkillConfigLoad.mockResolvedValue({
        success: true,
        config: { skills: {} },
      });
      mockSkillsScan.mockResolvedValue({
        success: true,
        skills: [
          {
            name: 'My Skill',
            description: 'Desc',
            path: 'my-skill/SKILL.md',
            skillDirName: 'my-skill',
            isExample: false,
          },
        ],
      });

      await act(async () => {
        await useSkillsStore.getState().syncFromDisk();
      });

      const skill = useSkillsStore.getState().skills[0];
      expect(skill.id).toBe('disk-my-skill');
    });

    it('should apply global config to skills when available', async () => {
      mockSkillConfigLoad.mockResolvedValue({
        success: true,
        config: {
          skills: {
            'Test Skill': {
              enabled: false,
              scope: { isGlobal: false, selectedAgents: ['agent-x'] },
              addedAt: 1600000000000,
              isExample: false,
            },
          },
        },
      });
      mockSkillsScan.mockResolvedValue({
        success: true,
        skills: [
          {
            name: 'Test Skill',
            description: 'Desc',
            path: 'test-skill/SKILL.md',
            skillDirName: 'test-skill',
            isExample: false,
          },
        ],
      });

      await act(async () => {
        await useSkillsStore.getState().syncFromDisk();
      });

      const skill = useSkillsStore.getState().skills[0];
      expect(skill.enabled).toBe(false);
      expect(skill.scope.isGlobal).toBe(false);
      expect(skill.scope.selectedAgents).toEqual(['agent-x']);
      expect(skill.addedAt).toBe(1600000000000);
    });

    it('should register new skills not present in config via skillConfigUpdate', async () => {
      mockSkillConfigLoad.mockResolvedValue({
        success: true,
        config: { skills: {} },
      });
      mockSkillsScan.mockResolvedValue({
        success: true,
        skills: [
          {
            name: 'Brand New',
            description: 'New skill',
            path: 'brand-new/SKILL.md',
            skillDirName: 'brand-new',
            isExample: false,
          },
        ],
      });

      await act(async () => {
        await useSkillsStore.getState().syncFromDisk();
      });

      expect(mockSkillConfigUpdate).toHaveBeenCalledWith(
        'user',
        'Brand New',
        expect.objectContaining({
          enabled: true,
          scope: { isGlobal: true, selectedAgents: [] },
          isExample: false,
        })
      );
    });

    it('should NOT call skillConfigUpdate for skills already in config', async () => {
      mockSkillConfigLoad.mockResolvedValue({
        success: true,
        config: {
          skills: {
            'Known Skill': {
              enabled: true,
              scope: { isGlobal: true, selectedAgents: [] },
              addedAt: 1600000000000,
              isExample: false,
            },
          },
        },
      });
      mockSkillsScan.mockResolvedValue({
        success: true,
        skills: [
          {
            name: 'Known Skill',
            description: 'Existing skill',
            path: 'known-skill/SKILL.md',
            skillDirName: 'known-skill',
            isExample: false,
          },
        ],
      });

      await act(async () => {
        await useSkillsStore.getState().syncFromDisk();
      });

      // Only skillConfigLoad was called, not skillConfigUpdate (for registration)
      expect(mockSkillConfigUpdate).not.toHaveBeenCalled();
    });

    it('should preserve existing fileContent from previous state', async () => {
      const existingSkill = createFullSkill({
        id: 'disk-prev-skill',
        skillDirName: 'prev-skill',
        fileContent: 'existing content',
      });
      useSkillsStore.setState({ skills: [existingSkill] });

      mockSkillConfigLoad.mockResolvedValue({
        success: true,
        config: { skills: {} },
      });
      mockSkillsScan.mockResolvedValue({
        success: true,
        skills: [
          {
            name: 'Prev Skill',
            description: 'Desc',
            path: 'prev-skill/SKILL.md',
            skillDirName: 'prev-skill',
            isExample: false,
          },
        ],
      });

      await act(async () => {
        await useSkillsStore.getState().syncFromDisk();
      });

      const skill = useSkillsStore.getState().skills[0];
      expect(skill.fileContent).toBe('existing content');
    });

    it('should default to empty string for fileContent when no previous state', async () => {
      mockSkillConfigLoad.mockResolvedValue({
        success: true,
        config: { skills: {} },
      });
      mockSkillsScan.mockResolvedValue({
        success: true,
        skills: [
          {
            name: 'New Skill',
            description: 'Fresh',
            path: 'new-skill/SKILL.md',
            skillDirName: 'new-skill',
            isExample: false,
          },
        ],
      });

      await act(async () => {
        await useSkillsStore.getState().syncFromDisk();
      });

      const skill = useSkillsStore.getState().skills[0];
      expect(skill.fileContent).toBe('');
    });

    it('should default scope to {isGlobal:true, selectedAgents:[]} when config has no scope', async () => {
      mockSkillConfigLoad.mockResolvedValue({
        success: true,
        config: {
          skills: {
            'No Scope Skill': {
              enabled: true,
              addedAt: 1700000000000,
              isExample: false,
              // scope is missing
            },
          },
        },
      });
      mockSkillsScan.mockResolvedValue({
        success: true,
        skills: [
          {
            name: 'No Scope Skill',
            description: 'Desc',
            path: 'no-scope/SKILL.md',
            skillDirName: 'no-scope',
            isExample: false,
          },
        ],
      });

      await act(async () => {
        await useSkillsStore.getState().syncFromDisk();
      });

      const skill = useSkillsStore.getState().skills[0];
      expect(skill.scope).toEqual({ isGlobal: true, selectedAgents: [] });
    });

    it('should handle skillsScan throwing an error gracefully', async () => {
      mockSkillsScan.mockRejectedValue(new Error('Scan failed'));

      await act(async () => {
        await useSkillsStore.getState().syncFromDisk();
      });

      // Store should remain unchanged (empty)
      expect(useSkillsStore.getState().skills).toEqual([]);
    });

    it('should handle skillConfigLoad throwing an error gracefully', async () => {
      mockSkillConfigLoad.mockRejectedValue(new Error('Config load failed'));
      mockSkillsScan.mockResolvedValue({
        success: true,
        skills: [
          {
            name: 'Resilient Skill',
            description: 'Survives config error',
            path: 'resilient/SKILL.md',
            skillDirName: 'resilient',
            isExample: false,
          },
        ],
      });

      await act(async () => {
        await useSkillsStore.getState().syncFromDisk();
      });

      // Skills should still be loaded with defaults
      const skills = useSkillsStore.getState().skills;
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('Resilient Skill');
      expect(skills[0].enabled).toBe(true);
    });

    it('should skip skillConfigInit and skillConfigLoad when userId is null', async () => {
      mockAuthState.email = null;
      mockSkillsScan.mockResolvedValue({
        success: true,
        skills: [
          {
            name: 'No User Skill',
            description: 'Desc',
            path: 'no-user/SKILL.md',
            skillDirName: 'no-user',
            isExample: true,
          },
        ],
      });

      await act(async () => {
        await useSkillsStore.getState().syncFromDisk();
      });

      expect(mockSkillConfigInit).not.toHaveBeenCalled();
      expect(mockSkillConfigLoad).not.toHaveBeenCalled();

      const skill = useSkillsStore.getState().skills[0];
      expect(skill.isExample).toBe(true);
      expect(skill.enabled).toBe(true);
    });

    it('should use existing addedAt when available during new skill registration', async () => {
      const existingSkill = createFullSkill({
        id: 'disk-existing',
        skillDirName: 'existing',
        addedAt: 1500000000000,
      });
      useSkillsStore.setState({ skills: [existingSkill] });

      mockSkillConfigLoad.mockResolvedValue({
        success: true,
        config: { skills: {} },
      });
      mockSkillsScan.mockResolvedValue({
        success: true,
        skills: [
          {
            name: 'Existing',
            description: 'Desc',
            path: 'existing/SKILL.md',
            skillDirName: 'existing',
            isExample: false,
          },
        ],
      });

      await act(async () => {
        await useSkillsStore.getState().syncFromDisk();
      });

      // Registration should use existing addedAt
      expect(mockSkillConfigUpdate).toHaveBeenCalledWith(
        'user',
        'Existing',
        expect.objectContaining({ addedAt: 1500000000000 })
      );
    });

    it('should set isExample from scan result', async () => {
      mockSkillConfigLoad.mockResolvedValue({
        success: true,
        config: { skills: {} },
      });
      mockSkillsScan.mockResolvedValue({
        success: true,
        skills: [
          {
            name: 'Example One',
            description: 'Example',
            path: 'example-one/SKILL.md',
            skillDirName: 'example-one',
            isExample: true,
          },
          {
            name: 'User One',
            description: 'User',
            path: 'user-one/SKILL.md',
            skillDirName: 'user-one',
            isExample: false,
          },
        ],
      });

      await act(async () => {
        await useSkillsStore.getState().syncFromDisk();
      });

      const skills = useSkillsStore.getState().skills;
      const exampleSkill = skills.find((s) => s.name === 'Example One');
      const userSkill = skills.find((s) => s.name === 'User One');
      expect(exampleSkill?.isExample).toBe(true);
      expect(userSkill?.isExample).toBe(false);
    });
  });

  // =========================================================================
  // emailToUserId (internal helper tested via side effects)
  // =========================================================================
  describe('emailToUserId (via store behavior)', () => {
    it('should extract the part before @ as userId', async () => {
      mockAuthState.email = 'john.doe@company.org';

      await act(async () => {
        await useSkillsStore.getState().addSkill(createSkillInput());
      });

      expect(mockSkillConfigUpdate).toHaveBeenCalledWith(
        'john.doe',
        expect.any(String),
        expect.any(Object)
      );
    });

    it('should replace special characters with underscores', async () => {
      mockAuthState.email = 'user name@domain.com';

      await act(async () => {
        await useSkillsStore.getState().addSkill(createSkillInput());
      });

      // Space is replaced with _
      expect(mockSkillConfigUpdate).toHaveBeenCalledWith(
        'user_name',
        expect.any(String),
        expect.any(Object)
      );
    });

    it('should handle email with dots', async () => {
      mockAuthState.email = 'a.b.c@domain.com';

      await act(async () => {
        await useSkillsStore.getState().addSkill(createSkillInput());
      });

      expect(mockSkillConfigUpdate).toHaveBeenCalledWith(
        'a.b.c',
        expect.any(String),
        expect.any(Object)
      );
    });
  });

  // =========================================================================
  // Persist Partialize
  // =========================================================================
  describe('Persist Partialize', () => {
    it('should partialize only the skills array', () => {
      const persistApi = useSkillsStore.persist;
      const partialize = persistApi.getOptions().partialize;

      const fullState = {
        ...useSkillsStore.getState(),
        skills: [createFullSkill()],
      };

      const partialized = partialize?.(fullState) as Record<string, unknown>;

      expect(partialized).toHaveProperty('skills');
      expect(partialized.skills).toHaveLength(1);
    });

    it('should use "skills-storage" as the persist name', () => {
      const persistApi = useSkillsStore.persist;
      expect(persistApi.getOptions().name).toBe('skills-storage');
    });
  });
});
