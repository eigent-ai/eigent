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

import { fetchPost } from '@/api/http';
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
import { Textarea } from '@/components/ui/textarea';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { INIT_PROVODERS } from '@/lib/llm';
import { useAuthStore, useWorkerList } from '@/store/authStore';
import { Bot, ChevronDown, ChevronUp, Edit, Eye, EyeOff } from 'lucide-react';
import { useRef, useState } from 'react';
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

export function AddWorker({
  edit = false,
  workerInfo = null,
  variant = 'default',
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
  if (!chatStore) {
    return null;
  }

  const activeProjectId = projectStore.activeProjectId;
  const activeTaskId = chatStore.activeTaskId;
  const tasks = chatStore.tasks;
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
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [customModelPlatform, setCustomModelPlatform] = useState('');
  const [customModelType, setCustomModelType] = useState('');

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
    setUseCustomModel(false);
    setCustomModelPlatform('');
    setCustomModelType('');
  };

  // tool function
  const getCategoryIcon = (categoryName?: string) => {
    if (!categoryName) return <Bot className="h-10 w-10 text-icon-primary" />;
    return <Bot className="h-10 w-10 text-icon-primary" />;
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
    let mcpLocal: any = {};
    if (window.ipcRenderer) {
      mcpLocal = await window.ipcRenderer.invoke('mcp-list');
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
      // Build custom model config if custom model is enabled
      const customModelConfig =
        useCustomModel && customModelPlatform
          ? {
              model_platform: customModelPlatform,
              model_type: customModelType || undefined,
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
          size="sm"
          className="gap-0 p-0"
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
              <DialogContentSection className="flex flex-col gap-3 bg-white-100% p-md">
                <div className="flex items-center gap-md">
                  {getCategoryIcon(activeMcp?.category?.name)}
                  <div>
                    <div className="text-base font-bold leading-9 text-text-action">
                      {activeMcp?.name}
                    </div>
                    <div className="text-sm font-bold leading-normal text-text-body">
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
                          <span className="line-clamp-1 items-center justify-center self-stretch overflow-hidden text-ellipsis break-words text-xs font-medium leading-normal">
                            {getGithubRepoName(activeMcp?.home_page)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-sm">
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
                                  className="text-button-transparent-icon-disabled"
                                />
                              ) : (
                                <Eye
                                  size={16}
                                  className="text-button-transparent-icon-disabled"
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
                className="!rounded-b-xl bg-white-100% p-md"
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
              <DialogContentSection className="flex flex-col gap-3 bg-white-100% p-md">
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-sm">
                    <div className="flex h-16 w-16 items-center justify-center">
                      <Bot size={32} className="text-icon-primary" />
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
                <div className="mt-2 flex flex-col gap-2">
                  <button
                    type="button"
                    className="flex items-center gap-1 text-sm text-text-body hover:text-text-action"
                    onClick={() => setShowModelConfig(!showModelConfig)}
                  >
                    {showModelConfig ? (
                      <ChevronUp size={16} />
                    ) : (
                      <ChevronDown size={16} />
                    )}
                    {t('workforce.advanced-model-config')}
                  </button>

                  {showModelConfig && (
                    <div className="flex flex-col gap-3 rounded-lg bg-surface-tertiary-subtle p-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={useCustomModel}
                          onChange={(e) => setUseCustomModel(e.target.checked)}
                          className="rounded border-border-subtle-strong"
                        />
                        {t('workforce.use-custom-model')}
                      </label>

                      {useCustomModel && (
                        <>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-text-body">
                              {t('workforce.model-platform')}
                            </label>
                            <Select
                              value={customModelPlatform}
                              onValueChange={setCustomModelPlatform}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue
                                  placeholder={t('workforce.select-platform')}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {INIT_PROVODERS.map((provider) => (
                                  <SelectItem
                                    key={provider.id}
                                    value={provider.id}
                                  >
                                    {provider.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-text-body">
                              {t('workforce.model-type')}
                            </label>
                            <Input
                              size="sm"
                              placeholder={t(
                                'workforce.model-type-placeholder'
                              )}
                              value={customModelType}
                              onChange={(e) =>
                                setCustomModelType(e.target.value)
                              }
                            />
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </DialogContentSection>
              <DialogFooter
                className="!rounded-b-xl bg-white-100% p-md"
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
