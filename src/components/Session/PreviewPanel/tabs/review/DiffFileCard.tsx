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

import { useHost } from '@/host';
import { ensureMonacoWorkers } from '@/lib/monacoWorkers';
import { cn } from '@/lib/utils';
import loader from '@monaco-editor/loader';
import { DiffEditor } from '@monaco-editor/react';
import { ChevronRight, FileWarning } from 'lucide-react';
import * as monaco from 'monaco-editor';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReviewFile } from './useReviewChanges';

ensureMonacoWorkers();
loader.config({ monaco });

/** Files above this size are not diffed (keeps Monaco responsive). */
const MAX_DIFF_BYTES = 2_000_000;
const MIN_EDITOR_HEIGHT = 72;
const MAX_EDITOR_HEIGHT = 520;

const DIFF_OPTIONS: monaco.editor.IDiffEditorConstructionOptions = {
  readOnly: true,
  originalEditable: false,
  renderSideBySide: false,
  hideUnchangedRegions: { enabled: true, contextLineCount: 3 },
  diffAlgorithm: 'advanced',
  automaticLayout: true,
  minimap: { enabled: false },
  overviewRulerLanes: 0,
  renderOverviewRuler: false,
  scrollBeyondLastLine: false,
  scrollbar: { alwaysConsumeMouseWheel: false },
  contextmenu: false,
  folding: false,
  fontSize: 12,
  lineNumbersMinChars: 4,
  renderLineHighlight: 'none',
  guides: { indentation: false },
};

export interface DiffFileCardProps {
  file: ReviewFile;
  selected: boolean;
  appearance: string;
}

interface DiffSides {
  original: string;
  modified: string;
}

interface LineCounts {
  added: number;
  removed: number;
}

function decodeText(data: unknown): string | null {
  if (!(data instanceof Uint8Array)) {
    return typeof data === 'string' ? data : null;
  }
  const probe = data.subarray(0, 8000);
  for (const byte of probe) {
    if (byte === 0) return null; // binary
  }
  return new TextDecoder('utf-8').decode(data);
}

/**
 * One changed file: sticky path header plus a read-only inline Monaco diff
 * (the file's earliest backup vs its current on-disk content). The editor
 * mounts lazily when the card first approaches the viewport.
 */
export function DiffFileCard({
  file,
  selected,
  appearance,
}: DiffFileCardProps) {
  const { t } = useTranslation();
  const host = useHost();
  const containerRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [sides, setSides] = useState<DiffSides | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [counts, setCounts] = useState<LineCounts | null>(null);
  const [editorHeight, setEditorHeight] = useState(160);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!nearViewport) return;
    if (file.inline) {
      setSides(file.inline);
      return;
    }
    const api = host?.electronAPI;
    if (!api?.readFile) return;
    let cancelled = false;

    const readSide = async (path: string | null): Promise<string> => {
      if (!path) return '';
      const result = await api.readFile(path);
      if (!result?.success) {
        // A missing original for an added file (or missing source for a
        // deletion) is expected — everything else is a real load failure.
        throw new Error(result?.error || 'Failed to read file');
      }
      if (typeof result.size === 'number' && result.size > MAX_DIFF_BYTES) {
        throw new Error('too_large');
      }
      const text = decodeText(result.data);
      if (text === null) throw new Error('binary');
      return text;
    };

    // Before = the earliest backup the file toolkit left; after = the file on
    // disk now. Added files have no backup, deleted files no current content.
    if (file.status === 'deleted' && !file.bakPath) {
      setLoadError('no_before_content');
      return;
    }
    const originalPath = file.status === 'added' ? null : file.bakPath;
    const modifiedPath = file.status === 'deleted' ? null : file.absPath;

    Promise.all([readSide(originalPath), readSide(modifiedPath)])
      .then(([original, modified]) => {
        if (!cancelled) setSides({ original, modified });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setLoadError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [nearViewport, host, file]);

  const handleMount = (editor: monaco.editor.IStandaloneDiffEditor) => {
    const applyMetrics = () => {
      const changes = editor.getLineChanges();
      if (changes) {
        let added = 0;
        let removed = 0;
        for (const change of changes) {
          if (change.modifiedEndLineNumber >= change.modifiedStartLineNumber)
            added +=
              change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1;
          if (change.originalEndLineNumber >= change.originalStartLineNumber)
            removed +=
              change.originalEndLineNumber - change.originalStartLineNumber + 1;
        }
        setCounts({ added, removed });
      }
      const contentHeight = editor.getModifiedEditor().getContentHeight();
      setEditorHeight(
        Math.min(
          MAX_EDITOR_HEIGHT,
          Math.max(MIN_EDITOR_HEIGHT, contentHeight + 12)
        )
      );
    };
    editor.onDidUpdateDiff(applyMetrics);
    editor.getModifiedEditor().onDidContentSizeChange(applyMetrics);
  };

  const statusMeta: Record<
    ReviewFile['status'],
    { letter: string; className: string }
  > = {
    added: { letter: 'A', className: 'text-ds-text-success-default-default' },
    modified: {
      letter: 'M',
      className: 'text-ds-text-warning-default-default',
    },
    deleted: { letter: 'D', className: 'text-ds-text-error-default-default' },
  };
  const status = statusMeta[file.status];
  const lastSlash = file.path.lastIndexOf('/');
  const dirName = lastSlash >= 0 ? file.path.slice(0, lastSlash + 1) : '';
  const baseName = lastSlash >= 0 ? file.path.slice(lastSlash + 1) : file.path;

  const notice =
    loadError === 'binary'
      ? t('layout.review-binary-file', {
          defaultValue: 'Binary file — no text diff available.',
        })
      : loadError === 'too_large'
        ? t('layout.review-file-too-large', {
            defaultValue: 'File is too large to diff.',
          })
        : loadError === 'no_before_content'
          ? t('layout.review-no-before-content', {
              defaultValue:
                'This file was deleted and no backup of its content exists.',
            })
          : loadError
            ? t('layout.review-file-load-failed', {
                defaultValue: 'Could not load this file: {{message}}',
                message: loadError,
              })
            : null;

  return (
    <div
      ref={containerRef}
      data-review-path={file.path}
      className={cn(
        'overflow-hidden rounded-xl border border-solid bg-ds-bg-neutral-default-default',
        selected
          ? 'border-ds-border-neutral-strong-default'
          : 'border-ds-border-neutral-subtle-default'
      )}
    >
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
        className="sticky top-0 z-10 flex h-9 w-full cursor-pointer items-center gap-2 border-0 border-b border-solid border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default px-3 text-left"
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-ds-icon-neutral-muted-default transition-transform duration-300',
            !collapsed && 'rotate-90'
          )}
          aria-hidden
        />
        <span
          className={cn('w-3 shrink-0 text-xs font-bold', status.className)}
          aria-label={file.status}
        >
          {status.letter}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ds-text-neutral-default-default">
          <span className="text-ds-text-neutral-muted-default">{dirName}</span>
          {baseName}
        </span>
        {counts && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium">
            <span className="text-ds-text-success-default-default">
              +{counts.added}
            </span>
            <span className="text-ds-text-error-default-default">
              −{counts.removed}
            </span>
          </span>
        )}
      </button>

      {!collapsed && (
        <div className="w-full">
          {notice ? (
            <div className="flex items-center gap-2 px-3 py-4 text-xs text-ds-text-neutral-muted-default">
              <FileWarning
                className="h-4 w-4 shrink-0 text-ds-icon-neutral-muted-default"
                aria-hidden
              />
              {notice}
            </div>
          ) : sides ? (
            <div style={{ height: editorHeight }}>
              <DiffEditor
                original={sides.original}
                modified={sides.modified}
                originalModelPath={`review://original/${file.path}`}
                modifiedModelPath={`review://modified/${file.path}`}
                theme={appearance === 'light' ? 'vs' : 'vs-dark'}
                options={DIFF_OPTIONS}
                onMount={handleMount}
                loading={
                  <div className="h-full w-full animate-pulse bg-ds-bg-neutral-subtle-default" />
                }
              />
            </div>
          ) : (
            <div className="h-24 w-full animate-pulse bg-ds-bg-neutral-subtle-default" />
          )}
        </div>
      )}
    </div>
  );
}
