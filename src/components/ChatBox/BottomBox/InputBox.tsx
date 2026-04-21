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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { WorkspaceSessionModeToggle } from '@/components/Workspace/WorkspaceSessionModeToggle';
import { processDroppedFiles } from '@/lib/fileUtils';
import { cn } from '@/lib/utils';
import type { TriggerInput } from '@/types';
import type { SessionModeType } from '@/types/constants';
import {
  ArrowRight,
  Compass,
  FileText,
  Hammer,
  Image,
  Paperclip,
  Plus,
  UploadCloud,
  Wand2,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ChatInputModelDropdown } from './ChatInputModelDropdown';
import { RichChatInput } from './RichChatInput';

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
  /** Session mode for the mode-select row; omit to hide it. */
  sessionMode?: SessionModeType;
  /** Called when the user changes mode (workspace only). */
  onSessionModeChange?: (mode: SessionModeType) => void;
  /** Full toggle on workspace; on session chat, only the current mode is shown. */
  sessionModeSelectInteractive?: boolean;
  /** Callback when trigger is being created (for placeholder) */
  onTriggerCreating?: (triggerData: TriggerInput) => void;
  /** Callback when trigger is created successfully */
  onTriggerCreated?: (triggerData: TriggerInput) => void;
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
 *   placeholder="Ask a follow-up"
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
  placeholder,
  placeholders,
  disabled = false,
  className,
  textareaRef: externalTextareaRef,
  allowDragDrop = false,
  privacy = true,
  useCloudModelInDev = false,
  sessionMode,
  onSessionModeChange,
  sessionModeSelectInteractive = false,
  onTriggerCreating: _onTriggerCreating,
  onTriggerCreated: _onTriggerCreated,
}: InputboxProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
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
    if (value.trim().length > 0 && !disabled) {
      onSend?.();
    } else if (value.trim().length === 0) {
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

  const handleRemoveFile = (filePath: string) => {
    const newFiles = files.filter((f) => f.filePath !== filePath);
    onFilesChange?.(newFiles);
  };

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
      return (
        <Image className="size-3.5 text-[color:var(--ds-icon-neutral-default-default)]" />
      );
    }
    return (
      <FileText className="size-3.5 text-[color:var(--ds-icon-neutral-default-default)]" />
    );
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
        'rounded-3xl p-3 border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default shadow-lg relative flex w-full flex-col items-start border border-solid transition-colors',
        (isFocused || hasContent) &&
          'border-ds-border-information-default-default',
        isDragging &&
          'border-ds-border-neutral-strong-default bg-ds-bg-information-subtle-default',
        className
      )}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="inset-0 gap-2 rounded-2xl backdrop-blur-sm border-ds-border-neutral-strong-default bg-ds-bg-information-subtle-default text-ds-text-neutral-default-default pointer-events-none absolute z-20 flex flex-col items-center justify-center border-2 border-dashed">
          <UploadCloud className="h-8 w-8" />
          <div className="text-sm font-semibold">
            {t('chat.drop-files-to-attach')}
          </div>
        </div>
      )}
      {/* Layer 2: File attachments (only show if has files) */}
      {files.length > 0 && (
        <div className="gap-1 pb-2 relative box-border flex w-full flex-wrap items-start">
          {visibleFiles.map((file) => {
            const isHovered = hoveredFilePath === file.filePath;
            return (
              <div
                key={file.filePath}
                className={cn(
                  'max-w-24 gap-0.5 rounded-md pr-1 bg-ds-bg-neutral-default-default relative box-border flex h-auto items-center'
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
                    <X className="size-3.5 text-[color:var(--ds-icon-neutral-muted-default)]" />
                  ) : (
                    getFileIcon(file.fileName)
                  )}
                </a>

                {/* File Name */}
                <p
                  className={cn(
                    "my-0 text-xs font-bold leading-tight relative min-h-px min-w-px flex-1 overflow-hidden font-['Inter'] overflow-ellipsis whitespace-nowrap text-[color:var(--ds-text-neutral-default-default)]"
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
                  className="rounded-lg bg-ds-bg-neutral-strong-default relative box-border flex h-auto items-center"
                  onMouseEnter={openRemainingPopover}
                  onMouseLeave={scheduleCloseRemainingPopover}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <p className="my-0 text-xs font-bold leading-tight text-ds-text-neutral-default-default font-['Inter'] whitespace-nowrap">
                    {remainingCount}+
                  </p>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                side="right"
                sideOffset={4}
                className="max-w-40 rounded-lg p-1 shadow-perfect border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default !w-auto border-solid"
                onMouseEnter={openRemainingPopover}
                onMouseLeave={scheduleCloseRemainingPopover}
              >
                <div className="scrollbar-hide gap-1 flex max-h-[176px] flex-col overflow-auto">
                  {files.slice(maxVisibleFiles).map((file) => {
                    const isHovered = hoveredFilePath === file.filePath;
                    return (
                      <div
                        key={file.filePath}
                        className="gap-1 rounded-lg px-1 py-0.5 bg-ds-bg-neutral-strong-default hover:bg-ds-bg-neutral-default-hover flex cursor-pointer items-center transition-colors duration-300"
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
                            <X className="size-4 text-ds-icon-neutral-muted-default" />
                          ) : (
                            getFileIcon(file.fileName)
                          )}
                        </a>
                        <p className="my-0 text-xs font-bold leading-tight text-ds-text-neutral-default-default flex-1 overflow-hidden font-['Inter'] text-ellipsis whitespace-nowrap">
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
      <div className="gap-2.5 pb-3 relative flex w-full flex-1 items-start justify-center">
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
          placeholder={placeholder}
          placeholders={placeholders}
          className={cn(
            'border-none shadow-none focus-visible:ring-0',
            'max-h-[200px] min-h-[40px]'
          )}
          textClassName="text-ds-text-neutral-default-default"
          style={{
            fontFamily: 'Inter',
            fontSize: '13px',
            lineHeight: '20px',
          }}
          maxHeightPx={200}
        />
      </div>

      {/* Layer 4: Action buttons */}
      <div className="flex w-full items-center justify-between">
        {/* Left: Add File Button and Add Trigger Button */}
        <div className="gap-2 flex items-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                buttonContent="icon-only"
                textWeight="bold"
                buttonRadius="lg"
                disabled={disabled}
                aria-label={t('chat.input-attach-menu-trigger')}
                aria-haspopup="menu"
              >
                <Plus />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              className="min-w-[13.5rem]"
            >
              <DropdownMenuItem
                disabled={
                  !privacy ||
                  useCloudModelInDev ||
                  typeof onAddFile !== 'function'
                }
                onSelect={() => {
                  onAddFile?.();
                }}
              >
                <Paperclip
                  className="text-ds-icon-neutral-default-default"
                  aria-hidden
                />
                {t('chat.input-attach-add-files-or-photos')}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="-mx-1 my-1 bg-ds-border-neutral-default-default" />
              {/* Submenus use alignOffset: Radix SubContent is fixed top-aligned; negative offset bottom-aligns panel to trigger row */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="gap-2">
                  <Wand2
                    className="text-ds-icon-neutral-default-default"
                    aria-hidden
                  />
                  {t('chat.input-attach-skills')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  sideOffset={6}
                  alignOffset={-40}
                  className="min-w-[13.5rem]"
                >
                  <DropdownMenuItem
                    onSelect={() =>
                      navigate(
                        '/history?tab=agents&section=skills&skillAction=upload'
                      )
                    }
                  >
                    {t('chat.input-attach-upload-new-skill')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      navigate('/history?tab=agents&section=skills')
                    }
                  >
                    {t('chat.input-attach-manage-skills')}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="gap-2">
                  <Hammer
                    className="text-ds-icon-neutral-default-default"
                    aria-hidden
                  />
                  {t('layout.connectors')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  sideOffset={6}
                  alignOffset={-40}
                  className="min-w-[13.5rem]"
                >
                  <DropdownMenuItem
                    onSelect={() =>
                      navigate('/history?tab=connectors&connectorAction=add')
                    }
                  >
                    {t('chat.input-attach-add-mcp')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => navigate('/history?tab=connectors')}
                  >
                    {t('chat.input-attach-manage-connectors')}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="gap-2">
                  <Compass
                    className="text-ds-icon-neutral-default-default"
                    aria-hidden
                  />
                  {t('layout.browser')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  sideOffset={6}
                  alignOffset={-40}
                  className="min-w-[13.5rem]"
                >
                  <DropdownMenuItem
                    onSelect={() =>
                      navigate('/history?tab=browser&browserAction=launch')
                    }
                  >
                    {t('chat.input-attach-open-browser')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => navigate('/history?tab=browser')}
                  >
                    {t('chat.input-attach-manage-browsers')}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
          <ChatInputModelDropdown disabled={disabled} />
        </div>

        {/* Right: Session mode (workspace: full toggle; session: current mode only) + send */}
        <div className="gap-2 flex items-center">
          {sessionMode !== undefined && (
            <WorkspaceSessionModeToggle
              value={sessionMode}
              onValueChange={onSessionModeChange ?? (() => {})}
              readOnly={!sessionModeSelectInteractive}
              className="shrink-0"
            />
          )}
          <Button
            size="xs"
            buttonContent="icon-only"
            textWeight="bold"
            buttonRadius="full"
            variant={value.trim().length > 0 ? 'primary' : 'primary'}
            tone={value.trim().length > 0 ? 'success' : 'default'}
            onClick={handleSend}
            disabled={disabled || value.trim().length === 0}
          >
            <ArrowRight
              className={cn(
                'text-current transition-transform duration-200',
                value.trim().length > 0 && 'rotate-[-90deg]'
              )}
            />
          </Button>
        </div>
      </div>
    </div>
  );
};
