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

import { TeachAnnotationCard } from '@/components/TeachMode/TeachAnnotationCard';
import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { TooltipSimple } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useSpaceStore } from '@/store/spaceStore';
import {
  teachFeedbackId,
  type TeachFeedbackSourceType,
  type TeachFileReference,
  useTeachModeStore,
} from '@/store/teachModeStore';
import { SquareDashedMousePointer } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface TeachCommentPopoverProps {
  projectId?: string | null;
  runId?: string;
  sourceType: TeachFeedbackSourceType;
  sourceId: string;
  contextLabel: string;
  contextDetail?: string;
  sourcePath?: string;
  selectedText?: string;
  triggerVariant?: 'icon' | 'text';
  triggerSize?: 'xs' | 'sm';
  className?: string;
}

export function TeachCommentPopover({
  projectId,
  runId,
  sourceType,
  sourceId,
  contextLabel,
  contextDetail,
  sourcePath,
  selectedText,
  triggerVariant = 'text',
  triggerSize,
  className,
}: TeachCommentPopoverProps) {
  const { t } = useTranslation();
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const enabled = useTeachModeStore((state) => state.enabled);
  const target = useMemo(
    () =>
      activeSpaceId && projectId
        ? {
            spaceId: activeSpaceId,
            projectId,
            runId,
            sourceType,
            sourceId,
            contextLabel,
            contextDetail,
            sourcePath,
          }
        : null,
    [
      activeSpaceId,
      contextDetail,
      contextLabel,
      sourcePath,
      projectId,
      runId,
      sourceId,
      sourceType,
    ]
  );
  const feedbackId = target ? teachFeedbackId(target) : '';
  const feedback = useTeachModeStore((state) =>
    feedbackId ? state.feedbackById[feedbackId] : undefined
  );
  const saveFeedback = useTeachModeStore((state) => state.saveFeedback);
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState(feedback?.comment ?? '');
  const [references, setReferences] = useState<TeachFileReference[]>(
    feedback?.fileReferences ?? []
  );
  const [capturedOutput, setCapturedOutput] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      setComment(feedback?.comment ?? '');
      setReferences(feedback?.fileReferences ?? []);
    }
  }, [feedback?.comment, feedback?.fileReferences, feedbackId, open]);

  if (!enabled || !target) return null;

  const addCommentLabel = t('chat.teach-add-comment', {
    defaultValue: 'Add comment',
  });
  const save = () => {
    saveFeedback(
      {
        ...target,
        selectedText: capturedOutput || selectedText || feedback?.selectedText,
      },
      { comment, fileReferences: references }
    );
    setOpen(false);
  };
  const trigger = (
    <Button
      ref={triggerRef}
      type="button"
      variant="ghost"
      size={triggerSize ?? (triggerVariant === 'icon' ? 'sm' : 'xs')}
      buttonContent={triggerVariant === 'icon' ? 'icon-only' : 'text'}
      aria-label={addCommentLabel}
      aria-pressed={Boolean(feedback?.comment)}
      className={cn(
        triggerVariant === 'text' && 'gap-1',
        feedback?.comment &&
          '!bg-ds-bg-teach-mode-muted-default !text-ds-text-teach-mode-strong-default',
        className
      )}
    >
      <DsIcon icon={SquareDashedMousePointer} recipe="main" />
      {triggerVariant === 'text' ? addCommentLabel : null}
    </Button>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          const marker = triggerRef.current?.closest<HTMLElement>(
            '[data-teach-feedback-source], [data-run-id]'
          );
          const selection = window.getSelection();
          const anchor = selection?.anchorNode;
          const anchorElement =
            anchor instanceof Element ? anchor : anchor?.parentElement;
          const selectedWithinSource =
            marker && anchorElement && marker.contains(anchorElement)
              ? selection?.toString().trim()
              : '';
          const markerText =
            sourceType === 'agent-log' ||
            sourceType === 'run' ||
            sourceType === 'artifact'
              ? marker?.innerText.trim()
              : '';
          setCapturedOutput(
            (
              selectedWithinSource ||
              selectedText ||
              markerText ||
              feedback?.selectedText ||
              ''
            ).slice(0, 10000)
          );
        }
        setOpen(nextOpen);
        if (!nextOpen) {
          setComment(feedback?.comment ?? '');
          setReferences(feedback?.fileReferences ?? []);
        }
      }}
    >
      {triggerVariant === 'icon' ? (
        <TooltipSimple content={addCommentLabel}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        </TooltipSimple>
      ) : (
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      )}
      <PopoverContent
        align="end"
        sideOffset={8}
        className="scrollbar-always-visible max-h-[var(--radix-popover-content-available-height)] !w-[min(360px,calc(100vw-24px))] overflow-y-auto p-0"
      >
        <TeachAnnotationCard
          target={{
            ...target,
            selectedText:
              capturedOutput || selectedText || feedback?.selectedText,
          }}
          comment={comment}
          onCommentChange={setComment}
          references={references}
          onReferencesChange={setReferences}
          onSave={save}
          isEditing={Boolean(feedback?.comment)}
          onRemove={
            feedback?.comment
              ? () => {
                  saveFeedback(target, { comment: '' });
                  setOpen(false);
                }
              : undefined
          }
        />
      </PopoverContent>
    </Popover>
  );
}
