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

import { TriggerDialog } from '@/components/Trigger/TriggerDialog';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { processDroppedFiles } from '@/lib/fileUtils';
import { cn } from '@/lib/utils';
import type { TriggerInput } from '@/types';
import { AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  AtSign,
  FileText,
  Image,
  Maximize2,
  Plus,
  UploadCloud,
  X,
  Zap,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ExpandedInputBox } from './ExpandedInputBox';
import {
  BUILTIN_AGENTS,
  getAgentMentionTheme,
  MENTION_DROPDOWN_PANEL_CLASS,
  MentionAgent,
  MentionDropdown,
} from './MentionDropdown';
import { getRichInputSelection, RichChatInput } from './RichChatInput';

// Module-level singleton to track which InputBox instance has the expanded dialog open
// This prevents multiple dialogs from opening when Cmd+P is pressed
let activeExpandedDialogId: string | null = null;

/**
 * File attachment object
 */
export interface FileAttachment {
  fileName: string;
  filePath: string;
}

/**
 * Inputbox Props
 */
export interface InputboxProps {
  /** Current text value */
  value?: string;
  /** Callback when text changes */
  onChange?: (value: string) => void;
  /** Callback when send button is clicked (only fires when value is not empty) */
  onSend?: () => void;
  /** Array of file attachments */
  files?: FileAttachment[];
  /** Callback when files are modified */
  onFilesChange?: (files: FileAttachment[]) => void;
  /** Callback when add file button is clicked */
  onAddFile?: () => void;
  /** Placeholder text for empty state */
  placeholder?: string;
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
  /** Active @mention target (e.g. "browser") — shown as a tag in the input */
  mentionTarget?: string | null;
  /** Callback when mention target changes */
  onMentionTargetChange?: (target: string | null) => void;
  /** Callback when trigger is being created (for placeholder) */
  onTriggerCreating?: (triggerData: TriggerInput) => void;
  /** Callback when trigger is created successfully */
  onTriggerCreated?: (triggerData: TriggerInput) => void;
  /** Hide the expand button (used when InputBox is already inside ExpandedInputBox) */
  hideExpandButton?: boolean;
  /** When true, show collapse control in the expand slot (expanded modal) */
  isExpandedInput?: boolean;
  /** Called when user collapses from expanded input (same control as expand) */
  onCollapseExpanded?: () => void;
}

/**
 * Inputbox Component
 *
 * A multi-state input component with two visual states:
 * - **Default**: Empty state with placeholder text and disabled send button
 * - **Focus/Input**: Active state with content, file attachments, and active send button
 *
 * Features:
 * - Auto-expanding rich text input (links + #skills, up to 200px height)
 * - File attachment display (shows up to 5 files + count indicator)
 * - Action buttons (add file on left, send on right)
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
 *   placeholder="What do you need to achieve today?"
 *   allowDragDrop={true}
 * />
 * ```
 */

export const Inputbox = ({
  value = '',
  onChange,
  onSend,
  files = [],
  onFilesChange,
  onAddFile,
  placeholder: _placeholder = 'Ask Eigent to automate your tasks',
  disabled = false,
  className,
  textareaRef: externalTextareaRef,
  allowDragDrop = false,
  privacy = true,
  useCloudModelInDev = false,
  mentionTarget,
  onMentionTargetChange,
  onTriggerCreating: _onTriggerCreating,
  onTriggerCreated: _onTriggerCreated,
  hideExpandButton = false,
  isExpandedInput = false,
  onCollapseExpanded,
}: InputboxProps) => {
  const { t } = useTranslation();
  const internalTextareaRef = useRef<HTMLDivElement>(null);
  const textareaRef = externalTextareaRef || internalTextareaRef;
  const [isFocused, setIsFocused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const [hoveredFilePath, setHoveredFilePath] = useState<string | null>(null);
  const [isRemainingOpen, setIsRemainingOpen] = useState(false);
  const hoverCloseTimerRef = useRef<number | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [mentionState, setMentionState] = useState<{
    visible: boolean;
    filter: string;
    startIndex: number;
  }>({ visible: false, filter: '', startIndex: -1 });
  const [isExpandedDialogOpen, setIsExpandedDialogOpen] = useState(false);
  const [triggerDialogOpen, setTriggerDialogOpen] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const reactId = React.useId();
  const instanceIdRef = useRef<string>(`inputbox-${reactId}`);

  // Handle dialog open/close with singleton tracking
  const handleExpandedDialogChange = useCallback((open: boolean) => {
    if (open) {
      activeExpandedDialogId = instanceIdRef.current;
      setIsExpandedDialogOpen(true);
    } else {
      if (activeExpandedDialogId === instanceIdRef.current) {
        activeExpandedDialogId = null;
      }
      setIsExpandedDialogOpen(false);
    }
  }, []);

  // Keyboard shortcut handler for Cmd+P / Ctrl+P
  // Opens dialog if none is open, or closes if this instance owns the open dialog
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();

        // If this instance has the dialog open, close it
        if (
          isExpandedDialogOpen &&
          activeExpandedDialogId === instanceIdRef.current
        ) {
          handleExpandedDialogChange(false);
        }
        // If no dialog is open, open this one
        else if (activeExpandedDialogId === null) {
          handleExpandedDialogChange(true);
        }
        // Otherwise another instance has it open, do nothing
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExpandedDialogOpen, handleExpandedDialogChange]);

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
  const isActive = isFocused || hasContent;

  const handleTextChange = useCallback(
    (newValue: string, cursorPos?: number) => {
      onChange?.(newValue);

      // Detect @ mention
      const pos = cursorPos ?? newValue.length;
      const textBeforeCursor = newValue.slice(0, pos);
      const lastAtIndex = textBeforeCursor.lastIndexOf('@');

      if (
        lastAtIndex >= 0 &&
        (lastAtIndex === 0 ||
          textBeforeCursor[lastAtIndex - 1] === ' ' ||
          textBeforeCursor[lastAtIndex - 1] === '\n')
      ) {
        const filterText = textBeforeCursor.slice(lastAtIndex + 1);
        if (!/\s/.test(filterText)) {
          setAgentPickerOpen(false);
          setMentionState({
            visible: true,
            filter: filterText,
            startIndex: lastAtIndex,
          });
          return;
        }
      }
      setMentionState({ visible: false, filter: '', startIndex: -1 });
    },
    [onChange, setAgentPickerOpen, setMentionState]
  );

  const handleMentionSelect = (agent: MentionAgent) => {
    // Remove the "@filter" text from the input and set the
    // mention target as a rendered tag instead
    const currentValue = value;
    const before = currentValue.slice(0, mentionState.startIndex);
    const afterFilterEnd =
      mentionState.startIndex + 1 + mentionState.filter.length;
    const after = currentValue.slice(afterFilterEnd);
    const newValue = `${before}${after}`.trimStart();
    onChange?.(newValue);
    onMentionTargetChange?.(agent.id);
    setAgentPickerOpen(false);
    setMentionState({ visible: false, filter: '', startIndex: -1 });

    // Focus textarea
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
      }
    });
  };

  const handleSend = () => {
    if (value.trim().length > 0 && !disabled) {
      onSend?.();
    } else if (value.trim().length === 0) {
      toast.error(t('chat.message-cannot-be-empty'), {
        closeButton: true,
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // When mention dropdown is open, let it handle navigation keys
    if (mentionState.visible) {
      if (['ArrowUp', 'ArrowDown', 'Tab', 'Escape', 'Enter'].includes(e.key)) {
        e.preventDefault(); // Stop input from scrolling / inserting newline
        return; // Let MentionDropdown's global handler handle these
      }
    }
    // Backspace at cursor position 0 removes the mention tag
    const sel = getRichInputSelection(textareaRef.current);
    if (
      e.key === 'Backspace' &&
      mentionTarget &&
      sel.start === 0 &&
      sel.end === 0
    ) {
      e.preventDefault();
      onMentionTargetChange?.(null);
    }
    if (e.key === 'Enter' && !e.shiftKey && !disabled && !isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleRemoveFile = (filePath: string) => {
    const newFiles = files.filter((f) => f.filePath !== filePath);
    onFilesChange?.(newFiles);
  };

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
      return <Image className="size-3.5 text-icon-primary" />;
    }
    return <FileText className="size-3.5 text-icon-primary" />;
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
        toast.success(`Added ${result.added} file(s)`);
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      console.error('[Drag-Drop] Error:', error);
      toast.error('Failed to process dropped files');
    }
  };

  // Determine remaining files count (show max 5 files + count tag)
  const maxVisibleFiles = 5;
  const visibleFiles = files.slice(0, maxVisibleFiles);
  const remainingCount =
    files.length > maxVisibleFiles ? files.length - maxVisibleFiles : 0;

  return (
    <div
      className={cn(
        'rounded-3xl border-input-border-default bg-input-bg-input p-3 relative box-border flex w-full flex-col items-start border border-solid transition-colors',
        isFocused && 'border-input-border-focus',
        isDragging && 'border-info-primary bg-info-primary/10',
        className
      )}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="border-info-primary bg-info-primary/10 text-info-primary inset-0 gap-2 rounded-2xl backdrop-blur-sm pointer-events-none absolute z-20 flex flex-col items-center justify-center border-2 border-dashed">
          <UploadCloud className="h-8 w-8" />
          <div className="text-sm font-semibold">
            {t('chat.drop-files-to-attach')}
          </div>
        </div>
      )}
      {/* Layer 1: Agent mention — picker row; expand input on the right */}
      <div className="gap-2 relative box-border flex w-full items-center justify-between">
        <div className="min-w-0 relative shrink">
          <Popover
            open={agentPickerOpen}
            onOpenChange={(open) => {
              setAgentPickerOpen(open);
              if (open) {
                setMentionState({
                  visible: false,
                  filter: '',
                  startIndex: -1,
                });
              }
            }}
          >
            {!mentionTarget ? (
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  buttonContent="text"
                  textWeight="normal"
                  buttonRadius="full"
                  className="bg-surface-hover-subtle"
                  disabled={disabled}
                >
                  <AtSign className="text-icon-primary size-3" />
                  {t('chat.select-agent')}
                </Button>
              </PopoverTrigger>
            ) : (
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  buttonContent="text"
                  textWeight="normal"
                  buttonRadius="full"
                  disabled={disabled}
                  title={t('chat.select-agent')}
                  className={cn(
                    'min-w-0 gap-1 max-w-[min(100%,240px)] !justify-between focus:!ring-0 focus:!ring-offset-0 focus-visible:!ring-0 focus-visible:!ring-offset-0 focus-visible:outline-none',
                    getAgentMentionTheme(mentionTarget).chip
                  )}
                >
                  <AtSign
                    className="size-3.5 shrink-0 opacity-60"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {BUILTIN_AGENTS.find((a) => a.id === mentionTarget)
                      ?.label ?? mentionTarget}
                  </span>
                </Button>
              </PopoverTrigger>
            )}
            <PopoverContent
              align="start"
              alignOffset={-8}
              side="top"
              sideOffset={2}
              className={cn(MENTION_DROPDOWN_PANEL_CLASS, 'overflow-hidden')}
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <MentionDropdown
                inline
                visible
                filter=""
                selectedAgentId={mentionTarget}
                onSelect={(agent) => {
                  onMentionTargetChange?.(agent.id);
                  setAgentPickerOpen(false);
                }}
                onClose={() => setAgentPickerOpen(false)}
              />
            </PopoverContent>
          </Popover>
          <MentionDropdown
            visible={mentionState.visible}
            filter={mentionState.filter}
            selectedAgentId={mentionTarget}
            onSelect={handleMentionSelect}
            onClose={() =>
              setMentionState({ visible: false, filter: '', startIndex: -1 })
            }
          />
        </div>
        {isExpandedInput ? (
          <Button
            variant="ghost"
            size="xs"
            buttonContent="icon-only"
            textWeight="bold"
            buttonRadius="full"
            className="shrink-0 opacity-40"
            onClick={() => onCollapseExpanded?.()}
            disabled={disabled}
            title={t('chat.collapse-input')}
          >
            <X className="text-icon-primary size-3.5" />
          </Button>
        ) : !hideExpandButton ? (
          <Button
            variant="ghost"
            size="xs"
            buttonContent="icon-only"
            textWeight="bold"
            buttonRadius="full"
            className="shrink-0 opacity-40"
            onClick={() => handleExpandedDialogChange(true)}
            disabled={disabled}
            title={t('chat.expand-input')}
          >
            <Maximize2 className="text-icon-primary size-3.5" />
          </Button>
        ) : null}
      </div>

      {/* Layer 2: File attachments (only show if has files) */}
      {files.length > 0 && (
        <div className="gap-1 pt-2 relative box-border flex w-full flex-wrap items-start">
          {visibleFiles.map((file) => {
            const isHovered = hoveredFilePath === file.filePath;
            return (
              <div
                key={file.filePath}
                className={cn(
                  'max-w-24 gap-0.5 rounded-md bg-tag-surface pr-1 relative box-border flex h-auto items-center'
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
                    'h-6 w-6 rounded-md flex cursor-pointer items-center justify-center'
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleRemoveFile(file.filePath);
                  }}
                  title={isHovered ? t('chat.remove-file') : file.fileName}
                >
                  {isHovered ? (
                    <X className="size-3.5 text-icon-secondary" />
                  ) : (
                    getFileIcon(file.fileName)
                  )}
                </a>

                {/* File Name */}
                <p
                  className={cn(
                    "my-0 text-xs font-bold leading-tight text-text-body relative min-h-px min-w-px flex-1 overflow-hidden font-['Inter'] overflow-ellipsis whitespace-nowrap"
                  )}
                  title={file.fileName}
                >
                  {file.fileName}
                </p>
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
                  className="rounded-lg bg-tag-surface relative box-border flex h-auto items-center"
                  onMouseEnter={openRemainingPopover}
                  onMouseLeave={scheduleCloseRemainingPopover}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <p className="my-0 text-xs font-bold leading-tight text-text-body font-['Inter'] whitespace-nowrap">
                    {remainingCount}+
                  </p>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                side="right"
                sideOffset={4}
                className="max-w-40 rounded-lg border-dropdown-border bg-dropdown-bg p-1 shadow-perfect !w-auto border"
                onMouseEnter={openRemainingPopover}
                onMouseLeave={scheduleCloseRemainingPopover}
              >
                <div className="scrollbar-hide gap-1 flex max-h-[176px] flex-col overflow-auto">
                  {files.slice(maxVisibleFiles).map((file) => {
                    const isHovered = hoveredFilePath === file.filePath;
                    return (
                      <div
                        key={file.filePath}
                        className="gap-1 rounded-lg bg-tag-surface px-1 py-0.5 hover:bg-tag-surface-hover flex cursor-pointer items-center transition-colors duration-300"
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
                            'h-6 w-6 rounded-md flex cursor-pointer items-center justify-center'
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
                            <X className="size-4 text-icon-secondary" />
                          ) : (
                            getFileIcon(file.fileName)
                          )}
                        </a>
                        <p className="my-0 text-xs font-bold leading-tight text-text-body flex-1 overflow-hidden font-['Inter'] text-ellipsis whitespace-nowrap">
                          {file.fileName}
                        </p>
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
      <div className="gap-2.5 py-3 relative box-border flex w-full flex-1 items-start justify-center">
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
          disabled={disabled}
          placeholder={t('chat.ask-placeholder')}
          className={cn(
            'border-none shadow-none focus-visible:ring-0',
            'max-h-[200px] min-h-[40px]'
          )}
          textClassName={
            isActive ? 'text-input-text-focus' : 'text-input-text-default'
          }
          style={{
            fontFamily: 'Inter',
            fontSize: '13px',
            lineHeight: '20px',
          }}
          maxHeightPx={200}
        />
      </div>

      {/* Layer 4: Action buttons */}
      <div className="relative flex w-full items-center justify-between">
        {/* Left: Add File Button and Add Trigger Button */}
        <div className="gap-1 relative flex items-center">
          <Button
            variant="ghost"
            size="xs"
            buttonContent="icon-only"
            textWeight="bold"
            buttonRadius="lg"
            onClick={onAddFile}
            disabled={disabled || !privacy || useCloudModelInDev}
          >
            <Plus className="text-icon-primary" />
          </Button>

          {/* Add Trigger Button - opens TriggerDialog */}
          <Button
            variant="ghost"
            size="xs"
            buttonContent="text"
            textWeight="bold"
            buttonRadius="full"
            className="rounded-lg"
            disabled={disabled}
            onClick={() => setTriggerDialogOpen(true)}
          >
            <Zap className="text-icon-primary" />
            {t('triggers.trigger-label')}
          </Button>

          {/* TriggerDialog for adding trigger and task */}
          <TriggerDialog
            selectedTrigger={null}
            isOpen={triggerDialogOpen}
            onOpenChange={setTriggerDialogOpen}
            initialTaskPrompt={value}
          />
        </div>

        {/* Right: Send Button */}
        <div className="gap-1 flex items-center">
          <Button
            size="xs"
            buttonContent="icon-only"
            textWeight="bold"
            buttonRadius="full"
            variant={value.trim().length > 0 ? 'success' : 'secondary'}
            className="rounded-full"
            onClick={handleSend}
            disabled={disabled || value.trim().length === 0}
          >
            <ArrowRight
              className={cn(
                'text-button-primary-icon-default transition-transform duration-200',
                value.trim().length > 0 && 'rotate-[-90deg]'
              )}
            />
            {/* Inner shadow highlight (from Figma design) */}
            <div className="inset-0 pointer-events-none absolute shadow-[0px_1px_0px_0px_inset_rgba(255,255,255,0.33)]" />
          </Button>
        </div>

        {/* Expanded Input Box */}
        <AnimatePresence>
          {isExpandedDialogOpen && (
            <ExpandedInputBox
              inputProps={{
                value,
                onChange,
                onSend,
                files,
                onFilesChange,
                onAddFile,
                disabled,
                privacy,
                useCloudModelInDev,
              }}
              onClose={() => handleExpandedDialogChange(false)}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
