import { describe, expect, it, vi } from 'vitest';
import { confirmNativeQuit } from '../../../../electron/main/nativeQuitGuard';

describe('native quit registry guard', () => {
  it('quits idle Brain without showing a dialog', async () => {
    const confirm = vi.fn();
    expect(
      await confirmNativeQuit({
        lookup: async () => ({ active: false }),
        confirm,
      })
    ).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    'shows active work and respects native decision %s',
    async (approved) => {
      const confirm = vi.fn(async () => approved);
      expect(
        await confirmNativeQuit({
          lookup: async () => ({ active: true }),
          confirm,
        })
      ).toBe(approved);
      expect(confirm).toHaveBeenCalledWith(false);
    }
  );
  it.each([
    async () => {
      throw new Error('timeout');
    },
    async () => ({}),
  ])('confirms unknown registry state', async (lookup) => {
    const confirm = vi.fn(async () => false);
    expect(await confirmNativeQuit({ lookup, confirm })).toBe(false);
    expect(confirm).toHaveBeenCalledWith(true);
  });
});
