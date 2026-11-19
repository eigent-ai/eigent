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
  isGeneratedAutomationSessionName,
  renameGeneratedAutomationSessions,
} from '@/lib/automationSessionName';
import { describe, expect, it, vi } from 'vitest';

function makeStores(names: Record<string, string>) {
  const sessions = new Map(Object.entries(names));
  const projectStore = {
    getProjectById: vi.fn((id: string) =>
      sessions.has(id) ? ({ id, name: sessions.get(id)! } as never) : null
    ),
    updateProject: vi.fn(),
  };
  const spaceStore = {
    getProjectMeta: vi.fn(() => undefined),
    updateProjectMeta: vi.fn(),
  };
  const rename = vi.fn(async (projectId: string, name: string) => {
    sessions.set(projectId, name);
  });
  return { sessions, stores: { projectStore, spaceStore }, rename };
}

describe('isGeneratedAutomationSessionName', () => {
  it('matches the generated name in every former app language', () => {
    for (const name of [
      'Automation: Daily',
      'Automatisierung: Daily',
      'Automatisation : Daily',
      'オートメーション：Daily',
      '自动化：Daily',
      'الأتمتة: Daily',
    ]) {
      expect(isGeneratedAutomationSessionName(name, 'Daily')).toBe(true);
    }
  });

  it('does not match an edited name or another Automation', () => {
    expect(isGeneratedAutomationSessionName('Daily notes', 'Daily')).toBe(
      false
    );
    expect(
      isGeneratedAutomationSessionName('Automation: Weekly', 'Daily')
    ).toBe(false);
    expect(isGeneratedAutomationSessionName('Daily', 'Daily')).toBe(false);
    expect(isGeneratedAutomationSessionName('', 'Daily')).toBe(false);
  });
});

describe('renameGeneratedAutomationSessions', () => {
  it('renames a linked Session that still has the generated name', async () => {
    const { sessions, stores, rename } = makeStores({
      'session-1': 'Automation: Daily inbox summary',
    });

    const renamed = await renameGeneratedAutomationSessions(
      [{ name: 'Daily inbox summary', project_id: 'session-1' }],
      stores,
      rename
    );

    expect(renamed).toEqual(['session-1']);
    expect(sessions.get('session-1')).toBe('Daily inbox summary');
  });

  it('keeps a name the person edited and skips unlinked Automations', async () => {
    const { stores, rename } = makeStores({
      'session-1': 'My inbox digest',
      'session-2': 'Automation: Weekly report',
    });

    const renamed = await renameGeneratedAutomationSessions(
      [
        { name: 'Daily inbox summary', project_id: 'session-1' },
        { name: 'Weekly report', project_id: undefined },
      ],
      stores,
      rename
    );

    expect(renamed).toEqual([]);
    expect(rename).not.toHaveBeenCalled();
  });

  it('does nothing the second time', async () => {
    const { stores, rename } = makeStores({
      'session-1': 'Automation: Daily',
    });
    const automations = [{ name: 'Daily', project_id: 'session-1' }];

    await renameGeneratedAutomationSessions(automations, stores, rename);
    const second = await renameGeneratedAutomationSessions(
      automations,
      stores,
      rename
    );

    expect(second).toEqual([]);
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it('keeps going when one rename fails', async () => {
    const { sessions, stores } = makeStores({
      'session-1': 'Automation: A',
      'session-2': 'Automation: B',
    });
    const rename = vi.fn(async (projectId: string, name: string) => {
      if (projectId === 'session-1') throw new Error('offline');
      sessions.set(projectId, name);
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const renamed = await renameGeneratedAutomationSessions(
      [
        { name: 'A', project_id: 'session-1' },
        { name: 'B', project_id: 'session-2' },
      ],
      stores,
      rename
    );

    expect(renamed).toEqual(['session-2']);
    expect(sessions.get('session-1')).toBe('Automation: A');
  });
});
