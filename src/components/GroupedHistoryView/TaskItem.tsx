import React from "react";
import { Ellipsis, Share, Trash2, Clock, CheckCircle, XCircle, CirclePause, CirclePlay, Pin, Hash } from "lucide-react";
import { HistoryTask } from "@/types/history";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { TooltipSimple } from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverClose,
} from "@/components/ui/popover";
import { useTranslation } from "react-i18next";
import folderIcon from "@/assets/Folder-1.svg";

interface TaskItemProps {
  task: HistoryTask;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onShare: () => void;
  isLast: boolean;
  isOngoing?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  showActions?: boolean;
}

export default function TaskItem({
  task,
  isActive,
  onSelect,
  onDelete,
  onShare,
  isLast,
  isOngoing = false,
  onPause,
  onResume,
  showActions = true
}: TaskItemProps) {
  const { t } = useTranslation();
  
  // Check if task is paused (for ongoing tasks)
  const isPaused = (task as any)._taskData?.status === "pause";

  const getStatusTag = (status: number) => {
    // ChatStatus enum: ongoing = 1, done = 2
    switch (status) {
      case 1: // ChatStatus.ongoing
        return (
          <Tag variant="info" size="sm">
            <Clock />
            <span>{t("layout.running")}</span>
          </Tag>
        );
      case 2: // ChatStatus.done
        return (
          <Tag variant="success" size="sm">
            <CheckCircle />
            <span>{t("layout.completed")}</span>
          </Tag>
        );
      default: // Unknown status
        return (
          <Tag variant="default" size="sm">
            <Clock />
            <span>{t("layout.unknown")}</span>
          </Tag>
        );
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div
      onClick={onSelect}
      className={`
        ${isActive ? "!bg-white-100%" : ""}
        relative cursor-pointer transition-all duration-300 bg-white-30% hover:bg-white-100% 
        rounded-xl flex justify-between items-center gap-md w-full p-3 h-14 
        shadow-history-item border border-solid border-border-disabled
        ${!isLast ? "mb-2" : ""}
      `}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <TooltipSimple content={t("layout.tasks")}>
          <Pin className="w-4 h-4 text-icon-primary" />
        </TooltipSimple>
        
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <TooltipSimple
            align="start"
            className="max-w-xs bg-surface-tertiary p-2 text-wrap break-words text-label-xs select-text pointer-events-auto shadow-perfect"
            content={
              <div className="space-y-1">
                <div className="font-medium">{task.summary || task.question}</div>
                <div className="text-xs opacity-60">
                  {t("layout.created")}: {formatDate(task.created_at)}
                </div>
                <div className="text-xs opacity-60">
                  {t("chat.token")}: {task.tokens ? task.tokens.toLocaleString() : "0"}
                </div>
              </div>
            }
          >
            <span className="text-text-body font-medium text-sm overflow-hidden text-ellipsis whitespace-nowrap block">
              {task.summary || task.question || t("layout.new-project")}
            </span>
          </TooltipSimple>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {!isOngoing && getStatusTag(task.status)}
        
        <Tag
          variant="info"
          size="sm"
        >
          <Hash />
          <span>{task.tokens ? task.tokens.toLocaleString() : "0"}</span>
        </Tag>

        {isOngoing && (onPause || onResume) && (
          <Tag
            variant={isPaused ? "info" : "success"}
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              if (isPaused && onResume) {
                onResume();
              } else if (!isPaused && onPause) {
                onPause();
              }
            }}
          >
            {isPaused ? (
              <CirclePlay />
            ) : (
              <CirclePause />
            )}
            <span>
              {isPaused ? t("layout.continue") : t("layout.pause")}
            </span>
          </Tag>
        )}

        {showActions && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="icon"
                onClick={(e) => e.stopPropagation()}
                variant="ghost"
                className="rounded-full"
              >
                <Ellipsis />
              </Button>
            </PopoverTrigger>
            <PopoverContent 
              align="end"
              className="w-[98px] p-sm rounded-[12px] bg-dropdown-bg border border-solid border-dropdown-border"
            >
              <div className="space-y-1">
                {!isOngoing && (
                  <PopoverClose asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={(e) => {
                        e.stopPropagation();
                        onShare();
                      }}
                    >
                      <Share size={14} />
                      {t("layout.share")}
                    </Button>
                  </PopoverClose>
                )}

                <PopoverClose asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                  >
                    <Trash2
                      size={14}
                      className="text-icon-primary group-hover:text-icon-cuation"
                    />
                    {t("layout.delete")}
                  </Button>
                </PopoverClose>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}
