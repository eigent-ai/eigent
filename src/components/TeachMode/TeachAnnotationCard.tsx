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
import type {
  TeachFeedbackSourceType,
  TeachFeedbackTarget,
  TeachFileReference,
} from '@/store/teachModeStore';
import { SquareDashedMousePointer } from 'lucide-react';
import { type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { TeachAnnotationMarkdown } from './TeachAnnotationMarkdown';
import { TeachCommentInput } from './TeachCommentInput';

interface TeachAnnotationCardProps {
  target: TeachFeedbackTarget;
  comment: string;
  onCommentChange: (comment: string) => void;
  references: TeachFileReference[];
  onReferencesChange: (references: TeachFileReference[]) => void;
  onSave: () => void;
  onRemove?: () => void;
  isEditing?: boolean;
}

export function TeachAnnotationCard({
  target,
  comment,
  onCommentChange,
  references,
  onReferencesChange,
  onSave,
  onRemove,
  isEditing = false,
}: TeachAnnotationCardProps) {
  const { t } = useTranslation();
  const sourceLabels: Record<TeachFeedbackSourceType, string> = {
    'agent-log': t('chat.teach-agent-log', { defaultValue: 'Agent log' }),
    run: t('chat.teach-whole-run', { defaultValue: 'Whole run' }),
    artifact: t('chat.teach-artifact', { defaultValue: 'Artifact' }),
    file: t('chat.teach-file', { defaultValue: 'File' }),
    browser: t('chat.teach-browser', { defaultValue: 'Browser' }),
    review: t('chat.teach-review', { defaultValue: 'Review' }),
    terminal: t('chat.teach-terminal', { defaultValue: 'Terminal' }),
    session: t('chat.teach-session', { defaultValue: 'Session' }),
  };
  const detail = target.contextDetail || sourceLabels[target.sourceType];
  const selectedOutput =
    target.selectedText?.trim() || target.contextDetail || target.contextLabel;
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (comment.trim()) onSave();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (comment.trim()) onSave();
    }
  };

  return (
    <form onSubmit={save} className="flex min-w-0 flex-col">
      <header className="flex min-h-ds-control-xl min-w-0 items-center gap-ds-control-gap p-ds-control-inline">
        <span className="flex size-ds-control-xl shrink-0 items-center justify-center rounded-ds-menu-row bg-ds-neutral-muted-default text-ds-text-teach-mode-strong-default">
          <DsIcon icon={SquareDashedMousePointer} recipe="detailed" />
        </span>
        <span className="flex min-h-ds-control-xl min-w-0 flex-1 flex-col justify-center">
          <span
            className="truncate text-ds-text-body-large font-semibold text-ds-ink-default-default"
            title={target.contextLabel}
          >
            {target.contextLabel}
          </span>
          <span
            className="truncate text-ds-text-meta text-ds-ink-muted-default"
            title={detail}
          >
            {detail}
          </span>
        </span>
      </header>
      <section
        aria-label={t('chat.teach-selected-output', {
          defaultValue: 'Selected output',
        })}
        className="min-w-0 border-x-0 border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-muted-default px-ds-control-inline py-ds-control-gap"
      >
        <span className="block pb-ds-4 text-ds-text-meta font-semibold text-ds-ink-muted-default">
          {t('chat.teach-selected-output', { defaultValue: 'Selected output' })}
        </span>
        <div className="scrollbar-always-visible max-h-32 overflow-y-auto">
          <TeachAnnotationMarkdown content={selectedOutput} />
        </div>
      </section>
      <div className="flex min-w-0 flex-col gap-ds-control-gap p-ds-control-inline">
        <TeachCommentInput
          autoFocus
          value={comment}
          onChange={onCommentChange}
          references={references}
          onReferencesChange={onReferencesChange}
          spaceId={target.spaceId}
          projectId={target.projectId}
          scope="session"
          onKeyDown={onKeyDown}
          showFileReferenceButton={false}
        />
        <footer className="flex items-center gap-ds-control-gap">
          {onRemove ? (
            <Button
              type="button"
              variant="text"
              size="sm"
              onClick={onRemove}
              className="ml-auto"
            >
              {t('chat.teach-remove-comment', {
                defaultValue: 'Remove comment',
              })}
            </Button>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!comment.trim()}
            className={onRemove ? undefined : 'ml-auto'}
          >
            {isEditing
              ? t('chat.teach-update-comment', {
                  defaultValue: 'Update comment',
                })
              : t('chat.teach-save-comment', { defaultValue: 'Save comment' })}
          </Button>
        </footer>
      </div>
    </form>
  );
}
