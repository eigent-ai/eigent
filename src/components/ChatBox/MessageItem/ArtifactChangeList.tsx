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
import { cn } from '@/lib/utils';
import { getWorkspaceRelativeFilePath } from '@/lib/workspaceRelativePath';
import { ChevronDown, FileDiff } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface ArtifactLineChanges {
  added: number;
  removed: number;
}

export interface ArtifactChangeListProps {
  files?: FileInfo[];
  onOpen: (file: FileInfo) => void;
  onViewChanges?: () => void;
  canOpenFile?: (file: FileInfo) => boolean;
  lineChangesForFile?: (file: FileInfo) => ArtifactLineChanges | null;
  totals?: ArtifactLineChanges | null;
  scanStatus?: string;
  truncated?: boolean;
}

/** Run-scoped artifact delta. Every item opens in the existing preview panel. */
export function ArtifactChangeList({
  files,
  onOpen,
  onViewChanges,
  canOpenFile = () => true,
  lineChangesForFile,
  totals,
  scanStatus = 'complete',
  truncated = false,
}: ArtifactChangeListProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const fileItems = files || [];
  const scanWarning = truncated
    ? 'This Run changed more files than the bounded scan could list. The files shown below are a partial durable manifest.'
    : scanStatus === 'workspace_unavailable'
      ? 'The original local workspace is unavailable. This durable file manifest may be incomplete.'
      : scanStatus === 'workspace_mismatch'
        ? 'The recorded workspace no longer matches this Run. File discovery was not completed.'
        : scanStatus !== 'complete'
          ? `File discovery completed with status: ${scanStatus}.`
          : null;
  if (!fileItems.length && !scanWarning) return null;

  const collapsedCount = 3;
  const hiddenCount = Math.max(0, fileItems.length - collapsedCount);
  const visibleFiles = isExpanded
    ? fileItems
    : fileItems.slice(0, collapsedCount);

  return (
    <section className="my-3 overflow-hidden rounded-ds-card border border-x border-y border-solid border-ds-hairline-default-default bg-ds-neutral-subtle-default">
      <div className="flex items-center gap-3 border-x-0 border-t-0 border-b border-solid border-ds-hairline-default-default bg-ds-neutral-default-default px-4 py-3">
        <span className="flex size-ds-control-xl shrink-0 items-center justify-center rounded-ds-menu-row bg-ds-neutral-strong-default text-ds-ink-default-default">
          <DsIcon icon={FileDiff} recipe="detailed" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-ds-text-base font-semibold text-ds-ink-default-default">
            {t('chat.files-edited', {
              count: fileItems.length,
              defaultValue_one: 'Edited {{count}} file',
              defaultValue_other: 'Edited {{count}} files',
            })}
          </span>
          {totals ? (
            <span className="inline-flex items-center gap-1.5 text-ds-text-meta font-medium tabular-nums">
              <span className="text-ds-text-success-default-default">
                +{totals.added}
              </span>
              <span className="text-ds-text-error-default-default">
                −{totals.removed}
              </span>
            </span>
          ) : null}
        </div>
        {onViewChanges && fileItems.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            buttonContent="text"
            onClick={onViewChanges}
            className="ml-auto"
          >
            {t('layout.review', { defaultValue: 'Review' })}
          </Button>
        ) : null}
      </div>
      {scanWarning ? (
        <div className="border-x-0 border-t-0 border-b border-ds-border-warning-default-default bg-ds-bg-warning-subtle-default px-4 py-2 text-ds-text-meta text-ds-text-warning-strong-default">
          {scanWarning}
        </div>
      ) : null}
      <div className="flex flex-col">
        {visibleFiles.map((file, fileIndex) => {
          const detail = getWorkspaceRelativeFilePath(file);
          const lastSlash = detail.lastIndexOf('/');
          const directory =
            lastSlash >= 0 ? detail.slice(0, lastSlash + 1) : '';
          const baseName =
            lastSlash >= 0 ? detail.slice(lastSlash + 1) : detail;
          const canOpen = canOpenFile(file);
          const lineChanges = lineChangesForFile?.(file) ?? null;
          const changeLabel =
            file.artifactChange === 'generated'
              ? 'Generated'
              : file.artifactChange === 'changed'
                ? 'Changed'
                : file.type || 'File';
          const contents = (
            <>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate !text-ds-text-base font-normal text-ds-ink-default-default',
                  canOpen && 'group-hover:underline'
                )}
              >
                <span className="text-ds-ink-muted-default">{directory}</span>
                {baseName}
              </span>
              {lineChanges ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-ds-text-base font-medium tabular-nums">
                  <span className="text-ds-text-success-default-default">
                    +{lineChanges.added}
                  </span>
                  <span className="text-ds-text-error-default-default">
                    −{lineChanges.removed}
                  </span>
                </span>
              ) : (
                <span className="shrink-0 text-ds-text-meta font-medium text-ds-ink-muted-default">
                  {changeLabel}
                </span>
              )}
            </>
          );
          const rowClassName = cn(
            'flex min-h-ds-control-xl w-full min-w-0 items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-ds-neutral-default-hover',
            canOpen && 'group'
          );
          return canOpen ? (
            <button
              type="button"
              key={`artifact-${detail}-${fileIndex}`}
              title={detail}
              data-artifact-preview="available"
              onClick={() => onOpen(file)}
              className={rowClassName}
            >
              {contents}
            </button>
          ) : (
            <div
              aria-disabled="true"
              key={`artifact-${detail}-${fileIndex}`}
              title={detail}
              data-artifact-preview="unavailable"
              className={rowClassName}
            >
              {contents}
            </div>
          );
        })}
        {hiddenCount > 0 ? (
          <button
            type="button"
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((value) => !value)}
            className="mt-1 flex items-center gap-1 px-4 py-3 text-ds-text-base font-semibold text-ds-ink-default-default transition-colors hover:bg-ds-neutral-default-default"
          >
            {isExpanded
              ? t('chat.show-fewer-files', {
                  defaultValue: 'Show fewer files',
                })
              : t('chat.show-more-files', {
                  count: hiddenCount,
                  defaultValue_one: 'Show {{count}} more file',
                  defaultValue_other: 'Show {{count}} more files',
                })}
            <ChevronDown
              size={15}
              aria-hidden
              className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            />
          </button>
        ) : null}
      </div>
    </section>
  );
}
