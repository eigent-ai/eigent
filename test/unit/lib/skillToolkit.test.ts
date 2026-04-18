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
  buildSkillMd,
  hasSkillsFsApi,
  parseSkillMd,
  skillNameToDirName,
  splitFrontmatter,
} from '@/lib/skillToolkit';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// splitFrontmatter
// ---------------------------------------------------------------------------
describe('splitFrontmatter', () => {
  it('returns {frontmatter: null, body: contents} when no --- delimiters', () => {
    const contents = 'Hello world\nThis is body text.';
    const result = splitFrontmatter(contents);

    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(contents);
  });

  it('returns {frontmatter: null, body: contents} when only opening ---', () => {
    const contents = '---\nname: test\nbody text here';
    const result = splitFrontmatter(contents);

    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(contents);
  });

  it('returns frontmatter and body for valid frontmatter', () => {
    const contents =
      '---\nname: my-skill\ndescription: A skill\n---\n\nSkill body here';
    const result = splitFrontmatter(contents);

    expect(result.frontmatter).toBe('name: my-skill\ndescription: A skill');
    expect(result.body).toBe('\nSkill body here');
  });

  it('handles BOM character at start', () => {
    const contents =
      '\uFEFF---\nname: bom-skill\ndescription: BOM test\n---\nBody';
    const result = splitFrontmatter(contents);

    expect(result.frontmatter).toBe('name: bom-skill\ndescription: BOM test');
    expect(result.body).toBe('Body');
  });

  it('handles leading whitespace/newlines before first ---', () => {
    const contents =
      '  \n  ---\nname: ws-skill\ndescription: WS test\n---\nBody';
    const result = splitFrontmatter(contents);

    expect(result.frontmatter).toBe('name: ws-skill\ndescription: WS test');
    expect(result.body).toBe('Body');
  });
});

// ---------------------------------------------------------------------------
// parseSkillMd
// ---------------------------------------------------------------------------
describe('parseSkillMd', () => {
  it('returns null when no frontmatter', () => {
    expect(parseSkillMd('Just body text, no frontmatter')).toBeNull();
  });

  it('returns null when name is missing', () => {
    const contents = '---\ndescription: Missing name\n---\nBody';
    expect(parseSkillMd(contents)).toBeNull();
  });

  it('returns null when description is missing', () => {
    const contents = '---\nname: no-desc\n---\nBody';
    expect(parseSkillMd(contents)).toBeNull();
  });

  it('returns {name, description, body} for valid content', () => {
    const contents =
      '---\nname: my-skill\ndescription: A great skill\n---\n\n# Body';
    const result = parseSkillMd(contents);

    expect(result).toEqual({
      name: 'my-skill',
      description: 'A great skill',
      body: '# Body',
    });
  });

  it('handles case-insensitive keys (Name/NAME/name)', () => {
    const contents =
      '---\nName: CI-Skill\nDESCRIPTION: Case insensitive\n---\nBody text';
    const result = parseSkillMd(contents);

    expect(result).not.toBeNull();
    expect(result!.name).toBe('CI-Skill');
    expect(result!.description).toBe('Case insensitive');
    expect(result!.body).toBe('Body text');
  });

  it('handles quoted values (single and double quotes)', () => {
    const contents =
      '---\nname: quoted-skill\ndescription: "It\'s a skill"\n---\nBody';
    const result = parseSkillMd(contents);

    expect(result).not.toBeNull();
    expect(result!.description).toBe("It's a skill");
  });

  it('trims name, description, and body', () => {
    const contents =
      '---\nname:  trimmed-name  \ndescription:  trimmed desc  \n---\n\n  trimmed body  \n';
    const result = parseSkillMd(contents);

    expect(result).not.toBeNull();
    expect(result!.name).toBe('trimmed-name');
    expect(result!.description).toBe('trimmed desc');
    expect(result!.body).toBe('trimmed body');
  });
});

// ---------------------------------------------------------------------------
// buildSkillMd
// ---------------------------------------------------------------------------
describe('buildSkillMd', () => {
  it('builds proper SKILL.md format', () => {
    const result = buildSkillMd('test-skill', 'A test skill', '# Hello');

    expect(result).toBe(
      '---\nname: test-skill\ndescription: "A test skill"\n---\n\n# Hello'
    );
  });

  it('escapes backslashes in description', () => {
    const result = buildSkillMd('skill', 'path\\to\\file', 'body');

    expect(result).toContain('description: "path\\\\to\\\\file"');
  });

  it('escapes double quotes in description', () => {
    const result = buildSkillMd('skill', 'say "hello"', 'body');

    expect(result).toContain('description: "say \\"hello\\""');
  });
});

// ---------------------------------------------------------------------------
// skillNameToDirName
// ---------------------------------------------------------------------------
describe('skillNameToDirName', () => {
  it('replaces unsafe chars with dashes', () => {
    expect(skillNameToDirName('my skill/name\\test')).toBe(
      'my-skill-name-test'
    );
  });

  it('replaces * ? : " < > | with dashes', () => {
    expect(skillNameToDirName('a*b?c:d"e<f>g|h')).toBe('a-b-c-d-e-f-g-h');
  });

  it('collapses multiple dashes into one', () => {
    expect(skillNameToDirName('a---b   c')).toBe('a-b-c');
  });

  it('strips leading and trailing dashes', () => {
    expect(skillNameToDirName('---My Skill---')).toBe('My-Skill');
  });

  it('returns "skill" for empty result after sanitization', () => {
    expect(skillNameToDirName('   ')).toBe('skill');
    expect(skillNameToDirName('///')).toBe('skill');
  });

  it('preserves casing', () => {
    expect(skillNameToDirName('MyCoolSkill')).toBe('MyCoolSkill');
  });
});

// ---------------------------------------------------------------------------
// hasSkillsFsApi
// ---------------------------------------------------------------------------
describe('hasSkillsFsApi', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    // Restore window to jsdom default
    vi.restoreAllMocks();
  });

  it('returns false when electronAPI.skillsScan is missing', () => {
    (globalThis as any).window = { electronAPI: {} };
    expect(hasSkillsFsApi()).toBe(false);
    (globalThis as any).window = originalWindow;
  });

  it('returns true when window.electronAPI.skillsScan exists', () => {
    (globalThis as any).window = {
      electronAPI: { skillsScan: vi.fn() },
    };
    expect(hasSkillsFsApi()).toBe(true);
    (globalThis as any).window = originalWindow;
  });

  it('returns false when window is undefined', () => {
    const saved = globalThis.window;
    // Simulate no window (SSR-like)
    try {
      delete (globalThis as any).window;
      // hasSkillsFsApi uses typeof check so it should not throw
      expect(hasSkillsFsApi()).toBe(false);
    } finally {
      (globalThis as any).window = saved;
    }
  });
});
