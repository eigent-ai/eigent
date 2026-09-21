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
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations.
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DsText } from '@/components/ui/ds-text';
import { TooltipSimple } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  CornerDownRight,
  FileText,
  GripVertical,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './QueuedBox.css';
import { useQueueReorder } from './useQueueReorder';

export interface QueuedMessage {
  id: string;
  content: string;
  timestamp?: number;
  processing?: boolean;
  canSendNow?: boolean;
  canReorder?: boolean;
  next?: boolean;
  stopping?: boolean;
}
export interface QueueContext {
  sessionId?: string;
  activeTaskId?: string;
  busy?: boolean;
  locked?: boolean;
  waitingReason?: string;
}
interface QueuedBoxProps {
  queuedMessages?: QueuedMessage[];
  queueContext?: QueueContext;
  onRemoveQueuedMessage?: (id: string) => void | Promise<void>;
  onSendQueuedMessageNow?: (id: string, expectedTaskId?: string) => void;
  onReorderQueuedMessage?: (id: string, targetId: string) => void;
  className?: string;
}
export function QueuedBox({
  queuedMessages = [],
  queueContext = {},
  onRemoveQueuedMessage,
  onSendQueuedMessageNow,
  onReorderQueuedMessage,
  className,
}: QueuedBoxProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const actionRef = useRef<HTMLButtonElement | null>(null);
  const menuRefs = useRef(new Map<string, HTMLButtonElement>());
  const [confirmation, setConfirmation] = useState<{
    id: string;
    sessionId?: string;
    taskId?: string;
  } | null>(null);
  const [viewing, setViewing] = useState<{
    id: string;
    sessionId?: string;
  } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [listCap, setListCap] = useState<number>();
  const reorder = useQueueReorder({
    messages: queuedMessages,
    sessionId: queueContext.sessionId,
    disabled: !!queueContext.locked || !!removing,
    listRef,
    onReorder: onReorderQueuedMessage,
  });
  const pendingFocus = useRef<string[] | null>(null);
  const focusComposer = () =>
    rootRef.current
      ?.closest('[data-bottom-box]')
      ?.querySelector<HTMLElement>('textarea, [contenteditable="true"]')
      ?.focus();
  const restoreFocus = () => {
    if (actionRef.current?.isConnected && !actionRef.current.disabled)
      actionRef.current.focus();
    else focusComposer();
  };
  useEffect(() => {
    setConfirmation(null);
    setViewing(null);
    pendingFocus.current = null;
    setRemoving(null);
  }, [queueContext.sessionId]);
  useLayoutEffect(() => {
    const targets = pendingFocus.current;
    if (!targets) return;
    const [removed, ...adjacent] = targets;
    if (queuedMessages.some((message) => message.id === removed)) return;
    pendingFocus.current = null;
    const target = adjacent.map((id) => menuRefs.current.get(id)).find(Boolean);
    if (target) target.focus();
    else focusComposer();
  }, [queuedMessages]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const row = listRef.current?.firstElementChild;
    if (!root || !row) return;
    const main = root
      .closest('[data-bottom-box]')
      ?.querySelector('[data-bottom-box-main]');
    const viewport = root.closest('[data-bottom-box-overlay]')?.parentElement;
    const measure = () => {
      const rowHeight = row.getBoundingClientRect().height;
      if (!rowHeight) return;
      const headerHeight =
        root.querySelector('[data-queue-status]')?.getBoundingClientRect()
          .height ?? 0;
      const gutter = parseFloat(getComputedStyle(root).paddingBottom) || 0;
      const available =
        (main?.getBoundingClientRect().top ?? window.innerHeight) -
        Math.max(0, viewport?.getBoundingClientRect().top ?? 0) -
        headerHeight -
        gutter * 2;
      setListCap(Math.min(rowHeight * 9, Math.max(rowHeight, available)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    if (main) observer.observe(main);
    if (viewport) observer.observe(viewport);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [queuedMessages.length, queueContext.waitingReason]);
  const selected = queuedMessages.find(
    (message) => message.id === confirmation?.id
  );
  const viewed = queuedMessages.find((message) => message.id === viewing?.id);
  const canConfirm =
    selected &&
    !selected.processing &&
    selected.canSendNow !== false &&
    !queueContext.locked &&
    !queueContext.waitingReason;
  const sameTask =
    !queueContext.busy || confirmation?.taskId === queueContext.activeTaskId;
  const open = Boolean(
    confirmation &&
    selected &&
    confirmation.sessionId === queueContext.sessionId
  );
  const remove = async (message: QueuedMessage) => {
    if (removing) return;
    const index = queuedMessages.findIndex((item) => item.id === message.id);
    pendingFocus.current = [
      message.id,
      queuedMessages[index + 1]?.id,
      queuedMessages[index - 1]?.id,
    ].filter((id): id is string => !!id);
    setRemoving(message.id);
    const composer = rootRef.current
      ?.closest('[data-bottom-box]')
      ?.querySelector<HTMLElement>('textarea, [contenteditable="true"]');
    const origin = menuRefs.current.get(message.id);
    try {
      await onRemoveQueuedMessage?.(message.id);
    } catch {
      pendingFocus.current = null;
    } finally {
      setRemoving(null);
      requestAnimationFrame(() => {
        if (origin?.isConnected) return;
        const target = [
          queuedMessages[index + 1]?.id,
          queuedMessages[index - 1]?.id,
        ]
          .map((id) => menuRefs.current.get(id))
          .find(Boolean);
        if (target) target.focus();
        else if (composer?.isConnected) composer.focus();
      });
    }
  };
  if (!queuedMessages.length) return null;
  return (
    <section
      ref={rootRef}
      aria-label={`${t('chat.queued-tasks')} (${queuedMessages.length})`}
      className={cn(
        'queued-task-tray rounded-ds-panel bg-ds-neutral-default-default',
        className
      )}
    >
      {queueContext.waitingReason && (
        <div
          data-queue-status
          className="queued-task-status border-ds-hairline-subtle-default"
        >
          <DsText
            role="meta"
            aria-live="polite"
            className="text-ds-ink-muted-default"
          >
            {queueContext.waitingReason}
          </DsText>
        </div>
      )}
      <span id={reorder.instructionsId} className="sr-only">
        {t('chat.queue-reorder-help')}
      </span>
      <span className="sr-only" role="status">
        {reorder.announcement}
      </span>
      <ul
        ref={listRef}
        className="queued-task-list scrollbar-always-visible rounded-t-ds-panel"
        style={listCap ? { maxHeight: listCap } : undefined}
      >
        {queuedMessages.map((message) => (
          <li
            key={message.id}
            data-queue-id={message.id}
            data-dragging={reorder.draggingId === message.id || undefined}
            data-lifted={reorder.liftedId === message.id || undefined}
            className={cn(
              'queued-task-row px-ds-8',
              reorder.liftedId === message.id && 'shadow-ds-elevation-drag'
            )}
          >
            <div className="queued-task-row-content">
              <div className="flex min-w-0 flex-1 items-center gap-ds-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  buttonContent="icon-only"
                  className="queued-task-drag-handle"
                  aria-label={t('chat.queue-reorder', {
                    task: message.content,
                  })}
                  aria-describedby={reorder.instructionsId}
                  disabled={!reorder.canMove(message)}
                  {...reorder.handleProps(message)}
                >
                  <GripVertical />
                </Button>
                <DsText
                  as="p"
                  role="base"
                  className="queued-task-preview"
                  title={message.content}
                >
                  {message.content}
                </DsText>
              </div>
              {(message.next || message.processing || message.stopping) && (
                <DsText
                  role="meta"
                  aria-live="polite"
                  className="queued-task-progress text-ds-ink-muted-default"
                  title={t(
                    message.stopping
                      ? 'chat.queue-stopping'
                      : message.processing
                        ? 'chat.queue-starting'
                        : 'chat.queue-next'
                  )}
                >
                  {t(
                    message.stopping
                      ? 'chat.queue-stopping'
                      : message.processing
                        ? 'chat.queue-starting'
                        : 'chat.queue-next'
                  )}
                </DsText>
              )}
              <div className="queued-task-actions gap-ds-2">
                <TooltipSimple content={t('chat.remove-queued-message')}>
                  <Button
                    type="button"
                    variant="ghost"
                    tone="error"
                    size="xs"
                    buttonContent="icon-only"
                    aria-label={t('chat.remove-queued-message')}
                    disabled={
                      message.processing ||
                      queueContext.locked ||
                      removing === message.id
                    }
                    onClick={() => {
                      void remove(message);
                    }}
                  >
                    <Trash2 />
                  </Button>
                </TooltipSimple>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      ref={(element) => {
                        if (element) menuRefs.current.set(message.id, element);
                        else menuRefs.current.delete(message.id);
                      }}
                      type="button"
                      variant="ghost"
                      size="xs"
                      buttonContent="icon-only"
                      aria-label={t('chat.queue-more-actions')}
                      disabled={
                        message.processing ||
                        queueContext.locked ||
                        removing === message.id
                      }
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {message.canSendNow !== false && (
                      <DropdownMenuItem
                        disabled={!!queueContext.waitingReason}
                        onSelect={() => {
                          actionRef.current =
                            menuRefs.current.get(message.id) ?? null;
                          if (queueContext.busy)
                            setConfirmation({
                              id: message.id,
                              sessionId: queueContext.sessionId,
                              taskId: queueContext.activeTaskId,
                            });
                          else onSendQueuedMessageNow?.(message.id);
                        }}
                      >
                        <CornerDownRight />
                        {t(
                          queueContext.busy
                            ? 'chat.queue-stop-and-start'
                            : 'chat.queue-start-next'
                        )}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onSelect={() => {
                        actionRef.current =
                          menuRefs.current.get(message.id) ?? null;
                        setViewing({
                          id: message.id,
                          sessionId: queueContext.sessionId,
                        });
                      }}
                    >
                      <FileText />
                      {t('chat.queue-view-full')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) setConfirmation(null);
        }}
      >
        <DialogContent
          size="sm"
          overlayVariant="dimmed"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <DialogHeader
            title={t('chat.queue-stop-title')}
            subtitle={t('chat.queue-stop-description')}
          />
          <DialogContentSection className="scrollbar-always-visible">
            <DsText
              as="p"
              role="base"
              className="break-words whitespace-pre-wrap"
            >
              {selected?.content}
            </DsText>
            {!sameTask && (
              <DsText as="p" role="meta" aria-live="polite">
                {t('chat.queue-task-changed')}
              </DsText>
            )}
          </DialogContentSection>
          <DialogFooter>
            <Button
              ref={cancelRef}
              variant="secondary"
              onClick={() => setConfirmation(null)}
            >
              {t('chat.queue-keep')}
            </Button>
            <Button
              variant="primary"
              tone="error"
              disabled={!canConfirm || !sameTask}
              onClick={() => {
                if (!confirmation || !canConfirm || !sameTask) return;
                const request = confirmation;
                setConfirmation(null);
                onSendQueuedMessageNow?.(request.id, request.taskId);
              }}
            >
              {t(
                queueContext.busy
                  ? 'chat.queue-stop-and-start'
                  : 'chat.queue-start-next'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(viewed && viewing?.sessionId === queueContext.sessionId)}
        onOpenChange={(value) => {
          if (!value) setViewing(null);
        }}
      >
        <DialogContent
          size="sm"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <DialogHeader
            title={t('chat.queue-view-full')}
            subtitle={t('chat.queued-tasks')}
          />
          <DialogContentSection className="scrollbar-always-visible">
            <DsText
              as="p"
              role="base"
              className="break-words whitespace-pre-wrap"
            >
              {viewed?.content}
            </DsText>
          </DialogContentSection>
        </DialogContent>
      </Dialog>
    </section>
  );
}
export default QueuedBox;
