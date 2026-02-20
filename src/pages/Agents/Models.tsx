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

import {
  fetchPost,
  proxyFetchDelete,
  proxyFetchGet,
  proxyFetchPost,
  proxyFetchPut,
} from '@/api/http';
import { ModelTypeCombobox } from '@/components/ModelTypeCombobox';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { INIT_PROVODERS } from '@/lib/llm';
import { useAuthStore } from '@/store/authStore';
import { Provider } from '@/types';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Cloud,
  Eye,
  EyeOff,
  Key,
  Loader2,
  RotateCcw,
  Server,
  Settings,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

// Import model images
import anthropicImage from '@/assets/model/anthropic.svg';
import azureImage from '@/assets/model/azure.svg';
import bedrockImage from '@/assets/model/bedrock.svg';
import deepseekImage from '@/assets/model/deepseek.svg';
import eigentImage from '@/assets/model/eigent.svg';
import geminiImage from '@/assets/model/gemini.svg';
import lmstudioImage from '@/assets/model/lmstudio.svg';
import minimaxImage from '@/assets/model/minimax.svg';
import modelarkImage from '@/assets/model/modelark.svg';
import moonshotImage from '@/assets/model/moonshot.svg';
import ollamaImage from '@/assets/model/ollama.svg';
import openaiImage from '@/assets/model/openai.svg';
import openrouterImage from '@/assets/model/openrouter.svg';
import qwenImage from '@/assets/model/qwen.svg';
import sglangImage from '@/assets/model/sglang.svg';
import vllmImage from '@/assets/model/vllm.svg';
import zaiImage from '@/assets/model/zai.svg';

const LOCAL_PROVIDER_NAMES = ['ollama', 'vllm', 'sglang', 'lmstudio'];
const DEFAULT_OLLAMA_ENDPOINT = 'http://localhost:11434/v1';

// Sidebar tab types
type SidebarTab =
  | 'cloud'
  | 'byok'
  | `byok-${string}`
  | 'local'
  | 'local-ollama'
  | 'local-vllm'
  | 'local-sglang'
  | 'local-lmstudio';

// Provider logos that use dark fills (black or currentColor) and need inversion in dark mode
const DARK_FILL_MODELS = new Set([
  'openai',
  'anthropic',
  'moonshot',
  'ollama',
  'openrouter',
  'lmstudio',
  'z.ai',
  'openai-compatible-model',
]);

export default function SettingModels() {
  const {
    modelType,
    cloud_model_type,
    setModelType,
    setCloudModelType,
    appearance,
  } = useAuthStore();
  const _navigate = useNavigate();
  const { t } = useTranslation();
  const getValidateMessage = (res: any) =>
    res?.message ??
    res?.detail?.message ??
    res?.detail?.error?.message ??
    res?.error?.message ??
    t('setting.validate-failed');
  const [items, _setItems] = useState<Provider[]>(
    INIT_PROVODERS.filter((p) => p.id !== 'local')
  );
  const [form, setForm] = useState(() =>
    INIT_PROVODERS.filter((p) => p.id !== 'local').map((p) => ({
      apiKey: p.apiKey,
      apiHost: p.apiHost,
      is_valid: p.is_valid ?? false,
      model_type: p.model_type ?? '',
      externalConfig: p.externalConfig
        ? p.externalConfig.map((ec) => ({ ...ec }))
        : undefined,
      provider_id: p.provider_id ?? undefined,
      prefer: p.prefer ?? false,
    }))
  );
  const [showApiKey, setShowApiKey] = useState(() =>
    INIT_PROVODERS.filter((p) => p.id !== 'local').map(() => false)
  );
  const [loading, setLoading] = useState<number | null>(null);
  const [errors, setErrors] = useState<
    {
      apiKey?: string;
      apiHost?: string;
      model_type?: string;
      externalConfig?: string;
    }[]
  >(() =>
    INIT_PROVODERS.filter((p) => p.id !== 'local').map(() => ({
      apiKey: '',
      apiHost: '',
    }))
  );
  const [_collapsed, _setCollapsed] = useState(false);

  // Sidebar selected tab - default to cloud
  const [selectedTab, setSelectedTab] = useState<SidebarTab>('cloud');

  // BYOK accordion state
  const [byokCollapsed, setByokCollapsed] = useState(false);

  // Local Model accordion state
  const [localCollapsed, setLocalCollapsed] = useState(false);

  // Cloud Model
  const [cloudPrefer, setCloudPrefer] = useState(false);

  // Local Model independent state - per platform
  const [localEnabled, setLocalEnabled] = useState(true);
  const [localPlatform, setLocalPlatform] = useState('ollama');
  const [localEndpoints, setLocalEndpoints] = useState<Record<string, string>>(
    {}
  );
  const [localTypes, setLocalTypes] = useState<Record<string, string>>({});
  const [localProviderIds, setLocalProviderIds] = useState<
    Record<string, number | undefined>
  >({});
  const [localVerifying, setLocalVerifying] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localInputError, setLocalInputError] = useState(false);
  const [localPrefer, setLocalPrefer] = useState(false); // Local model prefer state (for current platform)

  // Ollama-specific state for model fetching
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaModelsLoading, setOllamaModelsLoading] = useState(false);
  const [ollamaModelsError, setOllamaModelsError] = useState<string | null>(
    null
  );

  // Fetch available models from Ollama API
  const fetchOllamaModels = async (endpoint?: string) => {
    const url = endpoint || DEFAULT_OLLAMA_ENDPOINT;
    setOllamaModelsLoading(true);
    setOllamaModelsError(null);
    try {
      const baseUrl = url.replace(/\/v1\/?$/, '').replace(/\/$/, '');
      const response = await fetch(`${baseUrl}/api/tags`);
      if (!response.ok) throw new Error(`Failed: ${response.status}`);

      const data = await response.json();
      const modelNames = data.models?.map((m: any) => m.name) || [];
      setOllamaModels(modelNames);
    } catch (error: any) {
      console.error('Failed to fetch Ollama models:', error);
      setOllamaModels([]);
      setOllamaModelsError('Failed to fetch Ollama models. Is Ollama running?');
    } finally {
      setOllamaModelsLoading(false);
    }
  };

  // Default model dropdown state (removed - using DropdownMenu's built-in state)

  // Pending model to set as default after configuration
  const [pendingDefaultModel, setPendingDefaultModel] = useState<{
    category: 'cloud' | 'custom' | 'local';
    modelId: string;
  } | null>(null);

  // Load provider list and populate form
  useEffect(() => {
    (async () => {
      try {
        const res = await proxyFetchGet('/api/providers');
        const providerList = Array.isArray(res) ? res : res.items || [];
        // Handle custom models
        setForm((f) =>
          f.map((fi, idx) => {
            const item = items[idx];
            const found = providerList.find(
              (p: any) => p.provider_name === item.id
            );
            if (found) {
              return {
                ...fi,
                provider_id: found.id,
                apiKey: found.api_key || '',
                // Fall back to provider's default API host if endpoint_url is empty
                apiHost: found.endpoint_url || item.apiHost,
                is_valid: !!found?.is_valid,
                prefer: found.prefer ?? false,
                model_type: found.model_type ?? '',
                externalConfig: fi.externalConfig
                  ? fi.externalConfig.map((ec) => {
                      if (
                        found.encrypted_config &&
                        found.encrypted_config[ec.key] !== undefined
                      ) {
                        return { ...ec, value: found.encrypted_config[ec.key] };
                      }
                      return ec;
                    })
                  : undefined,
              };
            }
            return fi;
          })
        );
        // Handle local models - load all local providers per platform
        const localProviders = providerList.filter((p: any) =>
          LOCAL_PROVIDER_NAMES.includes(p.provider_name)
        );

        const endpoints: Record<string, string> = {};
        const types: Record<string, string> = {};
        const providerIds: Record<string, number | undefined> = {};

        localProviders.forEach((local: any) => {
          const platform =
            local.encrypted_config?.model_platform || local.provider_name;
          // Auto-populate default Ollama endpoint if not set
          endpoints[platform] =
            local.endpoint_url ||
            (platform === 'ollama' ? DEFAULT_OLLAMA_ENDPOINT : '');
          types[platform] = local.encrypted_config?.model_type || '';
          providerIds[platform] = local.id;

          // Set prefer state if any local model is preferred
          if (local.prefer) {
            setLocalPrefer(true);
            setLocalPlatform(platform);
          }
        });

        setLocalEndpoints(endpoints);
        setLocalTypes(types);
        setLocalProviderIds(providerIds);

        // Fetch Ollama models if ollama endpoint is set
        const ollamaEndpoint = endpoints['ollama'] || DEFAULT_OLLAMA_ENDPOINT;
        fetchOllamaModels(ollamaEndpoint);

        // If no local providers found, initialize empty state with Ollama default
        if (localProviders.length === 0) {
          LOCAL_PROVIDER_NAMES.forEach((platform) => {
            endpoints[platform] =
              platform === 'ollama' ? DEFAULT_OLLAMA_ENDPOINT : '';
            types[platform] = '';
            providerIds[platform] = undefined;
          });
          setLocalEndpoints(endpoints);
          setLocalTypes(types);
          setLocalProviderIds(providerIds);
        }
        if (modelType === 'cloud') {
          setCloudPrefer(true);
          setForm((f) => f.map((fi) => ({ ...fi, prefer: false })));
          setLocalPrefer(false);
        } else if (modelType === 'local') {
          setLocalEnabled(true);
          setForm((f) => f.map((fi) => ({ ...fi, prefer: false })));
          setLocalPrefer(true);
          setCloudPrefer(false);
        } else {
          setLocalPrefer(false);
          setCloudPrefer(false);
        }
      } catch (e) {
        console.error('Error fetching providers:', e);
        // ignore error
      }
    })();

    if (import.meta.env.VITE_USE_LOCAL_PROXY !== 'true') {
      fetchSubscription();
      updateCredits();
    }
  }, [items, modelType]);

  // Get current default model display text
  const getDefaultModelDisplayText = (): string => {
    if (cloudPrefer) {
      const cloudModel = cloudModelOptions.find(
        (m) => m.id === cloud_model_type
      );
      const modelName = cloudModel
        ? cloudModel.name
        : cloud_model_type
            .replace(/-/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase());
      return `${t('setting.eigent-cloud')} / ${modelName}`;
    }

    // Check for custom model preference
    const preferredIdx = form.findIndex((f) => f.prefer);
    if (preferredIdx !== -1) {
      const item = items[preferredIdx];
      const modelType = form[preferredIdx].model_type || '';
      return `${t('setting.custom-model')} / ${item.name}${modelType ? ` (${modelType})` : ''}`;
    }

    // Check for local model preference
    if (localPrefer && localPlatform) {
      const localModel = localModelOptions.find((m) => m.id === localPlatform);
      const platformName = localModel
        ? localModel.name
        : localPlatform === 'ollama'
          ? 'Ollama'
          : localPlatform === 'vllm'
            ? 'vLLM'
            : localPlatform === 'sglang'
              ? 'SGLang'
              : 'LM Studio';
      const modelType = localTypes[localPlatform] || '';
      return `${t('setting.local-model')} / ${platformName}${modelType ? ` (${modelType})` : ''}`;
    }

    return t('setting.select-default-model');
  };

  // Check if a model is configured
  const isModelConfigured = (
    category: 'cloud' | 'custom' | 'local',
    modelId: string
  ): boolean => {
    if (category === 'cloud') {
      return import.meta.env.VITE_USE_LOCAL_PROXY !== 'true';
    }
    if (category === 'custom') {
      const idx = items.findIndex((item) => item.id === modelId);
      return idx !== -1 && !!form[idx]?.provider_id;
    }
    if (category === 'local') {
      return !!localProviderIds[modelId];
    }
    return false;
  };

  // Handle model selection from dropdown
  const handleDefaultModelSelect = async (
    category: 'cloud' | 'custom' | 'local',
    modelId: string
  ) => {
    const configured = isModelConfigured(category, modelId);

    if (!configured) {
      // Store pending model to set as default after configuration
      setPendingDefaultModel({ category, modelId });

      // Navigate to the appropriate tab for configuration
      if (category === 'cloud') {
        setSelectedTab('cloud');
      } else if (category === 'custom') {
        setSelectedTab(`byok-${modelId}` as SidebarTab);
        // Expand BYOK section if collapsed
        if (byokCollapsed) setByokCollapsed(false);
      } else if (category === 'local') {
        setSelectedTab(`local-${modelId}` as SidebarTab);
        // Expand Local section if collapsed
        if (localCollapsed) setLocalCollapsed(false);
      }
      return;
    }

    // Model is configured, set it as default
    await setModelAsDefault(category, modelId);
  };

  // Set a model as the default
  const setModelAsDefault = async (
    category: 'cloud' | 'custom' | 'local',
    modelId: string
  ) => {
    if (category === 'cloud') {
      setLocalPrefer(false);
      setActiveModelIdx(null);
      setForm((f) => f.map((fi) => ({ ...fi, prefer: false })));
      setCloudPrefer(true);
      setModelType('cloud');
      if (modelId !== 'cloud') {
        setCloudModelType(modelId as any);
      }
    } else if (category === 'custom') {
      const idx = items.findIndex((item) => item.id === modelId);
      if (idx !== -1) {
        await handleSwitch(idx, true);
      }
    } else if (category === 'local') {
      // Update local platform if different
      if (localPlatform !== modelId) {
        setLocalPlatform(modelId);
      }
      const providerId = localProviderIds[modelId];
      await handleLocalSwitch(true, providerId);
    }
    setPendingDefaultModel(null);
  };

  // Cloud model options
  const cloudModelOptions = [
    { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview' },
    { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview' },
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview' },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
    { id: 'gpt-4.1', name: 'GPT-4.1' },
    { id: 'gpt-5', name: 'GPT-5' },
    { id: 'gpt-5.1', name: 'GPT-5.1' },
    { id: 'gpt-5.2', name: 'GPT-5.2' },
    { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4-5' },
    { id: 'minimax_m2_5', name: 'Minimax M2.5' },
  ];

  // Local model options
  const localModelOptions = [
    { id: 'ollama', name: 'Ollama' },
    { id: 'vllm', name: 'vLLM' },
    { id: 'sglang', name: 'SGLang' },
    { id: 'lmstudio', name: 'LM Studio' },
  ];

  const handleVerify = async (idx: number) => {
    const { apiKey, apiHost, externalConfig, model_type, provider_id } =
      form[idx];
    let hasError = false;
    const newErrors = [...errors];
    if (items[idx].id !== 'local') {
      if (!apiKey || apiKey.trim() === '') {
        newErrors[idx].apiKey = t('setting.api-key-can-not-be-empty');
        hasError = true;
      } else {
        newErrors[idx].apiKey = '';
      }
    }
    if (!apiHost || apiHost.trim() === '') {
      newErrors[idx].apiHost = t('setting.api-host-can-not-be-empty');
      hasError = true;
    } else {
      newErrors[idx].apiHost = '';
    }
    if (!model_type || model_type.trim() === '') {
      newErrors[idx].model_type = t('setting.model-type-can-not-be-empty');
      hasError = true;
    } else {
      newErrors[idx].model_type = '';
    }
    setErrors(newErrors);
    if (hasError) return;

    setLoading(idx);
    const item = items[idx];
    let external: any = {};
    if (form[idx]?.externalConfig) {
      form[idx]?.externalConfig.map((item) => {
        external[item.key] = item.value;
      });
    }

    console.log(form[idx]);
    try {
      const res = await fetchPost('/model/validate', {
        model_platform: item.id,
        model_type: form[idx].model_type,
        api_key: form[idx].apiKey,
        url: form[idx].apiHost,
        extra_params: external,
      });
      if (res.is_tool_calls && res.is_valid) {
        console.log('success');
        toast(t('setting.validate-success'), {
          description: t(
            'setting.the-model-has-been-verified-to-support-function-calling-which-is-required-to-use-eigent'
          ),
          closeButton: true,
        });
      } else {
        console.log('failed', res.message);
        // Surface error inline on API Key input
        setErrors((prev) => {
          const next = [...prev];
          if (!next[idx]) next[idx] = {} as any;
          next[idx].apiKey = getValidateMessage(res);
          return next;
        });
        return;
      }
      console.log(res);
    } catch (e) {
      console.log(e);
      // Network/exception case: show inline error
      setErrors((prev) => {
        const next = [...prev];
        if (!next[idx]) next[idx] = {} as any;
        next[idx].apiKey = getValidateMessage(e);
        return next;
      });
      return;
    } finally {
      setLoading(null);
    }

    const data: any = {
      provider_name: item.id,
      api_key: form[idx].apiKey,
      endpoint_url: form[idx].apiHost,
      is_valid: form[idx].is_valid,
      model_type: form[idx].model_type,
    };
    if (externalConfig) {
      data.encrypted_config = {};
      externalConfig.forEach((ec) => {
        data.encrypted_config[ec.key] = ec.value;
      });
    }
    try {
      if (provider_id) {
        await proxyFetchPut(`/api/provider/${provider_id}`, data);
      } else {
        await proxyFetchPost('/api/provider', data);
      }
      // add: refresh provider list after saving, update form and switch editable status
      const res = await proxyFetchGet('/api/providers');
      const providerList = Array.isArray(res) ? res : res.items || [];
      setForm((f) =>
        f.map((fi, i) => {
          const item = items[i];
          const found = providerList.find(
            (p: any) => p.provider_name === item.id
          );
          if (found) {
            return {
              ...fi,
              provider_id: found.id,
              apiKey: found.api_key || '',
              // Fall back to provider's default API host if endpoint_url is empty
              apiHost: found.endpoint_url || item.apiHost,
              is_valid: !!found.is_valid,
              prefer: found.prefer ?? false,
              externalConfig: fi.externalConfig
                ? fi.externalConfig.map((ec) => {
                    if (
                      found.encrypted_config &&
                      found.encrypted_config[ec.key] !== undefined
                    ) {
                      return { ...ec, value: found.encrypted_config[ec.key] };
                    }
                    return ec;
                  })
                : undefined,
            };
          }
          return fi;
        })
      );

      // Check if this was a pending default model selection
      if (
        pendingDefaultModel &&
        pendingDefaultModel.category === 'custom' &&
        pendingDefaultModel.modelId === item.id
      ) {
        await handleSwitch(idx, true);
        setPendingDefaultModel(null);
      } else {
        handleSwitch(idx, true);
      }
    } finally {
      setLoading(null);
    }
  };

  // Local Model verification
  const handleLocalVerify = async () => {
    setLocalVerifying(true);
    setLocalError(null);
    setLocalInputError(false);
    const currentEndpoint = localEndpoints[localPlatform] || '';
    const currentType = localTypes[localPlatform] || '';

    if (!currentEndpoint) {
      setLocalError(t('setting.endpoint-url-can-not-be-empty'));
      setLocalInputError(true);
      setLocalVerifying(false);
      return;
    }
    if (!currentType) {
      setLocalError(t('setting.model-type-can-not-be-empty'));
      setLocalInputError(true);
      setLocalVerifying(false);
      return;
    }
    try {
      // // 1. Check if endpoint returns response
      // let baseUrl = localEndpoint;
      // let testUrl = baseUrl;
      // let testMethod = "GET";
      // let testBody = undefined;

      // // Extract base URL if it contains specific endpoints
      // if (baseUrl.includes('/chat/completions')) {
      // 	baseUrl = baseUrl.replace('/chat/completions', '');
      // } else if (baseUrl.includes('/completions')) {
      // 	baseUrl = baseUrl.replace('/completions', '');
      // }

      // // Always test with chat completions endpoint for OpenAI-compatible APIs
      // testUrl = `${baseUrl}/chat/completions`;
      // testMethod = "POST";
      // testBody = JSON.stringify({
      // 	model: localType || "test",
      // 	messages: [{ role: "user", content: "test" }],
      // 	max_tokens: 1,
      // 	stream: false
      // });

      // const resp = await fetch(testUrl, {
      // 	method: testMethod,
      // 	headers: {
      // 		"Content-Type": "application/json",
      // 		"Authorization": "Bearer dummy"
      // 	},
      // 	body: testBody
      // });

      // if (!resp.ok) {
      // 	throw new Error("Endpoint is not responding");
      // }

      try {
        const res = await fetchPost('/model/validate', {
          model_platform: localPlatform,
          model_type: currentType,
          api_key: 'not-required',
          url: currentEndpoint,
        });
        if (res.is_tool_calls && res.is_valid) {
          console.log('success');
          toast(t('setting.validate-success'), {
            description: t(
              'setting.the-model-has-been-verified-to-support-function-calling-which-is-required-to-use-eigent'
            ),
            closeButton: true,
          });
        } else {
          console.log('failed', res.message);
          const toastId = toast(t('setting.validate-failed'), {
            description: getValidateMessage(res),
            action: {
              label: t('setting.close'),
              onClick: () => {
                toast.dismiss(toastId);
              },
            },
          });

          return;
        }
        console.log(res);
      } catch (e) {
        console.log(e);
        const toastId = toast(t('setting.validate-failed'), {
          description: getValidateMessage(e),
          action: {
            label: t('setting.close'),
            onClick: () => {
              toast.dismiss(toastId);
            },
          },
        });
        return;
      } finally {
        setLoading(null);
      }

      // 2. Save to /api/provider/ (save only base URL)
      const currentProviderId = localProviderIds[localPlatform];
      const data: any = {
        provider_name: localPlatform,
        api_key: 'not-required',
        endpoint_url: currentEndpoint, // Save base URL without specific endpoints
        is_valid: true,
        model_type: currentType,
        encrypted_config: {
          model_platform: localPlatform,
          model_type: currentType,
        },
      };

      // Update or create provider
      if (currentProviderId) {
        await proxyFetchPut(`/api/provider/${currentProviderId}`, data);
      } else {
        await proxyFetchPost('/api/provider', data);
      }

      setLocalError(null);
      setLocalInputError(false);
      // add: refresh provider list after saving, update localProviderIds and localPrefer
      const res = await proxyFetchGet('/api/providers');
      const providerList = Array.isArray(res) ? res : res.items || [];
      const local = providerList.find(
        (p: any) => p.provider_name === localPlatform
      );
      if (local) {
        setLocalProviderIds((prev) => ({ ...prev, [localPlatform]: local.id }));
        setLocalPrefer(local.prefer ?? false);

        // Check if this was a pending default model selection
        if (
          pendingDefaultModel &&
          pendingDefaultModel.category === 'local' &&
          pendingDefaultModel.modelId === localPlatform
        ) {
          await handleLocalSwitch(true, local.id);
          setPendingDefaultModel(null);
        } else {
          await handleLocalSwitch(true, local.id);
        }
      }
    } catch (e: any) {
      setLocalError(
        e.message || t('setting.verification-failed-please-check-endpoint-url')
      );
      setLocalInputError(true);
    } finally {
      setLocalVerifying(false);
    }
  };

  const [activeModelIdx, setActiveModelIdx] = useState<number | null>(null); // Current active model idx

  // Switch linkage logic: only one switch can be enabled
  useEffect(() => {
    if (activeModelIdx !== null) {
      setLocalEnabled(false);
    } else {
      setLocalEnabled(true);
    }
  }, [activeModelIdx]);
  useEffect(() => {
    if (localEnabled) {
      setActiveModelIdx(null);
    }
  }, [localEnabled]);

  // Sync localPlatform when switching to a local model tab
  useEffect(() => {
    if (selectedTab.startsWith('local-')) {
      const platform = selectedTab.replace('local-', '');
      if (localPlatform !== platform) {
        setLocalPlatform(platform);
      }
    }
  }, [selectedTab, localPlatform]);

  const handleSwitch = async (idx: number, checked: boolean) => {
    if (!checked) {
      setActiveModelIdx(null);
      setLocalEnabled(true);
      return;
    }
    const hasSearchKey = await checkHasSearchKey();
    if (!hasSearchKey) {
      // Show warning toast instead of blocking
      toast(t('setting.warning-google-search-not-configured'), {
        description: t(
          'setting.search-functionality-may-be-limited-without-google-api'
        ),
        closeButton: true,
      });
    }
    try {
      await proxyFetchPost('/api/provider/prefer', {
        provider_id: form[idx].provider_id,
      });
      setModelType('custom');
      setActiveModelIdx(idx);
      setLocalEnabled(false);
      setCloudPrefer(false);
      setForm((f) => f.map((fi, i) => ({ ...fi, prefer: i === idx }))); // Only one prefer allowed
      setLocalPrefer(false);
    } catch (e) {
      console.error('Error switching model:', e);
      // Optional: add error message
    }
  };
  const handleLocalSwitch = async (checked: boolean, providerId?: number) => {
    if (!checked) {
      setLocalEnabled(false);
      setLocalPrefer(false);
      return;
    }
    const hasSearchKey = await checkHasSearchKey();
    if (!hasSearchKey) {
      // Show warning toast instead of blocking
      toast(t('setting.warning-google-search-not-configured'), {
        description: t(
          'setting.search-functionality-may-be-limited-without-google-api'
        ),
        closeButton: true,
      });
    }
    try {
      const targetProviderId =
        providerId !== undefined ? providerId : localProviderIds[localPlatform];
      if (targetProviderId === undefined) return;
      await proxyFetchPost('/api/provider/prefer', {
        provider_id: targetProviderId,
      });
      setModelType('local');
      setLocalEnabled(true);
      setActiveModelIdx(null);
      setForm((f) => f.map((fi) => ({ ...fi, prefer: false }))); // Set all others' prefer to false
      setLocalPrefer(true);
      setCloudPrefer(false);
    } catch (e) {
      console.error('Error switching local model:', e);
      // Optional: add error message
    }
  };

  const handleLocalReset = async () => {
    try {
      const currentProviderId = localProviderIds[localPlatform];
      if (currentProviderId !== undefined) {
        await proxyFetchDelete(`/api/provider/${currentProviderId}`);
      }
      // Set endpoint to default for Ollama, empty for others
      const defaultEndpoint =
        localPlatform === 'ollama' ? DEFAULT_OLLAMA_ENDPOINT : '';
      setLocalEndpoints((prev) => ({
        ...prev,
        [localPlatform]: defaultEndpoint,
      }));
      setLocalTypes((prev) => ({ ...prev, [localPlatform]: '' }));
      setLocalProviderIds((prev) => ({ ...prev, [localPlatform]: undefined }));
      // Reset prefer state only if this platform was the preferred one
      if (localPrefer) {
        setLocalPrefer(false);
      }
      setLocalEnabled(true);
      setActiveModelIdx(null);
      // Re-fetch Ollama models after reset
      if (localPlatform === 'ollama') {
        setOllamaModelsError(null);
        fetchOllamaModels(DEFAULT_OLLAMA_ENDPOINT);
      }
      toast.success(t('setting.reset-success'));
    } catch (e) {
      console.error('Error resetting local model:', e);
      toast.error(t('setting.reset-failed'));
    }
  };
  const handleDelete = async (idx: number) => {
    try {
      const { provider_id } = form[idx];
      if (provider_id) {
        await proxyFetchDelete(`/api/provider/${provider_id}`);
      }
      // reset single form entry to default empty values
      setForm((prev) =>
        prev.map((fi, i) => {
          if (i !== idx) return fi;
          const item = items[i];
          return {
            apiKey: '',
            // Restore provider's default API host instead of clearing it
            apiHost: item.apiHost,
            is_valid: false,
            model_type: '',
            externalConfig: item.externalConfig
              ? item.externalConfig.map((ec) => ({ ...ec, value: '' }))
              : undefined,
            provider_id: undefined,
            prefer: false,
          };
        })
      );
      setErrors((prev) =>
        prev.map((er, i) =>
          i === idx ? ({ apiKey: '', apiHost: '', model_type: '' } as any) : er
        )
      );
      if (activeModelIdx === idx) {
        setActiveModelIdx(null);
        setLocalEnabled(true);
      }
      toast.success(t('setting.reset-success'));
    } catch (e) {
      console.error('Error deleting model:', e);
      toast.error(t('setting.reset-failed'));
    }
  };

  // removed bulk reset; only single-provider delete is supported

  const checkHasSearchKey = async () => {
    const configsRes = await proxyFetchGet('/api/configs');
    const configs = Array.isArray(configsRes) ? configsRes : [];
    console.log(configsRes, configs);
    const _hasApiKey = configs.find(
      (item) => item.config_name === 'GOOGLE_API_KEY'
    );
    const _hasApiId = configs.find(
      (item) => item.config_name === 'SEARCH_ENGINE_ID'
    );
    return _hasApiKey && _hasApiId;
  };

  const [subscription, setSubscription] = useState<any>(null);
  const fetchSubscription = async () => {
    const res = await proxyFetchGet('/api/subscription');
    console.log(res);
    if (res) {
      setSubscription(res);
    }
  };
  const [credits, setCredits] = useState<any>(0);
  const [loadingCredits, setLoadingCredits] = useState(false);
  const updateCredits = async () => {
    try {
      setLoadingCredits(true);
      const res = await proxyFetchGet(`/api/user/current_credits`);
      console.log(res?.credits);
      setCredits(res?.credits);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingCredits(false);
    }
  };

  // Check if a model logo needs inversion in dark mode
  const needsInvert = (modelId: string | null): boolean => {
    if (!modelId || appearance !== 'dark') return false;
    // Strip 'local-' prefix for local model tab IDs
    const key = modelId.startsWith('local-')
      ? modelId.replace('local-', '')
      : modelId;
    return DARK_FILL_MODELS.has(key);
  };

  // Helper to get model image based on model ID
  const getModelImage = (modelId: string | null): string | null => {
    if (!modelId) return null;
    const modelImageMap: Record<string, string> = {
      // Cloud version
      cloud: eigentImage,
      // Cloud models
      openai: openaiImage,
      anthropic: anthropicImage,
      gemini: geminiImage,
      openrouter: openrouterImage,
      'tongyi-qianwen': qwenImage,
      deepseek: deepseekImage,
      minimax: minimaxImage,
      'z.ai': zaiImage,
      moonshot: moonshotImage,
      ModelArk: modelarkImage,
      'aws-bedrock': bedrockImage,
      azure: azureImage,
      'openai-compatible-model': openaiImage, // Use OpenAI icon as fallback
      // Local models
      ollama: ollamaImage,
      vllm: vllmImage,
      sglang: sglangImage,
      lmstudio: lmstudioImage,
      // Local model tab IDs
      'local-ollama': ollamaImage,
      'local-vllm': vllmImage,
      'local-sglang': sglangImage,
      'local-lmstudio': lmstudioImage,
    };
    return modelImageMap[modelId] || null;
  };

  // Helper to render sidebar tab item
  const renderSidebarItem = (
    tabId: SidebarTab,
    label: string,
    modelId: string | null,
    isActive: boolean,
    isSubItem: boolean = false,
    isConfigured: boolean = false
  ) => {
    const modelImage = getModelImage(modelId);
    const fallbackIcon =
      modelId === 'cloud' ? (
        <Cloud className="h-5 w-5" />
      ) : modelId?.startsWith('local') ? (
        <Server className="h-5 w-5" />
      ) : (
        <Key className="h-5 w-5" />
      );

    return (
      <button
        key={tabId}
        onClick={() => setSelectedTab(tabId)}
        className={`flex w-full items-center justify-between rounded-xl px-3 py-2 transition-all duration-200 ${isSubItem ? 'pl-3' : ''} ${
          isActive
            ? 'bg-fill-fill-transparent-active'
            : 'bg-fill-fill-transparent hover:bg-fill-fill-transparent-hover'
        } `}
      >
        <div className="flex items-center justify-center gap-3">
          {modelImage ? (
            <img
              src={modelImage}
              alt={label}
              className="h-5 w-5"
              style={needsInvert(modelId) ? { filter: 'invert(1)' } : undefined}
            />
          ) : (
            <span className={isActive ? 'text-text-body' : 'text-text-label'}>
              {fallbackIcon}
            </span>
          )}
          <span
            className={`text-body-sm font-medium ${isActive ? 'text-text-body' : 'text-text-label'}`}
          >
            {label}
          </span>
        </div>
        {isConfigured && (
          <div className="m-1 h-2 w-2 rounded-full bg-text-success" />
        )}
      </button>
    );
  };

  // Render content based on selected tab
  const renderContent = () => {
    // Cloud version content
    if (selectedTab === 'cloud') {
      if (import.meta.env.VITE_USE_LOCAL_PROXY === 'true') {
        return (
          <div className="flex h-64 items-center justify-center text-text-label">
            {t('setting.cloud-not-available-in-local-proxy')}
          </div>
        );
      }
      return (
        <div className="flex w-full flex-col rounded-2xl bg-surface-tertiary">
          <div className="mx-6 mb-4 flex flex-col justify-start self-stretch border-x-0 border-b-[0.5px] border-t-0 border-solid border-border-secondary pb-4 pt-2">
            <div className="inline-flex items-center justify-start gap-2 self-stretch">
              <div className="text-body-base my-2 flex-1 justify-center font-bold text-text-heading">
                {t('setting.eigent-cloud')}
              </div>
              {cloudPrefer ? (
                <Button
                  variant="success"
                  size="xs"
                  className="focus-none rounded-full"
                  onClick={() => {
                    setCloudPrefer(false);
                    setModelType('custom');
                  }}
                >
                  {t('setting.default')}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="xs"
                  className="rounded-full !text-text-label"
                  onClick={() => {
                    setLocalPrefer(false);
                    setActiveModelIdx(null);
                    setForm((f) => f.map((fi) => ({ ...fi, prefer: false })));
                    setCloudPrefer(true);
                    setModelType('cloud');
                  }}
                >
                  {t('setting.set-as-default')}
                </Button>
              )}
            </div>
            <div className="justify-center self-stretch">
              <span className="text-body-sm text-text-label">
                {t('setting.you-are-currently-subscribed-to-the')}{' '}
                {subscription?.plan_key?.charAt(0).toUpperCase() +
                  subscription?.plan_key?.slice(1)}
                . {t('setting.discover-more-about-our')}{' '}
              </span>
              <span
                onClick={() => {
                  window.location.href = `https://www.eigent.ai/pricing`;
                }}
                className="cursor-pointer text-body-sm text-text-label underline"
              >
                {t('setting.pricing-options')}
              </span>
              <span className="text-label-sm font-normal text-text-body">
                .
              </span>
            </div>
          </div>
          {/*Content Area*/}
          <div className="flex w-full flex-row items-center justify-between gap-4 px-6 pb-4">
            <div className="text-body-sm text-text-body">
              {t('setting.credits')}:{' '}
              {loadingCredits ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                credits
              )}
            </div>
            <Button
              onClick={() => {
                window.location.href = `https://www.eigent.ai/dashboard`;
              }}
              variant="primary"
              size="sm"
            >
              {loadingCredits ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                subscription?.plan_key?.charAt(0).toUpperCase() +
                subscription?.plan_key?.slice(1)
              )}
              <Settings />
            </Button>
          </div>
          <div className="flex w-full flex-1 items-center justify-between px-6 pb-4">
            <div className="flex min-w-0 flex-1 items-center">
              <span className="overflow-hidden text-ellipsis whitespace-nowrap text-body-sm">
                {t('setting.select-model-type')}
              </span>
            </div>
            <div className="ml-4 flex-shrink-0">
              <Select
                value={cloud_model_type}
                onValueChange={setCloudModelType}
              >
                <SelectTrigger size="sm">
                  <SelectValue placeholder={t('setting.select-model-type')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gemini-3.1-pro-preview">
                    {t('setting.gemini-3.1-pro-preview-name')}
                  </SelectItem>
                  <SelectItem value="gemini-3-pro-preview">
                    {t('setting.gemini-3-pro-preview-name')}
                  </SelectItem>
                  <SelectItem value="gemini-3-flash-preview">
                    {t('setting.gemini-3-flash-preview-name')}
                  </SelectItem>
                  <SelectItem value="gpt-4.1-mini">
                    {t('setting.gpt-4.1-mini-name')}
                  </SelectItem>
                  <SelectItem value="gpt-4.1">
                    {t('setting.gpt-4.1-name')}
                  </SelectItem>
                  <SelectItem value="gpt-5">
                    {t('setting.gpt-5-name')}
                  </SelectItem>
                  <SelectItem value="gpt-5.1">
                    {t('setting.gpt-5.1-name')}
                  </SelectItem>
                  <SelectItem value="gpt-5.2">
                    {t('setting.gpt-5.2-name')}
                  </SelectItem>
                  <SelectItem value="gpt-5-mini">
                    {t('setting.gpt-5-mini-name')}
                  </SelectItem>
                  <SelectItem value="claude-sonnet-4-5">
                    {t('setting.claude-sonnet-4-5-name')}
                  </SelectItem>
                  <SelectItem value="minimax_m2_5">
                    {t('setting.minimax-m2-5-name')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      );
    }

    // BYOK (Bring Your Own Key) content - show specific model
    if (selectedTab.startsWith('byok-')) {
      const modelId = selectedTab.replace('byok-', '');
      const idx = items.findIndex((item) => item.id === modelId);
      if (idx === -1) return null;

      const item = items[idx];
      const canSwitch = !!form[idx].provider_id;

      return (
        <div className="flex w-full flex-col rounded-2xl bg-surface-tertiary">
          <div className="mx-6 mb-4 flex flex-col items-start justify-between border-x-0 border-b-[0.5px] border-t-0 border-solid border-border-secondary pb-4 pt-2">
            <div className="inline-flex items-center justify-between gap-2 self-stretch">
              <div className="text-body-base my-2 font-bold text-text-heading">
                {item.name}
              </div>
              <div className="flex items-center gap-2">
                {form[idx].prefer ? (
                  <span className="inline-flex items-center rounded-full px-2 py-1 text-label-xs font-bold text-text-success">
                    {t('setting.default')}
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={!canSwitch || loading === idx}
                    onClick={() => handleSwitch(idx, true)}
                    className={
                      canSwitch
                        ? 'inline-flex items-center rounded-full bg-button-transparent-fill-hover !text-text-label shadow-none hover:bg-button-transparent-fill-active'
                        : 'inline-flex items-center gap-1.5'
                    }
                  >
                    {!canSwitch
                      ? t('setting.not-configured')
                      : t('setting.set-as-default')}
                  </Button>
                )}
                {form[idx].provider_id ? (
                  <div className="h-2 w-2 shrink-0 rounded-full bg-text-success" />
                ) : (
                  <div className="h-2 w-2 shrink-0 rounded-full bg-text-label opacity-10" />
                )}
              </div>
            </div>
            <div className="text-body-sm text-text-label">
              {item.description}
            </div>
          </div>
          <div className="flex w-full flex-col items-center gap-4 px-6">
            {/* API Key Setting */}
            <Input
              id={`apiKey-${item.id}`}
              type={showApiKey[idx] ? 'text' : 'password'}
              size="default"
              title={t('setting.api-key-setting')}
              state={errors[idx]?.apiKey ? 'error' : 'default'}
              note={errors[idx]?.apiKey ?? undefined}
              placeholder={` ${t('setting.enter-your-api-key')} ${
                item.name
              } ${t('setting.key')}`}
              backIcon={
                showApiKey[idx] ? (
                  <Eye className="h-5 w-5" />
                ) : (
                  <EyeOff className="h-5 w-5" />
                )
              }
              onBackIconClick={() =>
                setShowApiKey((arr) => arr.map((v, i) => (i === idx ? !v : v)))
              }
              value={form[idx].apiKey}
              onChange={(e) => {
                const v = e.target.value;
                setForm((f) =>
                  f.map((fi, i) => (i === idx ? { ...fi, apiKey: v } : fi))
                );
                setErrors((errs) =>
                  errs.map((er, i) => (i === idx ? { ...er, apiKey: '' } : er))
                );
              }}
            />
            {/* API Host Setting */}
            <Input
              id={`apiHost-${item.id}`}
              size="default"
              title={t('setting.api-host-setting')}
              state={errors[idx]?.apiHost ? 'error' : 'default'}
              note={errors[idx]?.apiHost ?? undefined}
              placeholder={`${t('setting.enter-your-api-host')} ${
                item.name
              } ${t('setting.url')}`}
              value={form[idx].apiHost}
              onChange={(e) => {
                const v = e.target.value;
                setForm((f) =>
                  f.map((fi, i) => (i === idx ? { ...fi, apiHost: v } : fi))
                );
                setErrors((errs) =>
                  errs.map((er, i) => (i === idx ? { ...er, apiHost: '' } : er))
                );
              }}
            />
            {/* Model Type Setting */}
            <ModelTypeCombobox
              platform={item.id}
              apiKey={form[idx].apiKey}
              apiUrl={form[idx].apiHost}
              value={form[idx].model_type}
              onValueChange={(v) => {
                setForm((f) =>
                  f.map((fi, i) => (i === idx ? { ...fi, model_type: v } : fi))
                );
                setErrors((errs) =>
                  errs.map((er, i) =>
                    i === idx ? { ...er, model_type: '' } : er
                  )
                );
              }}
              placeholder={`${t('setting.enter-your-model-type')} ${
                item.name
              } ${t('setting.model-type')}`}
              disabled={loading === idx}
              error={errors[idx]?.model_type}
              title={t('setting.model-type-setting')}
            />
            {/* externalConfig render */}
            {item.externalConfig &&
              form[idx].externalConfig &&
              form[idx].externalConfig.map((ec, ecIdx) => (
                <div key={ec.key} className="flex h-full w-full flex-col gap-4">
                  {ec.options && ec.options.length > 0 ? (
                    <Select
                      value={ec.value}
                      onValueChange={(v) => {
                        setForm((f) =>
                          f.map((fi, i) =>
                            i === idx
                              ? {
                                  ...fi,
                                  externalConfig: fi.externalConfig?.map(
                                    (eec, i2) =>
                                      i2 === ecIdx ? { ...eec, value: v } : eec
                                  ),
                                }
                              : fi
                          )
                        );
                      }}
                    >
                      <SelectTrigger
                        size="default"
                        title={ec.name}
                        state={
                          errors[idx]?.externalConfig ? 'error' : undefined
                        }
                        note={errors[idx]?.externalConfig ?? undefined}
                      >
                        <SelectValue placeholder={t('setting.please-select')} />
                      </SelectTrigger>
                      <SelectContent>
                        {ec.options.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      size="default"
                      title={ec.name}
                      state={errors[idx]?.externalConfig ? 'error' : undefined}
                      note={errors[idx]?.externalConfig ?? undefined}
                      value={ec.value}
                      onChange={(e) => {
                        const v = e.target.value;
                        setForm((f) =>
                          f.map((fi, i) =>
                            i === idx
                              ? {
                                  ...fi,
                                  externalConfig: fi.externalConfig?.map(
                                    (eec, i2) =>
                                      i2 === ecIdx ? { ...eec, value: v } : eec
                                  ),
                                }
                              : fi
                          )
                        );
                      }}
                    />
                  )}
                </div>
              ))}
          </div>
          {/* Action Button */}
          <div className="flex justify-end gap-2 px-6 py-4">
            <Button
              variant="ghost"
              size="sm"
              className="!text-text-label"
              onClick={() => handleDelete(idx)}
            >
              {t('setting.reset')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleVerify(idx)}
              disabled={loading === idx}
            >
              <span className="text-text-inverse-primary">
                {loading === idx ? t('setting.configuring') : t('setting.save')}
              </span>
            </Button>
          </div>
        </div>
      );
    }

    // Local model content - specific platforms
    if (selectedTab.startsWith('local-')) {
      const platform = selectedTab.replace('local-', '');
      const currentEndpoint = localEndpoints[platform] || '';
      const currentType = localTypes[platform] || '';
      const isConfigured = !!localProviderIds[platform];
      const isPreferred = localPrefer && localPlatform === platform;

      return (
        <div className="flex w-full flex-col rounded-2xl bg-surface-tertiary">
          <div className="mx-6 mb-4 flex flex-col items-start justify-between border-x-0 border-b-[0.5px] border-t-0 border-solid border-border-secondary pb-4 pt-2">
            <div className="inline-flex items-center justify-between gap-2 self-stretch">
              <div className="flex items-center gap-2">
                <div className="text-body-base my-2 font-bold text-text-heading">
                  {platform === 'ollama'
                    ? 'Ollama'
                    : platform === 'vllm'
                      ? 'vLLM'
                      : platform === 'sglang'
                        ? 'SGLang'
                        : 'LM Studio'}
                </div>
                {isPreferred ? (
                  <Button
                    variant="success"
                    size="xs"
                    className="focus-none rounded-full shadow-none"
                    disabled={!isConfigured}
                    onClick={() => handleLocalSwitch(false)}
                  >
                    {t('setting.default')}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={!isConfigured}
                    onClick={() => handleLocalSwitch(true)}
                    className={
                      isConfigured
                        ? 'rounded-full bg-button-transparent-fill-hover !text-text-label shadow-none'
                        : ''
                    }
                  >
                    {!isConfigured
                      ? t('setting.not-configured')
                      : t('setting.set-as-default')}
                  </Button>
                )}
              </div>
              {isConfigured ? (
                <div className="h-2 w-2 rounded-full bg-text-success" />
              ) : (
                <div className="h-2 w-2 rounded-full bg-text-label opacity-10" />
              )}
            </div>
          </div>
          {/* Model Endpoint URL Setting */}
          <div className="flex w-full flex-col items-center gap-4 px-6">
            <Input
              size="default"
              title={t('setting.model-endpoint-url')}
              state={localInputError ? 'error' : 'default'}
              value={currentEndpoint}
              onChange={(e) => {
                setLocalEndpoints((prev) => ({
                  ...prev,
                  [platform]: e.target.value,
                }));
                setLocalInputError(false);
                setLocalError(null);
                // Clear Ollama models error when endpoint changes
                if (platform === 'ollama') {
                  setOllamaModelsError(null);
                }
              }}
              disabled={!localEnabled}
              placeholder={
                platform === 'ollama'
                  ? 'http://localhost:11434/v1'
                  : platform === 'lmstudio'
                    ? 'http://localhost:1234/v1'
                    : 'http://localhost:8000/v1'
              }
              note={localError ?? undefined}
            />
            {platform === 'ollama' ? (
              <div className="flex w-full flex-col gap-1">
                <div className="flex w-full items-end gap-2">
                  <div className="flex-1">
                    <Select
                      value={currentType}
                      onValueChange={(v) =>
                        setLocalTypes((prev) => ({
                          ...prev,
                          [platform]: v,
                        }))
                      }
                      disabled={!localEnabled || ollamaModelsLoading}
                    >
                      <SelectTrigger
                        size="default"
                        title={t('setting.model-type')}
                        state={
                          localInputError || ollamaModelsError
                            ? 'error'
                            : undefined
                        }
                      >
                        <SelectValue
                          placeholder={
                            ollamaModelsLoading
                              ? 'Loading models...'
                              : 'Select model'
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {(() => {
                          const modelList =
                            currentType && !ollamaModels.includes(currentType)
                              ? [currentType, ...ollamaModels]
                              : [
                                  ...new Set([currentType, ...ollamaModels]),
                                ].filter(Boolean);
                          return modelList.length > 0 ? (
                            modelList.map((model) => (
                              <SelectItem key={model} value={model}>
                                {model}
                              </SelectItem>
                            ))
                          ) : (
                            <SelectItem value="_no_models" disabled>
                              No models found
                            </SelectItem>
                          );
                        })()}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      fetchOllamaModels(
                        currentEndpoint || DEFAULT_OLLAMA_ENDPOINT
                      )
                    }
                    disabled={!localEnabled || ollamaModelsLoading}
                    className="mb-1 flex-shrink-0"
                  >
                    {ollamaModelsLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {ollamaModelsError && (
                  <span className="text-label-sm text-text-error">
                    {ollamaModelsError}
                  </span>
                )}
              </div>
            ) : (
              <ModelTypeCombobox
                platform={platform}
                apiKey={undefined}
                apiUrl={currentEndpoint}
                value={currentType}
                onValueChange={(v) =>
                  setLocalTypes((prev) => ({
                    ...prev,
                    [platform]: v,
                  }))
                }
                placeholder={t('setting.enter-your-local-model-type')}
                disabled={!localEnabled}
                error={localInputError ? localError || undefined : undefined}
                title={t('setting.model-type')}
              />
            )}
          </div>
          {/* Action Button */}
          <div className="flex justify-end gap-2 px-6 py-4">
            <Button
              variant="ghost"
              size="sm"
              className="!text-text-label"
              onClick={handleLocalReset}
            >
              {t('setting.reset')}
            </Button>
            <Button
              onClick={handleLocalVerify}
              disabled={!localEnabled || localVerifying}
              variant="primary"
              size="sm"
            >
              <span className="text-text-inverse-primary">
                {localVerifying ? t('setting.configuring') : t('setting.save')}
              </span>
            </Button>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="m-auto flex h-auto w-full flex-1 flex-col">
      {/* Header Section */}
      <div className="sticky top-0 z-10 flex w-full items-center justify-between bg-surface-primary px-6 pb-6 pt-8">
        <div className="flex w-full flex-col items-start justify-between gap-4">
          <div className="flex flex-col">
            <div className="text-heading-sm font-bold text-text-heading">
              {t('setting.models')}
            </div>
          </div>
        </div>
      </div>
      {/* Content Section */}
      <div className="mb-8 flex flex-col gap-6">
        {/* Default Model Cascading Dropdown */}
        <div className="flex w-full flex-row items-center justify-between gap-4 rounded-2xl bg-surface-secondary px-6 py-4">
          <div className="flex w-full flex-col items-start justify-center gap-1">
            <div className="text-body-base font-bold text-text-heading">
              {t('setting.models-default-setting-title')}
            </div>
            <div className="text-body-sm">
              {t('setting.models-default-setting-description')}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-fit items-center justify-between gap-2 rounded-lg border-[0.5px] border-solid border-border-success bg-surface-success px-3 py-1 font-semibold text-text-success transition-colors hover:opacity-70 active:opacity-90">
                <span className="whitespace-nowrap text-body-sm">
                  {getDefaultModelDisplayText()}
                </span>
                <ChevronDown className="h-4 w-4 flex-shrink-0 text-text-success" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[180px]">
              {/* Cloud Category */}
              {import.meta.env.VITE_USE_LOCAL_PROXY !== 'true' && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="gap-2">
                    <img src={eigentImage} alt="Cloud" className="h-5 w-5" />
                    <span className="text-body-sm">
                      {t('setting.eigent-cloud')}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-[300px] w-[200px] overflow-y-auto">
                    {cloudModelOptions.map((model) => (
                      <DropdownMenuItem
                        key={model.id}
                        onClick={() =>
                          handleDefaultModelSelect('cloud', model.id)
                        }
                        className="flex items-center justify-between"
                      >
                        <span className="text-body-sm">{model.name}</span>
                        {cloudPrefer && cloud_model_type === model.id && (
                          <Check className="h-4 w-4 text-text-success" />
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}

              {/* Custom Model Category */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="gap-2">
                  <Key className="h-5 w-5 text-icon-primary" />
                  <span className="text-body-sm">
                    {t('setting.custom-model')}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-[440px] w-[220px] overflow-y-auto">
                  {items.map((item, idx) => {
                    const isConfigured = !!form[idx]?.provider_id;
                    const isPreferred = form[idx]?.prefer;
                    const modelImage = getModelImage(item.id);

                    return (
                      <DropdownMenuItem
                        key={item.id}
                        onClick={() =>
                          handleDefaultModelSelect('custom', item.id)
                        }
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          {modelImage ? (
                            <img
                              src={modelImage}
                              alt={item.name}
                              className="h-4 w-4"
                              style={
                                needsInvert(item.id)
                                  ? { filter: 'invert(1)' }
                                  : undefined
                              }
                            />
                          ) : (
                            <Key className="h-4 w-4 text-icon-secondary" />
                          )}
                          <span
                            className={`text-body-sm ${isConfigured ? 'text-text-body' : 'text-text-label'}`}
                          >
                            {item.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          {!isConfigured && (
                            <div className="h-2 w-2 rounded-full bg-text-label opacity-10" />
                          )}
                          {isPreferred && (
                            <Check className="h-4 w-4 text-text-success" />
                          )}
                          {isConfigured && !isPreferred && (
                            <div className="h-2 w-2 rounded-full bg-text-success" />
                          )}
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              {/* Local Host Category */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="gap-2">
                  <Server className="h-5 w-5 text-icon-primary" />
                  <span className="text-body-sm">
                    {t('setting.local-model')}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-[200px]">
                  {localModelOptions.map((model) => {
                    const isConfigured = !!localProviderIds[model.id];
                    const isPreferred =
                      localPrefer && localPlatform === model.id;
                    const modelImage = getModelImage(`local-${model.id}`);

                    return (
                      <DropdownMenuItem
                        key={model.id}
                        onClick={() =>
                          handleDefaultModelSelect('local', model.id)
                        }
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          {modelImage ? (
                            <img
                              src={modelImage}
                              alt={model.name}
                              className="h-4 w-4"
                              style={
                                needsInvert(`local-${model.id}`)
                                  ? { filter: 'invert(1)' }
                                  : undefined
                              }
                            />
                          ) : (
                            <Server className="h-4 w-4 text-icon-secondary" />
                          )}
                          <span
                            className={`text-body-sm ${isConfigured ? 'text-text-body' : 'text-text-label'}`}
                          >
                            {model.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          {!isConfigured && (
                            <div className="h-2 w-2 rounded-full bg-text-label opacity-10" />
                          )}
                          {isPreferred && (
                            <Check className="h-4 w-4 text-text-success" />
                          )}
                          {isConfigured && !isPreferred && (
                            <div className="h-2 w-2 rounded-full bg-text-success" />
                          )}
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Content Section with Sidebar */}
        <div className="flex w-full flex-col items-start justify-between gap-2 rounded-2xl bg-surface-secondary px-6 py-4">
          <div className="text-body-base sticky top-[86px] z-10 mb-2 w-full border-x-0 border-b-[0.5px] border-t-0 border-solid border-border-secondary bg-surface-secondary pb-4 font-bold text-text-heading">
            {t('setting.models-configuration')}
          </div>

          <div className="flex w-full flex-row items-start justify-between">
            {/* Sidebar */}
            <div className="-ml-2 mr-4 h-full w-[240px] rounded-2xl bg-surface-secondary">
              <div className="flex flex-col gap-4">
                {/* Eigent Cloud Section */}
                <div className="flex flex-col gap-1">
                  <div className="px-3 py-2 text-body-sm font-bold text-text-heading">
                    {t('setting.eigent-cloud')}
                  </div>
                  {import.meta.env.VITE_USE_LOCAL_PROXY !== 'true' &&
                    renderSidebarItem(
                      'cloud',
                      t('setting.eigent-cloud'),
                      'cloud',
                      selectedTab === 'cloud',
                      false,
                      cloudPrefer
                    )}
                </div>
                {/* Bring Your Own Key Section */}
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => setByokCollapsed(!byokCollapsed)}
                    className="flex items-center justify-between rounded-lg bg-transparent px-3 py-2 transition-colors hover:bg-surface-secondary"
                  >
                    <div className="text-body-sm font-bold text-text-heading">
                      {t('setting.custom-model')}
                    </div>
                    {byokCollapsed ? (
                      <ChevronDown className="h-4 w-4 text-text-label" />
                    ) : (
                      <ChevronUp className="h-4 w-4 text-text-label" />
                    )}
                  </button>
                  <div
                    className={`overflow-hidden transition-all duration-300 ease-in-out ${
                      byokCollapsed
                        ? 'max-h-0 opacity-0'
                        : 'max-h-[2000px] opacity-100'
                    }`}
                  >
                    {items.map((item, idx) =>
                      renderSidebarItem(
                        `byok-${item.id}` as SidebarTab,
                        item.name,
                        item.id,
                        selectedTab === `byok-${item.id}`,
                        true,
                        !!form[idx].provider_id
                      )
                    )}
                  </div>
                </div>

                {/* Local Model Section */}
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => setLocalCollapsed(!localCollapsed)}
                    className="flex items-center justify-between rounded-lg bg-transparent px-3 py-2 transition-colors hover:bg-surface-secondary"
                  >
                    <div className="text-body-sm font-bold text-text-heading">
                      {t('setting.local-model')}
                    </div>
                    {localCollapsed ? (
                      <ChevronDown className="h-4 w-4 text-text-label" />
                    ) : (
                      <ChevronUp className="h-4 w-4 text-text-label" />
                    )}
                  </button>
                  <div
                    className={`overflow-hidden transition-all duration-300 ease-in-out ${
                      localCollapsed
                        ? 'max-h-0 opacity-0'
                        : 'max-h-[2000px] opacity-100'
                    }`}
                  >
                    {renderSidebarItem(
                      'local-ollama',
                      'Ollama',
                      'local-ollama',
                      selectedTab === 'local-ollama',
                      true,
                      !!localProviderIds['ollama']
                    )}
                    {renderSidebarItem(
                      'local-vllm',
                      'vLLM',
                      'local-vllm',
                      selectedTab === 'local-vllm',
                      true,
                      !!localProviderIds['vllm']
                    )}
                    {renderSidebarItem(
                      'local-sglang',
                      'SGLang',
                      'local-sglang',
                      selectedTab === 'local-sglang',
                      true,
                      !!localProviderIds['sglang']
                    )}
                    {renderSidebarItem(
                      'local-lmstudio',
                      'LM Studio',
                      'local-lmstudio',
                      selectedTab === 'local-lmstudio',
                      true,
                      !!localProviderIds['lmstudio']
                    )}
                  </div>
                </div>
              </div>
            </div>
            {/* Main Content */}
            <div className="sticky top-[136px] z-10 min-w-0 flex-1">
              {renderContent()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
