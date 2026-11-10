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

import { app } from 'electron';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileReader } from '../../../electron/main/fileReader';

vi.mock('electron', () => ({ app: { getPath: vi.fn() } }));

let home: string;
let reader: FileReader;
const email = 'alex@example.com';
const project = 'session-a';
const task = 'task_run-a';
const owner = 'user_42';

function file(relative: string, content = 'keep me') {
  const target = path.join(home, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}
function cleanup() {
  return reader.deleteTaskFiles(email, task, project, 42, 'space-a');
}
function output(identity = owner, session = project, taskName = task) {
  return `eigent/${identity}/project_${session}/${taskName}/output.txt`;
}
function log(identity = owner) {
  return `.eigent/${identity}/project_${project}/${task}/camel_logs/log.json`;
}

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'eigent-delete-')));
  vi.mocked(app.getPath).mockReturnValue(home);
  reader = new FileReader(null as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('Session task file cleanup using real directories', () => {
  it('cleans user-id and legacy outputs/logs, then removes empty Session containers', () => {
    const removed = [
      file(output()),
      file(log()),
      file(output('alex')),
      file(log('alex')),
      file(`.eigent/${owner}/${task}/camel_logs/legacy.log`),
      file(`eigent/${owner}/task_task_run-a/double-prefix.txt`),
      file(
        `.eigent/${owner}/spaces/space-a/projects/${project}/runs/${task}/result.txt`
      ),
    ];
    const untouched = [
      file(output('user_99')),
      file(output(owner, 'session-b')),
      file(output('alex', 'session-b')),
      file(
        `.eigent/${owner}/spaces/space-a/projects/session-b/runs/${task}/result.txt`
      ),
      file(
        `.eigent/${owner}/spaces/space-b/projects/${project}/runs/${task}/result.txt`
      ),
      file(`.eigent/${owner}/runtime/project_${project}/${task}/metadata.json`),
      file('Documents/Space/user-file.txt'),
    ];
    expect(cleanup().success).toBe(true);
    removed.forEach((target) => expect(fs.existsSync(target)).toBe(false));
    untouched.forEach((target) =>
      expect(fs.readFileSync(target, 'utf8')).toBe('keep me')
    );
    expect(
      fs.existsSync(path.join(home, 'eigent', owner, `project_${project}`))
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(home, '.eigent', owner, 'spaces/space-a/projects')
      )
    ).toBe(true);
    expect(fs.existsSync(path.join(home, 'eigent', owner))).toBe(true);
    expect(cleanup()).toEqual({ success: true, deletedPaths: [] });
  });

  it('handles email-only legacy storage and .eigent output fallback', () => {
    const targets = [
      file(output('alex')),
      file(log('alex')),
      file(`.eigent/alex/project_${project}/task_task_run-a/output.txt`),
    ];
    expect(reader.deleteTaskFiles(email, task, project).success).toBe(true);
    targets.forEach((target) => expect(fs.existsSync(target)).toBe(false));
  });

  it('does not scan unrelated Sessions when projectId is absent', () => {
    const sibling = file(output());
    const legacy = file(`eigent/${owner}/${task}/old.txt`);
    expect(reader.deleteTaskFiles(email, task, undefined, 42).success).toBe(
      true
    );
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.existsSync(sibling)).toBe(true);
  });

  it('preserves remaining tasks, user files, and Session workdirs', () => {
    file(output());
    const remaining = [
      file(output(owner, project, 'task_run-b')),
      file(`eigent/${owner}/project_${project}/user.txt`),
      file(
        `.eigent/${owner}/spaces/space-a/projects/${project}/workdir/user.txt`
      ),
    ];
    expect(cleanup().success).toBe(true);
    remaining.forEach((target) => expect(fs.existsSync(target)).toBe(true));
  });

  it('reports partial removal and safely retries after an I/O failure', () => {
    const outputFile = file(output());
    const logFile = file(log());
    const remove = fs.rmSync;
    const failure = vi
      .spyOn(fs, 'rmSync')
      .mockImplementation((target, options) => {
        if (String(target).includes('/.eigent/'))
          throw Object.assign(new Error('locked'), { code: 'EACCES' });
        return remove(target, options);
      });
    const result = cleanup();
    expect(result.success).toBe(false);
    expect(result.deletedPaths).toHaveLength(1);
    expect(fs.existsSync(outputFile)).toBe(false);
    expect(fs.existsSync(logFile)).toBe(true);
    failure.mockRestore();
    expect(cleanup().success).toBe(true);
    expect(fs.existsSync(logFile)).toBe(false);
    expect(cleanup().success).toBe(true);
  });

  it('does not treat an inaccessible directory as missing', () => {
    const target = file(output());
    const lstat = fs.lstatSync;
    vi.spyOn(fs, 'lstatSync').mockImplementation(((
      name: fs.PathLike,
      options?: unknown
    ) => {
      if (String(name).endsWith('/project_session-a'))
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return lstat(name, options as never);
    }) as typeof fs.lstatSync);
    expect(cleanup().success).toBe(false);
    expect(fs.existsSync(target)).toBe(true);
  });

  it.each([
    '../other',
    '..',
    '.',
    '',
    'a/b',
    'a\\b',
    '/tmp/other',
    'C:\\other',
    'a\0b',
    'task_',
  ])('rejects unsafe task id %j', (taskId) => {
    const target = file(output());
    expect(reader.deleteTaskFiles(email, taskId, project, 42).success).toBe(
      false
    );
    expect(fs.existsSync(target)).toBe(true);
  });

  it.each(['../other', '', '/tmp/other', 'a\\b'])(
    'rejects unsafe project, user and Space ids %j',
    (id) => {
      file(output());
      expect(reader.deleteTaskFiles(email, task, id, 42).success).toBe(false);
      if (id)
        expect(reader.deleteTaskFiles(email, task, project, id).success).toBe(
          false
        );
      expect(reader.deleteTaskFiles(email, task, project, 42, id).success).toBe(
        false
      );
    }
  );

  it('fails closed without any storage identity', () => {
    file(output());
    expect(reader.deleteTaskFiles('', task, project).success).toBe(false);
  });

  it.each(['user_99@example.com', 'workspace@corp.com', 'runtime@corp.com'])(
    'skips the colliding legacy prefix of %s and still cleans the user-id root',
    (namespacedEmail) => {
      const target = file(output());
      const otherUser = file(output('user_99'));
      const shared = file(output('workspace'));
      expect(
        reader.deleteTaskFiles(namespacedEmail, task, project, 42).success
      ).toBe(true);
      expect(fs.existsSync(target)).toBe(false);
      expect(fs.existsSync(otherUser)).toBe(true);
      expect(fs.existsSync(shared)).toBe(true);
    }
  );

  it("treats a user_* email prefix as Brain's owner key without a userId", () => {
    const target = file(output('user_7'));
    expect(
      reader.deleteTaskFiles('user_7@example.com', task, project).success
    ).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('never uses a reserved namespace as an email-only identity', () => {
    const shared = file(output('workspace'));
    expect(
      reader.deleteTaskFiles('workspace@corp.com', task, project).success
    ).toBe(false);
    expect(fs.existsSync(shared)).toBe(true);
  });

  it('supports user-id-only identity without falling back to a shared root', () => {
    const target = file(output());
    const shared = file(`eigent/project_${project}/${task}/shared.txt`);
    expect(reader.deleteTaskFiles('', task, project, 42).success).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(shared)).toBe(true);
  });

  it('retains an empty Session container when it is a registered Space root', () => {
    const root = path.join(home, 'eigent', owner, `project_${project}`);
    fs.mkdirSync(root, { recursive: true });
    file(
      `.eigent/workspaces/${owner}/spaces/shared.json`,
      JSON.stringify({ workspace_root: root })
    );
    expect(cleanup().success).toBe(true);
    expect(fs.existsSync(root)).toBe(true);
  });

  it('reports a container removal failure and removes it on retry', () => {
    const target = file(output());
    const remove = fs.rmdirSync;
    const failingRemove = vi
      .spyOn(fs, 'rmdirSync')
      .mockImplementation((dir) => {
        if (String(dir).endsWith('project_session-a'))
          throw Object.assign(new Error('locked'), { code: 'EACCES' });
        return remove(dir);
      });
    expect(cleanup().success).toBe(false);
    expect(fs.existsSync(target)).toBe(false);
    failingRemove.mockRestore();
    expect(cleanup().success).toBe(true);
    expect(fs.existsSync(path.dirname(path.dirname(target)))).toBe(false);
  });

  it.each([
    'eigent',
    `eigent/${owner}`,
    `eigent/${owner}/project_${project}`,
    `eigent/${owner}/project_${project}/${task}`,
  ])('rejects symlink ancestor or leaf %s before any removal', (relative) => {
    const external = file('external/keep.txt');
    const link = path.join(home, relative);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(path.dirname(external), link, 'dir');
    const logFile = file(log());
    expect(cleanup().success).toBe(false);
    expect(fs.readFileSync(external, 'utf8')).toBe('keep me');
    expect(fs.existsSync(logFile)).toBe(true);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('unlinks nested symlinks without touching their targets', () => {
    const external = file('external/keep.txt');
    const dir = path.dirname(file(output()));
    fs.symlinkSync(path.dirname(external), path.join(dir, 'linked'), 'dir');
    fs.symlinkSync(path.join(home, 'missing'), path.join(dir, 'broken'), 'dir');
    expect(cleanup().success).toBe(true);
    expect(fs.readFileSync(external, 'utf8')).toBe('keep me');
  });

  it.each(['', '/task_run-a', '/task_run-a/nested'])(
    'protects a bound Space at any intersection with the deletion path (%s)',
    (suffix) => {
      const target = file(output());
      const root =
        path.join(home, 'eigent', owner, `project_${project}`) + suffix;
      fs.mkdirSync(root, { recursive: true });
      file(
        `.eigent/workspaces/${owner}/spaces/shared.json`,
        JSON.stringify({ workspace_root: root })
      );
      const result = cleanup();
      expect(result.success).toBe(false);
      expect(result.deletedPaths).toEqual([]);
      expect(fs.existsSync(target)).toBe(true);
    }
  );
});
