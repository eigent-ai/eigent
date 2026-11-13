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

import { SpaceGlyph } from '@/components/SpaceSidebar/SpaceGlyph';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { spaceEmoji } from '@/lib/spaceEmoji';
import { cn } from '@/lib/utils';
import { EMOJI_DATA_DIR, type EmojiDataLocale } from '@/shared/emojiData';
import { useSpaceStore, type Space } from '@/store/spaceStore';
import {
  defaultEmojiDataResolver,
  EmojiPicker,
  type EmojiDataResolver,
  type EmojiPickerListCategoryHeaderProps,
  type EmojiPickerListEmojiProps,
  type EmojiPickerListRowProps,
} from 'frimousse';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

/**
 * The emoji lists ship with the app (see scripts/vite-emoji-data.ts), in a
 * folder beside index.html, so the picker works offline.
 */
export function bundledEmojiDataUrl(): string {
  return new URL(
    `${import.meta.env.BASE_URL}${EMOJI_DATA_DIR}`,
    document.baseURI
  ).href;
}

/**
 * The same lists on a CDN, for a build that could not read its own copy.
 * Pinned to the version the app ships, so both sources hold the same emoji.
 */
export const EMOJI_DATA_CDN_URL =
  'https://cdn.jsdelivr.net/npm/emojibase-data@18.0.0';

/** The picker shows nothing of its own when the list can't be read. */
export const EMOJI_LOAD_TIMEOUT_MS = 8_000;

/** The picker's search language for each app language; others use English. */
const EMOJI_LOCALES: Readonly<Record<string, EmojiDataLocale>> = {
  de: 'de',
  es: 'es',
  fr: 'fr',
  it: 'it',
  ja: 'ja',
  ko: 'ko',
  ru: 'ru',
  'zh-Hans': 'zh',
  'zh-Hant': 'zh-hant',
};

function CategoryHeader({
  category,
  className,
  ...props
}: EmojiPickerListCategoryHeaderProps) {
  return (
    <div
      className={cn(
        'bg-ds-neutral-default-default px-ds-4 py-ds-4 text-ds-text-meta font-medium text-ds-ink-muted-default',
        className
      )}
      {...props}
    >
      {category.label}
    </div>
  );
}

function EmojiRow({ children, className, ...props }: EmojiPickerListRowProps) {
  return (
    <div className={cn('scroll-my-ds-4', className)} {...props}>
      {children}
    </div>
  );
}

function EmojiButton({
  emoji,
  className,
  ...props
}: EmojiPickerListEmojiProps) {
  return (
    <button
      className={cn(
        'flex size-ds-control-sm cursor-pointer items-center justify-center rounded-ds-compact-control border-0 border-x-0 border-y-0 bg-transparent !text-ds-text-body-large outline-none',
        emoji.isActive && 'bg-ds-neutral-muted-default',
        className
      )}
      {...props}
    >
      {emoji.emoji}
    </button>
  );
}

/**
 * Read the emoji list the app ships. Only when that copy cannot be read does
 * the picker ask the CDN, so it needs no network in normal use.
 */
const loadEmojiData: EmojiDataResolver = async (locale, options) => {
  try {
    return await defaultEmojiDataResolver(locale, {
      ...options,
      emojibaseUrl: bundledEmojiDataUrl(),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    console.warn(
      '[SpaceEmojiPicker] Could not read the bundled emoji list:',
      error
    );
    return defaultEmojiDataResolver(locale, {
      ...options,
      emojibaseUrl: EMOJI_DATA_CDN_URL,
    });
  }
};

/**
 * The Space's emoji on its detail page, beside the title. Clicking it opens
 * an emoji picker, with a way back to the first letter.
 */
export function SpaceEmojiPicker({
  space,
  name,
}: {
  space: Space;
  name: string;
}) {
  const { t, i18n } = useTranslation();
  const setSpaceEmoji = useSpaceStore((state) => state.setSpaceEmoji);
  const [open, setOpen] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const current = spaceEmoji(space);

  // Reading the list can still fail or hang, so the picker never waits on it
  // forever.
  const resolveEmojiData = useCallback<EmojiDataResolver>(
    async (locale, options) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          loadEmojiData(locale, options),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Timed out loading emoji data')),
              EMOJI_LOAD_TIMEOUT_MS
            );
          }),
        ]);
      } catch (error) {
        if (!options.signal?.aborted) setLoadFailed(true);
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
    []
  );

  const choose = (emoji: string | null) => {
    setOpen(false);
    if (emoji === current) return;
    setSpaceEmoji(space.id, emoji).catch((error: unknown) => {
      console.warn('[SpaceEmojiPicker] Failed to update the emoji:', error);
      toast.error(t('layout.space-emoji-update-failed'));
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('layout.space-emoji-change', { name })}
          data-space-emoji-picker
          className="flex size-ds-control-xl shrink-0 cursor-pointer items-center justify-center rounded-ds-compact-control border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-default-default text-ds-ink-default-default transition-colors outline-none hover:bg-ds-neutral-muted-default focus-visible:ring-2 focus-visible:ring-ds-ring-focus data-[state=open]:bg-ds-neutral-muted-default"
        >
          <SpaceGlyph name={name} emoji={current} size="lg" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-76 p-ds-8">
        <EmojiPicker.Root
          key={loadAttempt}
          className="flex h-80 w-full flex-col gap-ds-4"
          columns={9}
          emojibaseUrl={bundledEmojiDataUrl()}
          resolveEmojiData={resolveEmojiData}
          locale={EMOJI_LOCALES[i18n.language] ?? 'en'}
          onEmojiSelect={({ emoji }) => choose(emoji)}
        >
          <EmojiPicker.Search
            aria-label={t('layout.space-emoji-search')}
            placeholder={t('layout.space-emoji-search')}
            className="h-ds-control-sm w-full shrink-0 rounded-ds-field border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default px-ds-8 text-ds-text-base text-ds-ink-default-default outline-none placeholder:text-ds-ink-subtle-default focus-visible:ring-2 focus-visible:ring-ds-ring-focus"
          />
          <EmojiPicker.Viewport className="scrollbar-always-visible relative min-h-0 flex-1 outline-none">
            <EmojiPicker.Loading className="absolute inset-0 flex flex-col items-center justify-center gap-ds-8 px-ds-16 text-center text-ds-text-base text-ds-ink-muted-default">
              {loadFailed ? (
                <>
                  <span role="alert">
                    {t('layout.space-emoji-load-failed')}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setLoadFailed(false);
                      setLoadAttempt((attempt) => attempt + 1);
                    }}
                  >
                    {t('layout.retry')}
                  </Button>
                </>
              ) : (
                t('layout.space-emoji-loading')
              )}
            </EmojiPicker.Loading>
            <EmojiPicker.Empty className="absolute inset-0 flex items-center justify-center text-ds-text-base text-ds-ink-muted-default">
              {t('layout.space-emoji-empty')}
            </EmojiPicker.Empty>
            <EmojiPicker.List
              className="pb-ds-4 select-none"
              components={{ CategoryHeader, Row: EmojiRow, Emoji: EmojiButton }}
            />
          </EmojiPicker.Viewport>
        </EmojiPicker.Root>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-ds-4 w-full"
          disabled={current === null}
          onClick={() => choose(null)}
        >
          {t('layout.space-emoji-use-letter')}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
