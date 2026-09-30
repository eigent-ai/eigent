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
// Licensed under the Apache License, Version 2.0 (the "License");

import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverViewport,
} from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import type { TeachFileReference } from '@/store/teachModeStore';
import { FileText, RotateCcw } from 'lucide-react';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useAnnotationReferenceFiles,
  type AnnotationReferenceFile,
} from './useAnnotationReferenceFiles';

type Mention = { start: number; end: number; query: string };

function mentionAtCaret(value: string, caret: number): Mention | null {
  const before = value.slice(0, caret);
  const match = /(^|[\s(])@([^\s@\n\]]*)$/.exec(before);
  if (!match) return null;
  return {
    start: caret - match[2].length - 1,
    end: caret,
    query: match[2],
  };
}

export function TeachCommentInput({
  value,
  onChange,
  references,
  onReferencesChange,
  spaceId,
  projectId,
  scope,
  id,
  autoFocus,
  onKeyDown,
  showFileReferenceButton = true,
}: {
  value: string;
  onChange: (value: string) => void;
  references: TeachFileReference[];
  onReferencesChange: (references: TeachFileReference[]) => void;
  spaceId: string | null;
  projectId: string | null;
  scope: 'session' | 'space';
  id?: string;
  autoFocus?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  showFileReferenceButton?: boolean;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastCaret = useRef<number | null>(null);
  const [mention, setMention] = useState<Mention | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const { files, loading, error, refresh } = useAnnotationReferenceFiles(
    spaceId,
    projectId,
    scope,
    mention !== null
  );
  const matches = useMemo(() => {
    const query = mention?.query.toLocaleLowerCase() ?? '';
    return files
      .filter((file) =>
        [file.name, file.relativePath, file.projectName].some((field) =>
          field.toLocaleLowerCase().includes(query)
        )
      )
      .slice(0, 40);
  }, [files, mention?.query]);

  const updateMention = (nextValue: string, caret: number) => {
    lastCaret.current = caret;
    setMention(mentionAtCaret(nextValue, caret));
    setActiveIndex(0);
  };
  const openFileReferences = () => {
    const input = inputRef.current;
    const caret = lastCaret.current ?? value.length;
    const prefix = value.slice(0, caret);
    const insertion = prefix && !/[\s(]$/.test(prefix) ? ' @' : '@';
    const nextValue = prefix + insertion + value.slice(caret);
    const nextCaret = caret + insertion.length;
    onChange(nextValue);
    updateMention(nextValue, nextCaret);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(nextCaret, nextCaret);
    });
  };
  const selectFile = (file: AnnotationReferenceFile) => {
    if (!mention) return;
    const displayPath =
      scope === 'space'
        ? `${file.projectName}/${file.relativePath}`
        : file.relativePath;
    const token = `@[${displayPath}]`;
    const nextValue =
      value.slice(0, mention.start) + token + ' ' + value.slice(mention.end);
    onChange(nextValue);
    onReferencesChange([
      ...references.filter(
        (reference) =>
          reference.projectId !== file.projectId ||
          reference.relativePath !== file.relativePath
      ),
      {
        projectId: file.projectId,
        relativePath: file.relativePath,
        name: file.name,
        token,
      },
    ]);
    setMention(null);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      const caret = mention.start + token.length + 1;
      input.focus();
      input.setSelectionRange(caret, caret);
    });
  };

  return (
    <Popover
      open={mention !== null}
      onOpenChange={(open) => {
        if (!open) setMention(null);
      }}
    >
      <PopoverAnchor asChild>
        <div className="relative flex flex-col gap-ds-4">
          <Textarea
            ref={inputRef}
            id={id}
            aria-label={t('chat.teach-comment', { defaultValue: 'Comment' })}
            variant="outlined"
            size="sm"
            rows={3}
            autoFocus={autoFocus}
            value={value}
            onChange={(event) => {
              const nextValue = event.target.value;
              onChange(nextValue);
              onReferencesChange(
                references.filter((reference) =>
                  nextValue.includes(reference.token)
                )
              );
              updateMention(nextValue, event.target.selectionStart);
            }}
            onClick={(event) =>
              updateMention(value, event.currentTarget.selectionStart)
            }
            onKeyUp={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                updateMention(value, event.currentTarget.selectionStart);
              }
            }}
            onKeyDown={(event) => {
              if (mention && matches.length > 0) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setActiveIndex((index) => (index + 1) % matches.length);
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActiveIndex(
                    (index) => (index - 1 + matches.length) % matches.length
                  );
                  return;
                }
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.altKey
                ) {
                  event.preventDefault();
                  selectFile(matches[activeIndex] ?? matches[0]);
                  return;
                }
              }
              if (mention && event.key === 'Escape') {
                event.preventDefault();
                setMention(null);
                return;
              }
              onKeyDown?.(event);
            }}
            aria-autocomplete="list"
            aria-expanded={mention !== null}
            aria-controls={mention ? listId : undefined}
            aria-activedescendant={
              mention && matches.length > 0
                ? `${listId}-item-${activeIndex}`
                : undefined
            }
            placeholder={t('chat.teach-comment-placeholder', {
              defaultValue: 'Add a comment…',
            })}
            className="resize-y"
          />
          {showFileReferenceButton ? (
            <div className="flex justify-start">
              <Button
                type="button"
                variant="text"
                size="xs"
                onClick={openFileReferences}
              >
                <span aria-hidden="true">@</span>
                {t('chat.teach-file-references', {
                  defaultValue: 'File references',
                })}
              </Button>
            </div>
          ) : null}
        </div>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        className="!w-[min(360px,calc(100vw-24px))] p-ds-4"
      >
        <span className="block px-ds-8 py-ds-4 text-ds-text-meta font-semibold text-ds-ink-muted-default">
          {scope === 'space'
            ? t('chat.teach-space-files', {
                defaultValue: 'Files in this space',
              })
            : t('chat.teach-session-files', {
                defaultValue: 'Files in this session',
              })}
        </span>
        <PopoverViewport
          id={listId}
          role="listbox"
          aria-label={t('chat.teach-file-references', {
            defaultValue: 'File references',
          })}
          maxHeight={240}
          className="scrollbar-always-visible"
        >
          {loading ? (
            <span className="block px-ds-8 py-ds-8 text-ds-text-base text-ds-ink-muted-default">
              {t('chat.teach-loading-files', {
                defaultValue: 'Loading files…',
              })}
            </span>
          ) : error ? (
            <div className="flex items-center justify-between gap-ds-8 px-ds-8 py-ds-4">
              <span className="text-ds-text-base text-ds-ink-muted-default">
                {t('chat.teach-files-unavailable', {
                  defaultValue: 'Could not load files.',
                })}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={refresh}>
                <DsIcon icon={RotateCcw} recipe="main" />
                {t('chat.teach-retry', { defaultValue: 'Retry' })}
              </Button>
            </div>
          ) : matches.length === 0 ? (
            <span className="block px-ds-8 py-ds-8 text-ds-text-base text-ds-ink-muted-default">
              {t('chat.teach-no-files', {
                defaultValue: 'No matching files.',
              })}
            </span>
          ) : (
            matches.map((file, index) => (
              <button
                key={`${file.projectId}:${file.relativePath}`}
                id={`${listId}-item-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectFile(file)}
                onMouseEnter={() => setActiveIndex(index)}
                className="flex min-h-ds-control-lg w-full items-center gap-ds-8 rounded-ds-menu-row px-ds-8 text-left text-ds-text-base text-ds-ink-default-default hover:bg-ds-neutral-default-hover focus-visible:ring-2 focus-visible:ring-ds-ring-focus focus-visible:outline-none aria-selected:bg-ds-neutral-default-hover"
              >
                <DsIcon icon={FileText} recipe="main" />
                <span
                  className="min-w-0 flex-1 truncate"
                  title={file.relativePath}
                >
                  {file.relativePath}
                </span>
                {scope === 'space' ? (
                  <span className="shrink-0 text-ds-text-meta text-ds-ink-muted-default">
                    {file.projectName}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </PopoverViewport>
      </PopoverContent>
    </Popover>
  );
}
