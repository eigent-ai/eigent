import { Trigger, TriggerType, TriggerStatus } from "@/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TooltipSimple } from "@/components/ui/tooltip";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Zap, Clock, MoreHorizontal, Edit, Copy, Trash2, Globe, MessageSquare, AlarmClockIcon, WebhookIcon, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "@/lib/utils";

type TriggerListItemProps = {
    trigger: Trigger;
    isSelected: boolean;
    onSelect: (id: number) => void;
    onEdit: (trigger: Trigger) => void;
    onDuplicate: (id: number) => void;
    onDelete: (trigger: Trigger) => void;
    onToggleActive: (trigger: Trigger) => void;
};

export const TriggerListItem: React.FC<TriggerListItemProps> = ({
    trigger,
    isSelected,
    onSelect,
    onEdit,
    onDuplicate,
    onDelete,
    onToggleActive,
}) => {
    const { t } = useTranslation();
    const isActive = trigger.status === TriggerStatus.Active;
    const needsAuth = trigger.status === TriggerStatus.PendingAuth && trigger.config?.authentication_required;

    const getTriggerTypeIcon = () => {
        switch (trigger.trigger_type) {
            case TriggerType.Schedule:
                return <AlarmClockIcon className="w-3.5 h-3.5" />;
            case TriggerType.Webhook:
                return <WebhookIcon className="w-3.5 h-3.5" />;
            case TriggerType.Slack:
                return <MessageSquare className="w-3.5 h-3.5" />;
            default:
                return <Clock className="w-3.5 h-3.5" />;
        }
    };

    const getTriggerTypeLabel = () => {
        switch (trigger.trigger_type) {
            case TriggerType.Schedule:
                return t("triggers.schedule");
            case TriggerType.Webhook:
                return t("triggers.webhook");
            case TriggerType.Slack:
                return t("triggers.slack-trigger");
            default:
                return trigger.trigger_type;
        }
    };

    const formatLastExecution = (dateString?: string) => {
        if (!dateString) return t("triggers.never");
        return formatDateTime(dateString, "HH:mm MMM dd");
    };

    return (
        <div
            onClick={() => onSelect(trigger.id)}
            className={`group flex items-center gap-3 p-3 bg-surface-primary rounded-xl border transition-all duration-200 cursor-pointer ${isSelected
                ? 'border-border-action bg-surface-tertiary'
                : needsAuth
                    ? 'border-yellow-500 hover:border-yellow-600 hover:bg-surface-tertiary'
                    : 'border-border-tertiary hover:border-border-secondary hover:bg-surface-tertiary'
                }`}
        >
            {/* 1. Zap Icon */}
            <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-amber-500/10 rounded-lg">
                <Zap className="w-5 h-5 text-icon-primary" />
            </div>

            {/* 2. Trigger Name + Task Prompt */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <div className="text-sm font-semibold text-text-heading truncate group-hover:text-text-action transition-colors">
                        {trigger.name}
                    </div>
                    {needsAuth && (
                        <TooltipSimple content={t("triggers.verification-required")}>
                            <div className="flex items-center justify-center p-1 rounded-full bg-yellow-100">
                                <AlertTriangle className="w-3.5 h-3.5 text-yellow-600" />
                            </div>
                        </TooltipSimple>
                    )}
                </div>
                <div className="text-xs text-text-label truncate mt-0.5">
                    {trigger.task_prompt || trigger.description || t("triggers.no-task-prompt")}
                </div>
            </div>

            {/* 3. Trigger Type */}
            <div className="flex items-center gap-1.5 text-xs text-text-label min-w-[80px]">
                {getTriggerTypeIcon()}
                <span>{getTriggerTypeLabel()}</span>
            </div>

            {/* 5. Activation Switch */}
            <TooltipSimple content={t("triggers.verification-required")}>
                <div>
                    <Switch
                        checked={isActive || needsAuth}
                        onCheckedChange={() => onToggleActive(trigger)}
                        onClick={(e) => e.stopPropagation()}
                        disabled={needsAuth}
                    />
                </div>
            </TooltipSimple>

            {/* 6. More Icon Dropdown */}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                        <MoreHorizontal className="w-4 h-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem className="gap-2" onSelect={(e) => { e.preventDefault(); onEdit(trigger); }}>
                        <Edit className="h-4 w-4" />
                        {t("triggers.edit")}
                    </DropdownMenuItem>
                    {/* TODO: Support Duplicate Action */}
                    {/* <DropdownMenuItem className="gap-2" onSelect={(e) => { e.preventDefault(); onDuplicate(trigger.id); }}>
                        <Copy className="h-4 w-4" />
                        {t("triggers.duplicate")}
                    </DropdownMenuItem> */}
                    <DropdownMenuItem className="gap-2 text-red-600 focus:text-red-600" onSelect={(e) => { e.preventDefault(); onDelete(trigger); }}>
                        <Trash2 className="h-4 w-4" />
                        {t("triggers.delete")}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
};
