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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  electronAPI: null as null | {
    registerAccountFolder?: ReturnType<typeof vi.fn>;
  },
}));

vi.mock('@/host/createHost', () => ({
  createHost: () => ({ electronAPI: mocked.electronAPI }),
}));

import {
  registerAccountFolder,
  resetRegisteredAccountFolders,
} from '@/lib/accountFolder';

describe('registerAccountFolder (renderer)', () => {
  beforeEach(() => {
    mocked.electronAPI = null;
    resetRegisteredAccountFolders();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('does nothing in a browser', async () => {
    await expect(registerAccountFolder('a@b.com', 1)).resolves.toBeUndefined();
  });

  it('sends the signed-in account to the desktop app once', async () => {
    const register = vi.fn(async () => ({ dirName: 'user_1', status: null }));
    mocked.electronAPI = { registerAccountFolder: register };

    await registerAccountFolder(' a@b.com ', 1);
    await registerAccountFolder('a@b.com', 1);
    await registerAccountFolder('a@b.com', 2);

    expect(register.mock.calls).toEqual([
      ['a@b.com', 1],
      ['a@b.com', 2],
    ]);
  });

  it('skips an account without an email or user id', async () => {
    const register = vi.fn();
    mocked.electronAPI = { registerAccountFolder: register };

    await registerAccountFolder(null, 1);
    await registerAccountFolder('a@b.com', null);
    await registerAccountFolder('a@b.com', '');

    expect(register).not.toHaveBeenCalled();
  });

  it('tries again after a failed call', async () => {
    const register = vi
      .fn()
      .mockRejectedValueOnce(new Error('no handler'))
      .mockResolvedValueOnce({ dirName: 'user_1', status: 'migrated' });
    mocked.electronAPI = { registerAccountFolder: register };

    await registerAccountFolder('a@b.com', 1);
    await registerAccountFolder('a@b.com', 1);

    expect(register).toHaveBeenCalledTimes(2);
  });
});
