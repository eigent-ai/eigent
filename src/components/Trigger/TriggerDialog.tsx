import { useState, useEffect, useCallback } from "react";
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
} from "@/types";
import { SchedulePicker } from "./SchedulePicker";
import { TaskEditor } from "./TaskEditor";
import React from "react";
import {
    ReactFlow,
    Background,
    Node,
    Edge,
    Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

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
};

// Custom node component for minimal styling
const TriggerNode = ({ data }: { data: { label: string; active?: boolean } }) => (
    <div
        className={`px-4 py-3 rounded-xl border transition-all ${data.active
                ? "border-border-primary bg-surface-secondary"
                : "border-border-secondary bg-surface-tertiary"
            }`}
        style={{ minWidth: 120, textAlign: "center" }}
    >
        <span className="text-sm text-text-body">{data.label}</span>
    </div>
);

const nodeTypes = { triggerNode: TriggerNode };

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
}) => {
    const { t } = useTranslation();
    const [isLoading, setIsLoading] = useState(false);
    const [currentStep, setCurrentStep] = useState(1);
    const [selectedExecution, setSelectedExecution] = useState<TriggerExecution | null>(null);
    const [showLogs, setShowLogs] = useState(false);
    const [formData, setFormData] = useState<TriggerInput>({
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

    // Graph nodes and edges
    const nodes: Node[] = [
        {
            id: "trigger",
            type: "triggerNode",
            position: { x: 60, y: 40 },
            data: { label: "When", active: currentStep === 1 },
            draggable: false,
            sourcePosition: Position.Bottom,
        },
        {
            id: "action",
            type: "triggerNode",
            position: { x: 60, y: 160 },
            data: { label: "Do", active: currentStep === 2 },
            draggable: false,
            targetPosition: Position.Top,
        },
    ];

    const edges: Edge[] = [
        {
            id: "trigger-action",
            source: "trigger",
            target: "action",
            style: { stroke: "var(--border-secondary)", strokeWidth: 2 },
        },
    ];

    useEffect(() => {
        if (view === "create" && isOpen) {
            setCurrentStep(1);
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
        }
    }, [view, isOpen]);

    const handleClose = () => {
        onOpenChange(false);
        setShowLogs(false);
        setSelectedExecution(null);
        setCurrentStep(1);
    };

    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();

        if (!formData.name.trim()) {
            toast.error(t("triggers.name-required"));
            return;
        }

        setIsLoading(true);
        onTriggerCreating(formData);

        try {
            await new Promise(resolve => setTimeout(resolve, 500));
            toast.success(t("triggers.created-successfully"));
            onTriggerCreated(formData);
            handleClose();
        } catch (error) {
            console.error("Failed to create trigger:", error);
            toast.error(t("triggers.failed-to-create"));
        } finally {
            setIsLoading(false);
        }
    };

    const handleNext = () => {
        if (currentStep === 1) {
            if (!formData.name.trim()) {
                toast.error(t("triggers.name-required"));
                return;
            }
            setCurrentStep(2);
        }
    };

    const handleBack = () => {
        if (currentStep === 2) {
            setCurrentStep(1);
        }
    };

    const getStatusColor = (status: TriggerStatus) => {
        switch (status) {
            case TriggerStatus.Active: return "text-text-success bg-surface-success";
            case TriggerStatus.Inactive: return "text-text-label bg-surface-secondary";
            case TriggerStatus.Stale: return "text-text-warning bg-surface-warning";
            case TriggerStatus.Completed: return "text-text-body bg-surface-primary";
            default: return "text-text-label bg-surface-secondary";
        }
    };

    const getExecutionStatusIcon = (status: ExecutionStatus) => {
        switch (status) {
            case ExecutionStatus.Completed: return <CheckCircle2 className="w-4 h-4 text-text-success" />;
            case ExecutionStatus.Failed: return <XCircle className="w-4 h-4 text-text-cuation" />;
            case ExecutionStatus.Running: return <Loader2 className="w-4 h-4 text-text-information animate-spin" />;
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
            if (window.confirm(t("triggers.confirm-delete-trigger"))) {
                onDelete(selectedTrigger);
                handleClose();
            }
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
                                                {selectedTrigger.status === TriggerStatus.Stale && t("triggers.status.stale")}
                                                {selectedTrigger.status === TriggerStatus.Completed && t("triggers.status.completed")}
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

    // Step 1: Trigger settings
    const renderStep1 = () => (
        <div className="w-full space-y-5">
            <div className="space-y-2">
                <Label htmlFor="name" className="font-medium text-sm">{t("triggers.name")}</Label>
                <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder={t("triggers.name-placeholder")} />
            </div>
            <div className="space-y-2">
                <Label className="font-medium text-sm">{t("triggers.type")}</Label>
                <Tabs value={formData.trigger_type} onValueChange={(value) => setFormData({ ...formData, trigger_type: value as TriggerType })}>
                    <TabsList className="w-full">
                        <TabsTrigger value={TriggerType.Schedule} className="flex-1"><Clock className="w-4 h-4 mr-2" />{t("triggers.schedule")}</TabsTrigger>
                        <TabsTrigger value={TriggerType.Webhook} className="flex-1"><Globe className="w-4 h-4 mr-2" />{t("triggers.webhook")}</TabsTrigger>
                    </TabsList>
                    <TabsContent value={TriggerType.Schedule}>
                        <SchedulePicker value={formData.custom_cron_expression || "0 */1 * * *"} onChange={(cron) => setFormData({ ...formData, custom_cron_expression: cron })} />
                    </TabsContent>
                    <TabsContent value={TriggerType.Webhook}>
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="webhook_function">{t("triggers.webhook-function")}</Label>
                                <Select value={formData.listener_type || ""} onValueChange={(value: ListenerType) => setFormData({ ...formData, listener_type: value })}>
                                    <SelectTrigger><SelectValue placeholder={t("triggers.select-listener")} /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={ListenerType.ChatAgent}>{t("triggers.get")}</SelectItem>
                                        <SelectItem value={ListenerType.Workforce}>{t("triggers.post")}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="webhook_url">{t("triggers.webhook-url")}</Label>
                                <Input id="webhook_url" value={formData.webhook_url || ""} onChange={(e) => setFormData({ ...formData, webhook_url: e.target.value })} placeholder="https://example.com/webhook" type="url" />
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>
            </div>
            <div className="space-y-2">
                <Label className="font-medium text-sm">Execution Settings</Label>
                <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="max_per_hour" className="text-xs">{t("triggers.max-per-hour")}</Label>
                        <Input id="max_per_hour" type="number" value={formData.max_executions_per_hour || ""} onChange={(e) => setFormData({ ...formData, max_executions_per_hour: e.target.value ? parseInt(e.target.value) : undefined })} placeholder="10" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="max_per_day" className="text-xs">{t("triggers.max-per-day")}</Label>
                        <Input id="max_per_day" type="number" value={formData.max_executions_per_day || ""} onChange={(e) => setFormData({ ...formData, max_executions_per_day: e.target.value ? parseInt(e.target.value) : undefined })} placeholder="100" />
                    </div>
                    <div className="flex items-end space-x-2 pb-2">
                        <Switch id="single_execution" checked={formData.is_single_execution} onCheckedChange={(checked) => setFormData({ ...formData, is_single_execution: checked })} />
                        <Label htmlFor="single_execution" className="text-xs">{t("triggers.single-execution")}</Label>
                    </div>
                </div>
            </div>
        </div>
    );

    // Step 2: Task definition
    const renderStep2 = () => (
        <div className="w-full space-y-4">
            <TaskEditor value={formData.task_prompt || ""} onChange={(value) => setFormData({ ...formData, task_prompt: value })} />
        </div>
    );

    const renderCreateContent = () => (
        <div className="flex flex-row h-full min-h-[400px]">
            {/* Left: Graph */}
            <div className="w-[200px] border-r border-border-secondary flex-shrink-0">
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    fitView
                    panOnDrag={false}
                    zoomOnScroll={false}
                    zoomOnPinch={false}
                    zoomOnDoubleClick={false}
                    preventScrolling={false}
                    nodesDraggable={false}
                    nodesConnectable={false}
                    elementsSelectable={false}
                    proOptions={{ hideAttribution: true }}
                >
                    <Background color="transparent" />
                </ReactFlow>
            </div>
            {/* Right: Form */}
            <div className="flex-1 px-6 py-4 overflow-auto">
                {currentStep === 1 && renderStep1()}
                {currentStep === 2 && renderStep2()}
            </div>
        </div>
    );

    const getDialogTitle = () => {
        if (view === "create") return currentStep === 1 ? t("triggers.create-trigger-agent") : t("triggers.define-task");
        if (selectedTrigger) return selectedTrigger.name;
        return t("triggers.trigger-details");
    };

    const renderFooter = () => {
        if (view !== "create") return null;
        return (
            <DialogFooter>
                <div className="flex w-full justify-between">
                    <div>
                        {currentStep === 2 && (
                            <Button variant="ghost" onClick={handleBack}>Back</Button>
                        )}
                    </div>
                    <div>
                        {currentStep === 1 && (
                            <Button variant="primary" onClick={handleNext}>Next</Button>
                        )}
                        {currentStep === 2 && (
                            <Button variant="primary" onClick={() => handleSubmit()} disabled={isLoading}>
                                {isLoading ? t("common.creating") : t("common.create")}
                            </Button>
                        )}
                    </div>
                </div>
            </DialogFooter>
        );
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent
                size="lg"
                showCloseButton={true}
                onClose={handleClose}
                className={view === "create" ? "max-w-[900px]" : showLogs ? "max-w-[1100px]" : "max-w-[700px]"}
            >
                <DialogHeader title={getDialogTitle()}>
                    {view === "overview" && selectedTrigger && (
                        <div className="flex items-center gap-2">
                            <Button variant="ghost" size="sm" onClick={handleEditClick} className="gap-1"><Pencil className="w-4 h-4" />{t("triggers.edit")}</Button>
                            <Button variant="ghost" size="sm" onClick={handleDeleteClick}><Trash2 className="w-4 h-4" />{t("triggers.delete")}</Button>
                        </div>
                    )}
                </DialogHeader>
                <DialogContentSection className={view === "create" ? "" : "max-h-[60vh] overflow-auto"}>
                    {view === "overview" && !selectedTrigger && renderEmptyState()}
                    {view === "overview" && selectedTrigger && renderOverviewContent()}
                    {view === "create" && renderCreateContent()}
                </DialogContentSection>
                {renderFooter()}
            </DialogContent>
        </Dialog>
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
