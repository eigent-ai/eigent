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

import { mcpList as fetchMcpConfig } from '@/api/brain';
import { fetchPost, proxyFetchGet } from '@/api/http';
import githubIcon from '@/assets/github.svg';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { INIT_PROVODERS } from '@/lib/llm';
import {
  getLocalPlatformName,
  LOCAL_MODEL_OPTIONS,
} from '@/pages/Agents/localModels';
import { useAuthStore, useWorkerList } from '@/store/authStore';
import { Bot, Edit, Eye, EyeOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ToolSelect from './ToolSelect';

interface EnvValue {
  value: string;
  required: boolean;
  tip: string;
  error?: string;
}

interface McpItem {
  id: number;
  name: string;
  key: string;
  description: string;
  category?: { name: string };
  home_page?: string;
  install_command?: {
    env?: { [key: string]: string };
  };
  toolkit?: string;
  isLocal?: boolean;
  mcp_name?: string;
}

type WorkerModelMode = 'eigent' | 'custom' | 'local';

interface WorkerModelOption {
  value: string;
  label: string;
  model_platform: string;
  model_type: string;
}

const EIGENT_MODEL_OPTIONS: ReadonlyArray<WorkerModelOption> = [
  {
    value: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro Preview',
    model_platform: 'gemini',
    model_type: 'gemini-3.1-pro-preview',
  },
  {
    value: 'gemini-3-pro-preview',
    label: 'Gemini 3 Pro Preview',
    model_platform: 'gemini',
    model_type: 'gemini-3-pro-preview',
  },
  {
    value: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash Preview',
    model_platform: 'gemini',
    model_type: 'gemini-3-flash-preview',
  },
  {
    value: 'gpt-4.1-mini',
    label: 'GPT-4.1 Mini',
    model_platform: 'openai',
    model_type: 'gpt-4.1-mini',
  },
  {
    value: 'gpt-4.1',
    label: 'GPT-4.1',
    model_platform: 'openai',
    model_type: 'gpt-4.1',
  },
  {
    value: 'gpt-5',
    label: 'GPT-5',
    model_platform: 'openai',
    model_type: 'gpt-5',
  },
  {
    value: 'gpt-5.1',
    label: 'GPT-5.1',
    model_platform: 'openai',
    model_type: 'gpt-5.1',
  },
  {
    value: 'gpt-5.2',
    label: 'GPT-5.2',
    model_platform: 'openai',
    model_type: 'gpt-5.2',
  },
  {
    value: 'gpt-5.4',
    label: 'GPT-5.4',
    model_platform: 'openai',
    model_type: 'gpt-5.4',
  },
  {
    value: 'gpt-5-mini',
    label: 'GPT-5 Mini',
    model_platform: 'openai',
    model_type: 'gpt-5-mini',
  },
  {
    value: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    model_platform: 'aws-bedrock-converse',
    model_type: 'claude-haiku-4-5',
  },
  {
    value: 'claude-sonnet-4-5',
    label: 'Claude Sonnet 4.5',
    model_platform: 'aws-bedrock-converse',
    model_type: 'claude-sonnet-4-5',
  },
  {
    value: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    model_platform: 'aws-bedrock-converse',
    model_type: 'claude-sonnet-4-6',
  },
  {
    value: 'claude-opus-4-6',
    label: 'Claude Opus 4.6',
    model_platform: 'aws-bedrock-converse',
    model_type: 'claude-opus-4-6',
  },
  {
    value: 'minimax_m2_5',
    label: 'Minimax M2.5',
    model_platform: 'openai-compatible-model',
    model_type: 'minimax_m2_5',
  },
];

export function AddWorker({
  edit = false,
  workerInfo = null,
  variant: _variant = 'default',
  isOpen,
  onOpenChange,
}: {
  edit?: boolean;
  workerInfo?: Agent | null;
  variant?: 'default' | 'icon';
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);

  // Use controlled state if provided, otherwise internal state
  const isControlled =
    typeof isOpen !== 'undefined' && typeof onOpenChange !== 'undefined';
  const dialogOpen = isControlled ? isOpen : internalOpen;
  const setDialogOpen = isControlled ? onOpenChange : setInternalOpen;
  const { chatStore, projectStore } = useChatStoreAdapter();
  const [showEnvConfig, setShowEnvConfig] = useState(false);
  const [activeMcp, setActiveMcp] = useState<McpItem | null>(null);
  const [envValues, setEnvValues] = useState<{ [key: string]: EnvValue }>({});
  const [isValidating, setIsValidating] = useState(false);
  const [secretVisible, setSecretVisible] = useState<{
    [key: string]: boolean;
  }>({});
  const toolSelectRef = useRef<{
    installMcp: (id: number, env?: any, activeMcp?: any) => Promise<void>;
  } | null>(null);
  const { email, setWorkerList } = useAuthStore();
  const workerList = useWorkerList();
  // save AddWorker form data
  const [workerName, setWorkerName] = useState('');
  const [workerDescription, setWorkerDescription] = useState('');
  const [selectedTools, setSelectedTools] = useState<McpItem[]>([]);

  // error status management
  const [nameError, setNameError] = useState<string>('');

  // Model configuration state
  const [showModelConfig, setShowModelConfig] = useState(false);
  const [workerModelMode, setWorkerModelMode] =
    useState<WorkerModelMode>('eigent');
  const [workerModelName, setWorkerModelName] = useState('');
  const [customModelOptions, setCustomModelOptions] = useState<
    WorkerModelOption[]
  >([]);
  const [localModelOptions, setLocalModelOptions] = useState<
    WorkerModelOption[]
  >([]);

  const activeProjectId = projectStore?.activeProjectId;
  const activeTaskId = chatStore?.activeTaskId ?? null;
  const tasks = chatStore?.tasks ?? {};

  // environment variable management
  const initializeEnvValues = (mcp: McpItem) => {
    console.log(mcp);
    if (mcp?.install_command?.env) {
      const initialValues: { [key: string]: EnvValue } = {};
      const initialVisibility: { [key: string]: boolean } = {};
      for (const key of Object.keys(mcp.install_command.env)) {
        initialValues[key] = {
          value: '',
          required: true,
          tip:
            mcp.install_command?.env?.[key]
              ?.replace(/{{/g, '')
              ?.replace(/}}/g, '') || '',
        };
        // GOOGLE_REFRESH_TOKEN is obtained via OAuth and does not require manual input
        if (key === 'GOOGLE_REFRESH_TOKEN') {
          initialValues[key].required = false;
        }
        initialVisibility[key] = false;
      }
      setEnvValues(initialValues);
      setSecretVisible(initialVisibility);
    }
  };

  const updateEnvValue = (key: string, value: string) => {
    setEnvValues((prev) => ({
      ...prev,
      [key]: {
        value,
        required: prev[key]?.required || true,
        tip: prev[key]?.tip || '',
        error: '', // Clear error when user types
      },
    }));
  };

  const validateRequiredFields = () => {
    let hasErrors = false;
    const updatedEnvValues = { ...envValues };

    Object.keys(envValues).forEach((key) => {
      const field = envValues[key];
      if (field?.required && (!field.value || field.value.trim() === '')) {
        updatedEnvValues[key] = {
          ...field,
          error: `${key} is required`,
        };
        hasErrors = true;
      }
    });

    if (hasErrors) {
      setEnvValues(updatedEnvValues);
    }

    return !hasErrors;
  };

  const handleConfigureMcpEnvSetting = async () => {
    if (!activeMcp) return;
    if (isValidating) return;

    // Validate required fields first
    if (!validateRequiredFields()) {
      return;
    }

    setIsValidating(true);

    // For Google Calendar, keep dialog open during authorization
    // For other tools, close dialog immediately
    if (activeMcp.key !== 'Google Calendar') {
      // switch back to tool selection interface, ensure ToolSelect component is visible
      setShowEnvConfig(false);

      // wait for component re-rendering
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // call ToolSelect's install method
    if (toolSelectRef.current) {
      try {
        if (
          activeMcp.key === 'EXA Search' ||
          activeMcp.key === 'Google Calendar' ||
          activeMcp.key === 'Lark'
        ) {
          await toolSelectRef.current.installMcp(
            activeMcp.id,
            { ...envValues },
            activeMcp
          );
        } else {
          await toolSelectRef.current.installMcp(activeMcp.id, {
            ...envValues,
          });
        }
      } finally {
        setIsValidating(false);
      }
    }

    // For Google Calendar, close dialog after installMcp completes
    if (activeMcp.key === 'Google Calendar') {
      setShowEnvConfig(false);
    }

    // clean status
    setActiveMcp(null);
    setEnvValues({});
    setSecretVisible({});
  };

  const handleCloseMcpEnvSetting = () => {
    setShowEnvConfig(false);
    setActiveMcp(null);
    setEnvValues({});
    setSecretVisible({});
  };

  const handleShowEnvConfig = (mcp: McpItem) => {
    setActiveMcp(mcp);
    initializeEnvValues(mcp);
    setShowEnvConfig(true);
  };

  const isSensitiveKey = (key: string) =>
    /token|key|secret|password|id/i.test(key);
  const toggleSecretVisibility = (key: string) => {
    setSecretVisible((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSelectedToolsChange = (tools: McpItem[]) => {
    setSelectedTools(tools);
  };

  const resetForm = () => {
    setWorkerName('');
    setWorkerDescription('');
    setSelectedTools([]);
    setShowEnvConfig(false);
    setActiveMcp(null);
    setEnvValues({});
    setSecretVisible({});
    setNameError('');
    setShowModelConfig(false);
    setWorkerModelMode('eigent');
    setWorkerModelName('');
    setCustomModelOptions([]);
    setLocalModelOptions([]);
  };

  const workerModelOptions = useMemo<
    Record<WorkerModelMode, WorkerModelOption[]>
  >(
    () => ({
      eigent: [...EIGENT_MODEL_OPTIONS],
      custom: customModelOptions,
      local: localModelOptions,
    }),
    [customModelOptions, localModelOptions]
  );

  const activeWorkerModelOptions = workerModelOptions[workerModelMode];

  useEffect(() => {
    if (!showModelConfig) return;
    const options = activeWorkerModelOptions;
    if (options.length === 0) {
      setWorkerModelName('');
      return;
    }
    if (!options.some((opt) => opt.value === workerModelName)) {
      setWorkerModelName(options[0].value);
    }
  }, [activeWorkerModelOptions, showModelConfig, workerModelName]);

  useEffect(() => {
    if (!showModelConfig) return;
    (async () => {
      try {
        const res = await proxyFetchGet('/api/v1/providers');
        const providerList = Array.isArray(res) ? res : res?.items || [];

        const customProviderIds = new Set(
          INIT_PROVODERS.filter((p) => p.id !== 'local').map((p) => p.id)
        );
        const localProviderIds = new Set(LOCAL_MODEL_OPTIONS.map((m) => m.id));

        const nextCustomOptions: WorkerModelOption[] = providerList
          .filter((provider: any) =>
            customProviderIds.has(provider.provider_name)
          )
          .map((provider: any) => {
            const modelType = String(provider.model_type || '');
            const providerName = String(provider.provider_name || '');
            return {
              value: `${providerName}::${modelType}`,
              label: modelType
                ? `${providerName} (${modelType})`
                : providerName,
              model_platform: providerName,
              model_type: modelType,
            };
          });

        const nextLocalOptions: WorkerModelOption[] = providerList
          .filter((provider: any) =>
            localProviderIds.has(provider.provider_name)
          )
          .map((provider: any) => {
            const config = provider.encrypted_config || {};
            const modelPlatform = String(
              config.model_platform || provider.provider_name || ''
            );
            const modelType = String(
              config.model_type || provider.model_type || ''
            );
            const platformName = getLocalPlatformName(modelPlatform);
            return {
              value: `${modelPlatform}::${modelType}`,
              label: modelType
                ? `${platformName} (${modelType})`
                : platformName,
              model_platform: modelPlatform,
              model_type: modelType,
            };
          });

        setCustomModelOptions(nextCustomOptions);
        setLocalModelOptions(nextLocalOptions);
      } catch (error) {
        console.error('Error fetching model providers for Add Worker:', error);
        setCustomModelOptions([]);
        setLocalModelOptions([]);
      }
    })();
  }, [showModelConfig]);

  // tool function
  const getCategoryIcon = (categoryName?: string) => {
    if (!categoryName)
      return <Bot className="h-10 w-10 text-ds-icon-neutral-default-default" />;
    return <Bot className="h-10 w-10 text-ds-icon-neutral-default-default" />;
  };

  const getGithubRepoName = (homePage?: string) => {
    if (!homePage || !homePage.startsWith('https://github.com/')) return null;
    const parts = homePage.split('/');
    return parts.length > 4 ? parts[4] : homePage;
  };

  // create Worker node
  const handleAddWorker = async () => {
    // clear previous errors
    setNameError('');

    if (!workerName) {
      setNameError(t('workforce.worker-name-cannot-be-empty'));
      return;
    }

    if (!edit && workerList.find((worker: any) => worker.name === workerName)) {
      setNameError(t('workforce.worker-name-already-exists'));
      return;
    }
    let mcpLocal: any = { mcpServers: {} };
    try {
      mcpLocal = await fetchMcpConfig();
    } catch {
      // Backend may not be ready
    }
    const localTool: string[] = [];
    const mcpList: string[] = [];
    selectedTools.forEach((tool: any) => {
      if (tool.isLocal) {
        localTool.push(tool.toolkit as string);
      } else {
        mcpList.push(tool?.key || tool?.mcp_name);
      }
    });
    console.log('mcpLocal.mcpServers', mcpLocal.mcpServers);
    if (mcpLocal.mcpServers && typeof mcpLocal.mcpServers === 'object') {
      for (const key of Object.keys(mcpLocal.mcpServers)) {
        if (!mcpList.includes(key)) {
          delete mcpLocal.mcpServers[key];
        }
      }
    }
    if (edit) {
      const newWorkerList = workerList.map((worker) => {
        if (worker.type === workerInfo?.type) {
          const newWorker: Agent = {
            tasks: [],
            agent_id: workerName,
            name: workerName,
            type: workerName as AgentNameType,
            log: [],
            tools: [
              ...selectedTools.map(
                (tool) =>
                  tool.name || tool.mcp_name || tool.key || `tool_${tool.id}`
              ),
            ],
            activeWebviewIds: [],
            workerInfo: {
              name: workerName,
              description: workerDescription,
              tools: localTool,
              mcp_tools: mcpLocal,
              selectedTools: JSON.parse(JSON.stringify(selectedTools)),
            },
          };
          return {
            ...newWorker,
          };
        } else {
          return worker;
        }
      });
      setWorkerList(newWorkerList);
    } else if (activeTaskId && tasks[activeTaskId].messages.length === 0) {
      const worker: Agent = {
        tasks: [],
        agent_id: workerName,
        name: workerName,
        type: workerName as AgentNameType,
        log: [],
        tools: [
          ...selectedTools.map(
            (tool) =>
              tool.name || tool.mcp_name || tool.key || `tool_${tool.id}`
          ),
        ],
        activeWebviewIds: [],
        workerInfo: {
          name: workerName,
          description: workerDescription,
          tools: localTool,
          mcp_tools: mcpLocal,
          selectedTools: JSON.parse(JSON.stringify(selectedTools)),
        },
      };
      setWorkerList([...workerList, worker]);
    } else {
      // Add-worker custom model config is applied to this agent only.
      const selectedModelOption = workerModelOptions[workerModelMode].find(
        (opt) => opt.value === workerModelName
      );
      const customModelConfig =
        showModelConfig && selectedModelOption
          ? {
              model_platform: selectedModelOption.model_platform,
              model_type: selectedModelOption.model_type || undefined,
            }
          : undefined;

      fetchPost(`/task/${activeProjectId}/add-agent`, {
        name: workerName,
        description: workerDescription,
        tools: localTool,
        mcp_tools: mcpLocal,
        email: email,
        custom_model_config: customModelConfig,
      });
      const worker: Agent = {
        tasks: [],
        agent_id: workerName,
        name: workerName,
        type: workerName as AgentNameType,
        log: [],
        activeWebviewIds: [],
        workerInfo: {
          name: workerName,
          description: workerDescription,
          tools: localTool,
          mcp_tools: mcpLocal,
          selectedTools: JSON.parse(JSON.stringify(selectedTools)),
        },
      };
      setWorkerList([...workerList, worker]);
    }

    setDialogOpen(false);

    // reset form
    resetForm();
  };

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <form>
        <DialogTrigger asChild>
          {edit && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={(e) => {
                e.stopPropagation();
                setDialogOpen(true);
                setWorkerName(workerInfo?.workerInfo?.name || '');
                setWorkerDescription(workerInfo?.workerInfo?.description || '');
                setSelectedTools(workerInfo?.workerInfo?.selectedTools || []);
              }}
            >
              <Edit size={16} />
              {t('workforce.edit')}
            </Button>
          )}
        </DialogTrigger>
        <DialogContent
          size="md"
          className="gap-0 p-0 min-h-[60vh]"
          onInteractOutside={(e: any) => {
            if (isValidating) e.preventDefault();
          }}
          onEscapeKeyDown={(e: any) => {
            if (isValidating) e.preventDefault();
          }}
          onPointerDownOutside={(e: any) => {
            if (isValidating) e.preventDefault();
          }}
        >
          <DialogHeader
            title={
              showEnvConfig
                ? t('workforce.configure-mcp-server')
                : t('workforce.add-your-agent')
            }
            tooltip={t('layout.configure-your-mcp-worker-node-here')}
            showTooltip={true}
            showBackButton={showEnvConfig}
            onBackClick={handleCloseMcpEnvSetting}
          />

          {showEnvConfig ? (
            // environment configuration interface
            <>
              <DialogContentSection className="gap-3 p-md flex flex-col">
                <div className="gap-md flex items-center">
                  {getCategoryIcon(activeMcp?.category?.name)}
                  <div>
                    <div className="text-base font-bold leading-9 text-ds-text-neutral-default-default">
                      {activeMcp?.name}
                    </div>
                    <div className="text-sm font-bold leading-normal text-ds-text-neutral-default-default">
                      {getGithubRepoName(activeMcp?.home_page) && (
                        <div className="flex items-center">
                          <img
                            src={githubIcon}
                            alt="github"
                            style={{
                              width: 14.7,
                              height: 14.7,
                              marginRight: 4,
                              display: 'inline-block',
                              verticalAlign: 'middle',
                            }}
                          />
                          <span className="text-xs font-medium leading-normal line-clamp-1 items-center justify-center self-stretch overflow-hidden break-words text-ellipsis">
                            {getGithubRepoName(activeMcp?.home_page)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="gap-sm flex flex-col">
                  {Object.keys(activeMcp?.install_command?.env || {}).map(
                    (key) => (
                      <div key={key}>
                        <Input
                          size="default"
                          title={key}
                          required={envValues[key]?.required ?? true}
                          placeholder={envValues[key]?.tip || `Enter ${key}`}
                          type={
                            isSensitiveKey(key) && !secretVisible[key]
                              ? 'password'
                              : 'text'
                          }
                          value={envValues[key]?.value || ''}
                          onChange={(e) => updateEnvValue(key, e.target.value)}
                          state={envValues[key]?.error ? 'error' : 'default'}
                          note={envValues[key]?.error || envValues[key]?.tip}
                          backIcon={
                            isSensitiveKey(key) ? (
                              secretVisible[key] ? (
                                <EyeOff
                                  size={16}
                                  className="text-ds-text-neutral-muted-disabled"
                                />
                              ) : (
                                <Eye
                                  size={16}
                                  className="text-ds-text-neutral-muted-disabled"
                                />
                              )
                            ) : undefined
                          }
                          onBackIconClick={
                            isSensitiveKey(key)
                              ? () => toggleSecretVisibility(key)
                              : undefined
                          }
                        />
                      </div>
                    )
                  )}
                </div>
              </DialogContentSection>
              <DialogFooter
                className="!rounded-b-xl p-md"
                showCancelButton={true}
                showConfirmButton={true}
                cancelButtonText={t('workforce.cancel')}
                confirmButtonText={
                  isValidating ? 'Validating...' : t('layout.connect')
                }
                onCancel={handleCloseMcpEnvSetting}
                onConfirm={handleConfigureMcpEnvSetting}
                cancelButtonVariant="ghost"
                confirmButtonVariant="primary"
              ></DialogFooter>
              {/* hidden but keep rendering ToolSelect component */}
              <div style={{ display: 'none' }}>
                <ToolSelect
                  onShowEnvConfig={handleShowEnvConfig}
                  onSelectedToolsChange={handleSelectedToolsChange}
                  initialSelectedTools={selectedTools}
                  ref={toolSelectRef}
                />
              </div>
            </>
          ) : (
            // default add interface
            <>
              <DialogContentSection className="gap-3 p-md flex flex-col">
                <div className="gap-4 flex flex-col">
                  <div className="gap-sm flex items-center">
                    <div className="h-16 w-16 flex items-center justify-center">
                      <Bot
                        size={32}
                        className="text-ds-icon-neutral-default-default"
                      />
                    </div>
                    <Input
                      size="sm"
                      title={t('layout.name-your-agent')}
                      placeholder={t('layout.add-an-agent-name')}
                      value={workerName}
                      onChange={(e) => {
                        setWorkerName(e.target.value);
                        // when user starts input, clear error
                        if (nameError) setNameError('');
                      }}
                      state={nameError ? 'error' : 'default'}
                      note={nameError || ''}
                      required
                    />
                  </div>
                </div>

                <Textarea
                  variant="enhanced"
                  size="sm"
                  title={t('workforce.description-optional')}
                  placeholder={t('layout.im-an-agent-specially-designed-for')}
                  value={workerDescription}
                  onChange={(e) => setWorkerDescription(e.target.value)}
                />

                <ToolSelect
                  onShowEnvConfig={handleShowEnvConfig}
                  onSelectedToolsChange={handleSelectedToolsChange}
                  initialSelectedTools={selectedTools}
                  ref={toolSelectRef}
                />

                {/* Model Configuration Section */}
                <div className="mt-2 gap-2 flex flex-col">
                  <div className="gap-3 flex items-center justify-start">
                    <span className="text-body-sm font-bold text-ds-text-neutral-default-default">
                      {t('workforce.use-custom-model')}
                    </span>
                    <Switch
                      checked={showModelConfig}
                      onCheckedChange={(checked) => {
                        setShowModelConfig(checked);
                        if (!checked) {
                          setWorkerModelName('');
                        }
                      }}
                      aria-label={t('workforce.use-custom-model')}
                      className="border-ds-border-neutral-default-default border-[0.5px] border-solid"
                    />
                  </div>

                  {showModelConfig && (
                    <div className="gap-3 rounded-lg px-3 py-2 bg-ds-bg-neutral-muted-default flex flex-row">
                      <div className="gap-1 flex w-full flex-1 flex-col">
                        <label className="text-body-sm font-bold text-ds-text-neutral-default-default">
                          {t('workforce.model-platform')}
                        </label>
                        <Select
                          value={workerModelMode}
                          onValueChange={(value) =>
                            setWorkerModelMode(value as WorkerModelMode)
                          }
                        >
                          <SelectTrigger
                            className="w-full"
                            wrapperClassName="w-full min-w-0"
                          >
                            <SelectValue
                              placeholder={t('workforce.select-platform')}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="eigent">
                              {t('setting.eigent-cloud')}
                            </SelectItem>
                            <SelectItem value="custom">
                              {t('setting.custom-model')}
                            </SelectItem>
                            <SelectItem value="local">
                              {t('setting.local-model')}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="gap-1 flex w-full flex-1 flex-col">
                        <label className="text-body-sm font-bold text-ds-text-neutral-default-default">
                          {t('workforce.model-type')}
                        </label>
                        <Select
                          value={workerModelName}
                          onValueChange={setWorkerModelName}
                        >
                          <SelectTrigger
                            className="w-full"
                            wrapperClassName="w-full min-w-0"
                          >
                            <SelectValue
                              placeholder={t('setting.select-default-model')}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {activeWorkerModelOptions.length > 0 ? (
                              activeWorkerModelOptions.map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                >
                                  {option.label}
                                </SelectItem>
                              ))
                            ) : (
                              <SelectItem value="__empty__" disabled>
                                {t('layout.no-results')}
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>
              </DialogContentSection>
              <DialogFooter
                className="!rounded-b-xl p-md bg-ds-bg-neutral-subtle-default"
                showCancelButton={true}
                showConfirmButton={true}
                cancelButtonText={t('workforce.cancel')}
                confirmButtonText={t('workforce.save-changes')}
                onCancel={() => {
                  resetForm();
                  setDialogOpen(false);
                }}
                onConfirm={handleAddWorker}
                cancelButtonVariant="ghost"
                confirmButtonVariant="primary"
              />
            </>
          )}
        </DialogContent>
      </form>
    </Dialog>
  );
}
