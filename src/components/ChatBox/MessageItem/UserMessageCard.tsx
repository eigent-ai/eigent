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

import { cn } from '@/lib/utils';
import { Check, Copy, FileText, Image } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';

const COPIED_RESET_MS = 2000;

interface UserMessageCardProps {
  id: string;
  content: string;
  className?: string;
  attaches?: File[];
}

export function UserMessageCard({
  id,
  content,
  className,
  attaches,
}: UserMessageCardProps) {
  const [_hoveredFilePath, setHoveredFilePath] = useState<string | null>(null);
  const [isRemainingOpen, setIsRemainingOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const hoverCloseTimerRef = useRef<number | null>(null);
  const { t } = useTranslation();

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success(t('setting.copied-to-clipboard'));
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  }, [content, t]);

  // Popover handles outside clicks; no manual listener needed
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

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
      return <Image className="h-4 w-4 text-icon-primary" />;
    }
    return <FileText className="h-4 w-4 text-icon-primary" />;
  };

  return (
    <div
      key={id}
      className={`relative w-full rounded-xl border bg-surface-tertiary px-sm py-2 ${className || ''} group overflow-visible`}
    >
      <div className="absolute bottom-[0px] right-1 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <Button onClick={handleCopy} variant="ghost" size="icon">
          {copied ? (
            <Check className="h-4 w-4 text-text-success" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>
      <div className="whitespace-pre-wrap break-words text-body-sm text-text-body">
        {content}
      </div>
      {attaches && attaches.length > 0 && (
        <div className="relative mt-2 box-border flex w-full flex-wrap items-start gap-1">
          {(() => {
            // Show max 4 files + count indicator
            const maxVisibleFiles = 4;
            const visibleFiles = attaches.slice(0, maxVisibleFiles);
            const remainingCount =
              attaches.length > maxVisibleFiles
                ? attaches.length - maxVisibleFiles
                : 0;

            return (
              <>
                {visibleFiles.map((file) => {
                  return (
                    <div
                      key={'attache-' + file.fileName}
                      className={cn(
                        'relative box-border flex h-auto max-w-32 cursor-pointer items-center gap-0.5 rounded-lg bg-tag-surface transition-colors duration-300 hover:bg-tag-surface-hover'
                      )}
                      onMouseEnter={() => setHoveredFilePath(file.filePath)}
                      onMouseLeave={() =>
                        setHoveredFilePath((prev) =>
                          prev === file.filePath ? null : prev
                        )
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        window.ipcRenderer.invoke(
                          'reveal-in-folder',
                          file.filePath
                        );
                      }}
                    >
                      {/* File icon */}
                      <div className="flex h-6 w-6 items-center justify-center rounded-md">
                        {getFileIcon(file.fileName)}
                      </div>

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

                {/* Show remaining count if more than 4 files */}
                {remainingCount > 0 && (
                  <Popover
                    open={isRemainingOpen}
                    onOpenChange={setIsRemainingOpen}
                  >
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
                        {attaches.slice(maxVisibleFiles).map((file) => {
                          return (
                            <div
                              key={file.filePath}
                              className="flex cursor-pointer items-center gap-1 rounded-lg bg-tag-surface py-0.5 transition-colors duration-300 hover:bg-tag-surface-hover"
                              onMouseLeave={() =>
                                setHoveredFilePath((prev) =>
                                  prev === file.filePath ? null : prev
                                )
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                window.ipcRenderer.invoke(
                                  'reveal-in-folder',
                                  file.filePath
                                );
                                setIsRemainingOpen(false);
                              }}
                            >
                              <div className="flex h-6 w-6 items-center justify-center rounded-md">
                                {getFileIcon(file.fileName)}
                              </div>
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
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
