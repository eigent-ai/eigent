import React from "react";
import { Ellipsis, Share, Trash2, Clock, CheckCircle, XCircle } from "lucide-react";
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
}

export default function TaskItem({
  task,
  isActive,
  onSelect,
  onDelete,
  onShare,
  isLast
}: TaskItemProps) {
  const { t } = useTranslation();

  const getStatusIcon = (status: number) => {
    switch (status) {
      case 1:
        return <Clock className="w-3 h-3 text-yellow-500" />;
      case 2:
        return <CheckCircle className="w-3 h-3 text-green-500" />;
      case 3:
        return <XCircle className="w-3 h-3 text-red-500" />;
      default:
        return <Clock className="w-3 h-3 text-gray-500" />;
    }
  };

  const getStatusText = (status: number) => {
    switch (status) {
      case 1:
        return t("layout.running");
      case 2:
        return t("layout.completed");
      case 3:
        return t("layout.failed");
      default:
        return t("layout.unknown");
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
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <img className="w-6 h-6 flex-shrink-0" src={folderIcon} alt="task-icon" />
        
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <TooltipSimple
            align="start"
            className="max-w-xs bg-surface-tertiary p-2 text-wrap break-words text-label-xs select-text pointer-events-auto shadow-perfect"
            content={
              <div className="space-y-1">
                <div className="font-medium">{task.question}</div>
                {task.summary && (
                  <div className="text-xs opacity-75">{task.summary}</div>
                )}
                <div className="text-xs opacity-60">
                  {t("layout.created")}: {formatDate(task.created_at)}
                </div>
              </div>
            }
          >
            <span className="text-text-body font-medium text-sm overflow-hidden text-ellipsis whitespace-nowrap block">
              {task.question || t("layout.new-project")}
            </span>
          </TooltipSimple>
          
          {task.summary && (
            <span className="text-xs text-text-secondary overflow-hidden text-ellipsis whitespace-nowrap">
              {task.summary}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="flex items-center gap-1">
          {getStatusIcon(task.status)}
          <span className="text-xs text-text-secondary hidden sm:inline">
            {getStatusText(task.status)}
          </span>
        </div>
        
        <Tag
          variant="primary"
          className="text-xs leading-17 font-medium text-nowrap"
        >
          {task.tokens ? task.tokens.toLocaleString() : "0"}
        </Tag>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              size="icon"
              onClick={(e) => e.stopPropagation()}
              variant="ghost"
              className="h-8 w-8 flex-shrink-0"
            >
              <Ellipsis size={14} className="text-text-primary" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[98px] p-sm rounded-[12px] bg-dropdown-bg border border-solid border-dropdown-border">
            <div className="space-y-1">
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
      </div>
    </div>
  );
}