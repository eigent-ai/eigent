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

import { TeachCommentInput } from '@/components/TeachMode/TeachCommentInput';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DsIcon } from '@/components/ui/ds-icon';
import type { TeachFeedback, TeachFileReference } from '@/store/teachModeStore';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ChevronDown,
  ChevronUp,
  Pencil,
  SquareDashedMousePointer,
  Trash2,
} from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

export function AnnotationItem({
  entry,
  sourceLabel,
  timeLabel,
  expanded,
  onToggle,
  onViewWork,
  onSave,
  onDelete,
  scope,
}: {
  entry: TeachFeedback;
  sourceLabel: string;
  timeLabel: string;
  expanded: boolean;
  onToggle: () => void;
  onViewWork?: () => void;
  onSave: (comment: string, references: TeachFileReference[]) => void;
  onDelete: () => void;
  scope: 'session' | 'space';
}) {
  const { t } = useTranslation();
  const contentId = useId();
  const reducedMotion = Boolean(useReducedMotion());
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState(entry.comment);
  const [references, setReferences] = useState(entry.fileReferences ?? []);
  const beginEdit = () => {
    setConfirmingDelete(false);
    setDraft(entry.comment);
    setReferences(entry.fileReferences ?? []);
    setEditing(true);
    if (!expanded) onToggle();
  };
  const cancelEdit = () => {
    setEditing(false);
    setDraft(entry.comment);
    setReferences(entry.fileReferences ?? []);
  };
  const viewWorkLabel = t('chat.teach-view-work', {
    defaultValue: 'View work',
  });
  const toggleLabel = expanded
    ? t('chat.teach-fold-annotation', { defaultValue: 'Fold annotation' })
    : t('chat.teach-expand-annotation', {
        defaultValue: 'Expand annotation',
      });
  const metadata = [
    sourceLabel,
    entry.contextDetail !== sourceLabel ? entry.contextDetail : undefined,
    timeLabel,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card className="min-w-0 border-ds-hairline-subtle-default bg-ds-neutral-subtle-default shadow-none">
      <article>
        <div className="flex min-w-0 items-center gap-ds-12 p-ds-12">
          <span className="flex size-ds-control-xl shrink-0 items-center justify-center rounded-ds-menu-row bg-ds-bg-teach-mode-strong-default text-ds-ink-inverse">
            <DsIcon icon={SquareDashedMousePointer} recipe="main" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-ds-2">
            <span
              className="truncate text-ds-text-base font-semibold text-ds-ink-default-default"
              title={entry.contextLabel}
            >
              {entry.contextLabel}
            </span>
            <span
              className="truncate text-ds-text-meta text-ds-ink-muted-default"
              title={metadata}
            >
              {metadata}
            </span>
            {!expanded ? (
              <span className="truncate pt-ds-4 text-ds-text-base text-ds-ink-default-default">
                {entry.comment}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-ds-4">
            {onViewWork ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`${viewWorkLabel}: ${entry.contextLabel}`}
                onClick={onViewWork}
              >
                {viewWorkLabel}
              </Button>
            ) : null}
            {confirmingDelete ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingDelete(false)}
                >
                  {t('layout.cancel', { defaultValue: 'Cancel' })}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  tone="error"
                  size="sm"
                  onClick={onDelete}
                >
                  {t('layout.delete', { defaultValue: 'Delete' })}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  buttonContent="icon-only"
                  aria-label={`${t('layout.edit', { defaultValue: 'Edit' })}: ${entry.contextLabel}`}
                  onClick={beginEdit}
                >
                  <DsIcon icon={Pencil} recipe="main" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  tone="error"
                  size="sm"
                  buttonContent="icon-only"
                  aria-label={`${t('layout.delete', { defaultValue: 'Delete' })}: ${entry.contextLabel}`}
                  onClick={() => setConfirmingDelete(true)}
                >
                  <DsIcon icon={Trash2} recipe="main" />
                </Button>
              </>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              aria-label={toggleLabel}
              aria-expanded={expanded}
              aria-controls={contentId}
              onClick={() => {
                if (editing) cancelEdit();
                setConfirmingDelete(false);
                onToggle();
              }}
            >
              <DsIcon icon={expanded ? ChevronUp : ChevronDown} recipe="main" />
            </Button>
          </div>
        </div>
        <motion.div
          initial={false}
          animate={{ height: expanded ? 'auto' : 0, opacity: expanded ? 1 : 0 }}
          transition={
            reducedMotion
              ? { height: { duration: 0 }, opacity: { duration: 0.12 } }
              : {
                  height: {
                    duration: 0.2,
                    ease: [0.25, 1, 0.5, 1],
                  },
                  opacity: {
                    duration: 0.16,
                    ease: [0.23, 1, 0.32, 1],
                  },
                }
          }
          aria-hidden={!expanded}
          className="min-w-0 overflow-hidden"
        >
          <div
            id={contentId}
            className="flex min-w-0 flex-col gap-ds-12 border-x-0 border-t border-b-0 border-solid border-ds-hairline-subtle-default p-ds-12"
          >
            {entry.selectedText?.trim() ? (
              <div className="flex min-w-0 flex-col gap-ds-4">
                <span className="text-ds-text-meta font-semibold text-ds-ink-muted-default">
                  {t('chat.teach-selected-work', {
                    defaultValue: 'Selected work',
                  })}
                </span>
                <blockquote className="scrollbar-always-visible m-0 max-h-40 overflow-y-auto rounded-ds-menu-row bg-ds-neutral-muted-default p-ds-12 text-ds-text-base whitespace-pre-wrap text-ds-ink-muted-default">
                  {entry.selectedText}
                </blockquote>
              </div>
            ) : null}
            <div className="flex min-w-0 flex-col gap-ds-4">
              <span className="text-ds-text-meta font-semibold text-ds-ink-muted-default">
                {t('chat.teach-your-comment', {
                  defaultValue: 'Your comment',
                })}
              </span>
              {editing ? (
                <div className="flex min-w-0 flex-col gap-ds-8">
                  <TeachCommentInput
                    autoFocus
                    value={draft}
                    onChange={setDraft}
                    references={references}
                    onReferencesChange={setReferences}
                    spaceId={entry.spaceId}
                    projectId={entry.projectId}
                    scope={scope}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') cancelEdit();
                    }}
                  />
                  <div className="flex justify-end gap-ds-4">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={cancelEdit}
                    >
                      {t('layout.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      disabled={!draft.trim()}
                      onClick={() => {
                        onSave(draft, references);
                        setEditing(false);
                      }}
                    >
                      {t('layout.save', { defaultValue: 'Save' })}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="m-0 text-ds-text-base break-words whitespace-pre-wrap text-ds-ink-default-default">
                  {entry.comment}
                </p>
              )}
            </div>
          </div>
        </motion.div>
      </article>
    </Card>
  );
}
