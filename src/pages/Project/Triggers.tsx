import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Card,
} from "@/components/ui/card";
import {
    MenuToggleGroup,
    MenuToggleItem,
} from "@/components/MenuButton/MenuButton";
import {
    Plus,
    Play,
    Pause,
    Trash2,
    Clock,
    Globe,
    MessageSquare,
    AlertCircle,
    CheckCircle2,
    XCircle,
    Activity,
    Copy,
    Search
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
    Trigger,
    TriggerInput,
    TriggerType,
    TriggerStatus,
    ListenerType,
    TriggerExecution
} from "@/types";
import {
    proxyFetchTriggers,
    proxyCreateTrigger,
    proxyDeleteTrigger,
    proxyActivateTrigger,
    proxyDeactivateTrigger,
    proxyFetchTriggerExecutions
} from "@/service/triggerApi";

type CreateTriggerPanelProps = {
    onTriggerCreated: () => void;
};

function CreateTriggerPanel({ onTriggerCreated }: CreateTriggerPanelProps) {
    const { t } = useTranslation();
    const [isLoading, setIsLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<"General" | "Toolkit" | "Logs">("General");
    const [formData, setFormData] = useState<TriggerInput>({
        name: "",
        description: "",
        trigger_type: TriggerType.Schedule,
        custom_cron_expression: "0 */1 * * *", // Default: every hour
        listener_type: ListenerType.ChatAgent,
        system_message: "",
        agent_model: "",
        task_prompt: "",
        max_executions_per_hour: undefined,
        max_executions_per_day: undefined,
        is_single_execution: false,
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.name.trim()) {
            toast.error(t("triggers.name-required"));
            return;
        }

        setIsLoading(true);
        try {
            await proxyCreateTrigger(formData);
            toast.success(t("triggers.created-successfully"));
            onTriggerCreated();
            // Reset form
            setFormData({
                name: "",
                description: "",
                trigger_type: TriggerType.Schedule,
                custom_cron_expression: "0 */1 * * *",
                listener_type: ListenerType.ChatAgent,
                system_message: "",
                agent_model: "",
                task_prompt: "",
                max_executions_per_hour: undefined,
                max_executions_per_day: undefined,
                is_single_execution: false,
            });
        } catch (error) {
            console.error("Failed to create trigger:", error);
            toast.error(t("triggers.failed-to-create"));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="w-full h-full flex flex-col items-start justify-center">
            <div className="w-full h-ful flex flex-row items-center justify-between px-md py-2">
                <div className="text-text-body font-bold text-body-base leading-relaxed">
                    {t("triggers.create-new")}
                </div>
                <Button
                    variant="primary"
                    size="sm"
                    type="submit" disabled={isLoading}>
                    {isLoading ? t("common.creating") : t("common.create")}
                </Button>
            </div>

            <div className="flex items-center gap-2 px-md py-2">
                <MenuToggleGroup type="single" value={activeTab} orientation="horizontal" onValueChange={(v) => v && setActiveTab(v as typeof activeTab)}>
                    <MenuToggleItem size="xs" value="General">General</MenuToggleItem>
                    <MenuToggleItem size="xs" value="Toolkit">Toolkit</MenuToggleItem>
                    <MenuToggleItem size="xs" value="Logs">Logs</MenuToggleItem>
                </MenuToggleGroup>
            </div>

            <form onSubmit={handleSubmit} className="w-full h-full flex flex-col items-center justify-start px-md py-2">
                <div className="w-full grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="name">{t("triggers.name")}</Label>
                        <Input
                            id="name"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder={t("triggers.name-placeholder")}
                            required
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="trigger_type">{t("triggers.type")}</Label>
                        <Select
                            value={formData.trigger_type}
                            onValueChange={(value: TriggerType) =>
                                setFormData({ ...formData, trigger_type: value })
                            }
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={TriggerType.Schedule}>
                                    <div className="flex items-center gap-2">
                                        <Clock className="w-4 h-4" />
                                        {t("triggers.schedule")}
                                    </div>
                                </SelectItem>
                                <SelectItem value={TriggerType.Webhook}>
                                    <div className="flex items-center gap-2">
                                        <Globe className="w-4 h-4" />
                                        {t("triggers.webhook")}
                                    </div>
                                </SelectItem>
                                <SelectItem value={TriggerType.SlackTrigger}>
                                    <div className="flex items-center gap-2">
                                        <MessageSquare className="w-4 h-4" />
                                        {t("triggers.slack")}
                                    </div>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <div className="w-full space-y-2">
                    <Label htmlFor="description">{t("triggers.description")}</Label>
                    <Textarea
                        id="description"
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        placeholder={t("triggers.description-placeholder")}
                        rows={2}
                    />
                </div>

                {formData.trigger_type === TriggerType.Schedule && (
                    <div className="w-full space-y-2">
                        <Label htmlFor="cron">{t("triggers.cron-expression")}</Label>
                        <Input
                            id="cron"
                            value={formData.custom_cron_expression || ""}
                            onChange={(e) => setFormData({ ...formData, custom_cron_expression: e.target.value })}
                            placeholder="0 */1 * * *"
                        />
                        <p className="text-xs text-muted-foreground">
                            {t("triggers.cron-help")}
                        </p>
                    </div>
                )}

                <div className="w-full grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="listener_type">{t("triggers.listener-type")}</Label>
                        <Select
                            value={formData.listener_type || ""}
                            onValueChange={(value: ListenerType) =>
                                setFormData({ ...formData, listener_type: value })
                            }
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t("triggers.select-listener")} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ListenerType.ChatAgent}>
                                    {t("triggers.chat-agent")}
                                </SelectItem>
                                <SelectItem value={ListenerType.Workforce}>
                                    {t("triggers.workforce")}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="agent_model">{t("triggers.agent-model")}</Label>
                        <Input
                            id="agent_model"
                            value={formData.agent_model || ""}
                            onChange={(e) => setFormData({ ...formData, agent_model: e.target.value })}
                            placeholder="gpt-4o-mini"
                        />
                    </div>
                </div>

                <div className="w-full space-y-2">
                    <Label htmlFor="task_prompt">{t("triggers.task-prompt")}</Label>
                    <Textarea
                        id="task_prompt"
                        value={formData.task_prompt || ""}
                        onChange={(e) => setFormData({ ...formData, task_prompt: e.target.value })}
                        placeholder={t("triggers.task-prompt-placeholder")}
                        rows={3}
                    />
                </div>

                <div className="w-full grid grid-cols-3 gap-4">
                    <div className="w-full space-y-2">
                        <Label htmlFor="max_per_hour">{t("triggers.max-per-hour")}</Label>
                        <Input
                            id="max_per_hour"
                            type="number"
                            value={formData.max_executions_per_hour || ""}
                            onChange={(e) => setFormData({
                                ...formData,
                                max_executions_per_hour: e.target.value ? parseInt(e.target.value) : undefined
                            })}
                            placeholder="10"
                        />
                    </div>
                    <div className="w-full space-y-2">
                        <Label htmlFor="max_per_day">{t("triggers.max-per-day")}</Label>
                        <Input
                            id="max_per_day"
                            type="number"
                            value={formData.max_executions_per_day || ""}
                            onChange={(e) => setFormData({
                                ...formData,
                                max_executions_per_day: e.target.value ? parseInt(e.target.value) : undefined
                            })}
                            placeholder="100"
                        />
                    </div>
                    <div className="flex items-center space-x-2 pt-6">
                        <Switch
                            id="single_execution"
                            checked={formData.is_single_execution}
                            onCheckedChange={(checked) => setFormData({ ...formData, is_single_execution: checked })}
                        />
                        <Label htmlFor="single_execution">{t("triggers.single-execution")}</Label>
                    </div>
                </div>
            </form>
        </div>
    );
}

function TriggerStatusBadge({ status }: { status: TriggerStatus }) {
    const { t } = useTranslation();

    const getStatusInfo = (status: TriggerStatus) => {
        switch (status) {
            case TriggerStatus.Active:
                return {
                    label: t("triggers.status.active"),
                    color: "bg-green-100 text-green-800",
                    icon: <CheckCircle2 className="w-3 h-3" />
                };
            case TriggerStatus.Inactive:
                return {
                    label: t("triggers.status.inactive"),
                    color: "bg-gray-100 text-gray-800",
                    icon: <XCircle className="w-3 h-3" />
                };
            case TriggerStatus.Stale:
                return {
                    label: t("triggers.status.stale"),
                    color: "bg-yellow-100 text-yellow-800",
                    icon: <AlertCircle className="w-3 h-3" />
                };
            case TriggerStatus.Completed:
                return {
                    label: t("triggers.status.completed"),
                    color: "bg-blue-100 text-blue-800",
                    icon: <CheckCircle2 className="w-3 h-3" />
                };
            default:
                return {
                    label: t("triggers.status.unknown"),
                    color: "bg-gray-100 text-gray-800",
                    icon: <AlertCircle className="w-3 h-3" />
                };
        }
    };

    const statusInfo = getStatusInfo(status);

    return (
        <Badge className={`${statusInfo.color} flex items-center gap-1`}>
            {statusInfo.icon}
            {statusInfo.label}
        </Badge>
    );
}

function TriggerTypeBadge({ type }: { type: TriggerType }) {
    const { t } = useTranslation();

    const getTypeInfo = (type: TriggerType) => {
        switch (type) {
            case TriggerType.Schedule:
                return {
                    label: t("triggers.schedule"),
                    icon: <Clock className="w-3 h-3" />
                };
            case TriggerType.Webhook:
                return {
                    label: t("triggers.webhook"),
                    icon: <Globe className="w-3 h-3" />
                };
            case TriggerType.SlackTrigger:
                return {
                    label: t("triggers.slack"),
                    icon: <MessageSquare className="w-3 h-3" />
                };
            default:
                return {
                    label: type,
                    icon: <Activity className="w-3 h-3" />
                };
        }
    };

    const typeInfo = getTypeInfo(type);

    return (
        <Badge variant="outline" className="flex items-center gap-1">
            {typeInfo.icon}
            {typeInfo.label}
        </Badge>
    );
}

export default function Triggers() {
    const { t } = useTranslation();
    const [triggers, setTriggers] = useState<Trigger[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedTrigger, setSelectedTrigger] = useState<Trigger | null>(null);
    const [executions, setExecutions] = useState<TriggerExecution[]>([]);
    const [executionsLoading, setExecutionsLoading] = useState(false);

    const loadTriggers = async () => {
        setLoading(true);
        try {
            const result = await proxyFetchTriggers();
            setTriggers(result.items || []);
        } catch (error) {
            console.error("Failed to load triggers:", error);
            toast.error(t("triggers.failed-to-load"));
        } finally {
            setLoading(false);
        }
    };

    const handleActivateToggle = async (trigger: Trigger) => {
        try {
            if (trigger.status === TriggerStatus.Active) {
                await proxyDeactivateTrigger(trigger.id);
                toast.success(t("triggers.deactivated"));
            } else {
                await proxyActivateTrigger(trigger.id);
                toast.success(t("triggers.activated"));
            }
            loadTriggers();
        } catch (error) {
            console.error("Failed to toggle trigger:", error);
            toast.error(t("triggers.failed-to-toggle"));
        }
    };

    const handleDelete = async (trigger: Trigger) => {
        if (!confirm(t("triggers.confirm-delete"))) return;

        try {
            await proxyDeleteTrigger(trigger.id);
            toast.success(t("triggers.deleted"));
            loadTriggers();
        } catch (error) {
            console.error("Failed to delete trigger:", error);
            toast.error(t("triggers.failed-to-delete"));
        }
    };

    const copyWebhookUrl = async (trigger: Trigger) => {
        if (trigger.webhook_url) {
            try {
                await navigator.clipboard.writeText(trigger.webhook_url);
                toast.success(t("triggers.webhook-copied"));
            } catch (error) {
                console.error("Failed to copy webhook URL:", error);
                toast.error(t("triggers.failed-to-copy"));
            }
        }
    };

    const loadExecutions = async (triggerId: number) => {
        setExecutionsLoading(true);
        try {
            const result = await proxyFetchTriggerExecutions(triggerId);
            setExecutions(result.items || []);
        } catch (error) {
            console.error("Failed to load executions:", error);
            toast.error(t("triggers.failed-to-load-executions"));
        } finally {
            setExecutionsLoading(false);
        }
    };

    useEffect(() => {
        loadTriggers();
    }, []);

    // Filter triggers based on search query
    const filteredTriggers = triggers.filter(trigger =>
        trigger.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (trigger.description && trigger.description.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <div className="text-center">
                    <Activity className="w-8 h-8 animate-spin mx-auto mb-2" />
                    <p>{t("common.loading")}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 min-w-0 min-h-0 flex h-full items-center justify-center bg-surface-secondary border-solid border-border-tertiary rounded-2xl relative overflow-hidden">
            {/* Left Column - Trigger List */}
            <div className="flex-[0.3] flex flex-col h-full border-solid border-y-0 border-l-0 border-r-[0.5px] border-border-secondary">
                <div className="flex flex-row items-center justify-between px-2 py-2.5">
                    <div className="text-text-body font-bold text-body-base leading-relaxed">
                        {t("layout.triggers")}
                    </div>

                    {/* Add Trigger Button */}
                    <Button
                        size="icon"
                        onClick={() => {
                            // Add a new empty trigger card to the list
                            const newTrigger: Trigger = {
                                id: Date.now(), // Temporary ID
                                user_id: "", // Placeholder user ID
                                name: "New Trigger",
                                description: "",
                                trigger_type: TriggerType.Schedule,
                                status: TriggerStatus.Inactive,
                                custom_cron_expression: "0 */1 * * *",
                                listener_type: ListenerType.ChatAgent,
                                execution_count: 0,
                                error_count: 0,
                                is_single_execution: false,
                                created_at: new Date().toISOString(),
                                updated_at: new Date().toISOString(),
                            };
                            setTriggers([newTrigger, ...triggers]);
                        }}
                        variant="primary"
                    >
                        <Plus className="w-4 h-4" />
                    </Button>
                </div>

                {/* Trigger List */}
                <div className="flex-1 h-full px-2">
                    {/* Search Bar */}
                    <div className="relative">
                        <Input
                            placeholder="Search triggers..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9"
                        />
                    </div>
                    {filteredTriggers.length === 0 ? (
                        <div className="text-center py-8">
                            <Activity className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                            <p className="text-gray-500">
                                {searchQuery ? "No triggers found" : t("triggers.no-triggers")}
                            </p>
                        </div>
                    ) : (
                        <div className="w-full h-full flex flex-col overflow-auto scrollbar pt-2">
                            {filteredTriggers.map((trigger) => (
                                <Card key={trigger.id} className="w-full p-4 mb-2">
                                    <div className="space-y-3">
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <h3 className="font-semibold text-sm">{trigger.name}</h3>
                                                </div>
                                                <div className="flex items-center gap-2 mb-2">
                                                    <TriggerStatusBadge status={trigger.status} />
                                                    <TriggerTypeBadge type={trigger.trigger_type} />
                                                </div>

                                                {trigger.description && (
                                                    <p className="text-xs text-gray-600 mb-2">{trigger.description}</p>
                                                )}

                                                <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                                                    <span>{t("triggers.executions")}: {trigger.execution_count}</span>
                                                    <span>{t("triggers.errors")}: {trigger.error_count}</span>
                                                </div>

                                                {trigger.trigger_type === TriggerType.Webhook && trigger.webhook_url && (
                                                    <div className="mt-2 flex items-center gap-2">
                                                        <code className="px-2 py-1 bg-gray-100 rounded text-xs font-mono flex-1 truncate">
                                                            {trigger.webhook_url}
                                                        </code>
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => copyWebhookUrl(trigger)}
                                                        >
                                                            <Copy className="w-3 h-3" />
                                                        </Button>
                                                    </div>
                                                )}

                                                {trigger.trigger_type === TriggerType.Schedule && trigger.custom_cron_expression && (
                                                    <div className="mt-2">
                                                        <code className="px-2 py-1 bg-gray-100 rounded text-xs font-mono">
                                                            {trigger.custom_cron_expression}
                                                        </code>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => {
                                                    setSelectedTrigger(trigger);
                                                    loadExecutions(trigger.id);
                                                }}
                                                className="flex-1"
                                            >
                                                <Activity className="w-3 h-3 mr-1" />
                                                {t("triggers.view-runs")}
                                            </Button>

                                            <Button
                                                size="sm"
                                                variant={trigger.status === TriggerStatus.Active ? "outline" : "primary"}
                                                onClick={() => handleActivateToggle(trigger)}
                                                className="flex-1"
                                            >
                                                {trigger.status === TriggerStatus.Active ? (
                                                    <>
                                                        <Pause className="w-3 h-3 mr-1" />
                                                        {t("triggers.deactivate")}
                                                    </>
                                                ) : (
                                                    <>
                                                        <Play className="w-3 h-3 mr-1" />
                                                        {t("triggers.activate")}
                                                    </>
                                                )}
                                            </Button>

                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => handleDelete(trigger)}
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </Button>
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Right Column - Create Trigger Panel */}
            <div className="flex-[0.7] flex flex-col h-full">
                <CreateTriggerPanel
                    onTriggerCreated={() => {
                        loadTriggers();
                    }}
                />
            </div>

            {/* Executions Dialog */}
            <Dialog open={!!selectedTrigger} onOpenChange={() => setSelectedTrigger(null)}>
                <DialogContent className="max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>
                            {t("triggers.executions-for")}: {selectedTrigger?.name}
                        </DialogTitle>
                    </DialogHeader>

                    {executionsLoading ? (
                        <div className="flex items-center justify-center p-4">
                            <Activity className="w-6 h-6 animate-spin" />
                        </div>
                    ) : (
                        <div className="max-h-96 overflow-y-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>{t("triggers.execution-id")}</TableHead>
                                        <TableHead>{t("triggers.status")}</TableHead>
                                        <TableHead>{t("triggers.started")}</TableHead>
                                        <TableHead>{t("triggers.duration")}</TableHead>
                                        <TableHead>{t("triggers.tokens")}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {executions.map((execution) => (
                                        <TableRow key={execution.id}>
                                            <TableCell className="font-mono text-xs">
                                                {execution.execution_id}
                                            </TableCell>
                                            <TableCell>
                                                <Badge className={
                                                    execution.status === 2 ? "bg-green-100 text-green-800" :
                                                        execution.status === 3 ? "bg-red-100 text-red-800" :
                                                            execution.status === 1 ? "bg-blue-100 text-blue-800" :
                                                                "bg-gray-100 text-gray-800"
                                                }>
                                                    {execution.status === 2 ? t("triggers.completed") :
                                                        execution.status === 3 ? t("triggers.failed") :
                                                            execution.status === 1 ? t("triggers.running") :
                                                                t("triggers.pending")}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                {execution.started_at ?
                                                    new Date(execution.started_at).toLocaleString() :
                                                    "-"
                                                }
                                            </TableCell>
                                            <TableCell>
                                                {execution.duration_seconds ?
                                                    `${execution.duration_seconds.toFixed(2)}s` :
                                                    "-"
                                                }
                                            </TableCell>
                                            <TableCell>
                                                {execution.tokens_used || "-"}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>

                            {executions.length === 0 && (
                                <div className="text-center py-8 text-gray-500">
                                    {t("triggers.no-executions")}
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
