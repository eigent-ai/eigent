import { useState, useEffect } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Clock,
    Globe,
    X,
    Plus,
    Zap,
    Copy,
    CircleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
    ListenerType,
    TriggerInput,
    TriggerType,
    Trigger,
    RequestType,
} from "@/types";
import { SchedulePicker } from "./SchedulePicker";
import { TriggerTaskInput } from "./TriggerTaskInput";
import { useTriggerStore } from "@/store/triggerStore";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";
import { proxyCreateTrigger, proxyUpdateTrigger, proxyDeleteTrigger } from "@/service/triggerApi";
import { TooltipSimple } from "../ui/tooltip";

type TriggerDialogProps = {
    selectedTrigger: Trigger | null;
    onTriggerCreating: (triggerData: TriggerInput) => void;
    onTriggerCreated: (triggerData: TriggerInput) => void;
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
        if (isOpen) {
            // Clear validation errors when dialog opens
            setNameError("");
            
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
    }, [isOpen, selectedTrigger, initialTaskPrompt]); // React to dialog state and trigger changes

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
            await navigator.clipboard.writeText(`${import.meta.env.VITE_PROXY_URL}/api${createdWebhookUrl}`);
            toast.success(t("triggers.webhook-url-copied"));
        } catch (err) {
            toast.error(t("triggers.failed-to-copy"));
        }
    };

    const renderCreateContent = () => {
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
                    onChange={(value) => setFormData({ ...formData, task_prompt: value })}
                />

                {/* Execution Settings - Accordion */}
                <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="execution-settings" className="border-none">
                        <AccordionTrigger className="py-2 hover:no-underline bg-transparent">
                            <span className="font-bold text-sm text-text-heading">Execution Settings</span>
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
                            <TabsTrigger value={TriggerType.Schedule} className="flex-1" disabled={!!selectedTrigger}><Clock className="w-4 h-4 mr-2" />{t("triggers.schedule")}</TabsTrigger>
                            <TabsTrigger value={TriggerType.Webhook} className="flex-1" disabled={!!selectedTrigger}><Globe className="w-4 h-4 mr-2" />{t("triggers.webhook")}</TabsTrigger>

                        </TabsList>
                        <TabsContent value={TriggerType.Schedule} className="min-h-[280px] bg-surface-disabled rounded-lg p-4">
                            <SchedulePicker value={formData.custom_cron_expression || "0 */1 * * *"} onChange={(cron) => setFormData({ ...formData, custom_cron_expression: cron })} />
                        </TabsContent>
                        <TabsContent value={TriggerType.Webhook} className="min-h-[280px] bg-surface-disabled rounded-lg p-4">
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
                                            <SelectItem value={RequestType.GET}>GET</SelectItem>
                                            <SelectItem value={RequestType.POST}>POST</SelectItem>
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
            </div>
        );
    };

    const getDialogTitle = () => {
        return selectedTrigger 
            ? t("triggers.edit-trigger-agent", { defaultValue: "Edit Trigger Agent" })
            : t("triggers.create-trigger-agent");
    };

    const renderFooter = () => {
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
                className="max-w-[550px] p-0 gap-0"
                aria-describedby={undefined}
            >
                <DialogHeader
                    className="!bg-popup-surface !rounded-t-xl p-md border-b border-border-secondary"
                    title={t("triggers.webhook-created-title")}
                />
                
                <div className="bg-popup-bg">
                    {/* Trigger Details Section */}
                    <div className="flex flex-col items-center justify-center py-6 px-md border-b border-border-secondary bg-surface-tertiary">
                        <div className="w-12 h-12 rounded-full bg-surface-success flex items-center justify-center mb-3 shadow-sm">
                            <Zap className="w-6 h-6 text-text-success" />
                        </div>
                        <h3 className="text-text-heading font-bold text-lg mb-1">
                            {formData.name}
                        </h3>
                        {formData.description && (
                            <p className="text-text-label text-sm text-center max-w-md line-clamp-2 px-4">
                                {formData.description}
                            </p>
                        )}
                        <Badge variant="outline" className="mt-3 bg-white/50">
                            {formData.webhook_method}
                        </Badge>
                    </div>
                    
                    {/* Webhook URL Section */}
                    <div className="px-md py-6 space-y-3">
                        <div className="flex items-center justify-start gap-2">
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
                        
                        <div className="relative groups">
                            <div className="w-full bg-surface-secondary rounded-xl p-4 pr-24 border border-border-secondary font-mono text-sm text-text-body break-all shadow-sm">
                                {`${import.meta.env.VITE_PROXY_URL}/api${createdWebhookUrl}`}
                            </div>
                            <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={handleCopyWebhookUrl}
                                className="absolute right-2 top-2 bg-white"
                            >
                                <Copy className="w-3 h-3 mr-1.5" />
                                {t("copy")}
                            </Button>
                        </div>
                    </div>

                    {/* Info Tip Section */}
                    <div className="px-md pb-md">
                        <div className="bg-surface-information/10 border border-surface-information/20 rounded-xl p-4">
                            <div className="flex items-start gap-3">
                                <div className="p-1.5 bg-surface-information/20 rounded-md shrink-0">
                                    <Globe className="w-4 h-4 text-text-information" />
                                </div>
                                <div className="space-y-1">
                                    <p className="text-sm font-semibold text-text-heading">
                                        {t("triggers.webhook-tip-title")}
                                    </p>
                                    <p className="text-sm text-text-label leading-relaxed">
                                        {t("triggers.webhook-tip-description")}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="p-md bg-surface-secondary border-t border-border-secondary">
                        <Button 
                            variant="primary" 
                            size="md"
                            onClick={() => setIsWebhookSuccessOpen(false)}
                            className="w-full font-semibold shadow-sm"
                        >
                            {t("common.got-it")}
                        </Button>
                    </div>
                </div>
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
