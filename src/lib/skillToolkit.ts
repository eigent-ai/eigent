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
 * Skill toolkit utilities aligned with CAMEL's skill_toolkit:
 * https://github.com/camel-ai/camel/blob/master/camel/toolkits/skill_toolkit.py
 *
 * Skills are stored as SKILL.md files with YAML frontmatter (name, description)
 * and a markdown body. Discovery order: repo > user > system (CAMEL);
 * in Eigent we use user scope at ~/.eigent/.camel/skills (one folder per skill).
 */

export interface SkillMeta {
  name: string;
  description: string;
  body: string;
}

export interface ScannedSkill {
  name: string;
  description: string;
  path: string;
  scope: 'repo' | 'user' | 'system';
  /** Folder name under skills dir (e.g. "my-skill") */
  skillDirName: string;
}

const FRONTMATTER_DELIM = '---';

/**
 * Split YAML frontmatter from the body of a SKILL.md file.
 * Expects content to start with "---", then YAML, then "---", then body.
 */
export function splitFrontmatter(contents: string): {
  frontmatter: string | null;
  body: string;
} {
  // Strip BOM and leading whitespace/newlines so the first `---` is detected
  const cleaned = contents.replace(/^\uFEFF/, '').trimStart();
  const lines = cleaned.split('\n');
  if (!lines.length || lines[0].trim() !== FRONTMATTER_DELIM) {
    return { frontmatter: null, body: cleaned };
  }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === FRONTMATTER_DELIM) {
      const frontmatter = lines.slice(1, i).join('\n');
      const body = lines.slice(i + 1).join('\n');
      return { frontmatter, body };
    }
  }
  return { frontmatter: null, body: cleaned };
}

/** Simple YAML-like parse for "name:" and "description:" (first-level keys only). */
function parseSimpleYaml(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (match) {
      const value = match[2].trim();
      // Lowercase key so `Name:` / `name:` / `NAME:` all work
      out[match[1].toLowerCase()] = value.replace(/^['"]|['"]$/g, '').trim();
    }
  }
  return out;
}

/**
 * Parse a SKILL.md file content and extract name, description, and body.
 * Compatible with CAMEL's _parse_skill format.
 */
export function parseSkillMd(contents: string): SkillMeta | null {
  const { frontmatter, body } = splitFrontmatter(contents);
  if (!frontmatter) return null;
  const data = parseSimpleYaml(frontmatter);
  const name = data.name;
  const description = data.description;
  if (typeof name !== 'string' || typeof description !== 'string') return null;
  return {
    name: name.trim(),
    description: description.trim(),
    body: body.trim(),
  };
}

/**
 * Build SKILL.md content from name, description, and body (CAMEL-compatible).
 */
export function buildSkillMd(
  name: string,
  description: string,
  body: string
): string {
  const front = [
    FRONTMATTER_DELIM,
    `name: ${name}`,
    `description: ${description}`,
    FRONTMATTER_DELIM,
    '',
    body,
  ].join('\n');
  return front;
}

/**
 * Sanitize a skill name into a safe folder name (no path separators, no dots at start).
 */
export function skillNameToDirName(name: string): string {
  // Keep original casing so that folder name matches skill name as closely
  // as possible, only stripping/normalizing unsafe characters.
  const cleaned = name
    .replace(/[\\/*?:"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'skill';
}

/** Check if running in Electron with skills API available */
export function hasSkillsFsApi(): boolean {
  return (
    typeof window !== 'undefined' && !!(window as any).electronAPI?.skillsScan
  );
}
