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
import fontStacks from '@/style/fontStacks.json';
import loader from '@monaco-editor/loader';
import { DiffEditor, Editor } from '@monaco-editor/react';
import { ChevronRight, FileWarning } from 'lucide-react';
import * as monaco from 'monaco-editor';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  countLineChanges,
  languageForPath,
  type LineCounts,
} from './diffMetrics';
import { ReviewAccordionContent } from './ReviewAccordionContent';
import { decodeFileText, diffSidePaths } from './reviewContent';
import './reviewDiff.css';
import { MAX_DIFF_BYTES, type ReviewFile } from './useReviewChanges';

ensureMonacoWorkers();
loader.config({ monaco });

const MIN_EDITOR_HEIGHT = 72;
const MAX_EDITOR_HEIGHT = 520;

/** The `font-code` stack Tailwind builds from; Monaco needs it as a string. */
const CODE_FONT_FAMILY = fontStacks.code.join(', ');

const BASE_OPTIONS: monaco.editor.IEditorConstructionOptions = {
  readOnly: true,
  automaticLayout: true,
  minimap: { enabled: false },
  overviewRulerLanes: 0,
  scrollBeyondLastLine: false,
  scrollbar: { alwaysConsumeMouseWheel: false },
  contextmenu: false,
  folding: false,
  fontFamily: CODE_FONT_FAMILY,
  fontSize: 13,
  lineHeight: 19,
  lineNumbersMinChars: 4,
  renderLineHighlight: 'none',
  guides: { indentation: false },
};

const DIFF_OPTIONS: monaco.editor.IDiffEditorConstructionOptions = {
  ...BASE_OPTIONS,
  renderOverviewRuler: false,
  originalEditable: false,
  renderSideBySide: false,
  hideUnchangedRegions: { enabled: true, contextLineCount: 3 },
  diffAlgorithm: 'advanced',
};

const WHOLE_FILE_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  ...BASE_OPTIONS,
  occurrencesHighlight: 'off',
  selectionHighlight: false,
};

/** Content lines, ignoring the trailing newline most files end with. */
function countLines(text: string): number {
  if (!text) return 0;
  return text.replace(/\r?\n$/, '').split('\n').length;
}

export interface DiffFileCardProps {
  file: ReviewFile;
  selected: boolean;
  appearance: string;
  /**
   * Fold state the "collapse/expand all" control last asked for. The card
   * still owns its own state — this only re-applies when `foldNonce` changes,
   * so folding one card by hand does not get undone by a re-render.
   */
  foldAll?: boolean;
  foldNonce?: number;
}

interface DiffSides {
  original: string;
  modified: string;
}

function reviewModelPath(side: 'original' | 'modified', file: ReviewFile) {
  const encodedPath = file.path
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `review://${side}/${encodeURIComponent(file.id)}/${encodedPath}`;
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
  foldAll = false,
  foldNonce = 0,
}: DiffFileCardProps) {
  const { t } = useTranslation();
  const host = useHost();
  const contentId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [sides, setSides] = useState<DiffSides | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [counts, setCounts] = useState<LineCounts | null>(null);
  const [editorHeight, setEditorHeight] = useState(160);
  const wholeFileEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(
    null
  );
  const wholeFileDecorationsRef =
    useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const [wholeFileEditorGeneration, setWholeFileEditorGeneration] = useState(0);

  // Follow the toolbar's collapse/expand-all only when it is actually clicked.
  useEffect(() => {
    if (foldNonce === 0) return;
    setCollapsed(foldAll);
  }, [foldAll, foldNonce]);

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
    setSides(null);
    setLoadError(null);
    setCounts(null);
    setEditorHeight(160);
    if (file.inline) {
      setSides(file.inline);
      return;
    }
    // Sizes come from the backup scan, so an oversized file is rejected before
    // its bytes are read and shipped across IPC.
    if (file.tooLarge) {
      setLoadError('too_large');
      return;
    }
    if (file.binary) {
      setLoadError('binary');
      return;
    }
    let cancelled = false;
    if (file.loadContent) {
      file
        .loadContent()
        .then((content) => {
          if (!cancelled) setSides(content);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setLoadError(err instanceof Error ? err.message : String(err));
        });
      return () => {
        cancelled = true;
      };
    }
    const api = host?.electronAPI;
    if (!api?.readFile) return;

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
      const text = decodeFileText(result.data);
      if (text === null) throw new Error('binary');
      return text;
    };

    if (file.status === 'deleted' && !file.bakPath) {
      setLoadError('no_before_content');
      return;
    }
    const { original: originalPath, modified: modifiedPath } =
      diffSidePaths(file);

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

  const language = useMemo(
    () => languageForPath(file.path, monaco.languages.getLanguages()),
    [file.path]
  );

  /**
   * Which side to show on its own, uncompared: a file that only exists on one
   * side (added or deleted) has nothing to diff against. Monaco's empty model
   * still holds one blank line, so diffing against it reported a phantom
   * removed line ("−1") and drew a red blank row above the content.
   *
   * `tinted` says whether those lines are really all added/removed. A modified
   * file whose backup is missing also renders one-sided, but its lines are not
   * new — tinting them green (and counting them as additions) would contradict
   * the "M" marker, so it shows as plain content with a notice instead.
   */
  const wholeFileSide: 'modified' | 'original' | null = !sides
    ? null
    : file.beforeUnavailable
      ? 'modified'
      : !sides.original && sides.modified
        ? 'modified'
        : !sides.modified && sides.original
          ? 'original'
          : null;
  const wholeFileTinted = wholeFileSide !== null && !file.beforeUnavailable;

  const fitHeight = (contentHeight: number) =>
    setEditorHeight(
      Math.min(
        MAX_EDITOR_HEIGHT,
        Math.max(MIN_EDITOR_HEIGHT, contentHeight + 12)
      )
    );

  const handleMount = (editor: monaco.editor.IStandaloneDiffEditor) => {
    const applyMetrics = () => {
      const changes = editor.getLineChanges();
      // Null means no diff is available — either it has not been computed yet,
      // or the editor is being torn down because the card was collapsed. Both
      // fire a content-size change, so overwriting here would blank the header
      // counts of a folded card. Keep the last real measurement instead; an
      // unchanged file reports an empty array, not null.
      if (!changes) return;
      const models = editor.getModel();
      setCounts(
        countLineChanges(changes, {
          originalEmpty: models?.original.getValueLength() === 0,
          modifiedEmpty: models?.modified.getValueLength() === 0,
        })
      );
      fitHeight(editor.getModifiedEditor().getContentHeight());
    };
    editor.onDidUpdateDiff(applyMetrics);
    editor.getModifiedEditor().onDidContentSizeChange(applyMetrics);
  };

  const handleWholeFileMount = (
    editor: monaco.editor.IStandaloneCodeEditor
  ) => {
    wholeFileEditorRef.current = editor;
    // Any collection still held belongs to the editor this one replaces, which
    // is already disposed — clearing it later would touch a dead model.
    wholeFileDecorationsRef.current = null;
    fitHeight(editor.getContentHeight());
    editor.onDidContentSizeChange(() => fitHeight(editor.getContentHeight()));
    // A counter, not a flag: collapsing unmounts the editor, so re-expanding
    // has to re-run the decoration effect against the newly mounted one.
    setWholeFileEditorGeneration((generation) => generation + 1);
  };

  // Tint every line of a one-sided file the way the diff editor tints its own
  // inserted/deleted lines, and count them all as added or removed.
  useEffect(() => {
    const editor = wholeFileEditorRef.current;
    const model = editor?.getModel();
    if (!wholeFileSide || !editor || !model) return;
    wholeFileDecorationsRef.current?.clear();
    wholeFileDecorationsRef.current = null;
    if (!wholeFileTinted) {
      // Content whose baseline is unknown: show it plainly, and claim no counts.
      setCounts(null);
      return;
    }
    const lines = countLines(model.getValue());
    wholeFileDecorationsRef.current = editor.createDecorationsCollection([
      {
        range: new monaco.Range(1, 1, model.getLineCount(), 1),
        options: {
          isWholeLine: true,
          className:
            wholeFileSide === 'modified' ? 'line-insert' : 'line-delete',
        },
      },
    ]);
    setCounts(
      wholeFileSide === 'modified'
        ? { added: lines, removed: 0 }
        : { added: 0, removed: lines }
    );
  }, [wholeFileSide, wholeFileTinted, sides, wholeFileEditorGeneration]);

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

  // Shown above the content, which is still worth reading.
  const banner =
    file.beforeUnavailable && !loadError
      ? t('layout.review-before-unavailable', {
          defaultValue:
            'No saved copy of the original — showing the current file, not a diff.',
        })
      : null;

  // Replaces the content entirely: there is nothing to show.
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
      data-review-id={file.id}
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
        aria-controls={contentId}
        className="sticky top-0 z-10 flex h-9 w-full cursor-pointer items-center gap-2 border-0 border-b border-solid border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default px-3 text-left"
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-ds-icon-neutral-muted-default transition-transform duration-200 ease-out motion-reduce:transition-none',
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

      <ReviewAccordionContent open={!collapsed} id={contentId}>
        {notice ? (
          <div className="flex items-center gap-2 px-3 py-4 text-xs text-ds-text-neutral-muted-default">
            <FileWarning
              className="h-4 w-4 shrink-0 text-ds-icon-neutral-muted-default"
              aria-hidden
            />
            {notice}
          </div>
        ) : sides ? (
          <>
            {banner ? (
              <div className="flex items-center gap-2 border-0 border-b border-solid border-ds-border-neutral-subtle-default px-3 py-2 text-xs text-ds-text-neutral-muted-default">
                <FileWarning
                  className="h-3.5 w-3.5 shrink-0 text-ds-icon-neutral-muted-default"
                  aria-hidden
                />
                {banner}
              </div>
            ) : null}
            <div
              className="review-diff-surface"
              style={
                {
                  height: editorHeight,
                  // Hands reviewDiff.css the same stack Monaco measures with.
                  '--review-code-font': CODE_FONT_FAMILY,
                } as React.CSSProperties
              }
            >
              {wholeFileSide ? (
                <Editor
                  value={
                    wholeFileSide === 'modified'
                      ? sides.modified
                      : sides.original
                  }
                  language={language}
                  path={reviewModelPath(wholeFileSide, file)}
                  theme={appearance === 'light' ? 'vs' : 'vs-dark'}
                  options={WHOLE_FILE_OPTIONS}
                  onMount={handleWholeFileMount}
                  loading={
                    <div className="h-full w-full animate-pulse bg-ds-bg-neutral-subtle-default" />
                  }
                />
              ) : (
                <DiffEditor
                  original={sides.original}
                  modified={sides.modified}
                  language={language}
                  originalModelPath={reviewModelPath('original', file)}
                  modifiedModelPath={reviewModelPath('modified', file)}
                  theme={appearance === 'light' ? 'vs' : 'vs-dark'}
                  options={DIFF_OPTIONS}
                  onMount={handleMount}
                  loading={
                    <div className="h-full w-full animate-pulse bg-ds-bg-neutral-subtle-default" />
                  }
                />
              )}
            </div>
          </>
        ) : (
          <div className="h-24 w-full animate-pulse bg-ds-bg-neutral-subtle-default" />
        )}
      </ReviewAccordionContent>
    </div>
  );
}
