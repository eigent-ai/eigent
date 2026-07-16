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
  buildSkillScopeAgentOptions,
  getWorkflowAgentDisplay,
  normalizeSkillScopeAgentId,
  SINGLE_AGENT_ID,
} from '@/components/WorkFlow/agents';
import { describe, expect, it } from 'vitest';

describe('normalizeSkillScopeAgentId', () => {
  it('canonicalizes Single Agent aliases to single_agent', () => {
    expect(normalizeSkillScopeAgentId('single_agent')).toBe(SINGLE_AGENT_ID);
    expect(normalizeSkillScopeAgentId('Agents.single_agent')).toBe(
      SINGLE_AGENT_ID
    );
    expect(normalizeSkillScopeAgentId('foo.single_agent')).toBe(
      'foo.single_agent'
    );
  });
});

describe('buildSkillScopeAgentOptions', () => {
  it('always includes single_agent first so Skills scope can target Single Agent', () => {
    const options = buildSkillScopeAgentOptions();
    expect(options[0]).toEqual({
      value: SINGLE_AGENT_ID,
      label: 'Single Agent',
    });
    expect(options.some((option) => option.value === 'developer_agent')).toBe(
      true
    );
    expect(
      options.some((option) => option.value === 'social_media_agent')
    ).toBe(false);
  });

  it('keeps a single Single Agent entry when workerList repeats aliases', () => {
    const options = buildSkillScopeAgentOptions([
      { name: 'custom_worker' },
      { name: 'developer_agent' },
      { name: SINGLE_AGENT_ID },
      { name: 'Agents.single_agent' },
      { name: 'foo.single_agent' },
    ]);

    expect(
      options.filter((option) => option.value === SINGLE_AGENT_ID)
    ).toHaveLength(1);
    expect(options[0].value).toBe(SINGLE_AGENT_ID);
    expect(
      options.filter((option) => option.value === 'developer_agent')
    ).toHaveLength(1);
    expect(options.some((option) => option.value === 'custom_worker')).toBe(
      true
    );
    expect(options.some((option) => option.value === 'foo.single_agent')).toBe(
      true
    );
  });
});

describe('getWorkflowAgentDisplay', () => {
  it('resolves single_agent display metadata', () => {
    const display = getWorkflowAgentDisplay(SINGLE_AGENT_ID);
    expect(display?.name).toBe('Single Agent');
    expect(display?.icon).toBeTruthy();
  });

  it('resolves alias display metadata for Single Agent', () => {
    expect(getWorkflowAgentDisplay('Agents.single_agent')?.name).toBe(
      'Single Agent'
    );
  });
});
