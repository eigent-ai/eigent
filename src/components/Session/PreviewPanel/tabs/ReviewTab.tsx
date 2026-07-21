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
import { TooltipSimple } from '@/components/ui/tooltip';
import { useHost } from '@/host';
import { useAuthStore } from '@/store/authStore';
import { ClipboardCheck, RefreshCw } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DiffFileCard } from './review/DiffFileCard';
import { ReviewFileTree } from './review/ReviewFileTree';
import { useReviewChanges } from './review/useReviewChanges';

/**
 * Read-only change showcase: every file the agents changed in this project,
 * shown as before-vs-after diffs (the file toolkit's backup vs the file on
 * disk now). Left is a stacked file-by-file diff view; right is the
 * changed-file tree. This is not an approval surface — undoing changes is a
 * separate (future) rewind feature.
 */
export function ReviewTab() {
  const { t } = useTranslation();
  const host = useHost();
  const appearance = useAuthStore((state) => state.appearance);
  const { loading, files, refresh } = useReviewChanges();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const isDesktop = Boolean(host?.electronAPI?.readFile);

  const handleSelect = useCallback((path: string) => {
    setSelectedPath(path);
    stackRef.current
      ?.querySelector(`[data-review-path=${CSS.escape(path)}]`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  // Diffing real changes reads files from disk, which needs the desktop
  // host. Inline (fixture) diffs render anywhere.
  const needsDisk = files.some((file) => !file.inline);
  if (!isDesktop && needsDisk) {
    return (
      <CenteredNotice
        message={t('layout.review-desktop-only', {
          defaultValue: 'Change review is available in the desktop app.',
        })}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex h-full min-h-0 w-full gap-2 overflow-hidden p-3">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="h-28 animate-pulse rounded-lg bg-ds-bg-neutral-default-default" />
          <div className="h-28 animate-pulse rounded-lg bg-ds-bg-neutral-default-default" />
        </div>
        <div className="w-[248px] shrink-0 animate-pulse rounded-lg bg-ds-bg-neutral-default-default" />
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <CenteredNotice
        message={t('layout.review-empty', {
          defaultValue: 'No file changes in this project yet.',
        })}
        detail={t('layout.review-empty-hint', {
          defaultValue:
            'Files written by agents will appear here as before / after diffs.',
        })}
        action={
          <Button type="button" variant="outline" size="sm" onClick={refresh}>
            {t('layout.review-refresh', { defaultValue: 'Refresh' })}
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center gap-2 border-0 border-b border-solid border-ds-border-neutral-subtle-default px-3">
        <span className="text-xs font-medium text-ds-text-neutral-default-default">
          {t('layout.review-changed-files', {
            defaultValue: '{{count}} changed files',
            count: files.length,
          })}
        </span>
        <div className="flex-1" />
        <TooltipSimple
          content={t('layout.review-refresh', { defaultValue: 'Refresh' })}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            onClick={refresh}
            aria-label={t('layout.review-refresh', {
              defaultValue: 'Refresh',
            })}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </TooltipSimple>
      </div>

      <div className="flex min-h-0 w-full flex-1 overflow-hidden">
        {/* Right padding comes from the always-visible 8px scrollbar gutter;
            the left padding matches it so the stack reads centered. */}
        <div
          ref={stackRef}
          className="scrollbar-always-visible flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto py-3 pl-2"
        >
          {files.map((file) => (
            <DiffFileCard
              key={file.path}
              file={file}
              selected={file.path === selectedPath}
              appearance={appearance}
            />
          ))}
        </div>
        <ReviewFileTree
          files={files}
          selectedPath={selectedPath}
          onSelect={handleSelect}
        />
      </div>
    </div>
  );
}

function CenteredNotice({
  message,
  detail,
  action,
}: {
  message: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-2 px-6 text-center">
      <ClipboardCheck
        className="h-8 w-8 text-ds-icon-neutral-muted-default"
        aria-hidden
      />
      <p className="text-sm text-ds-text-neutral-default-default">{message}</p>
      {detail && (
        <p className="max-w-[380px] text-xs text-ds-text-neutral-muted-default">
          {detail}
        </p>
      )}
      {action}
    </div>
  );
}

export default ReviewTab;
