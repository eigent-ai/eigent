import { useState, useEffect, useRef } from "react";
import ToolSelect from "@/components/AddWorker/ToolSelect";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogContentSection,
    DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Clock,
    Globe,
    MessageSquare,
    FileText,
    X,
    Pencil,
    Trash2,
    ChevronRight,
    CheckCircle2,
    XCircle,
    Loader2,
    Play,
    Plus,
    Zap,
    ChevronLeft,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
    ListenerType,
    TriggerInput,
    TriggerType,
    Trigger,
    TriggerExecution,
    ExecutionStatus,
    TriggerStatus,
    RequestType,
} from "@/types";
import { SchedulePicker } from "./SchedulePicker";
import { TriggerTaskInput } from "./TriggerTaskInput";
import { useTriggerStore } from "@/store/triggerStore";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";
import { proxyCreateTrigger, proxyUpdateTrigger, proxyDeleteTrigger } from "@/service/triggerApi";

type TriggerDialogProps = {
    view: "create" | "overview";
    selectedTrigger: Trigger | null;
    executions?: TriggerExecution[];
    onTriggerCreating: (triggerData: TriggerInput) => void;
    onTriggerCreated: (triggerData: TriggerInput) => void;
    onEdit?: (trigger: Trigger) => void;
    onDelete?: (trigger: Trigger) => void;
    onTestExecution?: (trigger: Trigger) => void;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    initialTaskPrompt?: string;
};

export const TriggerDialog: React.FC<TriggerDialogProps> = ({
    view,
    selectedTrigger,
    executions = [],
    onTriggerCreating,
    onTriggerCreated,
    onEdit,
    onDelete,
    onTestExecution,
    isOpen,
    onOpenChange,
    initialTaskPrompt = "",
}) => {
    const { t } = useTranslation();
    const [isLoading, setIsLoading] = useState(false);
    const [selectedExecution, setSelectedExecution] = useState<TriggerExecution | null>(null);
    const [showLogs, setShowLogs] = useState(false);
    const [isWebhookSuccessOpen, setIsWebhookSuccessOpen] = useState(false);
    const [createdWebhookUrl, setCreatedWebhookUrl] = useState<string>("");
    const [formData, setFormData] = useState<TriggerInput>({
        name: "",
        description: "",
        trigger_type: TriggerType.Schedule,
        custom_cron_expression: "0 */1 * * *",
        listener_type: ListenerType.Workforce,
        webhook_method: RequestType.POST,
        agent_model: "",
        task_prompt: "",
        max_executions_per_hour: undefined,
        max_executions_per_day: undefined,
        is_single_execution: false,
    });
    // const [selectedTools, setSelectedTools] = useState<any[]>([]);
    // const toolSelectRef = useRef<{ installMcp: (id: number, env?: any, activeMcp?: any) => Promise<void> } | null>(null);

    //Get projectStore for the active project's task
	const { projectStore } = useChatStoreAdapter();

    const { addTrigger, updateTrigger } = useTriggerStore();

    // Reset form when dialog opens
    useEffect(() => {
        if (view === "create" && isOpen) {
            // If editing an existing trigger, populate the form with its data
            if (selectedTrigger) {
                setFormData({
                    name: selectedTrigger.name || "",
                    description: selectedTrigger.description || "",
                    trigger_type: selectedTrigger.trigger_type || TriggerType.Schedule,
                    custom_cron_expression: selectedTrigger.custom_cron_expression || "0 */1 * * *",
                    listener_type: selectedTrigger.listener_type || ListenerType.Workforce,
                    webhook_method: RequestType.POST,
                    agent_model: selectedTrigger.agent_model || "",
                    task_prompt: selectedTrigger.task_prompt || "",
                    max_executions_per_hour: selectedTrigger.max_executions_per_hour,
                    max_executions_per_day: selectedTrigger.max_executions_per_day,
                    is_single_execution: selectedTrigger.is_single_execution || false,
                    webhook_url: selectedTrigger.webhook_url,
                });
            } else {
                // Reset form for new trigger, use initialTaskPrompt if provided
                setFormData({
                    name: "",
                    description: "",
                    trigger_type: TriggerType.Schedule,
                    custom_cron_expression: "0 */1 * * *",
                    listener_type: ListenerType.Workforce,
                    webhook_method: RequestType.POST,
                    agent_model: "",
                    task_prompt: initialTaskPrompt,
                    max_executions_per_hour: undefined,
                    max_executions_per_day: undefined,
                    is_single_execution: false,
                });
            }
        }
    }, [isOpen, selectedTrigger, view, initialTaskPrompt]); // React to dialog state and trigger changes

    const handleClose = () => {
        onOpenChange(false);
        setShowLogs(false);
        setSelectedExecution(null);
    };

    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();

        if (!formData.name.trim()) {
            toast.error(t("triggers.name-required"));
            return;
        }
        if (!formData.task_prompt?.trim()) {
            toast.error(t("triggers.task-prompt-required"));
            return;
        }

        setIsLoading(true);
        onTriggerCreating(formData);

        try {
            //Make sure we have an active project
            //TODO: Also make sure project is created in database
            if(!projectStore.activeProjectId) {
                toast.error(t("triggers.project-id-required"));
                return;
            }

            let response: Trigger;

            if (selectedTrigger) {
                // Editing existing trigger
                response = await proxyUpdateTrigger(selectedTrigger.id, {
                    name: formData.name,
                    description: formData.description,
                    custom_cron_expression: formData.custom_cron_expression,
                    listener_type: formData.listener_type,
                    webhook_method: formData.webhook_method,
                    agent_model: formData.agent_model,
                    task_prompt: formData.task_prompt,
                    max_executions_per_hour: formData.max_executions_per_hour,
                    max_executions_per_day: formData.max_executions_per_day,
                    is_single_execution: formData.is_single_execution,
                });
                toast.success(t("triggers.updated-successfully"));
                updateTrigger(selectedTrigger.id, response);
            } else {
                // Creating new trigger
                response = await proxyCreateTrigger({
                    name: formData.name,
                    description: formData.description,
                    trigger_type: formData.trigger_type,
                    custom_cron_expression: formData.custom_cron_expression,
                    listener_type: formData.listener_type,
                    webhook_method: formData.webhook_method,
                    agent_model: formData.agent_model,
                    task_prompt: formData.task_prompt,
                    max_executions_per_hour: formData.max_executions_per_hour,
                    max_executions_per_day: formData.max_executions_per_day,
                    is_single_execution: formData.is_single_execution,
                    project_id: projectStore.activeProjectId,
                });
                toast.success(t("triggers.created-successfully"));
                addTrigger(response);
            }

            onTriggerCreated(formData);
            handleClose();
            
            // Display the webhook url in a success dialog (only for new webhooks)
            if(!selectedTrigger && formData.trigger_type === TriggerType.Webhook && response.webhook_url) {
                setCreatedWebhookUrl(response.webhook_url);
                setIsWebhookSuccessOpen(true);
            }
        } catch (error) {
            console.error("Failed to create trigger:", error);
            toast.error(t("triggers.failed-to-create"));
        } finally {
            setIsLoading(false);
        }
    };

    const handleCopyWebhookUrl = async () => {
        try {
            await navigator.clipboard.writeText(createdWebhookUrl);
            toast.success(t("triggers.webhook-url-copied"));
        } catch (err) {
            toast.error(t("triggers.failed-to-copy"));
        }
    };

    const getStatusColor = (status: TriggerStatus) => {
        switch (status) {
            case TriggerStatus.Active: return "text-text-success bg-surface-success";
            case TriggerStatus.Inactive: return "text-text-label bg-surface-secondary";
            default: return "text-text-label bg-surface-secondary";
        }
    };

    const getExecutionStatusIcon = (status: ExecutionStatus) => {
        switch (status) {
            case ExecutionStatus.Completed: return <CheckCircle2 className="w-4 h-4 text-text-success" />;
            case ExecutionStatus.Failed: return <XCircle className="w-4 h-4 text-text-cuation" />;
            case ExecutionStatus.Running: return <Loader2 className="w-4 h-4 text-text-information animate-spin" />;
            //TODO: Reconform Missed icon
            case ExecutionStatus.Missed: return <XCircle className="w-4 h-4 text-text-cuation" />;
            default: return <Clock className="w-4 h-4 text-text-label" />;
        }
    };

    const formatDate = (dateString?: string) => {
        if (!dateString) return "-";
        return new Date(dateString).toLocaleString();
    };

    const handleEditClick = () => {
        if (onEdit && selectedTrigger) onEdit(selectedTrigger);
    };

    const handleDeleteClick = () => {
        if (onDelete && selectedTrigger) {
            onDelete(selectedTrigger);
        }
    };

    const handleExecutionClick = (execution: TriggerExecution) => {
        setSelectedExecution(execution);
        setShowLogs(true);
    };

    const renderEmptyState = () => (
        <div className="w-full h-full flex flex-col items-center justify-center text-center px-md py-lg min-h-[300px]">
            <FileText className="w-12 h-12 text-icon-secondary mb-sm" />
            <h3 className="text-text-heading font-semibold text-body-base mb-xs">
                {t("triggers.no-trigger-selected")}
            </h3>
            <p className="text-text-label text-sm max-w-sm">
                {t("triggers.select-trigger-hint")}
            </p>
        </div>
    );

    const renderOverviewContent = () => {
        if (!selectedTrigger) return null;
        return (
            <div className="w-full flex flex-col overflow-hidden">
                <div className={`flex-1 flex flex-row ${showLogs ? 'border-r border-border-secondary' : ''}`}>
                    <div className="flex-1 flex flex-col overflow-auto">
                        <div className="flex-1 flex-col space-y-4">
                            <div className="flex flex-col bg-surface-tertiary rounded-2xl p-4 gap-md">
                                <div className="flex items-center justify-between">
                                    <div className="text-text-body font-bold text-sm">{t("triggers.trigger-overview")}</div>
                                    <Button variant="primary" size="sm" onClick={() => onTestExecution?.(selectedTrigger)} className="gap-1">
                                        <Play className="w-4 h-4" />{t("triggers.run-test")}
                                    </Button>
                                </div>
                                <div className="w-full flex flex-row gap-4">
                                    <div className="flex-1 w-full h-full">
                                        <div className="text-text-body text-sm whitespace-pre-wrap bg-surface-secondary rounded-lg p-3 min-h-[100px]">
                                            {selectedTrigger.task_prompt || "-"}
                                        </div>
                                    </div>
                                    <div className="flex-1 w-full space-y-2">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-text-label text-xs">{t("triggers.type")}</Label>
                                            <div className="flex items-center gap-1 text-sm">
                                                {selectedTrigger.trigger_type === TriggerType.Schedule && <><Clock className="w-4 h-4" />{t("triggers.schedule")}</>}
                                                {selectedTrigger.trigger_type === TriggerType.Webhook && <><Globe className="w-4 h-4" />{t("triggers.webhook")}</>}
                                                {selectedTrigger.trigger_type === TriggerType.SlackTrigger && <><MessageSquare className="w-4 h-4" />{t("triggers.slack")}</>}
                                            </div>
                                        </div>
                                        {selectedTrigger.trigger_type === TriggerType.Schedule && (
                                            <div className="flex items-center justify-between">
                                                <Label className="text-text-label text-xs">{t("triggers.period")}</Label>
                                                <code className="text-xs font-mono bg-surface-secondary px-2 py-1 rounded">{selectedTrigger.custom_cron_expression}</code>
                                            </div>
                                        )}
                                        {selectedTrigger.trigger_type === TriggerType.Webhook && selectedTrigger.webhook_url && (
                                            <div className="flex items-center justify-between">
                                                <Label className="text-text-label text-xs">{t("triggers.webhook-url")}</Label>
                                                <code className="text-xs font-mono bg-surface-secondary px-2 py-1 rounded max-w-[180px] truncate">{selectedTrigger.webhook_url}</code>
                                            </div>
                                        )}
                                        <div className="flex items-center justify-between">
                                            <Label className="text-text-label text-xs">{t("triggers.executions")}</Label>
                                            <span className="text-sm">{selectedTrigger.execution_count}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <Label className="text-text-label text-xs">{t("triggers.status")}</Label>
                                            <span className={`text-xs px-2 py-1 rounded ${getStatusColor(selectedTrigger.status)}`}>
                                                {selectedTrigger.status === TriggerStatus.Active && t("triggers.status.active")}
                                                {selectedTrigger.status === TriggerStatus.Inactive && t("triggers.status.inactive")}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <Label className="text-text-label text-xs">{t("triggers.created-at")}</Label>
                                            <span className="text-xs text-text-label">{formatDate(selectedTrigger.created_at)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="bg-surface-tertiary rounded-2xl p-4">
                                <div className="text-text-body font-bold text-sm mb-3">{t("triggers.execution-history")}</div>
                                {executions.length === 0 ? (
                                    <div className="text-text-label text-sm text-center py-4">{t("triggers.no-executions-yet")}</div>
                                ) : (
                                    <div className="space-y-2 max-h-[200px] overflow-auto">
                                        {executions.map((execution) => (
                                            <div key={execution.id} onClick={() => handleExecutionClick(execution)} className="flex items-center justify-between p-3 bg-surface-secondary rounded-lg hover:bg-surface-primary cursor-pointer transition-colors">
                                                <div className="flex items-center gap-3">
                                                    {getExecutionStatusIcon(execution.status)}
                                                    <div>
                                                        <div className="text-sm font-medium">{execution.execution_id.slice(0, 8)}...</div>
                                                        <div className="text-xs text-text-label">{formatDate(execution.started_at)}</div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs text-text-label">{execution.duration_seconds ? `${execution.duration_seconds}s` : "-"}</span>
                                                    <ChevronRight className="w-4 h-4 text-icon-secondary" />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    {showLogs && selectedExecution && (
                        <div className="w-[320px] flex flex-col bg-fill-default border-l border-border-secondary">
                            <div className="flex items-center justify-between px-md py-sm border-b border-border-secondary">
                                <div className="text-text-body font-bold text-sm">{t("triggers.logs")}</div>
                                <Button variant="ghost" size="icon" onClick={() => setShowLogs(false)}><X className="w-4 h-4" /></Button>
                            </div>
                            <div className="flex-1 overflow-auto p-4 space-y-3">
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between"><Label className="text-text-label text-xs">Execution ID</Label><code className="text-xs font-mono">{selectedExecution.execution_id}</code></div>
                                    <div className="flex items-center justify-between"><Label className="text-text-label text-xs">Status</Label><div className="flex items-center gap-1">{getExecutionStatusIcon(selectedExecution.status)}<span className="text-xs">{selectedExecution.status}</span></div></div>
                                    <div className="flex items-center justify-between"><Label className="text-text-label text-xs">{t("triggers.started")}</Label><span className="text-xs">{formatDate(selectedExecution.started_at)}</span></div>
                                    {selectedExecution.duration_seconds && <div className="flex items-center justify-between"><Label className="text-text-label text-xs">{t("triggers.duration")}</Label><span className="text-xs">{selectedExecution.duration_seconds}s</span></div>}
                                    {selectedExecution.tokens_used && <div className="flex items-center justify-between"><Label className="text-text-label text-xs">{t("triggers.tokens")}</Label><span className="text-xs">{selectedExecution.tokens_used}</span></div>}
                                </div>
                                {selectedExecution.error_message && <div className="space-y-1"><Label className="text-text-label text-xs">Error</Label><div className="text-xs text-text-cuation bg-surface-cuation p-2 rounded">{selectedExecution.error_message}</div></div>}
                                {selectedExecution.output_data && <div className="space-y-1"><Label className="text-text-label text-xs">{t("triggers.output-tasks")}</Label><pre className="text-xs bg-surface-tertiary p-2 rounded overflow-auto max-h-[150px]">{JSON.stringify(selectedExecution.output_data, null, 2)}</pre></div>}
                                {selectedExecution.tools_executed && <div className="space-y-1"><Label className="text-text-label text-xs">Tools Executed</Label><pre className="text-xs bg-surface-tertiary p-2 rounded overflow-auto max-h-[150px]">{JSON.stringify(selectedExecution.tools_executed, null, 2)}</pre></div>}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderCreateContent = () => {
        return (
            <div className="flex-1 w-full h-full overflow-y-auto scrollbar-always-visible p-6 space-y-6 bg-surface-disabled">
                {/* Trigger Name */}
                <Input
                    id="name"
                    value={formData.name}
                    required
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    title={t("triggers.name")}
                    placeholder={t("triggers.name-placeholder")}
                />

                {/* Task Prompt - moved from step 2 */}
                <TriggerTaskInput
                    value={formData.task_prompt || ""}
                    onChange={(value) => setFormData({ ...formData, task_prompt: value })}
                />

                {/* Trigger Type */}
                <div className="space-y-3">
                    <Label className="font-bold text-sm">{t("triggers.type")}</Label>
                    <Tabs value={formData.trigger_type} onValueChange={(value) => setFormData({ ...formData, trigger_type: value as TriggerType })}>
                        <TabsList className="w-full">
                            <TabsTrigger value={TriggerType.Schedule} className="flex-1" disabled={!!selectedTrigger}><Clock className="w-4 h-4 mr-2" />{t("triggers.schedule")}</TabsTrigger>
                            <TabsTrigger value={TriggerType.Webhook} className="flex-1" disabled={!!selectedTrigger}><Globe className="w-4 h-4 mr-2" />{t("triggers.webhook")}</TabsTrigger>
                        </TabsList>
                        <TabsContent value={TriggerType.Schedule}>
                            <SchedulePicker value={formData.custom_cron_expression || "0 */1 * * *"} onChange={(cron) => setFormData({ ...formData, custom_cron_expression: cron })} />
                        </TabsContent>
                        <TabsContent value={TriggerType.Webhook}>
                            <div className="space-y-4">
                                {/* <ToolSelect
                                    onShowEnvConfig={() => { }}
                                    onSelectedToolsChange={setSelectedTools}
                                    initialSelectedTools={selectedTools}
                                    ref={toolSelectRef}
                                /> */}
                                <div className="space-y-2">
                                    <Label className="font-bold text-sm">{t("triggers.webhook-method")}</Label>
                                    <Select value={formData.webhook_method || RequestType.POST} onValueChange={(value: RequestType) => setFormData({ ...formData, webhook_method: value })}>
                                        <SelectTrigger><SelectValue placeholder={t("triggers.select-method")} /></SelectTrigger>
                                        <SelectContent>
                                            {/* <SelectItem value={RequestType.GET}>{t("webhook.get")}</SelectItem> */}
                                            <SelectItem value={RequestType.POST}>{t("webhook.post")}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="text-sm text-text-label bg-surface-secondary p-3 rounded-lg">
                                    {t("triggers.webhook-url-after-creation")}
                                </div>
                            </div>
                        </TabsContent>
                    </Tabs>
                </div>

                {/* Execution Settings - Accordion */}
                <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="execution-settings" className="border-none">
                        <AccordionTrigger className="py-2 hover:no-underline bg-transparent">
                            <span className="font-bold text-sm text-text-heading">Execution Settings</span>
                        </AccordionTrigger>
                        <AccordionContent>
                            <div className="grid grid-cols-3 gap-4 pt-2">
                                <Input
                                    id="max_per_hour"
                                    title={t("triggers.max-per-hour")}
                                    placeholder={t("triggers.max-per-hour-placeholder")}
                                    type="number" value={formData.max_executions_per_hour || ""}
                                    onChange={(e) => setFormData({ ...formData, max_executions_per_hour: e.target.value ? parseInt(e.target.value) : undefined })}
                                    min={0}
                                    disabled={formData.is_single_execution}
                                />
                                <Input
                                    id="max_per_day"
                                    title={t("triggers.max-per-day")}
                                    placeholder={t("triggers.max-per-day-placeholder")}
                                    type="number" value={formData.max_executions_per_day || ""}
                                    onChange={(e) => setFormData({ ...formData, max_executions_per_day: e.target.value ? parseInt(e.target.value) : undefined })}
                                    min={0}
                                    disabled={formData.is_single_execution}
                                />
                                <div className="flex flex-col items-start space-x-2">
                                    <Label htmlFor="single_execution" className="text-body-md font-bold mb-3">{t("triggers.single-execution")}</Label>
                                    <Switch id="single_execution" className="my-2" checked={formData.is_single_execution} onCheckedChange={(checked) => setFormData({ ...formData, is_single_execution: checked })} />
                                </div>
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </div>
        );
    };

    const getDialogTitle = () => {
        if (view === "create") {
            return t("triggers.create-trigger-agent");
        }
        if (selectedTrigger) return selectedTrigger.name;
        return t("triggers.trigger-details");
    };

    const renderFooter = () => {
        if (view !== "create") return null;
        return (
            <DialogFooter>
                <div className="flex w-full justify-end">
                    <Button variant="primary" onClick={() => handleSubmit()} disabled={isLoading}>
                        {isLoading 
                            ? (selectedTrigger ? t("common.updating") : t("common.creating"))
                            : (selectedTrigger ? t("common.update") : t("common.create"))
                        }
                    </Button>
                </div>
            </DialogFooter>
        );
    };

    return (
        <>
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent
                size="lg"
                showCloseButton={true}
                onClose={handleClose}
                className={view === "create" ? "max-w-[600px] h-[600px] overflow-hidden flex flex-col" : showLogs ? "max-w-[1100px]" : "max-w-[700px]"}
                aria-describedby={undefined}
            >
                <DialogHeader
                    title={getDialogTitle()}
                    subtitle={view === "create" ? t("triggers.create-trigger-subtitle", { defaultValue: "Set up an automated trigger for your agent" }) : undefined}
                >
                    {view === "overview" && selectedTrigger && (
                        <div className="flex items-center gap-2">
                            <Button variant="ghost" size="sm" onClick={handleEditClick} className="gap-1"><Pencil className="w-4 h-4" />{t("triggers.edit")}</Button>
                            <Button variant="ghost" size="sm" onClick={handleDeleteClick}><Trash2 className="w-4 h-4" />{t("triggers.delete")}</Button>
                        </div>
                    )}
                </DialogHeader>
                <DialogContentSection className={view === "create" ? "p-0 flex-1 overflow-hidden" : "max-h-[60vh] overflow-auto"}>
                    {view === "overview" && !selectedTrigger && renderEmptyState()}
                    {view === "overview" && selectedTrigger && renderOverviewContent()}
                    {view === "create" && renderCreateContent()}
                </DialogContentSection>
                {renderFooter()}
            </DialogContent>
        </Dialog>

        {/* Webhook Success Dialog */}
        <Dialog open={isWebhookSuccessOpen} onOpenChange={setIsWebhookSuccessOpen}>
            <DialogContent
                size="md"
                showCloseButton={true}
                onClose={() => setIsWebhookSuccessOpen(false)}
                className="max-w-[550px]"
                aria-describedby={undefined}
            >
                <DialogHeader
                    title={t("triggers.webhook-created-title")}
                    subtitle={t("triggers.webhook-created-subtitle")}
                />
                <DialogContentSection className="space-y-4">
                    <div className="flex flex-col items-center justify-center py-6 space-y-4">
                        <div className="w-16 h-16 rounded-full bg-surface-success flex items-center justify-center">
                            <Zap className="w-8 h-8 text-text-success" />
                        </div>
                        <div className="text-center space-y-2">
                            <h3 className="text-text-heading font-semibold text-lg">
                                {t("triggers.webhook-ready")}
                            </h3>
                            <p className="text-text-label text-sm max-w-md">
                                {t("triggers.webhook-instructions")}
                            </p>
                        </div>
                    </div>
                    
                    <div className="space-y-2">
                        <Label className="text-text-label text-xs font-semibold">{t("triggers.your-webhook-url")}</Label>
                        <div className="flex items-center gap-2">
                            <div className="flex-1 bg-surface-secondary rounded-lg p-3 border border-border-secondary">
                                <code className="text-sm font-mono text-text-body break-all">
                                    {createdWebhookUrl}
                                </code>
                            </div>
                            <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={handleCopyWebhookUrl}
                                className="shrink-0"
                            >
                                {t("common.copy")}
                            </Button>
                        </div>
                    </div>

                    <div className="bg-surface-information rounded-lg p-4 space-y-2">
                        <div className="flex items-start gap-2">
                            <Globe className="w-4 h-4 text-text-information mt-0.5 shrink-0" />
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-text-information">
                                    {t("triggers.webhook-tip-title")}
                                </p>
                                <p className="text-xs text-text-information opacity-90">
                                    {t("triggers.webhook-tip-description")}
                                </p>
                            </div>
                        </div>
                    </div>
                </DialogContentSection>
                <DialogFooter>
                    <Button 
                        variant="primary" 
                        onClick={() => setIsWebhookSuccessOpen(false)}
                        className="w-full"
                    >
                        {t("common.got-it")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        </>
    );
};

// Trigger button component
type TriggerDialogButtonProps = {
    view?: "create" | "overview";
    selectedTrigger?: Trigger | null;
    executions?: TriggerExecution[];
    onTriggerCreating: (triggerData: TriggerInput) => void;
    onTriggerCreated: (triggerData: TriggerInput) => void;
    onEdit?: (trigger: Trigger) => void;
    onDelete?: (trigger: Trigger) => void;
    onTestExecution?: (trigger: Trigger) => void;
    buttonVariant?: "primary" | "secondary" | "outline" | "ghost";
    buttonSize?: "xxs" | "xs" | "sm" | "md" | "lg" | "icon";
    buttonText?: string;
    buttonIcon?: React.ReactNode;
    className?: string;
};

export const TriggerDialogButton: React.FC<TriggerDialogButtonProps> = ({
    view = "create",
    selectedTrigger = null,
    executions = [],
    onTriggerCreating,
    onTriggerCreated,
    onEdit,
    onDelete,
    onTestExecution,
    buttonVariant = "primary",
    buttonSize = "md",
    buttonText,
    buttonIcon,
    className,
}) => {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <Button variant={buttonVariant} size={buttonSize} onClick={() => setIsOpen(true)} className={className}>
                {buttonIcon || <Plus className="w-4 h-4 mr-2" />}
                {buttonText || t("triggers.add-trigger")}
            </Button>
            <TriggerDialog
                view={view}
                selectedTrigger={selectedTrigger}
                executions={executions}
                onTriggerCreating={onTriggerCreating}
                onTriggerCreated={onTriggerCreated}
                onEdit={onEdit}
                onDelete={onDelete}
                onTestExecution={onTestExecution}
                isOpen={isOpen}
                onOpenChange={setIsOpen}
            />
        </>
    );
};

export default TriggerDialog;
