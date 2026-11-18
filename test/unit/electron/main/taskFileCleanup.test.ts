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

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteOwnedTaskFiles } from '../../../../electron/main/utils/taskFileCleanup';

const AUTOMATION_TASK = 'scheduled:918e3da7-c73b-49f6-ab77-335764f66aa7';

let home: string;

function makeDir(...parts: string[]) {
  const dir = path.join(home, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'output.md'), 'synthetic');
  return dir;
}

function cleanup(taskId: string, extra: Record<string, unknown> = {}) {
  return deleteOwnedTaskFiles({
    homeDir: home,
    email: 'person@example.test',
    taskId,
    projectId: 'project-a',
    userId: 7,
    spaceId: 'space-a',
    platform: 'darwin',
    ...extra,
  });
}

describe('deleteOwnedTaskFiles', () => {
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'task-cleanup-'));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('deletes the files of an automation Task whose id has a source prefix', () => {
    const projectTask = makeDir(
      'eigent',
      'user_7',
      'project_project-a',
      `task_${AUTOMATION_TASK}`
    );
    const runOutput = makeDir(
      '.eigent',
      'user_7',
      'spaces',
      'space-a',
      'projects',
      'project-a',
      'runs',
      AUTOMATION_TASK
    );
    const sibling = makeDir(
      'eigent',
      'user_7',
      'project_project-a',
      'task_scheduled'
    );

    const result = cleanup(AUTOMATION_TASK);

    expect(result).toMatchObject({ success: true });
    expect(fs.existsSync(projectTask)).toBe(false);
    expect(fs.existsSync(runOutput)).toBe(false);
    expect(fs.existsSync(sibling)).toBe(true);
  });

  it('accepts resumed Run ids and plain ids', () => {
    expect(cleanup('resume:1794355762263-2673:1794355769999-42')).toMatchObject(
      { success: true }
    );
    expect(cleanup('task_1794355762263-2673')).toMatchObject({
      success: true,
    });
  });

  it.each([
    'scheduled:../escape',
    '../escape',
    'scheduled/../../escape',
    'scheduled:a/b',
    'scheduled:a\\b',
    'scheduled:',
    ':scheduled',
    'scheduled::a',
    'scheduled:a.b',
    '..',
    '',
    `scheduled:${'a'.repeat(260)}`,
  ])('refuses the unsafe Task id %j without deleting anything', (taskId) => {
    const outside = makeDir('escape');
    expect(cleanup(taskId)).toMatchObject({
      success: false,
      error: 'Invalid storage identifier',
    });
    expect(fs.existsSync(outside)).toBe(true);
  });

  it('keeps a drive-like Task id inside the owner folders', () => {
    const outside = makeDir('evil');
    expect(cleanup('C:evil')).toMatchObject({ success: true });
    expect(cleanup('C:evil', { platform: 'win32' })).toEqual({
      success: true,
      deletedPaths: [],
    });
    expect(fs.existsSync(outside)).toBe(true);
  });

  it('keeps Session and Space ids to plain names', () => {
    expect(cleanup('task-1', { projectId: 'project:a' })).toMatchObject({
      success: false,
      error: 'Invalid storage identifier',
    });
    expect(cleanup('task-1', { spaceId: 'space:a' })).toMatchObject({
      success: false,
      error: 'Invalid storage identifier',
    });
  });

  it('on Windows treats an automation Task as having no folders', () => {
    // On Windows `task_scheduled:<id>` would name a stream of the file
    // `task_scheduled`, so the cleanup must not touch that file or folder.
    const stem = makeDir(
      'eigent',
      'user_7',
      'project_project-a',
      'task_scheduled'
    );

    const result = cleanup(AUTOMATION_TASK, { platform: 'win32' });

    expect(result).toEqual({ success: true, deletedPaths: [] });
    expect(fs.existsSync(stem)).toBe(true);
  });
});
