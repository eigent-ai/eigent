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

import larkIcon from '@/assets/icon/lark.png';
import slackIcon from '@/assets/icon/slack.svg';
import telegramIcon from '@/assets/icon/telegram.svg';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipSimple } from '@/components/ui/tooltip';
import {
  useTriggerCacheInvalidation,
  useTriggerConfigQuery,
} from '@/hooks/queries/useTriggerQueries';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { proxyCreateTrigger, proxyUpdateTrigger } from '@/service/triggerApi';
import { ActivityType, useActivityLogStore } from '@/store/activityLogStore';
import { useTriggerStore } from '@/store/triggerStore';
import {
  ListenerType,
  RequestType,
  Trigger,
  TriggerInput,
  TriggerStatus,
  TriggerType,
} from '@/types';
import {
  AlarmClockIcon,
  AlertTriangle,
  CableIcon,
  CircleAlert,
  Copy,
  Plus,
  Slack,
  WebhookIcon,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import DynamicTriggerConfig, {
  filterExcludedFields,
  getDefaultTriggerConfig,
  type TriggerConfigSchema,
  type ValidationError,
} from './DynamicTriggerConfig';
import { SchedulePicker, type ScheduleConfig } from './SchedulePicker';
import { TriggerTaskInput } from './TriggerTaskInput';

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
  initialTaskPrompt = '',
}) => {
  const { t } = useTranslation();
  const { addTrigger, updateTrigger } = useTriggerStore();
  const { addLog } = useActivityLogStore();
  const { invalidateUserTriggerCount } = useTriggerCacheInvalidation();
  const [isLoading, setIsLoading] = useState(false);
  const [isWebhookSuccessOpen, setIsWebhookSuccessOpen] = useState(false);
  const [createdWebhookUrl, setCreatedWebhookUrl] = useState<string>('');
  const [nameError, setNameError] = useState<string>('');
  const [taskPromptError, setTaskPromptError] = useState<string>('');
  const [formData, setFormData] = useState<TriggerInput>({
    name: selectedTrigger?.name || '',
    description: selectedTrigger?.description || '',
    trigger_type: selectedTrigger?.trigger_type || TriggerType.Schedule,
    custom_cron_expression:
      selectedTrigger?.custom_cron_expression || '0 0 * * *',
    listener_type: selectedTrigger?.listener_type || ListenerType.Workforce,
    webhook_method: selectedTrigger?.webhook_method || RequestType.POST,
    agent_model: selectedTrigger?.agent_model || '',
    task_prompt: selectedTrigger?.task_prompt || initialTaskPrompt || '',
    max_executions_per_hour: selectedTrigger?.max_executions_per_hour,
    max_executions_per_day: selectedTrigger?.max_executions_per_day,
    webhook_url: selectedTrigger?.webhook_url,
  });
  const [triggerConfig, setTriggerConfig] = useState<Record<string, any>>(
    getDefaultTriggerConfig()
  );
  const [triggerConfigSchema, setTriggerConfigSchema] =
    useState<TriggerConfigSchema | null>(null);
  const [selectedApp, setSelectedApp] = useState<string>('');
  const [isConfigValid, setIsConfigValid] = useState<boolean>(true);
  const [configValidationErrors, setConfigValidationErrors] = useState<
    ValidationError[]
  >([]);
  const [isScheduleValid, setIsScheduleValid] = useState<boolean>(true);
  const [showScheduleErrors, setShowScheduleErrors] = useState<boolean>(false);
  const [scheduleConfig, setScheduleConfig] = useState<ScheduleConfig>({});
  const [activeTab, setActiveTab] = useState<'schedule' | 'app'>('schedule');

  // Stable callback for validation changes to prevent infinite loops
  const handleValidationChange = useCallback(
    (isValid: boolean, errors: ValidationError[]) => {
      setIsConfigValid(isValid);
      setConfigValidationErrors(errors);
    },
    []
  );

  //Get projectStore for the active project's task
  const { projectStore } = useChatStoreAdapter();

  // Fetch trigger config using query hook - only fetch when we have a valid app selected
  const shouldFetchConfig =
    isOpen && (activeTab === 'schedule' || selectedApp !== '');
  const { data: configData } = useTriggerConfigQuery(
    selectedTrigger?.trigger_type || formData.trigger_type,
    shouldFetchConfig
  );

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      // Clear validation errors when dialog opens
      setNameError('');
      setTaskPromptError('');
      setShowScheduleErrors(false);

      // If editing an existing trigger, populate the form with its data
      if (selectedTrigger) {
        setFormData({
          name: selectedTrigger.name || '',
          description: selectedTrigger.description || '',
          trigger_type: selectedTrigger.trigger_type || TriggerType.Schedule,
          custom_cron_expression:
            selectedTrigger.custom_cron_expression || '0 0 * * *',
          listener_type:
            selectedTrigger.listener_type || ListenerType.Workforce,
          webhook_method: selectedTrigger.webhook_method || RequestType.POST,
          agent_model: selectedTrigger.agent_model || '',
          task_prompt: selectedTrigger.task_prompt || '',
          max_executions_per_hour: selectedTrigger.max_executions_per_hour,
          max_executions_per_day: selectedTrigger.max_executions_per_day,
          webhook_url: selectedTrigger.webhook_url,
        });
        // Load existing trigger config if available
        if (selectedTrigger.config) {
          setTriggerConfig(selectedTrigger.config as Record<string, any>);
          // For schedule triggers, also set scheduleConfig
          if (selectedTrigger.trigger_type === TriggerType.Schedule) {
            setScheduleConfig(selectedTrigger.config as ScheduleConfig);
          }
        } else {
          setTriggerConfig(getDefaultTriggerConfig());
          setScheduleConfig({});
        }
        // Set selectedApp based on trigger type for app-based triggers
        if (selectedTrigger.trigger_type === TriggerType.Slack) {
          setSelectedApp('slack');
          setActiveTab('app');
        } else if (selectedTrigger.trigger_type === TriggerType.Webhook) {
          setSelectedApp('webhook');
          setActiveTab('app');
        } else {
          setSelectedApp('');
          setActiveTab('schedule');
        }
      } else {
        // Reset form for new trigger, use initialTaskPrompt if provided
        setFormData({
          name: '',
          description: '',
          trigger_type: TriggerType.Schedule,
          custom_cron_expression: '0 0 * * *',
          listener_type: ListenerType.Workforce,
          webhook_method: RequestType.POST,
          agent_model: '',
          task_prompt: initialTaskPrompt || '',
          max_executions_per_hour: undefined,
          max_executions_per_day: undefined,
        });
        setTriggerConfig(getDefaultTriggerConfig());
        setScheduleConfig({});
        setTriggerConfigSchema(null);
        setSelectedApp('');
        setActiveTab('schedule');
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
      setNameError(t('triggers.name-required'));
      return;
    }

    // Clear name error if validation passes
    setNameError('');
    if (!formData.task_prompt?.trim()) {
      setTaskPromptError(t('triggers.task-prompt-required'));
      toast.error(t('triggers.task-prompt-required'));
      return;
    }

    // Clear task prompt error if validation passes
    setTaskPromptError('');

    // Check schedule validation
    if (formData.trigger_type === TriggerType.Schedule && !isScheduleValid) {
      setShowScheduleErrors(true);
      toast.error(t('triggers.schedule-required-fields'));
      return;
    }

    // Check dynamic config validation for triggers with config (Slack, Webhook, etc.)
    const hasDynamicConfig =
      triggerConfigSchema &&
      Object.keys(triggerConfigSchema.properties || {}).length > 0;
    if (hasDynamicConfig && !isConfigValid) {
      const errorMessages = configValidationErrors
        .map((e) => e.message)
        .join(', ');
      toast.error(
        t('triggers.dynamic.validation-failed', { errors: errorMessages })
      );
      return;
    }

    setIsLoading(true);
    onTriggerCreating?.(formData);

    try {
      //Make sure we have an active project
      if (!projectStore.activeProjectId) {
        toast.error(t('triggers.project-id-required'));
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

        // Include config based on trigger type
        if (formData.trigger_type === TriggerType.Schedule) {
          // For schedule triggers, use scheduleConfig (expirationDate, date for one-time)
          if (Object.keys(scheduleConfig).length > 0) {
            updateData.config = scheduleConfig;
          }
        } else if (Object.keys(triggerConfig).length > 0) {
          // For other triggers (Slack, Webhook), use dynamic config
          updateData.config = filterExcludedFields(
            triggerConfig,
            triggerConfigSchema
          );
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

        toast.success(t('triggers.updated-successfully'));
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

        // Include config based on trigger type
        if (formData.trigger_type === TriggerType.Schedule) {
          // For schedule triggers, use scheduleConfig (expirationDate, date for one-time)
          if (Object.keys(scheduleConfig).length > 0) {
            createData.config = scheduleConfig;
          }
        } else if (Object.keys(triggerConfig).length > 0) {
          // For other triggers (Slack, Webhook), use dynamic config
          createData.config = filterExcludedFields(
            triggerConfig,
            triggerConfigSchema
          );
        }

        response = await proxyCreateTrigger(createData);

        // Add trigger to store
        addTrigger(response);

        // Invalidate user trigger count cache
        invalidateUserTriggerCount();

        // Add activity log
        addLog({
          type: ActivityType.TriggerCreated,
          message: `Trigger "${response.name}" created`,
          projectId: projectStore.activeProjectId || undefined,
          triggerId: response.id,
          triggerName: response.name,
        });

        toast.success(t('triggers.created-successfully'));
      }

      // Call optional callback if provided
      onTriggerCreated?.(response);

      handleClose();

      // Display the webhook url in a success dialog (only for new webhooks)
      if (
        !selectedTrigger &&
        formData.trigger_type === TriggerType.Webhook &&
        response.webhook_url
      ) {
        setCreatedWebhookUrl(response.webhook_url);
        setIsWebhookSuccessOpen(true);
      }
    } catch (error) {
      console.error('Failed to create trigger:', error);
      toast.error(t('triggers.failed-to-create'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(
        `${import.meta.env.VITE_PROXY_URL}/api${formData.webhook_url || createdWebhookUrl}`
      );
      toast.success(t('triggers.webhook-url-copied'));
    } catch (err) {
      toast.error(t('triggers.failed-to-copy'));
    }
  };

  const renderCreateContent = () => {
    const needsAuth =
      selectedTrigger?.status === TriggerStatus.PendingAuth &&
      selectedTrigger?.config?.authentication_required;

    return (
      <div className="flex w-full flex-col gap-6 py-6 pl-6 pr-4">
        {/* Trigger Name */}
        <Input
          id="name"
          value={formData.name}
          required
          state={nameError ? 'error' : 'default'}
          note={nameError || undefined}
          onChange={(e) => {
            setFormData({ ...formData, name: e.target.value });
            // Clear error when user starts typing
            if (nameError) {
              setNameError('');
            }
          }}
          maxLength={100}
          title={t('triggers.name')}
          placeholder={t('triggers.name-placeholder')}
        />

        {/* Task Prompt - moved from step 2 */}
        <TriggerTaskInput
          value={formData.task_prompt || ''}
          onChange={(value) => {
            setFormData({ ...formData, task_prompt: value });
            // Clear error when user starts typing
            if (taskPromptError) {
              setTaskPromptError('');
            }
          }}
          state={taskPromptError ? 'error' : 'default'}
          note={taskPromptError || undefined}
        />

        {/* Trigger Type */}
        <div className="space-y-3">
          <Label className="text-sm font-bold">
            {t('triggers.trigger-type')}
          </Label>
          <Tabs
            value={activeTab}
            onValueChange={(value) => {
              const newTab = value as 'schedule' | 'app';
              setActiveTab(newTab);
              if (newTab === 'schedule') {
                setFormData({
                  ...formData,
                  trigger_type: TriggerType.Schedule,
                });
                setSelectedApp('');
                // Reset config when switching to schedule tab
                setTriggerConfig(getDefaultTriggerConfig());
                setTriggerConfigSchema(null);
              }
              // Don't change trigger_type when switching to app tab
              // The actual type will be set when user selects an app
            }}
            className="w-full rounded-2xl bg-surface-disabled"
          >
            <TabsList
              variant="outline"
              className="w-full rounded-t-2xl border-x-0 border-b-[0.5px] border-t-0 border-solid border-border-secondary px-4"
            >
              <TabsTrigger
                value="schedule"
                className="flex-1"
                disabled={!!selectedTrigger}
              >
                <AlarmClockIcon className="h-4 w-4" />
                {t('triggers.schedule-trigger')}
              </TabsTrigger>
              <TabsTrigger
                value="app"
                className="flex-1"
                disabled={!!selectedTrigger}
              >
                <CableIcon className="h-4 w-4" />
                {t('triggers.app-trigger')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="schedule" className="px-6 py-4">
              <SchedulePicker
                value={formData.custom_cron_expression || '0 0 * * *'}
                onChange={(cron) =>
                  setFormData({ ...formData, custom_cron_expression: cron })
                }
                onConfigChange={setScheduleConfig}
                onValidationChange={setIsScheduleValid}
                showErrors={showScheduleErrors}
                initialConfig={
                  selectedTrigger?.config as ScheduleConfig | undefined
                }
              />
            </TabsContent>
            <TabsContent value="app" className="px-6 py-4">
              {!selectedApp ? (
                <div className="space-y-4">
                  <Label className="text-sm font-bold">
                    {t('triggers.select-app')}
                  </Label>
                  <div className="grid grid-cols-2 gap-3">
                    <Card
                      className="relative flex h-24 cursor-pointer flex-col items-center justify-center gap-2 border-border-tertiary bg-surface-primary transition-colors hover:border-border-secondary"
                      onClick={() => {
                        setSelectedApp('slack');
                        setFormData({
                          ...formData,
                          trigger_type: TriggerType.Slack,
                        });
                        // Reset config when switching to Slack
                        setTriggerConfig(getDefaultTriggerConfig());
                        setTriggerConfigSchema(null);
                      }}
                    >
                      <img src={slackIcon} alt="Slack" className="h-8 w-8" />
                      <span className="text-body-md font-semibold text-text-heading">
                        Slack
                      </span>
                    </Card>
                    <Card
                      className="relative flex h-24 cursor-pointer flex-col items-center justify-center gap-2 border-border-tertiary bg-surface-primary transition-colors hover:border-border-secondary"
                      onClick={() => {
                        setSelectedApp('webhook');
                        setFormData({
                          ...formData,
                          trigger_type: TriggerType.Webhook,
                        });
                        // Reset config when switching to Webhook
                        setTriggerConfig(getDefaultTriggerConfig());
                        setTriggerConfigSchema(null);
                      }}
                    >
                      <WebhookIcon className="h-5 w-5" />
                      <span className="text-body-md font-semibold text-text-heading">
                        Webhook
                      </span>
                    </Card>
                    <Card className="relative flex h-24 cursor-not-allowed flex-col items-center justify-center gap-2 border-border-tertiary bg-surface-primary opacity-50 transition-colors hover:border-border-secondary">
                      <Badge
                        variant="secondary"
                        className="absolute right-2 top-2 text-xs"
                      >
                        Coming Soon
                      </Badge>
                      <img src={larkIcon} alt="Lark" className="h-8 w-8" />
                      <span className="text-body-md font-semibold text-text-heading">
                        Lark
                      </span>
                    </Card>
                    <Card className="relative flex h-24 cursor-not-allowed flex-col items-center justify-center gap-2 border-border-tertiary bg-surface-primary opacity-50 transition-colors hover:border-border-secondary">
                      <Badge
                        variant="secondary"
                        className="absolute right-2 top-2 text-xs"
                      >
                        Coming Soon
                      </Badge>
                      <img
                        src={telegramIcon}
                        alt="Telegram"
                        className="h-8 w-8"
                      />
                      <span className="text-body-md font-semibold text-text-heading">
                        Telegram
                      </span>
                    </Card>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {selectedApp === 'slack' && <Slack className="h-5 w-5" />}
                      {selectedApp === 'webhook' && (
                        <WebhookIcon className="h-5 w-5" />
                      )}
                      <Label className="text-sm font-bold">
                        {selectedApp.charAt(0).toUpperCase() +
                          selectedApp.slice(1)}{' '}
                        Configuration
                      </Label>
                    </div>
                    {!selectedTrigger && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedApp('');
                          // Reset config when going back to app selection
                          setTriggerConfig(getDefaultTriggerConfig());
                          setTriggerConfigSchema(null);
                        }}
                      >
                        {t('triggers.change-app')}
                      </Button>
                    )}
                  </div>
                  {!selectedTrigger || !formData.webhook_url ? (
                    <div className="rounded-lg bg-surface-secondary p-3 text-sm text-text-label">
                      {t('triggers.webhook-url-after-creation')}
                    </div>
                  ) : (
                    <div
                      className={`flex flex-row items-center justify-start gap-4 rounded-xl bg-surface-primary p-4 ${needsAuth ? 'border border-yellow-500' : ''}`}
                    >
                      <div className="flex w-full items-center gap-2 break-all font-mono text-sm text-text-body">
                        {needsAuth && (
                          <TooltipSimple
                            content={t('triggers.verification-required')}
                          >
                            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-yellow-600" />
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
                        {t('triggers.copy')}
                      </Button>
                    </div>
                  )}
                  {selectedApp === 'slack' && (
                    <DynamicTriggerConfig
                      triggerType={TriggerType.Slack}
                      value={triggerConfig}
                      onChange={setTriggerConfig}
                      disabled={isLoading}
                      onValidationChange={handleValidationChange}
                    />
                  )}
                  {selectedApp === 'webhook' && (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label className="text-sm font-bold">
                          {t('triggers.webhook-method')}
                        </Label>
                        <Select
                          value={formData.webhook_method || RequestType.POST}
                          onValueChange={(value: RequestType) =>
                            setFormData({ ...formData, webhook_method: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t('triggers.select-method')}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={RequestType.GET}>GET</SelectItem>
                            <SelectItem value={RequestType.POST}>
                              POST
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Accordion type="single" collapsible className="w-full">
                        <AccordionItem
                          value="extra-settings"
                          className="border-none"
                        >
                          <AccordionTrigger className="bg-transparent py-2 hover:no-underline">
                            <span className="text-sm font-bold text-text-heading">
                              {t('triggers.extra-settings')}
                            </span>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="flex flex-col gap-4 rounded-xl bg-surface-tertiary p-4 pt-2">
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
            <AccordionTrigger className="bg-transparent py-2 hover:no-underline">
              <span className="text-sm font-bold text-text-heading">
                {t('triggers.execution-settings')}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="flex flex-col gap-4 rounded-lg bg-surface-disabled p-4 pt-2">
                <div className="flex items-center gap-2">
                  <Input
                    id="max_per_hour"
                    title={t('triggers.max-per-hour')}
                    placeholder={t('triggers.max-per-hour-placeholder')}
                    type="number"
                    value={formData.max_executions_per_hour || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        max_executions_per_hour: e.target.value
                          ? parseInt(e.target.value)
                          : undefined,
                      })
                    }
                    min={0}
                  />
                  <Input
                    id="max_per_day"
                    title={t('triggers.max-per-day')}
                    placeholder={t('triggers.max-per-day-placeholder')}
                    type="number"
                    value={formData.max_executions_per_day || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        max_executions_per_day: e.target.value
                          ? parseInt(e.target.value)
                          : undefined,
                      })
                    }
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
      ? t('triggers.edit-trigger-agent')
      : t('triggers.create-trigger-agent');
  };

  const renderFooter = () => {
    return (
      <DialogFooter>
        <div className="flex w-full justify-end gap-2">
          {selectedTrigger && (
            <Button variant="ghost" onClick={handleClose} disabled={isLoading}>
              {t('triggers.cancel')}
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => handleSubmit()}
            disabled={isLoading}
          >
            {isLoading
              ? selectedTrigger
                ? t('triggers.updating')
                : t('triggers.creating')
              : selectedTrigger
                ? t('triggers.update')
                : t('triggers.create')}
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
          <DialogHeader title={getDialogTitle()} />
          <DialogContentSection className="scrollbar-overlay min-h-0 flex-1 p-0">
            {renderCreateContent()}
          </DialogContentSection>
          {renderFooter()}
        </DialogContent>
      </Dialog>

      {/* Webhook Success Dialog */}
      <Dialog
        open={isWebhookSuccessOpen}
        onOpenChange={setIsWebhookSuccessOpen}
      >
        <DialogContent
          size="md"
          showCloseButton={true}
          onClose={() => setIsWebhookSuccessOpen(false)}
          aria-describedby={undefined}
        >
          <DialogHeader
            className="!rounded-t-xl border-b border-border-secondary !bg-popup-surface p-md"
            title={t('triggers.webhook-created-title')}
          />

          {/* Trigger Details Section */}
          <div className="flex flex-col items-center justify-center gap-2 p-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-success shadow-sm">
              <Zap className="h-8 w-8 text-text-success" />
            </div>
            <div className="flex flex-col gap-2 px-4 pt-2">
              <div className="text-lg font-bold text-text-heading">
                {formData.name}
              </div>
              {formData.description && (
                <div className="line-clamp-2 max-w-md text-sm text-text-label">
                  {formData.description}
                </div>
              )}
              <Badge variant="default">{formData.webhook_method}</Badge>
            </div>
          </div>

          {/* Webhook URL Section */}
          <div className="flex flex-col p-4">
            <div className="mb-4 flex items-center justify-start gap-2">
              <Label className="text-sm font-semibold text-text-heading">
                {t('triggers.your-webhook-url')}
              </Label>
              <TooltipSimple content={t('triggers.webhook-instructions')}>
                <CircleAlert
                  className="h-4 w-4 cursor-pointer text-icon-primary"
                  onClick={(e) => e.stopPropagation()}
                />
              </TooltipSimple>
            </div>

            <div className="flex flex-row items-center justify-start gap-4 rounded-xl bg-surface-primary p-4">
              <div className="w-full break-all font-mono text-sm text-text-body">
                {`${import.meta.env.VITE_PROXY_URL}/api${createdWebhookUrl}`}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyWebhookUrl}
              >
                <Copy />
                {t('triggers.copy')}
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
              {t('triggers.got-it')}
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
  buttonVariant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  buttonSize?: 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'icon';
  buttonText?: string;
  buttonIcon?: React.ReactNode;
  className?: string;
  initialTaskPrompt?: string;
  disabled?: boolean;
  disabledTooltip?: string;
};

export const TriggerDialogButton: React.FC<TriggerDialogButtonProps> = ({
  selectedTrigger = null,
  onTriggerCreating,
  onTriggerCreated,
  buttonVariant = 'primary',
  buttonSize = 'md',
  buttonText,
  buttonIcon,
  className,
  initialTaskPrompt = '',
  disabled = false,
  disabledTooltip,
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const buttonElement = (
    <Button
      variant={buttonVariant}
      size={buttonSize}
      onClick={() => !disabled && setIsOpen(true)}
      className={className}
      disabled={disabled}
    >
      {buttonIcon || <Plus className="mr-2 h-4 w-4" />}
      {buttonText || t('triggers.add-trigger')}
    </Button>
  );

  return (
    <>
      {disabled && disabledTooltip ? (
        <TooltipSimple content={disabledTooltip}>{buttonElement}</TooltipSimple>
      ) : (
        buttonElement
      )}
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
