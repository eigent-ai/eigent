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

import { cn } from '@/lib/utils';
import { getWorkspaceRelativeFilePath } from '@/lib/workspaceRelativePath';
import { ChevronDown, FileDiff, FileText } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface ArtifactChangeListProps {
  files?: FileInfo[];
  onOpen: (file: FileInfo) => void;
  onViewChanges?: () => void;
  canOpenFile?: (file: FileInfo) => boolean;
  scanStatus?: string;
  truncated?: boolean;
}

/** Run-scoped artifact delta. Every item opens in the existing preview panel. */
export function ArtifactChangeList({
  files,
  onOpen,
  onViewChanges,
  canOpenFile = () => true,
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
    <section className="my-3 overflow-hidden rounded-xl border border-x border-y border-solid border-ds-hairline-default-default bg-ds-neutral-subtle-default">
      <div className="flex items-center gap-2 border-x-0 border-t-0 border-b-[1px] border-solid border-ds-hairline-default-default bg-ds-neutral-default-default px-4 py-3">
        <span className="flex size-4 shrink-0 items-center justify-center rounded-lg bg-ds-neutral-strong-default text-ds-ink-default-default">
          <FileText size={18} aria-hidden />
        </span>
        <span className="text-ds-text-base font-semibold text-ds-ink-default-default">
          {t('chat.files-changed')}
        </span>
        <span className="text-ds-text-base font-medium text-ds-text-success-default-default">
          {fileItems.length}
        </span>
        {onViewChanges && fileItems.length > 0 ? (
          <button
            type="button"
            onClick={onViewChanges}
            className="ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-x border-y border-solid border-ds-hairline-default-default bg-ds-neutral-subtle-default px-2.5 text-ds-text-meta font-medium text-ds-ink-default-default transition-colors hover:bg-ds-neutral-default-hover active:shadow-ds-elevation-control-pressed"
          >
            <FileDiff size={14} aria-hidden />
            {t('chat.view-changes')}
          </button>
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
          const canOpen = canOpenFile(file);
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
                  'min-w-0 flex-1 truncate !text-ds-text-base font-medium text-ds-ink-default-default',
                  canOpen && 'group-hover:underline'
                )}
              >
                {detail}
              </span>
              <span className="shrink-0 text-ds-text-meta font-semibold text-ds-text-success-default-default">
                {changeLabel}
              </span>
            </>
          );
          const rowClassName = cn(
            'flex w-full min-w-0 items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-ds-neutral-default-default',
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
