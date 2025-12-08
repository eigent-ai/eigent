import { Trigger, TriggerStatus, TriggerType } from "@/types";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "react-i18next";
import { Clock, Globe, MessageSquare, Activity } from "lucide-react";
import React, { useMemo } from "react";

type TriggerCardProps = {
  trigger: Trigger;
  onSelect: (trigger: Trigger) => void;
  onToggleActive: (trigger: Trigger) => void;
  selected?: boolean;
};

// Generate a consistent color based on trigger ID
const getColorForTrigger = (triggerId: string): string => {
  const colors = [
    "#FF6B6B", // Red
    "#4ECDC4", // Teal
    "#45B7D1", // Blue
    "#FFA07A", // Light Salmon
    "#98D8C8", // Mint
    "#F7DC6F", // Yellow
    "#BB8FCE", // Purple
    "#85C1E2", // Sky Blue
    "#F8B739", // Orange
    "#52B788", // Green
  ];

  // Simple hash function to get consistent color for same ID
  let hash = 0;
  for (let i = 0; i < triggerId.length; i++) {
    hash = triggerId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

export const TriggerCard: React.FC<TriggerCardProps> = ({
  trigger,
  onSelect,
  onToggleActive,
  selected = false,
}) => {
  const { t } = useTranslation();

  const colorBlock = useMemo(
    () => getColorForTrigger(trigger.id.toString()),
    [trigger.id]
  );

  const getTriggerTypeLabel = (type: TriggerType) => {
    switch (type) {
      case TriggerType.Schedule:
        return t("triggers.schedule");
      case TriggerType.Webhook:
        return t("triggers.webhook");
      case TriggerType.SlackTrigger:
        return t("triggers.slack");
      default:
        return type;
    }
  };

  const getTriggerTypeIcon = (type: TriggerType) => {
    switch (type) {
      case TriggerType.Schedule:
        return <Clock className="w-3 h-3" />;
      case TriggerType.Webhook:
        return <Globe className="w-3 h-3" />;
      case TriggerType.SlackTrigger:
        return <MessageSquare className="w-3 h-3" />;
      default:
        return <Activity className="w-3 h-3" />;
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const isActive = trigger.status === TriggerStatus.Active;

  return (
    <div
      className={`
        w-full rounded-3xl p-4 cursor-pointer transition-all duration-200
        ${selected
          ? "bg-surface-tertiary border border-solid border-border-primary shadow-sm"
          : "bg-surface-tertiary border border-solid border-transparent hover:bg-surface-secondary"
        }
      `}
      onClick={() => onSelect(trigger)}
    >
      {/* Top Header */}
      <div className="flex items-center gap-2 mb-2">
        {/* Color Block */}
        <div
          className="w-[38px] h-[38px] rounded-[10px] shrink-0"
          style={{ backgroundColor: colorBlock }}
        />

        {/* Trigger Info */}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="text-[10px] font-medium leading-tight text-text-label truncate">
            {getTriggerTypeLabel(trigger.trigger_type)}
          </div>
          <div className="text-[15px] font-bold leading-relaxed text-text-heading truncate">
            {trigger.name}
          </div>
        </div>

        {/* Toggle Switch */}
        <Switch
          checked={isActive}
          onCheckedChange={(checked) => {
            onToggleActive(trigger);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {/* Status Section */}
      <div className="pt-2 border-t border-border-disabled">
        <p className="text-[10px] font-bold leading-tight text-text-label mb-1">
          {t("triggers.executions").toUpperCase()}
        </p>
        <div className="flex items-center justify-between">
          {/* Left Side: Execution Numbers */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-normal leading-tight text-text-label">
                {trigger.execution_count}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-bold leading-tight text-text-cuation">
                {trigger.error_count}
              </span>
            </div>
          </div>

          {/* Right Side: Last Execution Time */}
          <p className="text-[10px] font-medium leading-tight text-text-label">
            {formatDate(trigger.last_executed_at)}
          </p>
        </div>
      </div>
    </div>
  );
};


