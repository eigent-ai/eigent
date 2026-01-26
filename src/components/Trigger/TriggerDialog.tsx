import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogContentSection,
    DialogFooter,
} from "@/components/ui/dialog";
import { TooltipSimple } from "@/components/ui/tooltip";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Globe,
    Plus,
    Zap,
    Copy,
    CircleAlert,
    AlarmClockIcon,
    WebhookIcon,
    AlertTriangle,
    GlobeIcon,
    Slack,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
    ListenerType,
    TriggerInput,
    TriggerType,
    Trigger,
    RequestType,
    TriggerStatus,
} from "@/types";
import { SchedulePicker } from "./SchedulePicker";
import { TriggerTaskInput } from "./TriggerTaskInput";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";
import { proxyCreateTrigger, proxyUpdateTrigger } from "@/service/triggerApi";
import { useTriggerConfigQuery, useTriggerCacheInvalidation } from "@/hooks/queries/useTriggerQueries";
import DynamicTriggerConfig, { getDefaultTriggerConfig, filterExcludedFields, type ValidationError, type TriggerConfigSchema } from "./DynamicTriggerConfig";

type TriggerDialogProps = {
    selectedTrigger: Trigger | null;
    onTriggerCreating: (triggerData: TriggerInput) => void;
    onTriggerCreated: (triggerData: Trigger) => void;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    initialTaskPrompt?: string;
};

export const TriggerDialog: React.FC<TriggerDialogProps> = ({
    selectedTrigger,
    onTriggerCreating,
    onTriggerCreated,
    isOpen,
    onOpenChange,
    initialTaskPrompt = "",
}) => {
    const { t } = useTranslation();
    const [isLoading, setIsLoading] = useState(false);
    const [isWebhookSuccessOpen, setIsWebhookSuccessOpen] = useState(false);
    const [createdWebhookUrl, setCreatedWebhookUrl] = useState<string>("");
    const [nameError, setNameError] = useState<string>("");
    const [taskPromptError, setTaskPromptError] = useState<string>("");
    const [formData, setFormData] = useState<TriggerInput>({
        name: selectedTrigger?.name || "",
        description: selectedTrigger?.description || "",
        trigger_type: selectedTrigger?.trigger_type || TriggerType.Schedule,
        custom_cron_expression: selectedTrigger?.custom_cron_expression || "0 */1 * * *",
        listener_type: selectedTrigger?.listener_type || ListenerType.Workforce,
        webhook_method: selectedTrigger?.webhook_method || RequestType.POST,
        agent_model: selectedTrigger?.agent_model || "",
        task_prompt: selectedTrigger?.task_prompt || initialTaskPrompt || "",
        max_executions_per_hour: selectedTrigger?.max_executions_per_hour,
        max_executions_per_day: selectedTrigger?.max_executions_per_day,
        is_single_execution: selectedTrigger?.is_single_execution || false,
        webhook_url: selectedTrigger?.webhook_url,
    });
    const [triggerConfig, setTriggerConfig] = useState<Record<string, any>>(getDefaultTriggerConfig());
    const [triggerConfigSchema, setTriggerConfigSchema] = useState<TriggerConfigSchema | null>(null);
    const [selectedApp, setSelectedApp] = useState<string>("");
    const [isConfigValid, setIsConfigValid] = useState<boolean>(true);
    const [configValidationErrors, setConfigValidationErrors] = useState<ValidationError[]>([]);
    const [isScheduleValid, setIsScheduleValid] = useState<boolean>(false);

    //Get projectStore for the active project's task
    const { projectStore } = useChatStoreAdapter();

    // Fetch trigger config using query hook
    const { data: configData } = useTriggerConfigQuery(
        selectedTrigger?.trigger_type || formData.trigger_type,
        isOpen // Only fetch when dialog is open
    );

    // Reset form when dialog opens
    useEffect(() => {
        if (isOpen) {
            // Clear validation errors when dialog opens
            setNameError("");
            setTaskPromptError("");
            setIsScheduleValid(false);

            // If editing an existing trigger, populate the form with its data
            if (selectedTrigger) {
                setFormData({
                    name: selectedTrigger.name || "",
                    description: selectedTrigger.description || "",
                    trigger_type: selectedTrigger.trigger_type || TriggerType.Schedule,
                    custom_cron_expression: selectedTrigger.custom_cron_expression || "0 */1 * * *",
                    listener_type: selectedTrigger.listener_type || ListenerType.Workforce,
                    webhook_method: selectedTrigger.webhook_method || RequestType.POST,
                    agent_model: selectedTrigger.agent_model || "",
                    task_prompt: selectedTrigger.task_prompt || "",
                    max_executions_per_hour: selectedTrigger.max_executions_per_hour,
                    max_executions_per_day: selectedTrigger.max_executions_per_day,
                    is_single_execution: selectedTrigger.is_single_execution || false,
                    webhook_url: selectedTrigger.webhook_url,
                });
                // Load existing trigger config if available
                if (selectedTrigger.config) {
                    setTriggerConfig(selectedTrigger.config as Record<string, any>);
                } else {
                    setTriggerConfig(getDefaultTriggerConfig());
                }
                // Set selectedApp based on trigger type for app-based triggers
                if (selectedTrigger.trigger_type === TriggerType.Slack) {
                    setSelectedApp("slack");
                } else {
                    setSelectedApp("");
                }
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
                    task_prompt: initialTaskPrompt || "",
                    max_executions_per_hour: undefined,
                    max_executions_per_day: undefined,
                    is_single_execution: false,
                });
                setTriggerConfig(getDefaultTriggerConfig());
                setTriggerConfigSchema(null);
                setSelectedApp("");
            }
        }
    }, [isOpen, selectedTrigger, initialTaskPrompt]); // React to dialog state and trigger changes

    // Update schema when query data changes
    useEffect(() => {
        if (configData?.schema_) {
            setTriggerConfigSchema(configData.schema_);
        }
    }, [configData]);

    const handleClose = () => {
        onOpenChange(false);
    };

    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();

        if (!formData.name.trim()) {
            setNameError(t("triggers.name-required"));
            return;
        }

        // Clear name error if validation passes
        setNameError("");
        if (!formData.task_prompt?.trim()) {
            setTaskPromptError(t("triggers.task-prompt-required"));
            toast.error(t("triggers.task-prompt-required"));
            return;
        }

        // Clear task prompt error if validation passes
        setTaskPromptError("");

        // Check dynamic config validation for triggers with config (Slack, Webhook, etc.)
        const hasDynamicConfig = triggerConfigSchema && Object.keys(triggerConfigSchema.properties || {}).length > 0;
        if (hasDynamicConfig && !isConfigValid) {
            const errorMessages = configValidationErrors.map((e) => e.message).join(", ");
            toast.error(t("triggers.dynamic.validation-failed", { errors: errorMessages }));
            return;
        }

        setIsLoading(true);
        onTriggerCreating(formData);

        try {
            //Make sure we have an active project
            //TODO: Also make sure project is created in database
            if (!projectStore.activeProjectId) {
                toast.error(t("triggers.project-id-required"));
                return;
            }

            let response: Trigger;

            if (selectedTrigger) {
                // Editing existing trigger
                const updateData: any = {
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
                };
                
                // Include config for triggers that have dynamic config (Slack, Webhook, etc.)
                if (Object.keys(triggerConfig).length > 0) {
                    // Filter out fields marked with exclude: true in schema
                    updateData.config = filterExcludedFields(triggerConfig, triggerConfigSchema);
                }
                
                response = await proxyUpdateTrigger(selectedTrigger.id, updateData);
                toast.success(t("triggers.updated-successfully"));
            } else {
                // Creating new trigger
                const createData: TriggerInput = {
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
                };
                
                // Include config for triggers that have dynamic config (Slack, Webhook, etc.)
                if (Object.keys(triggerConfig).length > 0) {
                    // Filter out fields marked with exclude: true in schema
                    createData.config = filterExcludedFields(triggerConfig, triggerConfigSchema);
                }
                
                response = await proxyCreateTrigger(createData);
                toast.success(t("triggers.created-successfully"));
            }
            
            //Update/Create Trigger on response
            onTriggerCreated(response);
            
            handleClose();

            // Display the webhook url in a success dialog (only for new webhooks)
            if (!selectedTrigger && formData.trigger_type === TriggerType.Webhook && response.webhook_url) {
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
            await navigator.clipboard.writeText(`${import.meta.env.VITE_PROXY_URL}/api${formData.webhook_url || createdWebhookUrl}`);
            toast.success(t("triggers.webhook-url-copied"));
        } catch (err) {
            toast.error(t("triggers.failed-to-copy"));
        }
    };

    const renderCreateContent = () => {
        const needsAuth = selectedTrigger?.status === TriggerStatus.PendingAuth && selectedTrigger?.config?.authentication_required;

        return (
            <div className="flex flex-col w-full h-full overflow-y-auto scrollbar-always-visible p-6 gap-6">
                {/* Trigger Name */}
                <Input
                    id="name"
                    value={formData.name}
                    required
                    state={nameError ? "error" : "default"}
                    note={nameError || undefined}
                    onChange={(e) => {
                        setFormData({ ...formData, name: e.target.value });
                        // Clear error when user starts typing
                        if (nameError) {
                            setNameError("");
                        }
                    }}
                    title={t("triggers.name")}
                    placeholder={t("triggers.name-placeholder")}
                />

                {/* Task Prompt - moved from step 2 */}
                <TriggerTaskInput
                    value={formData.task_prompt || ""}
                    onChange={(value) => {
                        setFormData({ ...formData, task_prompt: value });
                        // Clear error when user starts typing
                        if (taskPromptError) {
                            setTaskPromptError("");
                        }
                    }}
                    state={taskPromptError ? "error" : "default"}
                    note={taskPromptError || undefined}
                />

                {/* Execution Settings - Accordion */}
                <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="execution-settings" className="border-none">
                        <AccordionTrigger className="py-2 hover:no-underline bg-transparent">
                            <span className="font-bold text-sm text-text-heading">{t("triggers.execution-settings")}</span>
                        </AccordionTrigger>
                        <AccordionContent>
                            <div className="flex flex-col gap-4 pt-2 bg-surface-disabled rounded-lg p-4">
                                <div className="flex items-center gap-2 my-2">
                                    <Label htmlFor="single_execution" className="text-body-md font-bold">{t("triggers.single-execution")}</Label>
                                    <Switch id="single_execution"
                                        size="sm"
                                        checked={formData.is_single_execution} onCheckedChange={(checked) => setFormData({ ...formData, is_single_execution: checked })} />
                                </div>
                                <div className="flex items-center gap-2">
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
                                </div>
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>

                {/* Trigger Type */}
                <div className="space-y-3">
                    <Label className="font-bold text-sm">{t("triggers.type")}</Label>
                    <Tabs value={formData.trigger_type} onValueChange={(value) => setFormData({ ...formData, trigger_type: value as TriggerType })}>
                        <TabsList className="w-full">
                            <TabsTrigger value={TriggerType.Schedule} className="flex-1" disabled={!!selectedTrigger}><AlarmClockIcon className="w-4 h-4 mr-2" />{t("triggers.schedule-trigger")}</TabsTrigger>
                            <TabsTrigger value={TriggerType.Webhook} className="flex-1" disabled={!!selectedTrigger}><WebhookIcon className="w-4 h-4 mr-2" />{t("triggers.webhook-trigger")}</TabsTrigger>
                            <TabsTrigger value={TriggerType.Slack} className="flex-1" disabled={!!selectedTrigger}><GlobeIcon className="w-4 h-4 mr-2" />{t("triggers.app-trigger")}</TabsTrigger>
                        </TabsList>
                        <TabsContent value={TriggerType.Schedule} className="min-h-[280px] bg-surface-disabled rounded-lg p-4">
                            <SchedulePicker
                                value={formData.custom_cron_expression || "0 */1 * * *"}
                                onChange={(cron) => setFormData({ ...formData, custom_cron_expression: cron })}
                                onValidationChange={(isValid) => setIsScheduleValid(isValid)}
                            />
                        </TabsContent>
                        <TabsContent value={TriggerType.Webhook} className="min-h-[280px] bg-surface-disabled rounded-lg p-4">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label className="font-bold text-sm">{t("triggers.webhook-method")}</Label>
                                    <Select value={formData.webhook_method || RequestType.POST} onValueChange={(value: RequestType) => setFormData({ ...formData, webhook_method: value })}>
                                        <SelectTrigger><SelectValue placeholder={t("triggers.select-method")} /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value={RequestType.GET}>GET</SelectItem>
                                            <SelectItem value={RequestType.POST}>POST</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                {
                                    !selectedTrigger || !formData.webhook_url ? (
                                        <div className="text-sm text-text-label bg-surface-secondary p-3 rounded-lg">
                                            {t("triggers.webhook-url-after-creation")}
                                        </div>) : (
                                        <div className={`flex flex-row items-center justify-start gap-4 p-4 bg-surface-primary rounded-xl ${needsAuth ? 'border border-yellow-500' : ''}`}>
                                            <div className="w-full font-mono text-sm text-text-body break-all flex items-center gap-2">
                                                {needsAuth && (
                                                    <TooltipSimple content={t("triggers.verification-required")}>
                                                        <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0" />
                                                    </TooltipSimple>
                                                )}
                                                {`${import.meta.env.VITE_PROXY_URL}/api${formData.webhook_url || createdWebhookUrl}`}
                                            </div>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={handleCopyWebhookUrl}
                                            >
                                                <Copy />
                                                {t("triggers.copy")}
                                            </Button>
                                        </div>)
                                }
                                <div className="space-y-2">
                                    <Accordion type="single" collapsible className="w-full">
                                        <AccordionItem value="extra-settings" className="border-none">
                                            <AccordionTrigger className="py-2 hover:no-underline bg-transparent">
                                                <span className="font-bold text-sm text-text-heading">{t("triggers.extra-settings")}</span>
                                            </AccordionTrigger>
                                            <AccordionContent>
                                                <div className="flex flex-col gap-4 pt-2 bg-surface-disabled rounded-lg p-4">
                                                    <DynamicTriggerConfig
                                                        triggerType={TriggerType.Webhook}
                                                        value={triggerConfig}
                                                        onChange={setTriggerConfig}
                                                        disabled={isLoading}
                                                        showSectionTitles={false}
                                                    />
                                                </div>
                                            </AccordionContent>
                                        </AccordionItem>
                                    </Accordion>
                                </div>
                            </div>
                        </TabsContent>
                        {/* TODO: Select Slack Trigger only on App Select rather than section */}
                        <TabsContent value={TriggerType.Slack} className="min-h-[280px] bg-surface-disabled rounded-lg p-4">
                            {!selectedApp ? (
                                <div className="space-y-4">
                                    <Label className="font-bold text-sm">{t("triggers.select-app")}</Label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <Button
                                            variant="outline"
                                            size="lg"
                                            className="h-24 flex flex-col items-center justify-center gap-2"
                                            onClick={() => {
                                                setSelectedApp("slack");
                                                setFormData({ ...formData, trigger_type: TriggerType.Slack });
                                            }}
                                        >
                                            <Slack className="w-8 h-8" />
                                            <span className="font-semibold">Slack</span>
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="lg"
                                            className="h-24 flex flex-col items-center justify-center gap-2 opacity-50 cursor-not-allowed"
                                            disabled
                                        >
                                            <Globe className="w-8 h-8" />
                                            <span className="font-semibold">Lark</span>
                                            <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="lg"
                                            className="h-24 flex flex-col items-center justify-center gap-2 opacity-50 cursor-not-allowed"
                                            disabled
                                        >
                                            <Globe className="w-8 h-8" />
                                            <span className="font-semibold">Telegram</span>
                                            <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-2">
                                            <Slack className="w-5 h-5" />
                                            <Label className="font-bold text-sm">{selectedApp.charAt(0).toUpperCase() + selectedApp.slice(1)} Configuration</Label>
                                        </div>
                                        {
                                            !selectedTrigger && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => setSelectedApp("")}
                                                >
                                                    {t("triggers.change-app")}
                                                </Button>
                                            )
                                        }
                                    </div>
                                    {
                                    !selectedTrigger || !formData.webhook_url ? (
                                        <div className="text-sm text-text-label bg-surface-secondary p-3 rounded-lg">
                                            {t("triggers.webhook-url-after-creation")}
                                        </div>) : (
                                        <div className={`flex flex-row items-center justify-start gap-4 p-4 bg-surface-primary rounded-xl ${needsAuth ? 'border border-yellow-500' : ''}`}>
                                            <div className="w-full font-mono text-sm text-text-body break-all flex items-center gap-2">
                                                {needsAuth && (
                                                    <TooltipSimple content={t("triggers.verification-required")}>
                                                        <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0" />
                                                    </TooltipSimple>
                                                )}
                                                {`${import.meta.env.VITE_PROXY_URL}/api${formData.webhook_url || createdWebhookUrl}`}
                                            </div>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={handleCopyWebhookUrl}
                                            >
                                                <Copy />
                                                {t("triggers.copy")}
                                            </Button>
                                        </div>)
                                    }
                                    {selectedApp === "slack" && (
                                        <DynamicTriggerConfig
                                            triggerType={TriggerType.Slack}
                                            value={triggerConfig}
                                            onChange={setTriggerConfig}
                                            disabled={isLoading}
                                            onValidationChange={(isValid, errors) => {
                                                setIsConfigValid(isValid);
                                                setConfigValidationErrors(errors);
                                            }}
                                        />
                                    )}
                                </div>
                            )}
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        );
    };

    const getDialogTitle = () => {
        return selectedTrigger
            ? t("triggers.edit-trigger-agent")
            : t("triggers.create-trigger-agent");
    };

    const renderFooter = () => {
        // Disable save button if schedule validation fails for schedule triggers
        const isSaveDisabled = isLoading || (formData.trigger_type === TriggerType.Schedule && !isScheduleValid);

        return (
            <DialogFooter>
                <div className="flex w-full justify-end gap-2">
                    {selectedTrigger && (
                        <Button variant="ghost" onClick={handleClose} disabled={isLoading}>
                            {t("triggers.cancel")}
                        </Button>
                    )}
                    <Button variant="primary" onClick={() => handleSubmit()} disabled={isSaveDisabled}>
                        {isLoading
                            ? (selectedTrigger ? t("triggers.updating") : t("triggers.creating"))
                            : (selectedTrigger ? t("triggers.update") : t("triggers.create"))
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
                    size="md"
                    showCloseButton={true}
                    onClose={handleClose}
                    aria-describedby={undefined}
                >
                    <DialogHeader
                        title={getDialogTitle()}
                    />
                    <DialogContentSection className="p-0 flex-1 overflow-auto min-h-0">
                        {renderCreateContent()}
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
                    aria-describedby={undefined}
                >
                    <DialogHeader
                        className="!bg-popup-surface !rounded-t-xl p-md border-b border-border-secondary"
                        title={t("triggers.webhook-created-title")}
                    />

                    {/* Trigger Details Section */}
                    <div className="flex flex-col items-center justify-center p-4 gap-2">
                        <div className="w-16 h-16 rounded-full bg-surface-success flex items-center justify-center shadow-sm">
                            <Zap className="w-8 h-8 text-text-success" />
                        </div>
                        <div className="flex flex-col gap-2 px-4 pt-2">
                            <div className="text-text-heading font-bold text-lg">
                                {formData.name}
                            </div>
                            {formData.description && (
                                <div className="text-text-label text-sm max-w-md line-clamp-2">
                                    {formData.description}
                                </div>
                            )}
                            <Badge variant="default">
                                {formData.webhook_method}
                            </Badge>
                        </div>
                    </div>

                    {/* Webhook URL Section */}
                    <div className="flex flex-col p-4">
                        <div className="flex items-center justify-start gap-2 mb-4">
                            <Label className="text-text-heading text-sm font-semibold">
                                {t("triggers.your-webhook-url")}
                            </Label>
                            <TooltipSimple content={t("triggers.webhook-instructions")}>
                                <CircleAlert
                                    className="w-4 h-4 text-icon-primary cursor-pointer"
                                    onClick={(e) => e.stopPropagation()}
                                />
                            </TooltipSimple>
                        </div>

                        <div className="flex flex-row items-center justify-start gap-4 p-4 bg-surface-primary rounded-xl">
                            <div className="w-full font-mono text-sm text-text-body break-all">
                                {`${import.meta.env.VITE_PROXY_URL}/api${createdWebhookUrl}`}
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleCopyWebhookUrl}
                            >
                                <Copy />
                                {t("triggers.copy")}
                            </Button>
                        </div>
                    </div>

                    {/* Info Tip Section */}
                    <div className="flex flex-col p-4">
                        <div className="flex flex-row items-start justify-start bg-surface-information rounded-xl p-4">
                            <Globe className="w-5 h-5 text-text-information" />
                            <div className="flex flex-col items-start justify-start gap-2 pl-4">
                                <div className="text-label-sm font-semibold text-text-information">
                                    {t("triggers.webhook-tip-title")}
                                </div>
                                <div className="text-label-sm text-text-information opacity-60 leading-relaxed">
                                    {t("triggers.webhook-tip-description")}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <DialogFooter>
                        <Button
                            variant="primary"
                            size="md"
                            onClick={() => setIsWebhookSuccessOpen(false)}
                        >
                            {t("triggers.got-it")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};

// Trigger button component
type TriggerDialogButtonProps = {
    selectedTrigger?: Trigger | null;
    onTriggerCreating: (triggerData: TriggerInput) => void;
    onTriggerCreated: (triggerData: TriggerInput) => void;
    buttonVariant?: "primary" | "secondary" | "outline" | "ghost";
    buttonSize?: "xxs" | "xs" | "sm" | "md" | "lg" | "icon";
    buttonText?: string;
    buttonIcon?: React.ReactNode;
    className?: string;
    initialTaskPrompt?: string;
};

export const TriggerDialogButton: React.FC<TriggerDialogButtonProps> = ({
    selectedTrigger = null,
    onTriggerCreating,
    onTriggerCreated,
    buttonVariant = "primary",
    buttonSize = "md",
    buttonText,
    buttonIcon,
    className,
    initialTaskPrompt = "",
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
                selectedTrigger={selectedTrigger}
                onTriggerCreating={onTriggerCreating}
                onTriggerCreated={onTriggerCreated}
                isOpen={isOpen}
                onOpenChange={setIsOpen}
                initialTaskPrompt={initialTaskPrompt}
            />
        </>
    );
};

export default TriggerDialog;
