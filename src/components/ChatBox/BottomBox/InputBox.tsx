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
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  ArrowRight,
  FileText,
  Image,
  Plus,
  UploadCloud,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

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
  /** Ref for textarea */
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  /** Allow drag and drop */
  allowDragDrop?: boolean;
  /** Privacy mode enabled */
  privacy?: boolean;
  /** Use cloud model in dev */
  useCloudModelInDev?: boolean;
}

/**
 * Inputbox Component
 *
 * A multi-state input component with two visual states:
 * - **Default**: Empty state with placeholder text and disabled send button
 * - **Focus/Input**: Active state with content, file attachments, and active send button
 *
 * Features:
 * - Auto-expanding textarea (up to 100px height)
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
}: InputboxProps) => {
  const { t } = useTranslation();
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
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
  const isActive = isFocused || hasContent;

  const handleTextChange = (newValue: string) => {
    onChange?.(newValue);
  };

  const handleSend = () => {
    if (value.trim().length > 0 && !disabled) {
      onSend?.();
    } else if (value.trim().length === 0) {
      toast.error('Message cannot be empty', {
        closeButton: true,
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
      return <Image className="h-4 w-4 text-icon-primary" />;
    }
    return <FileText className="h-4 w-4 text-icon-primary" />;
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

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    if (!allowDragDrop || !privacy || useCloudModelInDev) return;
    try {
      const dropped = Array.from(e.dataTransfer?.files || []);
      if (dropped.length === 0) return;
      const mapped = dropped.map((f: File) => ({
        fileName: f.name,
        filePath: (f as any).path || f.name,
      }));
      const newFiles = [
        ...files.filter(
          (f: FileAttachment) => !mapped.find((m) => m.filePath === f.filePath)
        ),
        ...mapped.filter((m) => !files.find((f) => f.filePath === m.filePath)),
      ];
      onFilesChange?.(newFiles);
    } catch (error) {
      console.error('Drop File Error:', error);
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
        'relative box-border flex w-full flex-col items-start rounded-2xl border border-solid border-input-border-default bg-input-bg-input px-2 pb-2 pt-0 transition-colors',
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
        <div className="border-info-primary bg-info-primary/10 text-info-primary pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed backdrop-blur-sm">
          <UploadCloud className="h-8 w-8" />
          <div className="text-sm font-semibold">Drop files to attach</div>
        </div>
      )}
      {/* Text Input Area */}
      <div className="relative box-border flex w-full items-center justify-center gap-2.5 px-0 pb-2 pt-2.5">
        <div className="relative mx-2 box-border flex min-h-px min-w-px flex-1 items-center justify-center gap-2.5 py-0">
          <Textarea
            variant="none"
            size="default"
            ref={textareaRef}
            value={value}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            disabled={disabled}
            placeholder={t('chat.ask-placeholder')}
            className={cn(
              'flex-1 resize-none',
              'border-none shadow-none focus-visible:outline-none focus-visible:ring-0',
              'max-h-[200px] min-h-[40px] px-0 py-0',
              'scrollbar overflow-auto',
              'placeholder:text-text-label',
              isActive ? 'text-input-text-focus' : 'text-input-text-default'
            )}
            style={{
              fontFamily: 'Inter',
            }}
            rows={1}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
            }}
          />
        </div>
      </div>

      {/* File Attachments (only show if has files) */}
      {files.length > 0 && (
        <div className="relative box-border flex w-full flex-wrap items-start gap-1 px-2 pb-2 pt-0">
          {visibleFiles.map((file) => {
            const isHovered = hoveredFilePath === file.filePath;
            return (
              <div
                key={file.filePath}
                className={cn(
                  'relative box-border flex h-auto max-w-32 items-center gap-0.5 rounded-lg bg-tag-surface'
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
                  title={isHovered ? 'Remove file' : file.fileName}
                >
                  {isHovered ? (
                    <X className="size-4 text-icon-secondary" />
                  ) : (
                    getFileIcon(file.fileName)
                  )}
                </a>

                {/* File Name */}
                <p
                  className={cn(
                    "relative my-0 min-h-px min-w-px flex-1 overflow-hidden overflow-ellipsis whitespace-nowrap font-['Inter'] text-xs font-bold leading-tight text-text-body"
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
                  size="icon"
                  variant="ghost"
                  className="relative box-border flex h-auto items-center rounded-lg bg-tag-surface"
                  onMouseEnter={openRemainingPopover}
                  onMouseLeave={scheduleCloseRemainingPopover}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <p className="my-0 whitespace-nowrap font-['Inter'] text-xs font-bold leading-tight text-text-body">
                    {remainingCount}+
                  </p>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={4}
                className="!w-auto max-w-40 rounded-md border border-dropdown-border bg-dropdown-bg p-1 shadow-perfect"
                onMouseEnter={openRemainingPopover}
                onMouseLeave={scheduleCloseRemainingPopover}
              >
                <div className="scrollbar-hide flex max-h-[176px] flex-col gap-1 overflow-auto">
                  {files.slice(maxVisibleFiles).map((file) => {
                    const isHovered = hoveredFilePath === file.filePath;
                    return (
                      <div
                        key={file.filePath}
                        className="flex cursor-pointer items-center gap-1 rounded-lg bg-tag-surface px-1 py-0.5 transition-colors duration-300 hover:bg-tag-surface-hover"
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
                          title={isHovered ? 'Remove file' : file.fileName}
                        >
                          {isHovered ? (
                            <X className="size-4 text-icon-secondary" />
                          ) : (
                            getFileIcon(file.fileName)
                          )}
                        </a>
                        <p className="my-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-['Inter'] text-xs font-bold leading-tight text-text-body">
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

      {/* Action Buttons */}
      <div className="relative flex w-full items-center justify-between">
        {/* Left: Add File Button */}
        <div className="relative flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            onClick={onAddFile}
            disabled={disabled || !privacy || useCloudModelInDev}
          >
            <Plus size={16} className="text-icon-primary" />
          </Button>
        </div>

        {/* Right: Send Button */}
        <Button
          size="icon"
          variant={value.trim().length > 0 ? 'success' : 'secondary'}
          className="rounded-full"
          onClick={handleSend}
          disabled={disabled || value.trim().length === 0}
        >
          <ArrowRight
            size={16}
            className={cn(
              'text-button-primary-icon-default transition-transform duration-200',
              value.trim().length > 0 && 'rotate-[-90deg]'
            )}
          />
        </Button>
      </div>
    </div>
  );
};
