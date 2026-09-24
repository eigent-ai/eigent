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

import { renameSession } from '@/lib/sessionRename';
import type { Project } from '@/store/projectRuntimeStore';
import type { SpaceProjectMeta } from '@/store/spaceStore';
import { describe, expect, it, vi } from 'vitest';

function nameCaches() {
  let projectName = 'Original name';
  let metaName = 'Original name';
  let projectNameSource: Project['metadata']['nameSource'] = 'initial';
  let metaNameSource: Project['metadata']['nameSource'] = 'initial';
  const projectStore = {
    getProjectById: () =>
      ({
        name: projectName,
        metadata: { nameSource: projectNameSource },
      }) as Project,
    updateProject: (_id: string, updates: Partial<Project>) => {
      projectName = updates.name ?? projectName;
      projectNameSource = updates.metadata?.nameSource;
    },
  } as Parameters<typeof renameSession>[2];
  const spaceStore = {
    getProjectMeta: () =>
      ({
        name: metaName,
        metadata: { nameSource: metaNameSource },
      }) as SpaceProjectMeta,
    updateProjectMeta: (_id: string, updates: Partial<SpaceProjectMeta>) => {
      metaName = updates.name ?? metaName;
      metaNameSource = updates.metadata?.nameSource;
    },
  } as Parameters<typeof renameSession>[3];
  return {
    projectStore,
    spaceStore,
    names: () => [projectName, metaName],
    sources: () => [projectNameSource, metaNameSource],
    setNames: (name: string) => {
      projectName = name;
      metaName = name;
    },
  };
}

describe('renameSession', () => {
  it('updates both visible names before the save resolves', async () => {
    const caches = nameCaches();
    let resolveSave!: (value: { code: number }) => void;
    const pendingSave = new Promise<{ code: number }>((resolve) => {
      resolveSave = resolve;
    });
    const persist = vi.fn(() => pendingSave);

    const rename = renameSession(
      'project-1',
      'New name',
      caches.projectStore,
      caches.spaceStore,
      persist
    );
    expect(caches.names()).toEqual(['New name', 'New name']);
    expect(caches.sources()).toEqual(['manual', 'manual']);
    expect(persist).toHaveBeenCalledWith(
      '/api/v1/chat/project/project-1/name?new_name=New%20name'
    );
    resolveSave({ code: 0 });
    await rename;
    expect(caches.names()).toEqual(['New name', 'New name']);
  });

  it('rolls back a failed save without overwriting a newer rename', async () => {
    const caches = nameCaches();
    let rejectSave!: (error: Error) => void;
    const pendingSave = new Promise<{ code: number }>((_resolve, reject) => {
      rejectSave = reject;
    });
    const rename = renameSession(
      'project-1',
      'Failed name',
      caches.projectStore,
      caches.spaceStore,
      () => pendingSave
    );
    rejectSave(new Error('Save failed'));
    await expect(rename).rejects.toThrow('Save failed');
    expect(caches.names()).toEqual(['Original name', 'Original name']);
    expect(caches.sources()).toEqual(['initial', 'initial']);

    let rejectOlderSave!: (error: Error) => void;
    const olderSave = new Promise<{ code: number }>((_resolve, reject) => {
      rejectOlderSave = reject;
    });
    const olderRename = renameSession(
      'project-1',
      'Older pending name',
      caches.projectStore,
      caches.spaceStore,
      () => olderSave
    );
    caches.setNames('Newer name');
    rejectOlderSave(new Error('Older save failed'));
    await expect(olderRename).rejects.toThrow('Older save failed');
    expect(caches.names()).toEqual(['Newer name', 'Newer name']);
  });
});
