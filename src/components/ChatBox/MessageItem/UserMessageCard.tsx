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
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';
import { UserMessageRichContent } from './UserMessageRichContent';

const COPIED_RESET_MS = 2000;

/** Four lines at `body-sm` line height — same tokens as `text-body-sm` (13px / 20px). */
const USER_MESSAGE_COLLAPSED_MAX = 'calc(4 * var(--lineHeight-14, 20px))';

/** SVG alpha mask: CSS linear-gradient masks are often treated as luminance in WebKit/Chromium (black = hole), which reads as a flat white slab. */
const USER_MESSAGE_FOLD_MASK_DATA_URL = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" preserveAspectRatio="none"><defs><linearGradient id="g" gradientUnits="objectBoundingBox" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="white"/><stop offset="50%" stop-color="white" stop-opacity="0.55"/><stop offset="100%" stop-color="white" stop-opacity="0"/></linearGradient></defs><rect width="1" height="1" fill="url(#g)"/></svg>'
)}")`;

const USER_MESSAGE_FOLD_FADE_STYLE = {
  backgroundColor: 'var(--surface-tertiary)',
  maskImage: USER_MESSAGE_FOLD_MASK_DATA_URL,
  WebkitMaskImage: USER_MESSAGE_FOLD_MASK_DATA_URL,
  maskSize: '100% 100%',
  WebkitMaskSize: '100% 100%',
  maskRepeat: 'no-repeat',
  WebkitMaskRepeat: 'no-repeat',
} as const;

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
  const [expanded, setExpanded] = useState(false);
  const [canClamp, setCanClamp] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const hoverCloseTimerRef = useRef<number | null>(null);
  const { t } = useTranslation();

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const updateClamp = () => {
      if (expanded) {
        const prevMax = el.style.maxHeight;
        const prevOv = el.style.overflow;
        el.style.maxHeight = USER_MESSAGE_COLLAPSED_MAX;
        el.style.overflow = 'hidden';
        setCanClamp(el.scrollHeight > el.clientHeight + 1);
        el.style.maxHeight = prevMax;
        el.style.overflow = prevOv;
        return;
      }
      setCanClamp(el.scrollHeight > el.clientHeight + 1);
    };

    updateClamp();
    const ro = new ResizeObserver(updateClamp);
    ro.observe(el);
    return () => ro.disconnect();
  }, [content, expanded, id]);

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
    <div key={id} className={cn('group/msg relative w-full', className)}>
      <div className="rounded-xl bg-surface-tertiary px-sm pt-2 w-full overflow-visible">
        {attaches && attaches.length > 0 && (
          <div className="mb-2 gap-1 relative box-border flex w-full flex-wrap items-start">
            {(() => {
              // Show max 2 files + count indicator
              const maxVisibleFiles = 2;
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
                          'max-w-24 gap-0.5 rounded-lg bg-tag-surface hover:bg-tag-surface-hover relative box-border flex h-auto cursor-pointer items-center transition-colors duration-300'
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
                        <div className="h-6 w-6 rounded-md flex items-center justify-center">
                          {getFileIcon(file.fileName)}
                        </div>

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

                  {/* Show remaining count if more than 2 files */}
                  {remainingCount > 0 && (
                    <Popover
                      open={isRemainingOpen}
                      onOpenChange={setIsRemainingOpen}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          size="xs"
                          buttonContent="text"
                          variant="ghost"
                          className="rounded-lg bg-tag-surface relative flex items-center"
                          onMouseEnter={openRemainingPopover}
                          onMouseLeave={scheduleCloseRemainingPopover}
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          <span className="text-label-xs font-bold leading-tight text-text-body font-['Inter'] whitespace-nowrap">
                            {remainingCount}+
                          </span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        sideOffset={4}
                        className="max-w-40 rounded-md border-dropdown-border bg-dropdown-bg p-1 shadow-perfect !w-auto border"
                        onMouseEnter={openRemainingPopover}
                        onMouseLeave={scheduleCloseRemainingPopover}
                      >
                        <div className="scrollbar-hide gap-1 flex max-h-[176px] flex-col overflow-auto">
                          {attaches.slice(maxVisibleFiles).map((file) => {
                            return (
                              <div
                                key={file.filePath}
                                className="gap-1 rounded-lg bg-tag-surface py-0.5 hover:bg-tag-surface-hover flex cursor-pointer items-center transition-colors duration-300"
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
                                <div className="h-6 w-6 rounded-md flex items-center justify-center">
                                  {getFileIcon(file.fileName)}
                                </div>
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
                </>
              );
            })()}
          </div>
        )}
        <div className="relative w-full">
          <div
            ref={contentRef}
            style={
              !expanded ? { maxHeight: USER_MESSAGE_COLLAPSED_MAX } : undefined
            }
            className={cn('relative', !expanded && 'overflow-hidden')}
          >
            <UserMessageRichContent content={content} variant="card" />
            {canClamp && !expanded && (
              <div
                className="inset-x-0 bottom-0 h-14 pointer-events-none absolute z-[1]"
                style={USER_MESSAGE_FOLD_FADE_STYLE}
                aria-hidden
              />
            )}
          </div>
        </div>
        <div className="gap-0.5 pointer-events-none flex w-full shrink-0 items-center justify-end opacity-0 transition-opacity duration-300 group-hover/msg:pointer-events-auto group-hover/msg:opacity-100">
          {canClamp && !expanded && (
            <Button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(true);
              }}
              variant="ghost"
              size="xs"
              buttonContent="text"
              textWeight="normal"
            >
              {t('chat.agent-outcome-expand')}
            </Button>
          )}
          {canClamp && expanded && (
            <Button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(false);
              }}
              variant="ghost"
              size="xs"
              buttonContent="text"
              textWeight="normal"
            >
              {t('chat.agent-outcome-collapse')}
            </Button>
          )}
          <Button
            onClick={handleCopy}
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
          >
            {copied ? (
              <Check className="h-4 w-4 text-text-success" />
            ) : (
              <Copy />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
