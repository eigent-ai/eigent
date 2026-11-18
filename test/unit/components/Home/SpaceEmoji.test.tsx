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

// Load the HTTP client first, as the app does at boot, so the auth store
// and i18n settle their import cycle in the same order.
import '@/api/http';

import {
  EMOJI_DATA_CDN_URL,
  EMOJI_LOAD_TIMEOUT_MS,
  SpaceEmojiPicker,
} from '@/components/Home/SpaceEmojiPicker';
import { SpaceGlyph } from '@/components/SpaceSidebar/SpaceGlyph';
import { spaceEmoji } from '@/lib/spaceEmoji';
import { useSpaceStore, type Space } from '@/store/spaceStore';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import packageJson from '../../../../package.json';

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  rootProps: {} as Record<string, unknown>,
  loadEmojiData: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));

// The picker's own list needs real layout, so stand in with one emoji.
vi.mock('frimousse', () => ({
  defaultEmojiDataResolver: mocks.loadEmojiData,
  EmojiPicker: {
    Root: ({
      children,
      onEmojiSelect,
      ...props
    }: {
      children: ReactNode;
      onEmojiSelect: (emoji: { emoji: string; label: string }) => void;
    }) => {
      Object.assign(mocks.rootProps, props);
      return (
        <div>
          <button
            type="button"
            onClick={() => onEmojiSelect({ emoji: '🚀', label: 'rocket' })}
          >
            Pick rocket
          </button>
          {children}
        </div>
      );
    },
    Search: () => null,
    Viewport: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Loading: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Empty: () => null,
    List: () => null,
  },
}));

const space = (metadata?: Space['metadata']): Space => ({
  id: 'space-research',
  name: 'Research',
  sourceType: 'folder',
  rootPath: '/work/research',
  status: 'active',
  schemaVersion: 1,
  createdAt: 0,
  updatedAt: 0,
  metadata,
});

const currentEmoji = () =>
  spaceEmoji(useSpaceStore.getState().spaces['space-research']);

function Picker() {
  const current = useSpaceStore((state) => state.spaces['space-research']);
  return <SpaceEmojiPicker space={current} name="Research" />;
}

async function openPicker() {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole('button', { name: 'Change emoji for Research' })
  );
  return user;
}

describe('Space emojis', () => {
  const updateSpaceOnServer = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    updateSpaceOnServer.mockResolvedValue(undefined);
    useSpaceStore.setState({
      spaces: { 'space-research': space({ keep: 'me' }) },
      updateSpaceOnServer,
    });
  });

  it('reads only real emojis', () => {
    expect(spaceEmoji(space({ emoji: '🚀' }))).toBe('🚀');
    expect(spaceEmoji(space({ emoji: '👩🏽‍💻' }))).toBe('👩🏽‍💻');
    expect(spaceEmoji(space({ emoji: '🇯🇵' }))).toBe('🇯🇵');
    expect(spaceEmoji(space({ emoji: 'rocket' }))).toBeNull();
    expect(spaceEmoji(space({ emoji: 7 }))).toBeNull();
    expect(spaceEmoji(space())).toBeNull();
  });

  it('draws the chosen emoji, or the first letter without one', () => {
    const { container, rerender } = render(
      <SpaceGlyph name="Research" emoji={null} />
    );
    expect(container).toHaveTextContent('R');

    rerender(<SpaceGlyph name="Research" emoji="🚀" />);
    expect(container).toHaveTextContent('🚀');
    expect(container).not.toHaveTextContent('R');
  });

  it('saves the chosen emoji with the Space, keeping its other metadata', async () => {
    render(<Picker />);
    const user = await openPicker();

    await user.click(
      await screen.findByRole('button', { name: 'Pick rocket' })
    );

    expect(currentEmoji()).toBe('🚀');
    expect(updateSpaceOnServer).toHaveBeenCalledWith('space-research', {
      metadata: { keep: 'me', emoji: '🚀' },
    });
  });

  describe('where the emoji list comes from', () => {
    const bundledUrl = new URL('/emojibase', window.location.href).href;
    const resolve = () =>
      (
        mocks.rootProps.resolveEmojiData as (
          locale: string,
          options: object
        ) => Promise<unknown>
      )('en', {});
    const sources = () =>
      mocks.loadEmojiData.mock.calls.map(
        ([, options]) => (options as { emojibaseUrl: string }).emojibaseUrl
      );

    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it('reads the list the app ships, without the network', async () => {
      mocks.loadEmojiData.mockResolvedValue({ locale: 'en' });
      render(<Picker />);
      await openPicker();
      await screen.findByRole('button', { name: 'Pick rocket' });

      await act(async () => {
        await expect(resolve()).resolves.toEqual({ locale: 'en' });
      });

      expect(mocks.rootProps.emojibaseUrl).toBe(bundledUrl);
      expect(sources()).toEqual([bundledUrl]);
    });

    it('asks the CDN only when its own list cannot be read', async () => {
      mocks.loadEmojiData
        .mockRejectedValueOnce(new Error('missing'))
        .mockResolvedValueOnce({ locale: 'en' });
      render(<Picker />);
      await openPicker();

      await act(async () => {
        await expect(resolve()).resolves.toEqual({ locale: 'en' });
      });

      expect(sources()).toEqual([bundledUrl, EMOJI_DATA_CDN_URL]);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('asks the CDN for the same version the app ships', () => {
      expect(EMOJI_DATA_CDN_URL).toBe(
        `https://cdn.jsdelivr.net/npm/emojibase-data@${packageJson.devDependencies['emojibase-data']}`
      );
    });
  });

  describe('when the emoji list cannot load', () => {
    const resolve = () =>
      (
        mocks.rootProps.resolveEmojiData as (
          locale: string,
          options: object
        ) => Promise<unknown>
      )('en', {});

    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('says so, and Retry tries again', async () => {
      mocks.loadEmojiData.mockRejectedValue(new Error('offline'));
      render(<Picker />);
      const user = await openPicker();
      expect(screen.queryByRole('alert')).toBeNull();

      await act(async () => {
        await expect(resolve()).rejects.toThrow('offline');
      });

      expect(screen.getByRole('alert')).toHaveTextContent(
        "Couldn't load emoji"
      );
      await user.click(screen.getByRole('button', { name: 'Retry' }));
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('stops waiting for a request that never answers', async () => {
      mocks.loadEmojiData.mockReturnValue(new Promise(() => undefined));
      render(<Picker />);
      await openPicker();

      vi.useFakeTimers();
      await act(async () => {
        const pending = expect(resolve()).rejects.toThrow('Timed out');
        await vi.advanceTimersByTimeAsync(EMOJI_LOAD_TIMEOUT_MS);
        await pending;
      });

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('stays quiet when the picker itself stopped the read', async () => {
      mocks.loadEmojiData.mockRejectedValue(new Error('aborted'));
      render(<Picker />);
      await openPicker();

      await act(async () => {
        await expect(
          (
            mocks.rootProps.resolveEmojiData as (
              locale: string,
              options: object
            ) => Promise<unknown>
          )('en', { signal: AbortSignal.abort() })
        ).rejects.toThrow('aborted');
      });

      expect(screen.queryByRole('alert')).toBeNull();
      // A read the picker stopped is not a reason to try the CDN.
      expect(mocks.loadEmojiData).toHaveBeenCalledTimes(1);
    });
  });

  it('goes back to the first letter', async () => {
    useSpaceStore.setState({
      spaces: { 'space-research': space({ emoji: '🚀' }) },
    });
    render(<Picker />);
    const user = await openPicker();

    await user.click(
      await screen.findByRole('button', { name: 'Use first letter' })
    );

    expect(currentEmoji()).toBeNull();
    expect(updateSpaceOnServer).toHaveBeenCalledWith('space-research', {
      metadata: { emoji: null },
    });
  });

  it('restores the old emoji and says so when saving fails', async () => {
    updateSpaceOnServer.mockRejectedValue(new Error('offline'));
    useSpaceStore.setState({
      spaces: { 'space-research': space({ emoji: '⭐' }) },
    });
    render(<Picker />);
    const user = await openPicker();

    await user.click(
      await screen.findByRole('button', { name: 'Pick rocket' })
    );
    await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalled());

    expect(currentEmoji()).toBe('⭐');
  });

  it('goes back to the first letter when saving a first emoji fails', async () => {
    updateSpaceOnServer.mockRejectedValue(new Error('offline'));
    useSpaceStore.setState({
      spaces: { 'space-research': space({ keep: 'me' }) },
    });

    await expect(
      useSpaceStore.getState().setSpaceEmoji('space-research', '🚀')
    ).rejects.toThrow('offline');

    expect(currentEmoji()).toBeNull();
    expect(
      useSpaceStore.getState().spaces['space-research'].metadata?.keep
    ).toBe('me');
  });

  it('keeps a signed-out local Space on this device', async () => {
    useSpaceStore.setState({
      spaces: { 'space-research': space({ legacy: true }) },
    });

    await useSpaceStore.getState().setSpaceEmoji('space-research', '🚀');

    expect(currentEmoji()).toBe('🚀');
    expect(updateSpaceOnServer).not.toHaveBeenCalled();
  });
});
