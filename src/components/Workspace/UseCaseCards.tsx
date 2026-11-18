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

import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { DS_FOCUS_RING } from '@/components/ui/semanticProps';
import { cn } from '@/lib/utils';
import { FolderSearch, Globe, Scale, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Testing override for when the starter use cases show, set from DevTools:
 * `localStorage.setItem('eigent.starterUseCases', 'show')` (or `'hide'`);
 * remove it to go back to the new-user rule.
 */
export const STARTER_USE_CASES_OVERRIDE_KEY = 'eigent.starterUseCases';

export function readStarterUseCasesOverride(): 'show' | 'hide' | null {
  try {
    const value = window.localStorage.getItem(STARTER_USE_CASES_OVERRIDE_KEY);
    return value === 'show' || value === 'hide' ? value : null;
  } catch {
    return null;
  }
}

/** Public catalogue of use cases on the website. */
export const USE_CASES_URL = 'https://www.eigent.ai/use-cases';

/**
 * Preview tint per card: the agent identity roles (document, browser,
 * workforce) at 5%, only to tell the cards apart. Icons keep full colour.
 */
const TONE_CLASSES = {
  document: {
    tile: 'bg-ds-bg-document-subtle-default/5',
    icon: 'text-ds-icon-document-default-default',
  },
  browser: {
    tile: 'bg-ds-bg-browser-subtle-default/5',
    icon: 'text-ds-icon-browser-default-default',
  },
  workforce: {
    tile: 'bg-ds-bg-workforce-subtle-default/5',
    icon: 'text-ds-icon-workforce-default-default',
  },
} as const;

interface UseCase {
  id: string;
  icon: LucideIcon;
  tone: keyof typeof TONE_CLASSES;
  /** Translation key prefix: `<key>-title`, `<key>-description`, `<key>-prompt`. */
  key: string;
}

export const STARTER_USE_CASES: readonly UseCase[] = [
  {
    id: 'explore-folder',
    icon: FolderSearch,
    tone: 'document',
    key: 'layout.use-case-explore-folder',
  },
  {
    id: 'meet-eigent',
    icon: Globe,
    tone: 'browser',
    key: 'layout.use-case-meet-eigent',
  },
  {
    id: 'choose-model',
    icon: Scale,
    tone: 'workforce',
    key: 'layout.use-case-choose-model',
  },
];

export interface UseCaseCardsProps {
  /** Puts the use case's prompt in the composer. */
  onSelectPrompt: (prompt: string) => void;
  /** Shows every use case ({@link USE_CASES_URL}), in the Session's preview. */
  onViewMore: () => void;
}

/**
 * Starter tasks under the new-session composer: three cards that each fill
 * the composer with a ready-made prompt, and "View more" for every use case
 * on eigent.ai. From 36rem of column width the cards sit in a row with a
 * preview tile; narrower, they become compact rows of icon and name.
 */
export function UseCaseCards({
  onSelectPrompt,
  onViewMore,
}: UseCaseCardsProps) {
  const { t } = useTranslation();
  const headingId = 'workspace-use-cases-heading';

  return (
    <section
      aria-labelledby={headingId}
      data-workspace-use-cases
      className="flex w-full min-w-0 flex-col gap-ds-12"
    >
      {/* Lined up with the composer's actions above: 24px puts the heading
          at the "+" glyph (16px inset, 28px button, 16px icon), and 6px plus
          the text button's 10px padding ends "View more" at the send button's
          edge. */}
      <div className="flex min-w-0 items-center justify-between gap-ds-12 pr-ds-6 pl-ds-24">
        <h2
          id={headingId}
          className="m-0 min-w-0 truncate text-ds-text-base font-semibold text-ds-ink-muted-default"
        >
          {t('layout.use-cases-title')}
        </h2>
        <Button
          type="button"
          variant="text"
          size="sm"
          data-workspace-use-cases-view-more
          className="shrink-0"
          onClick={onViewMore}
        >
          {t('layout.use-cases-view-more')}
        </Button>
      </div>

      {/* Narrow column: three compact rows (icon tile + name). From 36rem:
          three cards in a row with a preview tile and a description. */}
      <ul className="m-0 grid list-none grid-cols-1 gap-ds-8 p-0 @min-[36rem]:grid-cols-3 @min-[36rem]:gap-ds-12">
        {STARTER_USE_CASES.map((useCase) => {
          const tone = TONE_CLASSES[useCase.tone];
          const title = t(`${useCase.key}-title`);
          return (
            <li key={useCase.id} className="flex min-w-0">
              <button
                type="button"
                data-use-case={useCase.id}
                onClick={() => onSelectPrompt(t(`${useCase.key}-prompt`))}
                className={cn(
                  'group flex w-full min-w-0 cursor-pointer flex-row items-center gap-ds-10 overflow-hidden rounded-ds-menu-row border border-x border-y border-solid border-ds-hairline-subtle-default bg-transparent p-ds-4 text-left',
                  '@min-[36rem]:flex-col @min-[36rem]:items-stretch @min-[36rem]:gap-0 @min-[36rem]:rounded-ds-card',
                  'transition-[background-color,border-color,transform] duration-150 ease-out hover:border-ds-hairline-default-default hover:bg-ds-neutral-subtle-default active:scale-[0.98]',
                  'motion-reduce:transition-none motion-reduce:active:scale-100',
                  DS_FOCUS_RING
                )}
              >
                {/* Radii nest with the 4px inset: a 12px row holds an 8px
                    tile; a 16px card holds a 12px media tile. */}
                <span
                  aria-hidden
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-ds-compact-control',
                    '@min-[36rem]:h-20 @min-[36rem]:w-full @min-[36rem]:rounded-ds-media',
                    tone.tile
                  )}
                >
                  <DsIcon
                    icon={useCase.icon}
                    className={cn(tone.icon, '@min-[36rem]:hidden')}
                  />
                  <DsIcon
                    icon={useCase.icon}
                    recipe="illustration"
                    illustrationSize={32}
                    className={cn(tone.icon, 'hidden @min-[36rem]:block')}
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-ds-2 @min-[36rem]:px-ds-8 @min-[36rem]:pt-ds-10 @min-[36rem]:pb-ds-8">
                  <span className="truncate text-ds-text-base font-semibold text-ds-ink-default-default">
                    {title}
                  </span>
                  <span className="hidden text-ds-text-meta text-ds-ink-muted-default @min-[36rem]:line-clamp-2">
                    {t(`${useCase.key}-description`)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
