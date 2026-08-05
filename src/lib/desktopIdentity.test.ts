import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  electronAPI: null as null | {
    getDesktopInstanceId: ReturnType<typeof vi.fn>;
  },
}));

vi.mock('@/host/createHost', () => ({
  createHost: () => ({ electronAPI: mocked.electronAPI }),
}));

import {
  __desktopIdentityTestHooks,
  getDesktopInstanceId,
} from './desktopIdentity';

describe('desktop identity ownership', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocked.electronAPI = null;
    __desktopIdentityTestHooks.reset();
  });

  it('does not mint a device identity in an ordinary browser', async () => {
    await expect(getDesktopInstanceId()).resolves.toBe('');
    expect(
      window.localStorage.getItem('eigent_desktop_instance_id')
    ).toBeNull();
  });

  it('coalesces concurrent renderer reads through the main process', async () => {
    window.localStorage.setItem(
      'eigent_desktop_instance_id',
      'desk_legacyrendereridentity1234'
    );
    const getIdentity = vi.fn(async () => {
      await Promise.resolve();
      return 'desk_mainprocessidentity123456';
    });
    mocked.electronAPI = { getDesktopInstanceId: getIdentity };

    const identities = await Promise.all([
      getDesktopInstanceId(),
      getDesktopInstanceId(),
      getDesktopInstanceId(),
    ]);

    expect(identities).toEqual([
      'desk_mainprocessidentity123456',
      'desk_mainprocessidentity123456',
      'desk_mainprocessidentity123456',
    ]);
    expect(getIdentity).toHaveBeenCalledOnce();
    expect(getIdentity).toHaveBeenCalledWith('desk_legacyrendereridentity1234');
  });
});
