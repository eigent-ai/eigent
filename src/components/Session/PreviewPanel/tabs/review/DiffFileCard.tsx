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

import ContentHeader from '@/components/Layout/ContentHeader';
import { DsIcon } from '@/components/ui/ds-icon';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useHost } from '@/host';
import {
  CODE_FONT_FAMILY,
  READ_ONLY_CODE_OPTIONS,
  codeThemeForAppearance,
  languageForPath,
  registerCodeThemes,
} from '@/lib/codePresentation';
import { ensureMonacoWorkers } from '@/lib/monacoWorkers';
import { formatFileSize } from '@/shared/filePreviewContract';
import type {
  ReviewLineSelection,
  SessionReviewComment,
} from '@/store/pageTabStore';
import loader from '@monaco-editor/loader';
import {
  DiffEditor,
  Editor,
  type DiffEditorProps,
  type DiffOnMount,
} from '@monaco-editor/react';
import { CodeXml, Eye, FileWarning } from 'lucide-react';
import * as monaco from 'monaco-editor';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { countLineChanges, type LineCounts } from './diffMetrics';
import { releaseDiffEditorModels } from './monacoModelLifecycle';
import {
  decodeFileText,
  diffSidePaths,
  isRasterImagePreviewPath,
} from './reviewContent';
import { SemanticDiffView, semanticDiffKindForPath } from './SemanticDiffView';
import { MAX_DIFF_BYTES, type ReviewFile } from './useReviewChanges';

ensureMonacoWorkers();
loader.config({ monaco });
registerCodeThemes(monaco);

export type DiffViewMode = 'inline' | 'split';

export interface DiffFileCardHandle {
  goToDiff: (target: 'next' | 'previous') => void;
  revealSelection: (selection: ReviewLineSelection) => void;
}

export type ReviewSelection = ReviewLineSelection;

export interface DiffFileCardProps {
  file: ReviewFile;
  appearance: string;
  viewMode: DiffViewMode;
  wordWrap: boolean;
  comments?: readonly SessionReviewComment[];
  headerActions?: ReactNode;
  onSelectionChange?: (selection: ReviewSelection | null) => void;
  onCommentRequest?: (selection: ReviewSelection) => void;
}

interface DiffSides {
  original: string;
  modified: string;
}

const WHOLE_FILE_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  ...READ_ONLY_CODE_OPTIONS,
  glyphMargin: true,
  lineDecorationsWidth: 22,
  occurrencesHighlight: 'off',
  selectionHighlight: false,
};

function countLines(text: string): number {
  if (!text) return 0;
  return text.replace(/\r?\n$/, '').split('\n').length;
}

function reviewModelPath(side: 'original' | 'modified', file: ReviewFile) {
  const encodedPath = file.path
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `review://${side}/${encodeURIComponent(file.id)}/${encodedPath}`;
}

interface ReviewDiffEditorProps extends DiffEditorProps {
  onDispose?: (editor: monaco.editor.IStandaloneDiffEditor) => void;
}

/** Owns model cleanup until @monaco-editor/react fixes its disposal order. */
function ReviewDiffEditor({
  onMount,
  onDispose,
  ...props
}: ReviewDiffEditorProps) {
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const onDisposeRef = useRef(onDispose);

  useLayoutEffect(() => {
    onDisposeRef.current = onDispose;
  }, [onDispose]);

  useLayoutEffect(
    () => () => {
      const editor = editorRef.current;
      editorRef.current = null;
      if (!editor) return;
      releaseDiffEditorModels(editor);
      onDisposeRef.current?.(editor);
    },
    []
  );

  const handleMount: DiffOnMount = (editor, monacoApi) => {
    editorRef.current = editor;
    onMount?.(editor, monacoApi);
  };

  return (
    <DiffEditor
      {...props}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      onMount={handleMount}
    />
  );
}

/** One active changed file rendered as a full-height review workbench. */
export const DiffFileCard = forwardRef<DiffFileCardHandle, DiffFileCardProps>(
  function DiffFileCard(
    {
      file,
      appearance,
      viewMode,
      wordWrap,
      comments = [],
      headerActions,
      onSelectionChange,
      onCommentRequest,
    },
    ref
  ) {
    const { t } = useTranslation();
    const host = useHost();
    const semanticKind = semanticDiffKindForPath(file.path);
    const [displayMode, setDisplayMode] = useState<'source' | 'preview'>(() =>
      semanticKind === 'image' ? 'preview' : 'source'
    );
    const [sides, setSides] = useState<DiffSides | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [counts, setCounts] = useState<LineCounts | null>(null);
    const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(
      null
    );
    const diffCommentDecorationsRef = useRef<{
      original: monaco.editor.IEditorDecorationsCollection;
      modified: monaco.editor.IEditorDecorationsCollection;
    } | null>(null);
    const wholeFileEditorRef =
      useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const wholeFileDecorationsRef =
      useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
    const wholeFileCommentDecorationsRef =
      useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
    const [diffEditorGeneration, setDiffEditorGeneration] = useState(0);
    const [wholeFileEditorGeneration, setWholeFileEditorGeneration] =
      useState(0);

    useImperativeHandle(
      ref,
      () => ({
        goToDiff(target) {
          if (diffEditorRef.current) {
            diffEditorRef.current.goToDiff(target);
            diffEditorRef.current.getModifiedEditor().focus();
            return;
          }
          const editor = wholeFileEditorRef.current;
          if (!editor) return;
          const lineNumber =
            target === 'next' ? 1 : (editor.getModel()?.getLineCount() ?? 1);
          editor.revealLineInCenter(lineNumber);
          editor.setPosition({ lineNumber, column: 1 });
          editor.focus();
        },
        revealSelection(selection) {
          const diffEditor = diffEditorRef.current;
          const editor = diffEditor
            ? selection.side === 'original'
              ? diffEditor.getOriginalEditor()
              : diffEditor.getModifiedEditor()
            : wholeFileEditorRef.current;
          const model = editor?.getModel();
          if (!editor || !model) return;
          const startLine = Math.min(
            Math.max(selection.startLine, 1),
            model.getLineCount()
          );
          const endLine = Math.min(
            Math.max(selection.endLine, startLine),
            model.getLineCount()
          );
          editor.revealLinesInCenter(startLine, endLine);
          editor.setSelection(
            new monaco.Selection(
              startLine,
              1,
              endLine,
              model.getLineMaxColumn(endLine)
            )
          );
          editor.focus();
        },
      }),
      []
    );

    useEffect(() => {
      if (displayMode !== 'preview') return;
      onSelectionChange?.(null);
      // @monaco-editor/react disposes the editor when Preview replaces Source,
      // but exposes no unmount callback. Drop every imperative handle here so
      // comment updates cannot target a disposed model while Preview is open.
      diffEditorRef.current = null;
      diffCommentDecorationsRef.current = null;
      wholeFileEditorRef.current = null;
      wholeFileDecorationsRef.current = null;
      wholeFileCommentDecorationsRef.current = null;
    }, [displayMode, onSelectionChange]);

    useEffect(() => {
      setSides(null);
      setLoadError(null);
      setCounts(null);
      diffEditorRef.current = null;
      diffCommentDecorationsRef.current = null;
      wholeFileEditorRef.current = null;
      wholeFileDecorationsRef.current = null;
      wholeFileCommentDecorationsRef.current = null;
      onSelectionChange?.(null);

      if (file.inline) {
        setSides(file.inline);
        return;
      }
      if (file.previewTooLarge) {
        setLoadError('preview_too_large');
        return;
      }
      if (file.tooLarge) {
        setLoadError('too_large');
        return;
      }
      // Raster images are loaded by ImageDiff as object URLs. Avoid reading
      // them through the text-diff path (and its intentionally smaller cap).
      if (isRasterImagePreviewPath(file.path)) return;
      if (file.binary) {
        if (semanticKind !== 'image') setLoadError('binary');
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
            if (!cancelled) {
              setLoadError(err instanceof Error ? err.message : String(err));
            }
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
          throw new Error(
            result?.error ||
              t('layout.review-file-read-failed', {
                defaultValue: 'Failed to read file',
              })
          );
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
          if (!cancelled) {
            setLoadError(err instanceof Error ? err.message : String(err));
          }
        });
      return () => {
        cancelled = true;
      };
    }, [file, host, onSelectionChange, semanticKind, t]);

    const language = useMemo(
      () => languageForPath(file.path, monaco.languages.getLanguages()),
      [file.path]
    );
    const codeTheme = codeThemeForAppearance(appearance);
    const diffOptions = useMemo<monaco.editor.IDiffEditorConstructionOptions>(
      () => ({
        ...READ_ONLY_CODE_OPTIONS,
        wordWrap: wordWrap ? 'on' : 'off',
        glyphMargin: true,
        lineDecorationsWidth: 22,
        renderOverviewRuler: false,
        originalEditable: false,
        renderSideBySide: viewMode === 'split',
        useInlineViewWhenSpaceIsLimited: true,
        hideUnchangedRegions: { enabled: true, contextLineCount: 3 },
        diffAlgorithm: 'advanced',
      }),
      [viewMode, wordWrap]
    );
    const wholeFileOptions =
      useMemo<monaco.editor.IStandaloneEditorConstructionOptions>(
        () => ({ ...WHOLE_FILE_OPTIONS, wordWrap: wordWrap ? 'on' : 'off' }),
        [wordWrap]
      );

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

    const reviewSelectionFor = (
      side: 'original' | 'modified',
      codeEditor: monaco.editor.IStandaloneCodeEditor,
      selection: monaco.Selection
    ): ReviewSelection | null => {
      const model = codeEditor.getModel();
      if (!model) return null;
      const startLine = Math.min(
        selection.startLineNumber,
        selection.endLineNumber
      );
      let endLine = Math.max(
        selection.startLineNumber,
        selection.endLineNumber
      );
      if (endLine > startLine && selection.getEndPosition().column === 1) {
        endLine -= 1;
      }
      return {
        side,
        startLine,
        endLine,
        text: model.getValueInRange(
          new monaco.Range(
            startLine,
            1,
            endLine,
            model.getLineMaxColumn(endLine)
          )
        ),
      };
    };

    const bindCommenting = (
      side: 'original' | 'modified',
      codeEditor: monaco.editor.IStandaloneCodeEditor
    ) => {
      const hoverDecorations = codeEditor.createDecorationsCollection();
      let hoveredLine: number | null = null;
      let commentDragStartLine: number | null = null;
      let commentDragEndLine: number | null = null;

      const selectWholeLines = (
        startLine: number,
        endLine: number
      ): ReviewSelection | null => {
        const model = codeEditor.getModel();
        if (!model) return null;
        const firstLine = Math.min(startLine, endLine);
        const lastLine = Math.max(startLine, endLine);
        const selected = new monaco.Selection(
          firstLine,
          1,
          lastLine,
          model.getLineMaxColumn(lastLine)
        );
        codeEditor.setSelection(selected);
        return reviewSelectionFor(side, codeEditor, selected);
      };

      const cancelCommentDrag = () => {
        commentDragStartLine = null;
        commentDragEndLine = null;
      };

      window.addEventListener('mouseup', cancelCommentDrag);
      codeEditor.onDidDispose(() => {
        window.removeEventListener('mouseup', cancelCommentDrag);
      });

      codeEditor.onDidChangeCursorSelection(({ selection }) => {
        onSelectionChange?.(
          reviewSelectionFor(side, codeEditor, selection as monaco.Selection)
        );
      });
      codeEditor.onMouseMove(({ target }) => {
        const lineNumber = target.position?.lineNumber;
        if (commentDragStartLine !== null && lineNumber) {
          commentDragEndLine = lineNumber;
          selectWholeLines(commentDragStartLine, lineNumber);
        }
        if (!lineNumber) {
          if (hoveredLine !== null) {
            hoveredLine = null;
            hoverDecorations.clear();
          }
          return;
        }
        if (hoveredLine === lineNumber) return;
        hoveredLine = lineNumber;
        hoverDecorations.set([
          {
            range: new monaco.Range(lineNumber, 1, lineNumber, 1),
            options: {
              isWholeLine: true,
              linesDecorationsClassName: 'review-comment-add-glyph',
              linesDecorationsTooltip: t('layout.review-add-comment', {
                defaultValue: 'Add review comment',
              }),
            },
          },
        ]);
      });
      codeEditor.onMouseLeave(() => {
        hoveredLine = null;
        hoverDecorations.clear();
      });
      codeEditor.onMouseDown(({ event, target }) => {
        const lineNumber = target.position?.lineNumber;
        if (
          !event.leftButton ||
          target.type !==
            monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS ||
          !lineNumber
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        commentDragStartLine = lineNumber;
        commentDragEndLine = lineNumber;
        selectWholeLines(lineNumber, lineNumber);
      });
      codeEditor.onMouseUp(({ event, target }) => {
        if (commentDragStartLine === null) return;
        event.preventDefault();
        event.stopPropagation();
        const endLine = target.position?.lineNumber ?? commentDragEndLine;
        const startLine = commentDragStartLine;
        cancelCommentDrag();
        if (!endLine) return;
        const reviewSelection = selectWholeLines(startLine, endLine);
        if (reviewSelection) onCommentRequest?.(reviewSelection);
      });
    };

    const handleMount = (editor: monaco.editor.IStandaloneDiffEditor) => {
      diffEditorRef.current = editor;
      setDiffEditorGeneration((generation) => generation + 1);
      bindCommenting('original', editor.getOriginalEditor());
      bindCommenting('modified', editor.getModifiedEditor());
      const applyMetrics = () => {
        const changes = editor.getLineChanges();
        if (!changes) return;
        const models = editor.getModel();
        setCounts(
          countLineChanges(changes, {
            originalEmpty: models?.original.getValueLength() === 0,
            modifiedEmpty: models?.modified.getValueLength() === 0,
          })
        );
      };
      editor.onDidUpdateDiff(applyMetrics);
      applyMetrics();
    };

    const handleDiffEditorDispose = (
      editor: monaco.editor.IStandaloneDiffEditor
    ) => {
      if (diffEditorRef.current === editor) diffEditorRef.current = null;
      diffCommentDecorationsRef.current = null;
    };

    const handleWholeFileMount = (
      editor: monaco.editor.IStandaloneCodeEditor
    ) => {
      wholeFileEditorRef.current = editor;
      wholeFileDecorationsRef.current = null;
      setWholeFileEditorGeneration((generation) => generation + 1);
      bindCommenting(wholeFileSide ?? 'modified', editor);
    };

    useEffect(() => {
      const decorationsFor = (
        side: 'original' | 'modified',
        editor: monaco.editor.IStandaloneCodeEditor
      ): monaco.editor.IModelDeltaDecoration[] => {
        const model = editor.getModel();
        if (!model) return [];
        return comments.flatMap((comment) => {
          const target = comment.selection;
          if (!target || target.side !== side) return [];
          const startLine = Math.min(
            Math.max(target.startLine, 1),
            model.getLineCount()
          );
          const endLine = Math.min(
            Math.max(target.endLine, startLine),
            model.getLineCount()
          );
          return [
            {
              range: new monaco.Range(startLine, 1, endLine, 1),
              options: {
                isWholeLine: true,
                className: 'review-comment-line',
                linesDecorationsClassName: 'review-comment-line-marker',
                glyphMarginClassName: 'review-comment-thread-glyph',
                glyphMarginHoverMessage: { value: comment.body },
              },
            },
          ];
        });
      };

      const diffEditor = diffEditorRef.current;
      if (diffEditor) {
        diffCommentDecorationsRef.current?.original.clear();
        diffCommentDecorationsRef.current?.modified.clear();
        diffCommentDecorationsRef.current = {
          original: diffEditor
            .getOriginalEditor()
            .createDecorationsCollection(
              decorationsFor('original', diffEditor.getOriginalEditor())
            ),
          modified: diffEditor
            .getModifiedEditor()
            .createDecorationsCollection(
              decorationsFor('modified', diffEditor.getModifiedEditor())
            ),
        };
      }

      const wholeEditor = wholeFileEditorRef.current;
      if (wholeEditor && wholeFileSide) {
        wholeFileCommentDecorationsRef.current?.clear();
        wholeFileCommentDecorationsRef.current =
          wholeEditor.createDecorationsCollection(
            decorationsFor(wholeFileSide, wholeEditor)
          );
      }
    }, [
      comments,
      diffEditorGeneration,
      wholeFileEditorGeneration,
      wholeFileSide,
    ]);

    useEffect(() => {
      const editor = wholeFileEditorRef.current;
      const model = editor?.getModel();
      if (!wholeFileSide || !editor || !model) return;
      wholeFileDecorationsRef.current?.clear();
      wholeFileDecorationsRef.current = null;
      if (!wholeFileTinted) {
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
            linesDecorationsClassName:
              wholeFileSide === 'modified'
                ? 'line-insert-marker'
                : 'line-delete-marker',
          },
        },
      ]);
      setCounts(
        wholeFileSide === 'modified'
          ? { added: lines, removed: 0 }
          : { added: 0, removed: lines }
      );
    }, [wholeFileEditorGeneration, wholeFileSide, wholeFileTinted]);

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
    const baseName =
      lastSlash >= 0 ? file.path.slice(lastSlash + 1) : file.path;

    const fileHeaderMetadata = (
      <div
        data-testid="review-file-metadata"
        className="flex h-full min-w-0 items-center gap-ds-6"
      >
        <span
          className={`inline-flex w-3 shrink-0 items-center justify-center text-ds-text-meta leading-none font-bold ${status.className}`}
          aria-label={file.status}
        >
          {status.letter}
        </span>
        <span className="flex min-w-0 shrink items-center font-code text-ds-code-small font-medium text-ds-ink-default-default">
          <span className="truncate">
            <span className="font-code text-ds-ink-muted-default">
              {dirName}
            </span>
            {baseName}
          </span>
        </span>
        {counts ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-ds-text-meta leading-none font-medium">
            <span className="text-ds-text-success-default-default">
              +{counts.added}
            </span>
            <span className="text-ds-text-error-default-default">
              −{counts.removed}
            </span>
          </span>
        ) : null}
      </div>
    );

    const banner =
      file.beforeUnavailable && !loadError
        ? t('layout.review-before-unavailable', {
            defaultValue:
              'No saved copy of the original — showing the current file, not a diff.',
          })
        : null;
    const notice =
      loadError === 'binary'
        ? t('layout.review-binary-file', {
            defaultValue: 'Binary file — no text diff available.',
          })
        : loadError === 'too_large'
          ? t('layout.review-file-too-large', {
              defaultValue: 'File is too large to diff.',
            })
          : loadError === 'preview_too_large'
            ? t('folder.preview-too-large', {
                defaultValue:
                  'This file exceeds the safe in-app preview limit.',
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
      <section
        data-review-id={file.id}
        className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-ds-neutral-default-default"
      >
        <ContentHeader
          leading={fileHeaderMetadata}
          actions={
            <>
              {semanticKind ? (
                <ToggleGroup
                  type="single"
                  value={displayMode}
                  onValueChange={(value) => {
                    if (value) setDisplayMode(value as 'source' | 'preview');
                  }}
                  size="sm"
                  aria-label={t('layout.review-content-view', {
                    defaultValue: 'Content view',
                  })}
                >
                  {semanticKind !== 'image' ? (
                    <ToggleGroupItem
                      value="source"
                      aria-label={t('layout.review-source-view', {
                        defaultValue: 'Source diff',
                      })}
                    >
                      <CodeXml aria-hidden />
                    </ToggleGroupItem>
                  ) : null}
                  <ToggleGroupItem
                    value="preview"
                    aria-label={t('layout.review-preview-view', {
                      defaultValue: 'Rendered diff',
                    })}
                  >
                    <Eye aria-hidden />
                  </ToggleGroupItem>
                </ToggleGroup>
              ) : null}
              {headerActions}
            </>
          }
        />

        {banner ? (
          <div className="flex shrink-0 items-center gap-2 border-0 border-x-0 border-t-0 border-b border-solid border-ds-hairline-subtle-default px-3 py-2 text-ds-text-meta text-ds-ink-muted-default">
            <DsIcon icon={FileWarning} recipe="main-compact" />
            {banner}
          </div>
        ) : null}

        <div className="min-h-0 flex-1">
          {notice ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-ds-text-meta text-ds-ink-muted-default">
              <div className="flex items-center gap-2">
                <DsIcon icon={FileWarning} />
                {notice}
              </div>
              {(loadError === 'binary' ||
                loadError === 'too_large' ||
                loadError === 'preview_too_large') &&
              (file.beforeSize != null || file.afterSize != null) ? (
                <div className="flex items-center gap-3 font-code text-ds-code-small">
                  <span>
                    {t('layout.review-before-size', {
                      defaultValue: 'Before {{size}}',
                      size:
                        file.beforeSize == null
                          ? '—'
                          : formatFileSize(file.beforeSize),
                    })}
                  </span>
                  <span aria-hidden>→</span>
                  <span>
                    {t('layout.review-after-size', {
                      defaultValue: 'After {{size}}',
                      size:
                        file.afterSize == null
                          ? '—'
                          : formatFileSize(file.afterSize),
                    })}
                  </span>
                </div>
              ) : null}
            </div>
          ) : displayMode === 'preview' && semanticKind ? (
            <SemanticDiffView file={file} kind={semanticKind} sides={sides} />
          ) : sides ? (
            <div
              className="code-editor-surface review-diff-surface h-full w-full bg-ds-neutral-subtle-default"
              style={
                {
                  '--code-font-family': CODE_FONT_FAMILY,
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
                  theme={codeTheme}
                  options={wholeFileOptions}
                  onMount={handleWholeFileMount}
                  loading={
                    <div className="h-full w-full animate-pulse bg-ds-neutral-subtle-default" />
                  }
                />
              ) : (
                <ReviewDiffEditor
                  original={sides.original}
                  modified={sides.modified}
                  language={language}
                  originalModelPath={reviewModelPath('original', file)}
                  modifiedModelPath={reviewModelPath('modified', file)}
                  theme={codeTheme}
                  options={diffOptions}
                  onMount={handleMount}
                  onDispose={handleDiffEditorDispose}
                  loading={
                    <div className="h-full w-full animate-pulse bg-ds-neutral-subtle-default" />
                  }
                />
              )}
            </div>
          ) : (
            <div className="h-full w-full animate-pulse bg-ds-neutral-subtle-default" />
          )}
        </div>
      </section>
    );
  }
);

DiffFileCard.displayName = 'DiffFileCard';
