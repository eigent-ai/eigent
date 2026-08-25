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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ShortcutTooltipContent } from '@/components/ui/shortcut-tooltip';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useDesktopShortcutPlatform } from '@/hooks/useDesktopShortcutPlatform';
import { processDroppedFiles, processPastedFiles } from '@/lib/fileUtils';
import { cn } from '@/lib/utils';
import { getEnterKeyLabel } from '@/shared/keyboardShortcuts';
import type { TriggerInput } from '@/types';
import {
  ArrowRight,
  Cable,
  FileText,
  Image,
  Paperclip,
  Play,
  Square,
  UploadCloud,
  WandSparkles,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { BoxHeaderDisplay } from './BoxHeader';
import { RichChatInput } from './RichChatInput';
import type { BottomBoxHeaderContent } from './types';

const PRIMARY_ACTION_ICON_MOTION_CLASS =
  'absolute inset-0 size-ds-icon-md text-current transition-[transform,opacity] motion-reduce:transition-none';
const PRIMARY_ACTION_ICON_MOTION_STYLE: React.CSSProperties = {
  transitionDuration: '160ms',
  transitionTimingFunction: 'cubic-bezier(0.77, 0, 0.175, 1)',
};

/**
 * File attachment object
 */
export interface FileAttachment {
  fileName: string;
  filePath: string;
  fileId?: string;
  source?: 'local' | 'upload';
}

/**
 * Inputbox Props
 */
export interface InputboxProps {
  /** Current text value */
  value?: string;
  /** Callback when text changes */
  onChange?: (value: string) => void;
  /** Callback when the send action is clicked. Text or attachments make it available. */
  onSend?: () => void;
  /** Task state shown by the primary action when the composer has no draft. */
  taskControlState?: 'idle' | 'running' | 'paused';
  onPauseTask?: () => void;
  onResumeTask?: () => void;
  taskControlLoading?: boolean;
  /** Array of file attachments */
  files?: FileAttachment[];
  /** Render attachment chips inside the input surface (layer 2). */
  showFileAttachments?: boolean;
  /** Input-required question, details, and non-file context (layer 1). */
  header?: BottomBoxHeaderContent;
  /** Callback when files are modified */
  onFilesChange?: (files: FileAttachment[]) => void;
  /** Callback when add file button is clicked */
  onAddFile?: () => void;
  /** Static placeholder when empty (no rotation). RichChatInput defaults to rotating product hints when omitted. */
  placeholder?: string;
  /** Rotating placeholders when empty; takes precedence over `placeholder` when non-empty. */
  placeholders?: readonly string[];
  /** Disable all interactions */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Ref for the rich text input surface (contenteditable) */
  textareaRef?: React.RefObject<HTMLDivElement | null>;
  /** Allow drag and drop */
  allowDragDrop?: boolean;
  /** Privacy mode enabled */
  privacy?: boolean;
  /** Use cloud model in dev */
  useCloudModelInDev?: boolean;
  /** Connector picker panel state; the toggle button only renders when the callback is provided. */
  connectorPanelOpen?: boolean;
  onToggleConnectorPanel?: () => void;
  /** Skill picker panel state; the toggle button only renders when the callback is provided. */
  skillPanelOpen?: boolean;
  onToggleSkillPanel?: () => void;
  /** Callback when trigger is being created (for placeholder) */
  onTriggerCreating?: (triggerData: TriggerInput) => void;
  /** Callback when trigger is created successfully */
  onTriggerCreated?: (triggerData: TriggerInput) => void;
}

/**
 * Inputbox Component
 *
 * A multi-state input component with four stacked layers:
 * - **Layer 1**: Input-required question / details (when provided)
 * - **Layer 2**: File attachment chips (original design, up to 5 + overflow)
 * - **Layer 3**: Auto-expanding rich text input
 * - **Layer 4**: Action buttons (attach, connectors, skills, send)
 * - Send button changes color based on content (gray when empty, green when has content)
 * - Arrow icon rotates when there's content
 * - Supports Enter to send, Shift+Enter for new line
 * - Drag and drop file support
 *
 * @example
 * ```tsx
 * const [message, setMessage] = useState("");
 * const [files, setFiles] = useState<FileAttachment[]>([]);
 *
 * <Inputbox
 *   value={message}
 *   onChange={setMessage}
 *   onSend={() => {
 *     console.log("Sending:", message);
 *     setMessage("");
 *   }}
 *   files={files}
 *   onFilesChange={setFiles}
 *   onAddFile={() => {
 *     // Open file picker
 *   }}
 *   placeholder="Ask a follow-up"
 *   allowDragDrop={true}
 * />
 * ```
 */

export const Inputbox = ({
  value = '',
  onChange,
  onSend,
  taskControlState = 'idle',
  onPauseTask,
  onResumeTask,
  taskControlLoading = false,
  files = [],
  showFileAttachments = true,
  header,
  onFilesChange,
  onAddFile,
  placeholder,
  placeholders,
  disabled = false,
  className,
  textareaRef: externalTextareaRef,
  allowDragDrop = false,
  privacy = true,
  useCloudModelInDev = false,
  connectorPanelOpen = false,
  onToggleConnectorPanel,
  skillPanelOpen = false,
  onToggleSkillPanel,
  onTriggerCreating: _onTriggerCreating,
  onTriggerCreated: _onTriggerCreated,
}: InputboxProps) => {
  const { t } = useTranslation();
  const enterLabel = getEnterKeyLabel(useDesktopShortcutPlatform());
  const internalTextareaRef = useRef<HTMLDivElement>(null);
  const textareaRef = externalTextareaRef || internalTextareaRef;
  const [isFocused, setIsFocused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const [hoveredFilePath, setHoveredFilePath] = useState<string | null>(null);
  const [isRemainingOpen, setIsRemainingOpen] = useState(false);
  const hoverCloseTimerRef = useRef<number | null>(null);
  const [isComposing, setIsComposing] = useState(false);

  const openRemainingPopover = () => {
    if (hoverCloseTimerRef.current) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
    setIsRemainingOpen(true);
  };

  const scheduleCloseRemainingPopover = () => {
    if (hoverCloseTimerRef.current) {
      window.clearTimeout(hoverCloseTimerRef.current);
    }
    hoverCloseTimerRef.current = window.setTimeout(() => {
      setIsRemainingOpen(false);
      hoverCloseTimerRef.current = null;
    }, 150);
  };

  // Auto-resize textarea on value changes (hug content up to max height)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value, textareaRef]);

  // Determine if we're in the "Input" state (has content or files)
  const hasContent = value.trim().length > 0 || files.length > 0;

  const handleTextChange = useCallback(
    (newValue: string, _cursorPos?: number) => {
      onChange?.(newValue);
    },
    [onChange]
  );

  const handleSend = () => {
    if (hasContent && !disabled) {
      onSend?.();
    } else if (!hasContent) {
      toast.error(t('chat.message-cannot-be-empty'), {
        closeButton: true,
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !disabled && !isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const primaryAction = hasContent
    ? 'send'
    : taskControlState === 'running'
      ? 'pause'
      : taskControlState === 'paused'
        ? 'resume'
        : 'idle';
  const showArrow = primaryAction === 'idle' || primaryAction === 'send';
  const primaryActionLabel =
    primaryAction === 'pause'
      ? t('chat.pause')
      : primaryAction === 'resume'
        ? t('layout.continue', { defaultValue: 'Continue' })
        : t('chat.send-now');
  const primaryActionDisabled =
    primaryAction === 'idle' ||
    taskControlLoading ||
    (primaryAction === 'send' && disabled) ||
    (primaryAction === 'pause' && !onPauseTask) ||
    (primaryAction === 'resume' && !onResumeTask);

  const handlePrimaryAction = () => {
    if (primaryActionDisabled) return;
    if (primaryAction === 'send') handleSend();
    if (primaryAction === 'pause') onPauseTask?.();
    if (primaryAction === 'resume') onResumeTask?.();
  };

  const handleRemoveFile = (filePath: string) => {
    const newFiles = files.filter((f) => f.filePath !== filePath);
    onFilesChange?.(newFiles);
  };

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
      return <Image className="size-3.5 text-ds-ink-default-default" />;
    }
    return <FileText className="size-3.5 text-ds-ink-default-default" />;
  };

  // Drag & drop handlers
  const isFileDrag = (e: React.DragEvent) => {
    try {
      return Array.from(e.dataTransfer?.types || []).includes('Files');
    } catch {
      return false;
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!allowDragDrop || !privacy || useCloudModelInDev) return;
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragging(true);
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!allowDragDrop || !privacy || useCloudModelInDev) return;
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    if (!allowDragDrop || !privacy || useCloudModelInDev) return;

    try {
      const dropped = Array.from(e.dataTransfer?.files || []);
      if (dropped.length === 0) return;

      console.log('[Drag-Drop] Processing dropped files:', dropped.length);

      const result = await processDroppedFiles(dropped, files);

      if (result.success) {
        console.log('[Drag-Drop] Setting files:', result.files);
        onFilesChange?.(result.files);
        toast.success(
          t('chat.files-added', {
            count: result.added,
            defaultValue_one: 'Added {{count}} file',
            defaultValue_other: 'Added {{count}} files',
          })
        );
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      console.error('[Drag-Drop] Error:', error);
      toast.error(
        t('chat.dropped-files-failed', {
          defaultValue: 'Failed to process dropped files',
        })
      );
    }
  };

  const handlePasteFiles = async (pasted: File[]) => {
    // Mirror the drag-and-drop gating: attachments are unavailable in
    // privacy-off / cloud-model-in-dev states.
    if (!privacy || useCloudModelInDev) return;
    try {
      const result = await processPastedFiles(pasted, files);
      if (result.success) {
        onFilesChange?.(result.files);
        toast.success(
          t('chat.files-added', {
            count: result.added,
            defaultValue_one: 'Added {{count}} file',
            defaultValue_other: 'Added {{count}} files',
          })
        );
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      console.error('[Paste] Error:', error);
      toast.error(
        t('chat.pasted-files-failed', {
          defaultValue: 'Failed to process pasted files',
        })
      );
    }
  };

  // Determine remaining files count (show max 5 files + count tag)
  const maxVisibleFiles = 5;
  const visibleFiles = files.slice(0, maxVisibleFiles);
  const remainingCount =
    files.length > maxVisibleFiles ? files.length - maxVisibleFiles : 0;

  return (
    <div
      data-bottom-box-input-surface
      className={cn(
        'relative flex w-full flex-col items-start rounded-3xl border border-x border-y border-solid border-ds-hairline-default-default bg-ds-neutral-subtle-default p-3 transition-colors',
        (isFocused || hasContent) &&
          'border-ds-border-information-default-default',
        isDragging &&
          'border-ds-hairline-strong-default bg-ds-bg-information-subtle-default',
        className
      )}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-x-2 border-y-2 border-dashed border-ds-hairline-strong-default bg-ds-bg-information-subtle-default text-ds-ink-default-default backdrop-blur-sm">
          <UploadCloud className="h-8 w-8" />
          <span className="block text-ds-text-base font-semibold">
            {t('chat.drop-files-to-attach')}
          </span>
        </div>
      )}
      {/* Layer 1: Input-required question / details */}
      {header && <BoxHeaderDisplay {...header} className="px-0 pt-0 pb-2" />}
      {/* Layer 2: File attachments (only show if has files) */}
      {showFileAttachments && files.length > 0 && (
        <div className="relative box-border flex w-full flex-wrap items-start gap-1 pb-2">
          {visibleFiles.map((file) => {
            const isHovered = hoveredFilePath === file.filePath;
            return (
              <div
                key={file.filePath}
                className={cn(
                  'relative box-border flex h-auto max-w-24 items-center gap-0.5 rounded-md bg-ds-neutral-default-default pr-1'
                )}
                onMouseEnter={() => setHoveredFilePath(file.filePath)}
                onMouseLeave={() =>
                  setHoveredFilePath((prev) =>
                    prev === file.filePath ? null : prev
                  )
                }
              >
                {/* File icon as a link that turns into remove on hover */}
                <a
                  href="#"
                  className={cn(
                    'flex h-6 w-6 cursor-pointer items-center justify-center rounded-md'
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleRemoveFile(file.filePath);
                  }}
                  title={isHovered ? t('chat.remove-file') : file.fileName}
                >
                  {isHovered ? (
                    <X className="size-3.5 text-ds-ink-muted-default" />
                  ) : (
                    getFileIcon(file.fileName)
                  )}
                </a>

                {/* File Name */}
                <span
                  className={cn(
                    "relative block min-h-px min-w-px flex-1 overflow-hidden font-['Inter'] text-xs leading-tight font-bold text-ellipsis whitespace-nowrap text-ds-ink-default-default"
                  )}
                  title={file.fileName}
                >
                  {file.fileName}
                </span>
              </div>
            );
          })}
          {/* Show remaining count if more than 5 files */}
          {remainingCount > 0 && (
            <Popover open={isRemainingOpen} onOpenChange={setIsRemainingOpen}>
              <PopoverTrigger asChild>
                <Button
                  size="xs"
                  variant="ghost"
                  buttonContent="text"
                  textWeight="bold"
                  buttonRadius="full"
                  className="relative box-border flex h-auto items-center rounded-lg bg-ds-neutral-strong-default"
                  onMouseEnter={openRemainingPopover}
                  onMouseLeave={scheduleCloseRemainingPopover}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <span className="block font-['Inter'] text-xs leading-tight font-bold whitespace-nowrap text-ds-ink-default-default">
                    {remainingCount}+
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                side="right"
                sideOffset={4}
                className="!w-auto max-w-40 rounded-lg border-solid border-ds-hairline-subtle-default bg-ds-neutral-default-default p-1 shadow-ds-elevation-popover"
                onMouseEnter={openRemainingPopover}
                onMouseLeave={scheduleCloseRemainingPopover}
              >
                <div className="scrollbar-hide flex max-h-[176px] flex-col gap-1 overflow-auto">
                  {files.slice(maxVisibleFiles).map((file) => {
                    const isHovered = hoveredFilePath === file.filePath;
                    return (
                      <div
                        key={file.filePath}
                        className="flex cursor-pointer items-center gap-1 rounded-lg bg-ds-neutral-strong-default px-1 py-0.5 transition-colors duration-300 hover:bg-ds-neutral-default-hover"
                        onMouseEnter={() => setHoveredFilePath(file.filePath)}
                        onMouseLeave={() =>
                          setHoveredFilePath((prev) =>
                            prev === file.filePath ? null : prev
                          )
                        }
                      >
                        <a
                          href="#"
                          className={cn(
                            'flex h-6 w-6 cursor-pointer items-center justify-center rounded-md'
                          )}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleRemoveFile(file.filePath);
                            setIsRemainingOpen(false);
                          }}
                          title={
                            isHovered ? t('chat.remove-file') : file.fileName
                          }
                        >
                          {isHovered ? (
                            <X className="size-4 text-ds-ink-muted-default" />
                          ) : (
                            getFileIcon(file.fileName)
                          )}
                        </a>
                        <span className="block flex-1 overflow-hidden font-['Inter'] text-xs leading-tight font-bold text-ellipsis whitespace-nowrap text-ds-ink-default-default">
                          {file.fileName}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}

      {/* Layer 3: Text input area */}
      <div
        data-text-input
        className="relative flex w-full flex-1 items-start justify-center gap-2.5 pb-3"
      >
        <RichChatInput
          ref={textareaRef as React.RefObject<HTMLDivElement>}
          value={value}
          onChange={(next, cursorPos) =>
            handleTextChange(next, cursorPos ?? undefined)
          }
          onKeyDown={handleKeyDown}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onPasteFiles={handlePasteFiles}
          disabled={disabled}
          placeholder={placeholder}
          placeholders={placeholders}
          className={cn(
            'border-none shadow-none focus-visible:ring-0',
            'max-h-[200px] min-h-[40px]'
          )}
          textClassName="text-ds-ink-default-default"
          style={{
            fontFamily: 'Inter',
            fontSize: '13px',
            lineHeight: '20px',
          }}
          maxHeightPx={200}
        />
      </div>

      {/* Layer 4: Action buttons */}
      <div
        data-input-actions
        className="flex w-full flex-wrap items-center justify-between gap-y-2"
      >
        {/* Left: add files/photos + connector picker + skill picker */}
        <div className="flex min-w-0 items-center gap-1">
          <TooltipSimple content="Attach" side="top">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              textWeight="bold"
              buttonRadius="lg"
              disabled={
                disabled ||
                !privacy ||
                useCloudModelInDev ||
                typeof onAddFile !== 'function'
              }
              aria-label={t('chat.input-attach-add-files-or-photos')}
              onClick={() => onAddFile?.()}
            >
              <Paperclip />
            </Button>
          </TooltipSimple>
          {onToggleConnectorPanel && (
            <TooltipSimple content="MCPs" side="top">
              <Button
                type="button"
                data-picker-trigger
                variant="ghost"
                size="sm"
                buttonContent="icon-only"
                textWeight="bold"
                buttonRadius="lg"
                disabled={disabled}
                aria-label={t('chat.input-add-connector', {
                  defaultValue: 'Add connectors',
                })}
                aria-haspopup="true"
                aria-expanded={connectorPanelOpen}
                className={cn(
                  connectorPanelOpen && 'bg-ds-neutral-strong-default'
                )}
                onClick={onToggleConnectorPanel}
              >
                <Cable />
              </Button>
            </TooltipSimple>
          )}
          {onToggleSkillPanel && (
            <TooltipSimple content="Skills" side="top">
              <Button
                type="button"
                data-picker-trigger
                variant="ghost"
                size="sm"
                buttonContent="icon-only"
                textWeight="bold"
                buttonRadius="lg"
                disabled={disabled}
                aria-label={t('chat.input-add-skill', {
                  defaultValue: 'Add skills',
                })}
                aria-haspopup="true"
                aria-expanded={skillPanelOpen}
                className={cn(skillPanelOpen && 'bg-ds-neutral-strong-default')}
                onClick={onToggleSkillPanel}
              >
                <WandSparkles />
              </Button>
            </TooltipSimple>
          )}
        </div>

        {/* Right: send or control the current task when the draft is empty. */}
        <div className="flex shrink-0 items-center gap-2">
          <TooltipSimple
            content={
              <ShortcutTooltipContent
                label={primaryActionLabel}
                shortcutLabel={
                  primaryAction === 'send' ? enterLabel : undefined
                }
              />
            }
            compact
            side="top"
            variant="instant"
          >
            <Button
              type="button"
              size="sm"
              buttonContent="icon-only"
              textWeight="bold"
              buttonRadius="full"
              variant="primary"
              tone={
                primaryAction === 'send' || primaryAction === 'resume'
                  ? 'success'
                  : 'default'
              }
              aria-label={primaryActionLabel}
              aria-busy={taskControlLoading || undefined}
              data-composer-primary-action={primaryAction}
              onClick={handlePrimaryAction}
              disabled={primaryActionDisabled}
            >
              <span
                className="relative grid size-ds-icon-md place-items-center leading-none"
                aria-hidden
              >
                <ArrowRight
                  data-composer-primary-icon="arrow"
                  style={PRIMARY_ACTION_ICON_MOTION_STYLE}
                  className={cn(
                    PRIMARY_ACTION_ICON_MOTION_CLASS,
                    showArrow
                      ? primaryAction === 'send'
                        ? '-rotate-90 opacity-100'
                        : 'rotate-0 opacity-100'
                      : 'rotate-0 opacity-0'
                  )}
                />
                <Square
                  data-composer-primary-icon="pause"
                  style={PRIMARY_ACTION_ICON_MOTION_STYLE}
                  className={cn(
                    PRIMARY_ACTION_ICON_MOTION_CLASS,
                    primaryAction === 'pause'
                      ? 'rotate-0 opacity-100'
                      : 'rotate-90 opacity-0'
                  )}
                />
                <Play
                  data-composer-primary-icon="play"
                  style={PRIMARY_ACTION_ICON_MOTION_STYLE}
                  className={cn(
                    PRIMARY_ACTION_ICON_MOTION_CLASS,
                    primaryAction === 'resume'
                      ? 'rotate-0 opacity-100'
                      : '-rotate-90 opacity-0'
                  )}
                />
              </span>
            </Button>
          </TooltipSimple>
        </div>
      </div>
    </div>
  );
};
