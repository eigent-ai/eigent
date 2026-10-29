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

import { afterEach, describe, expect, it } from 'vitest';
import {
  getSessionWindowRole,
  parseSessionWindowPath,
  sessionWindowPath,
} from '../../../src/lib/sessionWindows';

const target = { spaceId: 'space 1', projectId: 'project/a' };

describe('Session window routes', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('round-trips a Session through its window path', () => {
    const path = sessionWindowPath(target);
    expect(path).toBe('/session-window/space%201/project%2Fa');
    expect(parseSessionWindowPath(path)).toEqual(target);
  });

  it('rejects paths that are not exactly one Session', () => {
    expect(parseSessionWindowPath('/')).toBeNull();
    expect(parseSessionWindowPath('/session-window/space')).toBeNull();
    expect(parseSessionWindowPath('/session-window/a/b/c')).toBeNull();
    expect(parseSessionWindowPath('/session-window/%E0%A4%A/b')).toBeNull();
  });

  it('reads the role from the desktop hash route', () => {
    expect(getSessionWindowRole()).toBe('main');
    window.location.hash = '#/session-window/space/project';
    expect(getSessionWindowRole()).toBe('session');
  });
});
