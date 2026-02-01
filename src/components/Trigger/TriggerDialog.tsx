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

import { useState, useEffect, useCallback } from "react";
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
import { Card } from "@/components/ui/card";
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
    CableIcon,
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
import slackIcon from "@/assets/icon/slack.svg";
import larkIcon from "@/assets/icon/lark.png";
import telegramIcon from "@/assets/icon/telegram.svg";
import { proxyCreateTrigger, proxyUpdateTrigger } from "@/service/triggerApi";
import { useTriggerConfigQuery, useTriggerCacheInvalidation } from "@/hooks/queries/useTriggerQueries";
import DynamicTriggerConfig, { getDefaultTriggerConfig, filterExcludedFields, type ValidationError, type TriggerConfigSchema } from "./DynamicTriggerConfig";
import { useTriggerStore } from "@/store/triggerStore";
import { useActivityLogStore, ActivityType } from "@/store/activityLogStore";

type TriggerDialogProps = {
    selectedTrigger: Trigger | null;
    onTriggerCreating?: (triggerData: TriggerInput) => void;
    onTriggerCreated?: (triggerData: Trigger) => void;
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
    const { addTrigger, updateTrigger } = useTriggerStore();
    const { addLog } = useActivityLogStore();
    const [isLoading, setIsLoading] = useState(false);
    const [isWebhookSuccessOpen, setIsWebhookSuccessOpen] = useState(false);
    const [createdWebhookUrl, setCreatedWebhookUrl] = useState<string>("");
    const [nameError, setNameError] = useState<string>("");
    const [taskPromptError, setTaskPromptError] = useState<string>("");
    const [formData, setFormData] = useState<TriggerInput>({
        name: selectedTrigger?.name || "",
        description: selectedTrigger?.description || "",
        trigger_type: selectedTrigger?.trigger_type || TriggerType.Schedule,
        custom_cron_expression: selectedTrigger?.custom_cron_expression || "0 0 * * *",
        listener_type: selectedTrigger?.listener_type || ListenerType.Workforce,
        webhook_method: selectedTrigger?.webhook_method || RequestType.POST,
        agent_model: selectedTrigger?.agent_model || "",
        task_prompt: selectedTrigger?.task_prompt || initialTaskPrompt || "",
        max_executions_per_hour: selectedTrigger?.max_executions_per_hour,
        max_executions_per_day: selectedTrigger?.max_executions_per_day,
        webhook_url: selectedTrigger?.webhook_url,
    });
    const [triggerConfig, setTriggerConfig] = useState<Record<string, any>>(getDefaultTriggerConfig());
    const [triggerConfigSchema, setTriggerConfigSchema] = useState<TriggerConfigSchema | null>(null);
    const [selectedApp, setSelectedApp] = useState<string>("");
    const [isConfigValid, setIsConfigValid] = useState<boolean>(true);
    const [configValidationErrors, setConfigValidationErrors] = useState<ValidationError[]>([]);
    const [isScheduleValid, setIsScheduleValid] = useState<boolean>(true);
    const [showScheduleErrors, setShowScheduleErrors] = useState<boolean>(false);
    const [activeTab, setActiveTab] = useState<"schedule" | "app">("schedule");

    // Stable callback for validation changes to prevent infinite loops
    const handleValidationChange = useCallback((isValid: boolean, errors: ValidationError[]) => {
        setIsConfigValid(isValid);
        setConfigValidationErrors(errors);
    }, []);

    //Get projectStore for the active project's task
    const { projectStore } = useChatStoreAdapter();

    // Fetch trigger config using query hook - only fetch when we have a valid app selected
    const shouldFetchConfig = isOpen && (
        activeTab === "schedule" || selectedApp !== ""
    );
    const { data: configData } = useTriggerConfigQuery(
        selectedTrigger?.trigger_type || formData.trigger_type,
        shouldFetchConfig
    );

    // Reset form when dialog opens
    useEffect(() => {
        if (isOpen) {
            // Clear validation errors when dialog opens
            setNameError("");
            setTaskPromptError("");
            setShowScheduleErrors(false);

            // If editing an existing trigger, populate the form with its data
            if (selectedTrigger) {
                setFormData({
                    name: selectedTrigger.name || "",
                    description: selectedTrigger.description || "",
                    trigger_type: selectedTrigger.trigger_type || TriggerType.Schedule,
                    custom_cron_expression: selectedTrigger.custom_cron_expression || "0 0 * * *",
                    listener_type: selectedTrigger.listener_type || ListenerType.Workforce,
                    webhook_method: selectedTrigger.webhook_method || RequestType.POST,
                    agent_model: selectedTrigger.agent_model || "",
                    task_prompt: selectedTrigger.task_prompt || "",
                    max_executions_per_hour: selectedTrigger.max_executions_per_hour,
                    max_executions_per_day: selectedTrigger.max_executions_per_day,
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
                    setActiveTab("app");
                } else if (selectedTrigger.trigger_type === TriggerType.Webhook) {
                    setSelectedApp("webhook");
                    setActiveTab("app");
                } else {
                    setSelectedApp("");
                    setActiveTab("schedule");
                }
            } else {
                // Reset form for new trigger, use initialTaskPrompt if provided
                setFormData({
                    name: "",
                    description: "",
                    trigger_type: TriggerType.Schedule,
                    custom_cron_expression: "0 0 * * *",
                    listener_type: ListenerType.Workforce,
                    webhook_method: RequestType.POST,
                    agent_model: "",
                    task_prompt: initialTaskPrompt || "",
                    max_executions_per_hour: undefined,
                    max_executions_per_day: undefined,
                });
                setTriggerConfig(getDefaultTriggerConfig());
                setTriggerConfigSchema(null);
                setSelectedApp("");
                setActiveTab("schedule");
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

        // Check schedule validation
        if (formData.trigger_type === TriggerType.Schedule && !isScheduleValid) {
            setShowScheduleErrors(true);
            toast.error(t("triggers.schedule-required-fields"));
            return;
        }

        // Check dynamic config validation for triggers with config (Slack, Webhook, etc.)
        const hasDynamicConfig = triggerConfigSchema && Object.keys(triggerConfigSchema.properties || {}).length > 0;
        if (hasDynamicConfig && !isConfigValid) {
            const errorMessages = configValidationErrors.map((e) => e.message).join(", ");
            toast.error(t("triggers.dynamic.validation-failed", { errors: errorMessages }));
            return;
        }

        setIsLoading(true);
        onTriggerCreating?.(formData);

        try {
            //Make sure we have an active project
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
                };

                // Include config for triggers that have dynamic config (Slack, Webhook, etc.)
                if (Object.keys(triggerConfig).length > 0) {
                    // Filter out fields marked with exclude: true in schema
                    updateData.config = filterExcludedFields(triggerConfig, triggerConfigSchema);
                }

                response = await proxyUpdateTrigger(selectedTrigger.id, updateData);
                
                // Update trigger in store
                updateTrigger(selectedTrigger.id, response);
                
                // Add activity log
                addLog({
                    type: ActivityType.TriggerUpdated,
                    message: `Trigger "${response.name}" updated`,
                    projectId: projectStore.activeProjectId || undefined,
                    triggerId: response.id,
                    triggerName: response.name,
                });
                
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
                    project_id: projectStore.activeProjectId,
                };

                // Include config for triggers that have dynamic config (Slack, Webhook, etc.)
                if (Object.keys(triggerConfig).length > 0) {
                    // Filter out fields marked with exclude: true in schema
                    createData.config = filterExcludedFields(triggerConfig, triggerConfigSchema);
                }

                response = await proxyCreateTrigger(createData);
                
                // Add trigger to store
                addTrigger(response);
                
                // Add activity log
                addLog({
                    type: ActivityType.TriggerCreated,
                    message: `Trigger "${response.name}" created`,
                    projectId: projectStore.activeProjectId || undefined,
                    triggerId: response.id,
                    triggerName: response.name,
                });
                
                toast.success(t("triggers.created-successfully"));
            }

            // Call optional callback if provided
            onTriggerCreated?.(response);

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
            <div className="flex flex-col w-full pl-6 pr-4 py-6 gap-6">
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
                    maxLength={100}
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

                {/* Trigger Type */}
                <div className="space-y-3">
                    <Label className="font-bold text-sm">{t("triggers.trigger-type")}</Label>
                    <Tabs 
                        value={activeTab} 
                        onValueChange={(value) => {
                            const newTab = value as "schedule" | "app";
                            setActiveTab(newTab);
                            if (newTab === "schedule") {
                                setFormData({ ...formData, trigger_type: TriggerType.Schedule });
                                setSelectedApp("");
                            }
                            // Don't change trigger_type when switching to app tab
                            // The actual type will be set when user selects an app
                        }} 
                        className="w-full bg-surface-disabled rounded-2xl"
                    >
                        <TabsList variant="outline" className="w-full px-4 border-solid border-border-secondary border-b-[0.5px] border-x-0 border-t-0 rounded-t-2xl">
                            <TabsTrigger value="schedule" className="flex-1" disabled={!!selectedTrigger}><AlarmClockIcon className="w-4 h-4" />{t("triggers.schedule-trigger")}</TabsTrigger>
                            <TabsTrigger value="app" className="flex-1" disabled={!!selectedTrigger}><CableIcon className="w-4 h-4" />{t("triggers.app-trigger")}</TabsTrigger>
                        </TabsList>
                        <TabsContent value="schedule" className="py-4 px-6">
                            <SchedulePicker
                                value={formData.custom_cron_expression || "0 0 * * *"}
                                onChange={(cron) => setFormData({ ...formData, custom_cron_expression: cron })}
                                onValidationChange={setIsScheduleValid}
                                showErrors={showScheduleErrors}
                            />
                        </TabsContent>
                        <TabsContent value="app" className="py-4 px-6">
                            {!selectedApp ? (
                                <div className="space-y-4">
                                    <Label className="font-bold text-sm">{t("triggers.select-app")}</Label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <Card
                                            className="h-24 flex flex-col items-center justify-center gap-2 cursor-pointer border-border-tertiary bg-surface-primary hover:border-border-secondary transition-colors relative"
                                            onClick={() => {
                                                setSelectedApp("slack");
                                                setFormData({ ...formData, trigger_type: TriggerType.Slack });
                                            }}
                                        >
                                            <img src={slackIcon} alt="Slack" className="w-8 h-8" />
                                            <span className="font-semibold text-body-md text-text-heading">Slack</span>
                                        </Card>
                                        <Card
                                            className="h-24 flex flex-col items-center justify-center gap-2 cursor-pointer border-border-tertiary bg-surface-primary hover:border-border-secondary transition-colors relative"
                                            onClick={() => {
                                                setSelectedApp("webhook");
                                                setFormData({ ...formData, trigger_type: TriggerType.Webhook });
                                            }}
                                        >
                                            <WebhookIcon className="w-5 h-5" />
                                            <span className="font-semibold text-body-md text-text-heading">Webhook</span>
                                        </Card>
                                        <Card
                                            className="h-24 flex flex-col items-center justify-center gap-2 opacity-50 cursor-not-allowed border-border-tertiary bg-surface-primary hover:border-border-secondary transition-colors relative"
                                        >
                                            <Badge variant="secondary" className="text-xs absolute top-2 right-2">Coming Soon</Badge>
                                            <img src={larkIcon} alt="Lark" className="w-8 h-8" />
                                            <span className="font-semibold text-body-md text-text-heading">Lark</span>
                                        </Card>
                                        <Card
                                            className="h-24 flex flex-col items-center justify-center gap-2 opacity-50 cursor-not-allowed border-border-tertiary bg-surface-primary hover:border-border-secondary transition-colors relative"
                                        >
                                            <Badge variant="secondary" className="text-xs absolute top-2 right-2">Coming Soon</Badge>
                                            <img src={telegramIcon} alt="Telegram" className="w-8 h-8" />
                                            <span className="font-semibold text-body-md text-text-heading">Telegram</span>
                                        </Card>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-2">
                                            {selectedApp === "slack" && <Slack className="w-5 h-5" />}
                                            {selectedApp === "webhook" && <WebhookIcon className="w-5 h-5" />}
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
                                            onValidationChange={handleValidationChange}
                                        />
                                    )}
                                    {selectedApp === "webhook" && (
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
                                            <Accordion type="single" collapsible className="w-full">
                                                <AccordionItem value="extra-settings" className="border-none">
                                                    <AccordionTrigger className="py-2 hover:no-underline bg-transparent">
                                                        <span className="font-bold text-sm text-text-heading">{t("triggers.extra-settings")}</span>
                                                    </AccordionTrigger>
                                                    <AccordionContent>
                                                        <div className="flex flex-col gap-4 pt-2 bg-surface-tertiary rounded-xl p-4">
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
                                    )}
                                </div>
                            )}
                        </TabsContent>
                    </Tabs>
                </div>

                {/* Execution Settings - Accordion */}
                <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="execution-settings" className="border-none">
                        <AccordionTrigger className="py-2 hover:no-underline bg-transparent">
                            <span className="font-bold text-sm text-text-heading">{t("triggers.execution-settings")}</span>
                        </AccordionTrigger>
                        <AccordionContent>
                            <div className="flex flex-col gap-4 pt-2 bg-surface-disabled rounded-lg p-4">
                                <div className="flex items-center gap-2">
                                    <Input
                                        id="max_per_hour"
                                        title={t("triggers.max-per-hour")}
                                        placeholder={t("triggers.max-per-hour-placeholder")}
                                        type="number" value={formData.max_executions_per_hour || ""}
                                        onChange={(e) => setFormData({ ...formData, max_executions_per_hour: e.target.value ? parseInt(e.target.value) : undefined })}
                                        min={0}
                                    />
                                    <Input
                                        id="max_per_day"
                                        title={t("triggers.max-per-day")}
                                        placeholder={t("triggers.max-per-day-placeholder")}
                                        type="number" value={formData.max_executions_per_day || ""}
                                        onChange={(e) => setFormData({ ...formData, max_executions_per_day: e.target.value ? parseInt(e.target.value) : undefined })}
                                        min={0}
                                    />
                                </div>
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </div>
        );
    };

    const getDialogTitle = () => {
        return selectedTrigger
            ? t("triggers.edit-trigger-agent")
            : t("triggers.create-trigger-agent");
    };

    const renderFooter = () => {
        return (
            <DialogFooter>
                <div className="flex w-full justify-end gap-2">
                    {selectedTrigger && (
                        <Button variant="ghost" onClick={handleClose} disabled={isLoading}>
                            {t("triggers.cancel")}
                        </Button>
                    )}
                    <Button variant="primary" onClick={() => handleSubmit()} disabled={isLoading}>
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
                    <DialogContentSection className="p-0 flex-1 min-h-0 scrollbar-overlay">
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
                    {/* <div className="flex flex-col p-4">
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
                    </div> */}

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
    onTriggerCreating?: (triggerData: TriggerInput) => void;
    onTriggerCreated?: (triggerData: TriggerInput) => void;
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
