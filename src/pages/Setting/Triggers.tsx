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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { 
  Plus, 
  Play, 
  Pause, 
  Trash2, 
  Edit, 
  Clock, 
  Globe, 
  MessageSquare,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Activity,
  Copy
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { 
  Trigger, 
  TriggerInput, 
  TriggerUpdate, 
  TriggerType, 
  TriggerStatus, 
  ListenerType,
  TriggerExecution
} from "@/types";
import { 
  proxyFetchTriggers, 
  proxyCreateTrigger, 
  proxyUpdateTrigger, 
  proxyDeleteTrigger,
  proxyActivateTrigger,
  proxyDeactivateTrigger,
  proxyFetchTriggerExecutions
} from "@/service/triggerApi";

type CreateTriggerDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onTriggerCreated: () => void;
};

function CreateTriggerDialog({ isOpen, onClose, onTriggerCreated }: CreateTriggerDialogProps) {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
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
      onClose();
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
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("triggers.create-new")}</DialogTitle>
          <DialogDescription>
            {t("triggers.create-description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
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

          <div className="space-y-2">
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
            <div className="space-y-2">
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

          <div className="grid grid-cols-2 gap-4">
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

          <div className="space-y-2">
            <Label htmlFor="task_prompt">{t("triggers.task-prompt")}</Label>
            <Textarea
              id="task_prompt"
              value={formData.task_prompt || ""}
              onChange={(e) => setFormData({ ...formData, task_prompt: e.target.value })}
              placeholder={t("triggers.task-prompt-placeholder")}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
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
            <div className="space-y-2">
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

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? t("common.creating") : t("common.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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

export default function SettingTriggers() {
  const { t } = useTranslation();
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
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
    <div className="space-y-6">
      <div className="px-6 py-4 bg-surface-secondary rounded-2xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold">{t("triggers.title")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("triggers.description")}
            </p>
          </div>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            {t("triggers.create-new")}
          </Button>
        </div>

        {triggers.length === 0 ? (
          <div className="text-center py-8">
            <Activity className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">{t("triggers.no-triggers")}</p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => setCreateDialogOpen(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              {t("triggers.create-first")}
            </Button>
          </div>
        ) : (
          <div className="grid gap-4">
            {triggers.map((trigger) => (
              <Card key={trigger.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold">{trigger.name}</h3>
                      <TriggerStatusBadge status={trigger.status} />
                      <TriggerTypeBadge type={trigger.trigger_type} />
                    </div>
                    
                    {trigger.description && (
                      <p className="text-sm text-gray-600 mb-2">{trigger.description}</p>
                    )}
                    
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>{t("triggers.executions")}: {trigger.execution_count}</span>
                      <span>{t("triggers.errors")}: {trigger.error_count}</span>
                      {trigger.last_executed_at && (
                        <span>
                          {t("triggers.last-run")}: {new Date(trigger.last_executed_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>

                    {trigger.trigger_type === TriggerType.Webhook && trigger.webhook_url && (
                      <div className="mt-2">
                        <div className="flex items-center gap-2">
                          <code className="px-2 py-1 bg-gray-100 rounded text-xs font-mono">
                            {trigger.webhook_url}
                          </code>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => copyWebhookUrl(trigger)}
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                        </div>
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
                  
                  <div className="flex items-center gap-2">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        setSelectedTrigger(trigger);
                        loadExecutions(trigger.id);
                      }}
                    >
                      <Activity className="w-3 h-3 mr-1" />
                      {t("triggers.view-runs")}
                    </Button>
                    
                    <Button
                      size="xs"
                      variant={trigger.status === TriggerStatus.Active ? "outline" : "primary"}
                      onClick={() => handleActivateToggle(trigger)}
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
                      size="xs"
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

      <CreateTriggerDialog
        isOpen={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onTriggerCreated={loadTriggers}
      />

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