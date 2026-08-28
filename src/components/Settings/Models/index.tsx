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
import { DefaultModelMenuItem } from '@/components/ModelSelection/DefaultModelMenuItem';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
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
import { Textarea } from '@/components/ui/textarea';
import { createHost } from '@/host/createHost';
import { SITE_URL } from '@/lib';
import { INIT_PROVODERS } from '@/lib/llm';
import {
  buildProviderConfig,
  formatModelConfigJson,
  parseModelConfigJson,
  splitProviderConfig,
} from '@/lib/modelConfig';
import { getProviderValid, toProviderValidStatus } from '@/lib/providerStatus';
import { isSearchConfigured } from '@/lib/searchConfig';
import { useAuthStore } from '@/store/authStore';
import { useCloudModelStore } from '@/store/cloudModelStore';
import { Provider } from '@/types';
import {
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
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import eigentImage from '@/assets/model/eigent.svg';
import {
  getModelImage,
  needsInvertModelImage,
} from '@/shared/modelProviderImages';

import {
  fetchProviderModels,
  loadCachedModels,
  saveCachedModels,
  type ProviderModelGroup,
} from '@/lib/providerModels';
import SettingsSection from '../SettingsSection';
import SettingsSectionPage from '../SettingsSectionPage';
import { ProviderModelCombobox } from './components/ProviderModelCombobox';
import { ConfigModelCard, type ConfigCardRingStatus } from './ConfigModelCard';
import {
  appendV1ToEndpoint,
  canAutoFixOllamaEndpoint,
  getDefaultLocalEndpoint,
  getLocalPlatformName,
  LLAMA_CPP_PROVIDER_ID,
  LMSTUDIO_PROVIDER_ID,
  LOCAL_MODEL_OPTIONS,
  OLLAMA_PROVIDER_ID,
  SGLANG_PROVIDER_ID,
  toEndpointBaseUrl,
  VLLM_PROVIDER_ID,
} from './localModels';

// Sidebar tab types
type SidebarTab =
  | 'cloud'
  | 'byok'
  | `byok-${string}`
  | 'local'
  | 'local-ollama'
  | 'local-vllm'
  | 'local-sglang'
  | 'local-lmstudio'
  | 'local-llama.cpp';

const PLAN_CREDITS_BY_KEY: Record<string, number> = {
  plus: 2000,
  pro: 10000,
};

export default function SettingModels() {
  const {
    modelType,
    cloud_model_type,
    codex_model_type,
    email,
    setModelType,
    setCloudModelType,
    setCodexModelType,
    appearance,
  } = useAuthStore();
  const _navigate = useNavigate();
  const { t } = useTranslation();
  const getValidateMessage = (res: any): string => {
    const msg =
      res?.message ??
      res?.detail?.message ??
      res?.detail?.error?.message ??
      res?.error?.message ??
      t('setting.validate-failed');
    return typeof msg === 'string' ? msg : JSON.stringify(msg);
  };
  const getProviderDescription = (provider: Provider) =>
    provider.id === 'aws-bedrock-converse'
      ? t('setting.aws-bedrock-converse-description')
      : t('setting.provider-configuration-description', {
          provider: provider.name,
        });
  const getExternalConfigName = (key: string, fallback: string) => {
    const translationKeyByField: Record<string, string> = {
      region_name: 'setting.region',
      aws_access_key_id: 'setting.access-key-id',
      aws_secret_access_key: 'setting.secret-access-key',
      aws_session_token: 'setting.session-token-optional',
      api_version: 'setting.api-version',
      azure_deployment_name: 'setting.deployment-name',
    };
    const translationKey = translationKeyByField[key];
    return translationKey ? t(translationKey) : fallback;
  };
  const [items, _setItems] = useState<Provider[]>(
    INIT_PROVODERS.filter((p) => p.id !== 'local')
  );
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const cloudModels = useCloudModelStore((state) => state.models);
  const fetchCloudModels = useCloudModelStore(
    (state) => state.fetchCloudModels
  );
  const getCloudModelDisplayName = useCloudModelStore(
    (state) => state.getModelDisplayName
  );
  const effectiveCloudModelId = useCloudModelStore((state) =>
    state.getEffectiveModelId(cloud_model_type)
  );
  const cloudModelOptions = cloudModels.map((model) => ({
    id: model.id,
    name: model.display_name,
  }));
  const [form, setForm] = useState(() =>
    INIT_PROVODERS.filter((p) => p.id !== 'local').map((p) => ({
      apiKey: p.apiKey,
      apiHost: p.apiHost,
      is_valid: p.is_valid ?? false,
      model_type: p.model_type ?? '',
      modelConfigJson: '',
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
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState<number | null>(null);
  const [configCardRing, setConfigCardRing] =
    useState<ConfigCardRingStatus>('idle');
  const configCardRingResetRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const showConfigCardRing = useCallback((status: ConfigCardRingStatus) => {
    if (configCardRingResetRef.current) {
      clearTimeout(configCardRingResetRef.current);
      configCardRingResetRef.current = null;
    }
    setConfigCardRing(status);
    if (status === 'success' || status === 'error') {
      configCardRingResetRef.current = setTimeout(() => {
        setConfigCardRing('idle');
        configCardRingResetRef.current = null;
      }, 1000);
    }
  }, []);
  const [errors, setErrors] = useState<
    {
      apiKey?: string;
      apiHost?: string;
      model_type?: string;
      modelConfigJson?: string;
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

  // Subscription sub-accordion state (nested inside Custom Model)
  const [subscriptionCollapsed, setSubscriptionCollapsed] = useState(false);

  // BYOK (API key) sub-accordion state (nested inside Custom Model)
  const [byokGroupCollapsed, setByokGroupCollapsed] = useState(false);

  // Local Model accordion state
  const [localCollapsed, setLocalCollapsed] = useState(false);

  // Cloud Model
  const [cloudPrefer, setCloudPrefer] = useState(false);
  const [codexBusy, setCodexBusy] = useState(false);
  const [codexStatus, setCodexStatus] = useState<{
    connected: boolean;
    status: string;
    account_label?: string | null;
    expires_at?: string | null;
    last_error_code?: string | null;
  }>({ connected: false, status: 'not_connected' });

  // Local Model independent state - per platform
  const [localEnabled, setLocalEnabled] = useState(true);
  const [localPlatform, setLocalPlatform] =
    useState<string>(OLLAMA_PROVIDER_ID);
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

  // Per-platform model list state: { models, loading, error } keyed by platform ID.
  const [platformModelState, setPlatformModelState] = useState<
    Record<string, { models: string[]; loading: boolean; error: string | null }>
  >({});
  const [ollamaEndpointAutoFixedOnce, setOllamaEndpointAutoFixedOnce] =
    useState(false);

  // Per-cloud-provider model list state: { groups, loading, error } keyed by
  // provider id. Populated for providers whose `INIT_PROVODERS` entry declares
  // a `modelsEndpoint`.
  const [cloudModelsState, setCloudModelsState] = useState<
    Record<
      string,
      { groups: ProviderModelGroup[]; loading: boolean; error: string | null }
    >
  >(() => {
    const initial: Record<
      string,
      { groups: ProviderModelGroup[]; loading: boolean; error: string | null }
    > = {};
    for (const p of INIT_PROVODERS) {
      if (!p.modelsEndpoint) continue;
      const cached = loadCachedModels(p.id);
      if (cached) {
        initial[p.id] = { groups: cached, loading: false, error: null };
      }
    }
    return initial;
  });

  const fetchCloudProviderModels = useCallback(
    async (idx: number) => {
      const item = items[idx];
      if (!item?.modelsEndpoint) return;
      const apiKey = form[idx]?.apiKey;
      const apiHost = form[idx]?.apiHost || item.apiHost;
      if (!apiKey) return;
      setCloudModelsState((prev) => ({
        ...prev,
        [item.id]: {
          groups: prev[item.id]?.groups || [],
          loading: true,
          error: null,
        },
      }));
      try {
        const groups = await fetchProviderModels(
          apiHost,
          item.modelsEndpoint,
          apiKey
        );
        setCloudModelsState((prev) => ({
          ...prev,
          [item.id]: { groups, loading: false, error: null },
        }));
        saveCachedModels(item.id, groups);
      } catch (err: any) {
        setCloudModelsState((prev) => ({
          ...prev,
          [item.id]: {
            groups: prev[item.id]?.groups || [],
            loading: false,
            error:
              typeof err?.message === 'string'
                ? err.message
                : t('setting.failed-to-fetch-models'),
          },
        }));
      }
    },
    [items, form, t]
  );

  // Generic model fetcher driven by LOCAL_MODEL_OPTIONS config.
  // Only fetches for providers that define fetchPath and parseModels.
  const fetchModelsForPlatform = useCallback(
    async (platform: string, endpoint?: string) => {
      const option = LOCAL_MODEL_OPTIONS.find((m) => m.id === platform);
      if (!option?.fetchPath || !option?.parseModels) return;

      const url = endpoint || option.defaultEndpoint;
      setPlatformModelState((prev) => ({
        ...prev,
        [platform]: {
          models: prev[platform]?.models || [],
          loading: true,
          error: null,
        },
      }));
      try {
        const baseUrl = toEndpointBaseUrl(url);
        const response = await fetch(`${baseUrl}${option.fetchPath}`);
        if (!response.ok) throw new Error(`Failed: ${response.status}`);

        const data = await response.json();
        const modelNames = option.parseModels(data);
        setPlatformModelState((prev) => ({
          ...prev,
          [platform]: { models: modelNames, loading: false, error: null },
        }));
      } catch (error: any) {
        console.error(`Failed to fetch ${option.name} models:`, error);
        setPlatformModelState((prev) => ({
          ...prev,
          [platform]: {
            models: [],
            loading: false,
            error: t('setting.failed-to-fetch-provider-models', {
              provider: option.name,
            }),
          },
        }));
      }
    },
    [t]
  );

  const clearPlatformModelsError = useCallback((platform: string) => {
    setPlatformModelState((prev) => {
      const current = prev[platform];
      if (!current || !current.error) return prev;
      return { ...prev, [platform]: { ...current, error: null } };
    });
  }, []);

  const checkLlamaCppHealth = useCallback(
    async (endpoint: string) => {
      const baseUrl = toEndpointBaseUrl(endpoint);
      const response = await fetch(`${baseUrl}/v1/health`);
      if (!response.ok) {
        throw new Error(t('setting.llama-health-check-failed'));
      }
    },
    [t]
  );

  // Default model dropdown state (removed - using DropdownMenu's built-in state)

  // Pending model to set as default after configuration
  const [pendingDefaultModel, setPendingDefaultModel] = useState<{
    category: 'cloud' | 'custom' | 'local';
    modelId: string;
  } | null>(null);

  // Load provider list and populate form
  useEffect(() => {
    let isActive = true;
    setProvidersLoading(true);
    setProvidersError(null);

    (async () => {
      try {
        const res = await proxyFetchGet('/api/v1/providers');
        if (!isActive) return;
        const providerList = Array.isArray(res) ? res : res.items || [];
        const hydratedModelType = useAuthStore.getState().modelType;
        const customProviderCanBePreferred = ![
          'cloud',
          'local',
          'codex_subscription',
        ].includes(hydratedModelType);

        // Handle custom models
        setForm((f) =>
          f.map((fi, idx) => {
            const item = items[idx];
            const found = providerList.find(
              (p: any) => p.provider_name === item.id
            );
            if (found) {
              const { modelConfigDict } = splitProviderConfig(
                found.encrypted_config
              );
              return {
                ...fi,
                provider_id: found.id,
                apiKey: found.api_key || '',
                // Fall back to provider's default API host if endpoint_url is empty
                apiHost: found.endpoint_url || item.apiHost,
                is_valid: getProviderValid(found),
                prefer: customProviderCanBePreferred && (found.prefer ?? false),
                model_type: found.model_type ?? '',
                modelConfigJson:
                  Object.keys(modelConfigDict).length > 0
                    ? formatModelConfigJson(modelConfigDict)
                    : '',
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
          LOCAL_MODEL_OPTIONS.some((model) => model.id === p.provider_name)
        );

        const endpoints: Record<string, string> = {};
        const types: Record<string, string> = {};
        const providerIds: Record<string, number | undefined> = {};

        localProviders.forEach((local: any) => {
          const platform =
            local.encrypted_config?.model_platform || local.provider_name;
          // Auto-populate platform default endpoint if not set
          endpoints[platform] =
            local.endpoint_url || getDefaultLocalEndpoint(platform);
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

        // If no local providers found, initialize empty state with Ollama default
        if (localProviders.length === 0) {
          LOCAL_MODEL_OPTIONS.forEach((model) => {
            endpoints[model.id] = getDefaultLocalEndpoint(model.id);
            types[model.id] = '';
            providerIds[model.id] = undefined;
          });
          setLocalEndpoints(endpoints);
          setLocalTypes(types);
          setLocalProviderIds(providerIds);
        }

        if (hydratedModelType === 'cloud') {
          setCloudPrefer(true);
          setLocalPrefer(false);
        } else if (hydratedModelType === 'local') {
          setCloudPrefer(false);
          setLocalPrefer(true);
          setLocalEnabled(true);
        } else if (hydratedModelType === 'codex_subscription') {
          setCloudPrefer(false);
          setLocalPrefer(false);
        }
      } catch (e) {
        console.error('Error fetching providers:', e);
        if (isActive) {
          setProvidersError(
            e instanceof Error
              ? e.message
              : t('setting.failed-to-load-model-providers')
          );
        }
      } finally {
        if (isActive) setProvidersLoading(false);
      }
    })();

    if (import.meta.env.VITE_USE_LOCAL_PROXY !== 'true') {
      fetchSubscription();
      updateCredits();
    }
    return () => {
      isActive = false;
    };
  }, [items, t]);

  useEffect(() => {
    if (modelType === 'cloud') {
      setCloudPrefer(true);
      setForm((current) =>
        current.some((entry) => entry.prefer)
          ? current.map((entry) => ({ ...entry, prefer: false }))
          : current
      );
      setLocalPrefer(false);
      return;
    }
    if (modelType === 'local') {
      setLocalEnabled(true);
      setForm((current) =>
        current.some((entry) => entry.prefer)
          ? current.map((entry) => ({ ...entry, prefer: false }))
          : current
      );
      setLocalPrefer(true);
      setCloudPrefer(false);
      return;
    }
    if (modelType === 'codex_subscription') {
      setForm((current) =>
        current.some((entry) => entry.prefer)
          ? current.map((entry) => ({ ...entry, prefer: false }))
          : current
      );
      setLocalPrefer(false);
      setCloudPrefer(false);
      return;
    }
    setLocalPrefer(false);
    setCloudPrefer(false);
  }, [modelType]);

  useEffect(
    () => () => {
      if (configCardRingResetRef.current) {
        clearTimeout(configCardRingResetRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (import.meta.env.VITE_USE_LOCAL_PROXY === 'true') return;
    void fetchCloudModels();
  }, [fetchCloudModels]);

  // Get current default model display text
  const getDefaultModelDisplayText = (): string => {
    if (cloudPrefer) {
      const modelName = getCloudModelDisplayName(cloud_model_type);
      return `${t('setting.eigent-cloud')} / ${modelName}`;
    }

    if (modelType === 'codex_subscription') {
      return `${t('setting.custom-model')} / Codex Subscription${
        codex_model_type ? ` (${codex_model_type})` : ''
      }`;
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
      const platformName = getLocalPlatformName(localPlatform);
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
      if (idx !== -1 && items[idx].authMode === 'oauth_subscription') {
        return codexStatus.connected;
      }
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
        // Expand the relevant Custom Model sub-accordion if collapsed
        const target = items.find((item) => item.id === modelId);
        if (target?.authMode === 'oauth_subscription') {
          setSubscriptionCollapsed(false);
        } else {
          setByokGroupCollapsed(false);
        }
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
        setCloudModelType(modelId);
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

  const handleVerify = async (idx: number) => {
    const {
      apiKey,
      apiHost,
      externalConfig,
      model_type,
      modelConfigJson,
      provider_id,
    } = form[idx];
    let hasError = false;
    let modelConfigDict: Record<string, unknown> = {};
    const newErrors = [...errors];
    if (items[idx].id !== 'local' && items[idx].id !== 'aws-bedrock-converse') {
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
    try {
      modelConfigDict = parseModelConfigJson(modelConfigJson);
      newErrors[idx].modelConfigJson = '';
    } catch {
      newErrors[idx].modelConfigJson = t(
        'setting.model-parameters-must-be-valid-json-object'
      );
      hasError = true;
    }
    setErrors(newErrors);
    if (hasError) {
      showConfigCardRing('error');
      return;
    }

    showConfigCardRing('configuring');
    setLoading(idx);
    const item = items[idx];
    const external: Record<string, unknown> = {};
    if (externalConfig) {
      externalConfig.forEach((item) => {
        external[item.key] = item.value;
      });
    }

    setForm((currentForm) =>
      currentForm.map((entry, entryIdx) =>
        entryIdx === idx
          ? {
              ...entry,
              modelConfigJson:
                Object.keys(modelConfigDict).length > 0
                  ? formatModelConfigJson(modelConfigDict)
                  : '',
            }
          : entry
      )
    );

    try {
      const res = await fetchPost('/model/validate', {
        model_platform: item.id,
        model_type: form[idx].model_type,
        api_key: form[idx].apiKey || null,
        url: form[idx].apiHost,
        model_config_dict: modelConfigDict,
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
        showConfigCardRing('error');
        setLoading(null);
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
      showConfigCardRing('error');
      setLoading(null);
      return;
    }

    const data: any = {
      provider_name: item.id,
      api_key: form[idx].apiKey,
      endpoint_url: form[idx].apiHost,
      is_valid: toProviderValidStatus(true),
      model_type: form[idx].model_type,
      encrypted_config: buildProviderConfig(external, modelConfigDict),
    };
    try {
      if (provider_id) {
        await proxyFetchPut(`/api/v1/provider/${provider_id}`, data);
      } else {
        await proxyFetchPost('/api/v1/provider', data);
      }
      // add: refresh provider list after saving, update form and switch editable status
      const res = await proxyFetchGet('/api/v1/providers');
      const providerList = Array.isArray(res) ? res : res.items || [];
      setForm((f) =>
        f.map((fi, i) => {
          const item = items[i];
          const found = providerList.find(
            (p: any) => p.provider_name === item.id
          );
          if (found) {
            const { modelConfigDict } = splitProviderConfig(
              found.encrypted_config
            );
            return {
              ...fi,
              provider_id: found.id,
              apiKey: found.api_key || '',
              // Fall back to provider's default API host if endpoint_url is empty
              apiHost: found.endpoint_url || item.apiHost,
              is_valid: getProviderValid(found),
              prefer: found.prefer ?? false,
              model_type: found.model_type ?? fi.model_type ?? '',
              modelConfigJson:
                Object.keys(modelConfigDict).length > 0
                  ? formatModelConfigJson(modelConfigDict)
                  : '',
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
      showConfigCardRing('success');
    } catch (e) {
      console.error('Error saving provider:', e);
      showConfigCardRing('error');
    } finally {
      setLoading(null);
    }
  };

  const handleLocalVerify = async () => {
    showConfigCardRing('configuring');
    setLocalVerifying(true);
    setLocalError(null);
    setLocalInputError(false);
    let currentEndpoint = localEndpoints[localPlatform] || '';
    const currentType = localTypes[localPlatform] || '';

    // Fallback guard for fast save interactions: ensure one-time auto-fix
    // still applies even if blur state hasn't committed yet.
    if (
      localPlatform === OLLAMA_PROVIDER_ID &&
      !ollamaEndpointAutoFixedOnce &&
      canAutoFixOllamaEndpoint(currentEndpoint)
    ) {
      const fixedEndpoint = appendV1ToEndpoint(currentEndpoint);
      currentEndpoint = fixedEndpoint;
      setLocalEndpoints((prev) => ({
        ...prev,
        [localPlatform]: fixedEndpoint,
      }));
      setOllamaEndpointAutoFixedOnce(true);
    }

    if (!currentEndpoint) {
      setLocalError(t('setting.endpoint-url-can-not-be-empty'));
      setLocalInputError(true);
      setLocalVerifying(false);
      showConfigCardRing('error');
      return;
    }
    if (!currentType) {
      setLocalError(t('setting.model-type-can-not-be-empty'));
      setLocalInputError(true);
      setLocalVerifying(false);
      showConfigCardRing('error');
      return;
    }
    try {
      if (localPlatform === LLAMA_CPP_PROVIDER_ID) {
        await checkLlamaCppHealth(currentEndpoint);
      }

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

      // Temporary: skip /model/validate for llama.cpp.
      // Current validation flow is not fully compatible.
      if (localPlatform !== LLAMA_CPP_PROVIDER_ID) {
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

            showConfigCardRing('error');
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
          showConfigCardRing('error');
          return;
        }
      }

      // 2. Save to /api/provider/ (save only base URL)
      const currentProviderId = localProviderIds[localPlatform];
      const data: any = {
        provider_name: localPlatform,
        api_key: 'not-required',
        endpoint_url: currentEndpoint, // Save base URL without specific endpoints
        is_valid: toProviderValidStatus(true),
        model_type: currentType,
        encrypted_config: {
          model_platform: localPlatform,
          model_type: currentType,
        },
      };

      // Update or create provider
      if (currentProviderId) {
        await proxyFetchPut(`/api/v1/provider/${currentProviderId}`, data);
      } else {
        await proxyFetchPost('/api/v1/provider', data);
      }

      setLocalError(null);
      setLocalInputError(false);
      // add: refresh provider list after saving, update localProviderIds and localPrefer
      const res = await proxyFetchGet('/api/v1/providers');
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

      await fetchModelsForPlatform(localPlatform, currentEndpoint);
      showConfigCardRing('success');
    } catch (e: any) {
      setLocalError(
        e.message || t('setting.verification-failed-please-check-endpoint-url')
      );
      setLocalInputError(true);
      showConfigCardRing('error');
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

  useEffect(() => {
    if (!selectedTab.startsWith('local-')) return;
    const platform = selectedTab.replace('local-', '');
    const option = LOCAL_MODEL_OPTIONS.find((item) => item.id === platform);
    if (!option?.fetchPath || platformModelState[platform]) return;
    void fetchModelsForPlatform(
      platform,
      localEndpoints[platform] || option.defaultEndpoint
    );
  }, [fetchModelsForPlatform, localEndpoints, platformModelState, selectedTab]);

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
      await proxyFetchPost('/api/v1/provider/prefer', {
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
      await proxyFetchPost('/api/v1/provider/prefer', {
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
        await proxyFetchDelete(`/api/v1/provider/${currentProviderId}`);
      }
      // Set endpoint to platform default
      const defaultEndpoint = getDefaultLocalEndpoint(localPlatform);
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
      // Re-fetch model list after reset
      if (localPlatform === OLLAMA_PROVIDER_ID) {
        setOllamaEndpointAutoFixedOnce(false);
      }
      clearPlatformModelsError(localPlatform);
      await fetchModelsForPlatform(localPlatform);
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
        await proxyFetchDelete(`/api/v1/provider/${provider_id}`);
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
            modelConfigJson: '',
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
          i === idx
            ? ({
                apiKey: '',
                apiHost: '',
                model_type: '',
                modelConfigJson: '',
              } as any)
            : er
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
    const configsRes = await proxyFetchGet('/api/v1/configs');
    const configs = Array.isArray(configsRes) ? configsRes : [];
    return isSearchConfigured(configs);
  };

  const [subscription, setSubscription] = useState<any>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(
    import.meta.env.VITE_USE_LOCAL_PROXY !== 'true'
  );
  const [trialUpgradeDialogOpen, setTrialUpgradeDialogOpen] = useState(false);
  const [upgradingTrial, setUpgradingTrial] = useState(false);
  const fetchSubscription = async () => {
    setSubscriptionLoading(true);
    try {
      const res = await proxyFetchGet('/api/v1/subscription');
      console.log(res);
      if (res) {
        setSubscription(res);
      }
    } catch (error) {
      console.error('Failed to load subscription:', error);
    } finally {
      setSubscriptionLoading(false);
    }
  };
  const [credits, setCredits] = useState<any>(0);
  const [loadingCredits, setLoadingCredits] = useState(
    import.meta.env.VITE_USE_LOCAL_PROXY !== 'true'
  );
  // True when the credits request failed (treated as "server not connected").
  const [creditsError, setCreditsError] = useState(false);
  const updateCredits = async () => {
    try {
      setLoadingCredits(true);
      const res = await proxyFetchGet(`/api/v1/user/current_credits`);
      console.log(res?.credits);
      setCredits(res?.credits);
      setCreditsError(false);
    } catch (error) {
      console.error(error);
      setCreditsError(true);
    } finally {
      setLoadingCredits(false);
    }
  };

  const formatCredits = (value: unknown): string => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return String(value ?? 0);
    }
    return new Intl.NumberFormat().format(numericValue);
  };

  const getPlanKey = () =>
    typeof subscription?.plan_key === 'string'
      ? subscription.plan_key.toLowerCase()
      : '';

  const getPlanName = () => {
    const planKey = getPlanKey();
    if (!planKey) {
      return '';
    }
    return planKey.charAt(0).toUpperCase() + planKey.slice(1);
  };

  const getSelectedPlanCredits = () => {
    const planKey = getPlanKey();
    const monthlyCredits = Number(subscription?.monthly_credits);
    return (
      PLAN_CREDITS_BY_KEY[planKey] ??
      (Number.isFinite(monthlyCredits) ? monthlyCredits : 0)
    );
  };

  const handleTrialUpgrade = async () => {
    try {
      setUpgradingTrial(true);
      await proxyFetchPost('/api/v1/upgrade-trial-to-paid');
      toast.success(
        t('setting.trial-upgrade-success', {
          defaultValue: 'Your full plan credits are unlocked.',
        })
      );
      setTrialUpgradeDialogOpen(false);
      await Promise.all([fetchSubscription(), updateCredits()]);
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      const recoveryUrl =
        detail && typeof detail === 'object' ? detail.recovery_url : undefined;
      const message =
        detail && typeof detail === 'object'
          ? detail.message
          : detail || error?.message;

      if (recoveryUrl) {
        window.location.href = recoveryUrl;
        return;
      }

      toast.error(
        message ||
          t('setting.trial-upgrade-failed', {
            defaultValue: 'Upgrade failed. Please try again.',
          })
      );
    } finally {
      setUpgradingTrial(false);
    }
  };

  const needsInvert = (modelId: string | null): boolean =>
    needsInvertModelImage(modelId, appearance);

  // Helper to render sidebar tab item
  const renderSidebarItem = (
    tabId: SidebarTab,
    label: string,
    modelId: string | null,
    isActive: boolean,
    isSubItem: boolean = false,
    isConfigured: boolean = false,
    // When provided, renders a connection dot with this tone (overrides the
    // default binary "configured" green dot). `null` renders no dot.
    dotTone?: 'success' | 'error' | 'muted' | null
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
        className={`flex w-full items-center justify-between rounded-xl px-3 py-2 transition-colors duration-200 ${isSubItem ? 'pl-3' : ''} ${
          isActive
            ? 'bg-ds-neutral-subtle-default hover:bg-ds-neutral-subtle-default'
            : 'bg-transparent hover:bg-ds-neutral-subtle-hover'
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
            <span
              className={
                isActive
                  ? 'text-ds-ink-default-default'
                  : 'text-ds-ink-muted-default'
              }
            >
              {fallbackIcon}
            </span>
          )}
          <span
            className={`text-ds-text-base font-medium ${isActive ? 'text-ds-ink-default-default' : 'text-ds-ink-muted-default'}`}
          >
            {label}
          </span>
        </div>
        {dotTone !== undefined
          ? dotTone && (
              <div
                className={`m-1 h-2 w-2 shrink-0 rounded-full ${
                  dotTone === 'success'
                    ? 'bg-ds-text-success-default-default'
                    : dotTone === 'error'
                      ? 'bg-ds-text-error-default-default'
                      : 'bg-ds-text-neutral-default-default opacity-10'
                }`}
              />
            )
          : isConfigured && (
              <div className="m-1 h-2 w-2 shrink-0 rounded-full bg-ds-text-success-default-default" />
            )}
      </button>
    );
  };

  const refreshCodexStatus = useCallback(async () => {
    if (!email) {
      setCodexStatus({ connected: false, status: 'not_connected' });
      return;
    }
    try {
      const status =
        await createHost().electronAPI?.codexSubscriptionStatus?.(email);
      setCodexStatus(status || { connected: false, status: 'not_connected' });
    } catch (error) {
      console.error('Failed to load Codex subscription status:', error);
      setCodexStatus({
        connected: false,
        status: 'error',
        last_error_code: 'status_unavailable',
      });
    }
  }, [email]);

  useEffect(() => {
    refreshCodexStatus();
  }, [refreshCodexStatus]);

  const codexAuthErrorMessage = useCallback(
    (code?: string | null): string => {
      switch (code) {
        case 'oauth_callback_port_in_use':
          return t('setting.codex-port-in-use', {
            defaultValue:
              'The Codex sign-in port (1455) is in use. Close other Codex/ChatGPT CLI sessions or another Eigent window, then try again.',
          });
        case 'oauth_callback_unavailable':
          return t('setting.codex-callback-unavailable', {
            defaultValue:
              'Could not start the local sign-in listener. Please try again.',
          });
        case 'oauth_open_browser_failed':
          return t('setting.codex-open-browser-failed', {
            defaultValue: 'Could not open your browser for sign-in.',
          });
        case 'oauth_state_expired':
          return t('setting.codex-state-expired', {
            defaultValue: 'Sign-in took too long. Please try again.',
          });
        case 'oauth_state_mismatch':
          return t('setting.codex-state-mismatch', {
            defaultValue: 'Sign-in could not be verified. Please try again.',
          });
        case 'access_denied':
          return t('setting.codex-access-denied', {
            defaultValue: 'Sign-in was cancelled.',
          });
        default:
          return t('setting.codex-login-failed', {
            defaultValue: 'Codex sign-in failed. Please try again.',
          });
      }
    },
    [t]
  );

  useEffect(() => {
    const ipcRenderer = createHost().ipcRenderer;
    if (!ipcRenderer?.on || !ipcRenderer?.off) return;
    const listener = (_event?: unknown, payload?: { error_code?: string }) => {
      if (payload?.error_code) {
        toast.error(codexAuthErrorMessage(payload.error_code));
      }
      refreshCodexStatus();
    };
    ipcRenderer.on('subscription-auth:codex-status-changed', listener);
    return () => {
      ipcRenderer.off('subscription-auth:codex-status-changed', listener);
    };
  }, [refreshCodexStatus, codexAuthErrorMessage]);

  const handleCodexLogin = async () => {
    if (!email) {
      toast.error(
        t('setting.login-required', { defaultValue: 'Please sign in first.' })
      );
      return;
    }

    try {
      setCodexBusy(true);
      const result =
        await createHost().electronAPI?.codexSubscriptionLogin?.(email);
      if (!result?.success) {
        throw new Error(result?.error || result?.error_code || 'login_failed');
      }
      await refreshCodexStatus();
    } catch (error: any) {
      console.error('Failed to start Codex subscription login:', error);
      toast.error(codexAuthErrorMessage(error?.message));
    } finally {
      setCodexBusy(false);
    }
  };

  const handleCodexDisconnect = async () => {
    if (!email) return;
    try {
      setCodexBusy(true);
      const result =
        await createHost().electronAPI?.codexSubscriptionDisconnect?.(email);
      if (!result?.success) {
        throw new Error(
          result?.error || result?.error_code || 'disconnect_failed'
        );
      }
      await refreshCodexStatus();
      if (modelType === 'codex_subscription') {
        setModelType('cloud');
      }
      toast.success(
        t('setting.codex-disconnected', {
          defaultValue: 'Codex subscription disconnected.',
        })
      );
    } catch (error: any) {
      console.error('Failed to disconnect Codex subscription:', error);
      toast.error(error?.message || t('setting.reset-failed'));
    } finally {
      setCodexBusy(false);
    }
  };

  const handleCodexSetDefault = () => {
    setCloudPrefer(false);
    setLocalPrefer(false);
    setForm((f) => f.map((fi) => ({ ...fi, prefer: false })));
    setModelType('codex_subscription');
  };

  // Render content based on selected tab
  const renderContent = () => {
    // Cloud version content
    if (selectedTab === 'cloud') {
      if (import.meta.env.VITE_USE_LOCAL_PROXY === 'true') {
        return (
          <div className="flex h-64 items-center justify-center text-ds-ink-muted-default">
            {t('setting.cloud-not-available-in-local-proxy')}
          </div>
        );
      }
      const isTrialing = Boolean(subscription?.is_trialing);
      const selectedPlanCredits = getSelectedPlanCredits();
      const trialDailyLimit =
        Number(subscription?.trial_daily_credits_limit) || 300;
      const trialTotalLimit =
        Number(subscription?.trial_total_credits_limit) || 1000;
      return (
        <div className="flex w-full flex-col rounded-2xl bg-ds-neutral-subtle-default">
          <div className="mx-6 mb-4 flex flex-col justify-start self-stretch border-x-0 border-t-0 border-b-[0.5px] border-solid border-ds-hairline-default-default pt-2 pb-4">
            <div className="inline-flex items-center justify-start gap-2 self-stretch">
              <div className="my-2 flex-1 justify-center text-ds-text-base font-bold text-ds-ink-default-default">
                {t('setting.eigent-cloud')}
              </div>
              <div className="flex items-center gap-2">
                {cloudPrefer ? (
                  <Button
                    variant="primary"
                    tone="success"
                    size="xs"
                    buttonContent="text"
                    textWeight="bold"
                    buttonRadius="full"
                    disabled
                  >
                    {t('setting.default')}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    tone="neutral"
                    size="xs"
                    buttonContent="text"
                    textWeight="bold"
                    buttonRadius="full"
                    className="!text-ds-ink-muted-default"
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
                {/* Connection dot: green = connected with credits,
                    grey = server not connected, error = out of credits. */}
                {loadingCredits ? (
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin text-ds-ink-muted-default motion-reduce:animate-none"
                    aria-hidden
                  />
                ) : (
                  <div
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      creditsError
                        ? 'bg-ds-text-neutral-default-default opacity-10'
                        : Number(credits) > 0
                          ? 'bg-ds-text-success-default-default'
                          : 'bg-ds-text-error-default-default'
                    }`}
                  />
                )}
              </div>
            </div>
            <div className="justify-center self-stretch">
              {subscriptionLoading ? (
                <span
                  role="status"
                  aria-live="polite"
                  className="inline-flex items-center gap-2 text-ds-text-base text-ds-ink-muted-default"
                >
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                    aria-hidden
                  />
                  {t('setting.loading', {
                    defaultValue: 'Loading subscription',
                  })}
                </span>
              ) : (
                <>
                  <span className="text-ds-text-base text-ds-ink-muted-default">
                    {t('setting.you-are-currently-subscribed-to-the')}{' '}
                    {getPlanName()}. {t('setting.discover-more-about-our')}{' '}
                  </span>
                  <span
                    onClick={() => {
                      window.location.href = `${SITE_URL}/pricing`;
                    }}
                    className="cursor-pointer text-ds-text-base text-ds-ink-muted-default underline"
                  >
                    {t('setting.pricing-options')}
                  </span>
                  <span className="text-ds-text-base font-normal text-ds-ink-default-default">
                    .
                  </span>
                </>
              )}
            </div>
          </div>
          {/*Content Area*/}
          <div className="flex w-full flex-row items-center justify-between gap-4 px-6 pb-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-1 !text-ds-text-base text-ds-ink-default-default">
                <span>{t('setting.credits')}:</span>
                {loadingCredits ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <span>{formatCredits(credits)}</span>
                )}
              </div>
              {isTrialing && (
                <span className="block max-w-[560px] !text-ds-text-base leading-5 text-ds-ink-muted-default">
                  {t('setting.trial-plan-notice-before-upgrade', {
                    defaultValue:
                      "You're on a trial. Your {{planName}} plan includes {{planCredits}} credits; the trial unlocks {{daily}} credits/day (up to {{total}}) before you upgrade.",
                    planName: getPlanName(),
                    planCredits: formatCredits(selectedPlanCredits),
                    daily: formatCredits(trialDailyLimit),
                    total: formatCredits(trialTotalLimit),
                  })}{' '}
                  <button
                    type="button"
                    onClick={() => setTrialUpgradeDialogOpen(true)}
                    className="cursor-pointer border-x-0 border-y-0 border-solid bg-transparent p-0 !text-ds-text-base font-medium text-ds-ink-default-default underline"
                  >
                    {t('setting.upgrade', { defaultValue: 'Upgrade' })}
                  </button>{' '}
                  {t('setting.trial-plan-notice-after-upgrade', {
                    defaultValue:
                      'anytime to unlock the full plan credits and get the most out of your plan.',
                  })}
                </span>
              )}
            </div>
            <Button
              onClick={() => {
                window.location.href = `${SITE_URL}/dashboard`;
              }}
              variant="primary"
              tone="neutral"
              size="sm"
              buttonContent="text"
              textWeight="bold"
              buttonRadius="full"
            >
              {subscriptionLoading ? (
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                getPlanName()
              )}
              <Settings />
            </Button>
          </div>
          <Dialog
            open={trialUpgradeDialogOpen}
            onOpenChange={setTrialUpgradeDialogOpen}
          >
            <DialogContent
              size="sm"
              overlayVariant="dark"
              onClose={() => setTrialUpgradeDialogOpen(false)}
            >
              <DialogHeader
                title={t('setting.trial-upgrade-title', {
                  defaultValue: 'Upgrade plan',
                })}
              />
              <DialogContentSection className="px-4 py-4">
                <span className="block !text-ds-text-base text-ds-ink-default-default">
                  {t('setting.trial-upgrade-body', {
                    defaultValue:
                      'Upgrade now to unlock full credits instantly.',
                  })}
                </span>
              </DialogContentSection>
              <DialogFooter
                showCancelButton
                showConfirmButton
                cancelButtonText={t('setting.not-now', {
                  defaultValue: 'Not Now',
                })}
                confirmButtonText={
                  upgradingTrial
                    ? t('setting.upgrading', { defaultValue: 'Upgrading...' })
                    : t('setting.upgrade', { defaultValue: 'Upgrade' })
                }
                onCancel={() => setTrialUpgradeDialogOpen(false)}
                onConfirm={handleTrialUpgrade}
                confirmButtonDisabled={upgradingTrial}
                cancelButtonDisabled={upgradingTrial}
              />
            </DialogContent>
          </Dialog>
          <div className="flex w-full flex-1 items-center justify-between px-6 pb-4">
            <div className="flex min-w-0 flex-1 items-center">
              <span className="overflow-hidden text-ds-text-base text-ellipsis whitespace-nowrap">
                {t('setting.select-model-type')}
              </span>
            </div>
            <div className="ml-4 shrink-0">
              <Select
                value={effectiveCloudModelId ?? cloud_model_type}
                onValueChange={setCloudModelType}
              >
                <SelectTrigger size="sm">
                  <SelectValue placeholder={t('setting.select-model-type')} />
                </SelectTrigger>
                <SelectContent>
                  {cloudModelOptions.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name}
                    </SelectItem>
                  ))}
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
      const isSubscriptionAuth = item.authMode === 'oauth_subscription';
      const canSwitch = !!form[idx].provider_id && !isSubscriptionAuth;

      if (isSubscriptionAuth) {
        const isConnected = codexStatus.connected;
        const isDefault = modelType === 'codex_subscription';

        return (
          <ConfigModelCard status={configCardRing}>
            <div className="mx-6 mb-4 flex flex-col items-start justify-between border-x-0 border-t-0 border-b-[0.5px] border-solid border-ds-hairline-default-default pt-2 pb-4">
              <div className="inline-flex items-center justify-between gap-2 self-stretch">
                <div className="my-2 text-ds-text-base font-bold text-ds-ink-default-default">
                  {item.name}
                </div>
                <div className="flex items-center gap-2">
                  {isConnected ? (
                    isDefault ? (
                      <Button
                        variant="primary"
                        tone="success"
                        size="xs"
                        buttonContent="text"
                        textWeight="bold"
                        buttonRadius="full"
                        disabled
                      >
                        {t('setting.default')}
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        tone="neutral"
                        size="xs"
                        buttonContent="text"
                        textWeight="bold"
                        buttonRadius="full"
                        className="!text-ds-ink-muted-default"
                        disabled={codexBusy}
                        onClick={handleCodexSetDefault}
                      >
                        {t('setting.set-as-default')}
                      </Button>
                    )
                  ) : null}
                  <div
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      isConnected
                        ? 'bg-ds-text-success-default-default'
                        : 'bg-ds-text-neutral-default-default opacity-10'
                    }`}
                  />
                </div>
              </div>
              <span className="block text-ds-text-base text-ds-ink-muted-default">
                {getProviderDescription(item)}
              </span>
            </div>
            <div className="flex w-full flex-col gap-4 px-6 pb-4">
              {/* Login row: left status text, right action */}
              <div className="flex w-full items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-ds-text-base text-ds-ink-default-default">
                    {isConnected
                      ? codexStatus.account_label || t('connectors.connected')
                      : t('setting.not-configured')}
                  </span>
                  {codexStatus.expires_at ? (
                    <span className="text-ds-text-meta text-ds-ink-muted-default">
                      {codexStatus.expires_at}
                    </span>
                  ) : null}
                  {!isConnected && codexStatus.last_error_code ? (
                    <span className="text-ds-text-meta text-ds-ink-muted-default">
                      {codexStatus.last_error_code}
                    </span>
                  ) : null}
                </div>
                <div className="ml-4 flex shrink-0 items-center gap-2">
                  {isConnected ? (
                    <Button
                      variant="secondary"
                      tone="error"
                      size="sm"
                      buttonContent="text"
                      textWeight="bold"
                      buttonRadius="lg"
                      disabled={codexBusy}
                      onClick={handleCodexDisconnect}
                    >
                      {t('setting.disconnect', { defaultValue: 'Disconnect' })}
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      tone="neutral"
                      size="sm"
                      buttonContent="text"
                      textWeight="bold"
                      buttonRadius="lg"
                      disabled={codexBusy}
                      onClick={handleCodexLogin}
                    >
                      {codexBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        t('layout.login', { defaultValue: 'Sign in' })
                      )}
                    </Button>
                  )}
                </div>
              </div>

              {/* Model type row: left label, right input */}
              <div className="flex w-full items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center">
                  <span className="overflow-hidden text-ds-text-base text-ellipsis whitespace-nowrap">
                    {t('setting.model-type')}
                  </span>
                </div>
                <div className="ml-4 shrink-0">
                  <Input
                    value={codex_model_type}
                    onChange={(e) => setCodexModelType(e.target.value)}
                    placeholder="gpt-5.5"
                    className="w-[220px]"
                  />
                </div>
              </div>
            </div>
          </ConfigModelCard>
        );
      }

      return (
        <ConfigModelCard status={configCardRing}>
          <div className="mx-6 mb-4 flex flex-col items-start justify-between border-x-0 border-t-0 border-b-[0.5px] border-solid border-ds-hairline-default-default pt-2 pb-4">
            <div className="inline-flex items-center justify-between gap-2 self-stretch">
              <div className="my-2 text-ds-text-base font-bold text-ds-ink-default-default">
                {item.name}
              </div>
              <div className="flex items-center gap-2">
                {form[idx].prefer ? (
                  <Button
                    variant="primary"
                    tone="success"
                    size="xs"
                    buttonContent="text"
                    textWeight="bold"
                    disabled
                    buttonRadius="full"
                  >
                    {t('setting.default')}
                  </Button>
                ) : canSwitch ? (
                  <Button
                    variant="ghost"
                    tone="neutral"
                    size="xs"
                    buttonContent="text"
                    textWeight="bold"
                    disabled={loading === idx}
                    buttonRadius="full"
                    onClick={() => handleSwitch(idx, true)}
                  >
                    {t('setting.set-as-default')}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    tone="neutral"
                    size="xs"
                    buttonContent="text"
                    textWeight="bold"
                    disabled
                    buttonRadius="full"
                  >
                    {t('setting.not-configured')}
                  </Button>
                )}
                {form[idx].provider_id ? (
                  <div className="h-2 w-2 shrink-0 rounded-full bg-ds-text-success-default-default" />
                ) : (
                  <div className="h-2 w-2 shrink-0 rounded-full bg-ds-text-neutral-default-default opacity-10" />
                )}
              </div>
            </div>
            <span className="block text-ds-text-base text-ds-ink-muted-default">
              {getProviderDescription(item)}
              {item.websiteUrl ? (
                <>
                  {' '}
                  <a
                    href={item.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ds-text-information-strong-default hover:underline"
                  >
                    {t('setting.visit-provider', { provider: item.name })}
                  </a>
                </>
              ) : null}
            </span>
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
            {item.modelsEndpoint ? (
              <ProviderModelCombobox
                providerName={item.name}
                title={t('setting.model-type-setting')}
                value={form[idx].model_type || ''}
                onChange={(v) => {
                  setForm((f) =>
                    f.map((fi, i) =>
                      i === idx ? { ...fi, model_type: v } : fi
                    )
                  );
                  setErrors((errs) =>
                    errs.map((er, i) =>
                      i === idx ? { ...er, model_type: '' } : er
                    )
                  );
                }}
                groups={cloudModelsState[item.id]?.groups || []}
                loading={cloudModelsState[item.id]?.loading || false}
                error={
                  cloudModelsState[item.id]?.error ??
                  errors[idx]?.model_type ??
                  null
                }
                disabled={!form[idx].apiKey}
                disabledReason={t('setting.enter-api-key-first')}
                onRefresh={() => void fetchCloudProviderModels(idx)}
                triggerPlaceholder={t('setting.select-model-type', {
                  defaultValue: 'Select model type',
                })}
              />
            ) : (
              <Input
                id={`modelType-${item.id}`}
                size="default"
                title={t('setting.model-type-setting')}
                state={errors[idx]?.model_type ? 'error' : 'default'}
                note={errors[idx]?.model_type ?? undefined}
                placeholder={`${t('setting.enter-your-model-type')} ${
                  item.name
                } ${t('setting.model-type')}`}
                value={form[idx].model_type}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((f) =>
                    f.map((fi, i) =>
                      i === idx ? { ...fi, model_type: v } : fi
                    )
                  );
                  setErrors((errs) =>
                    errs.map((er, i) =>
                      i === idx ? { ...er, model_type: '' } : er
                    )
                  );
                }}
              />
            )}
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="model-parameters" className="border-none">
                <AccordionTrigger className="bg-transparent px-0 py-2 hover:no-underline">
                  <span className="text-ds-text-base font-medium text-ds-ink-default-default">
                    {t('setting.model-parameters-setting')}
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <Textarea
                    id={`modelParameters-${item.id}`}
                    variant="enhanced"
                    state={errors[idx]?.modelConfigJson ? 'error' : 'default'}
                    note={errors[idx]?.modelConfigJson ?? undefined}
                    placeholder={t('setting.model-parameters-placeholder')}
                    value={form[idx].modelConfigJson}
                    rows={5}
                    spellCheck={false}
                    className="font-mono"
                    onChange={(e) => {
                      const value = e.target.value;
                      setForm((currentForm) =>
                        currentForm.map((entry, entryIdx) =>
                          entryIdx === idx
                            ? { ...entry, modelConfigJson: value }
                            : entry
                        )
                      );
                      setErrors((currentErrors) =>
                        currentErrors.map((entry, entryIdx) =>
                          entryIdx === idx
                            ? { ...entry, modelConfigJson: '' }
                            : entry
                        )
                      );
                    }}
                  />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
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
                        title={getExternalConfigName(ec.key, ec.name)}
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
                      title={getExternalConfigName(ec.key, ec.name)}
                      type={
                        ec.secret && !showSecret[`${idx}-${ecIdx}`]
                          ? 'password'
                          : 'text'
                      }
                      placeholder={
                        ec.placeholder ??
                        t('connectors.enter-field', {
                          field: getExternalConfigName(ec.key, ec.name),
                        })
                      }
                      state={errors[idx]?.externalConfig ? 'error' : undefined}
                      note={errors[idx]?.externalConfig ?? undefined}
                      backIcon={
                        ec.secret ? (
                          showSecret[`${idx}-${ecIdx}`] ? (
                            <Eye className="h-5 w-5" />
                          ) : (
                            <EyeOff className="h-5 w-5" />
                          )
                        ) : undefined
                      }
                      onBackIconClick={
                        ec.secret
                          ? () =>
                              setShowSecret((prev) => ({
                                ...prev,
                                [`${idx}-${ecIdx}`]: !prev[`${idx}-${ecIdx}`],
                              }))
                          : undefined
                      }
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
              tone="neutral"
              size="sm"
              buttonContent="text"
              textWeight="medium"
              buttonRadius="full"
              onClick={() => handleDelete(idx)}
            >
              {t('setting.reset')}
            </Button>
            <Button
              variant="primary"
              tone="neutral"
              size="sm"
              buttonContent="text"
              textWeight="bold"
              buttonRadius="full"
              onClick={() => handleVerify(idx)}
              disabled={loading === idx}
            >
              {loading === idx ? t('setting.configuring') : t('setting.save')}
            </Button>
          </div>
        </ConfigModelCard>
      );
    }

    // Local model content - specific platforms
    if (selectedTab.startsWith('local-')) {
      const platform = selectedTab.replace('local-', '');
      const currentEndpoint = localEndpoints[platform] || '';
      const currentType = localTypes[platform] || '';
      const isConfigured = !!localProviderIds[platform];
      const isPreferred = localPrefer && localPlatform === platform;
      const platformState = platformModelState[platform];
      const isModelListPlatform = !!LOCAL_MODEL_OPTIONS.find(
        (m) => m.id === platform && m.fetchPath
      );
      const platformModels = platformState?.models || [];
      const platformModelsLoading = platformState?.loading || false;
      const platformModelsError = platformState?.error || null;

      return (
        <ConfigModelCard status={configCardRing}>
          <div className="mx-6 mb-4 flex flex-col items-start justify-between border-x-0 border-t-0 border-b-[0.5px] border-solid border-ds-hairline-default-default pt-2 pb-4">
            <div className="inline-flex items-center justify-between gap-2 self-stretch">
              <div className="flex items-center gap-2">
                <div className="my-2 text-ds-text-base font-bold text-ds-ink-default-default">
                  {getLocalPlatformName(platform)}
                </div>
                {isPreferred ? (
                  <Button
                    variant="primary"
                    tone="success"
                    size="xs"
                    buttonContent="text"
                    textWeight="bold"
                    buttonRadius="full"
                    className="focus-none shadow-none"
                    disabled={!isConfigured}
                    onClick={() => handleLocalSwitch(false)}
                  >
                    {t('setting.default')}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    tone="neutral"
                    size="xs"
                    buttonContent="text"
                    textWeight="bold"
                    buttonRadius="full"
                    disabled={!isConfigured}
                    onClick={() => handleLocalSwitch(true)}
                    className={
                      isConfigured
                        ? 'bg-ds-neutral-default-hover !text-ds-ink-muted-default shadow-none hover:bg-ds-neutral-muted-hover'
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
                <div className="h-2 w-2 rounded-full bg-ds-bg-success-strong-default" />
              ) : (
                <div className="h-2 w-2 rounded-full bg-ds-ink-muted-default opacity-10" />
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
                // Clear model list error when endpoint changes
                clearPlatformModelsError(platform);
              }}
              onBlur={(e) => {
                if (
                  platform !== OLLAMA_PROVIDER_ID ||
                  ollamaEndpointAutoFixedOnce ||
                  !canAutoFixOllamaEndpoint(e.target.value)
                ) {
                  return;
                }
                const fixedEndpoint = appendV1ToEndpoint(e.target.value);
                setLocalEndpoints((prev) => ({
                  ...prev,
                  [platform]: fixedEndpoint,
                }));
                setOllamaEndpointAutoFixedOnce(true);
                toast(t('setting.ollama-endpoint-updated'), {
                  description: t('setting.ollama-endpoint-updated-description'),
                  closeButton: true,
                });
              }}
              disabled={!localEnabled}
              placeholder={
                getDefaultLocalEndpoint(platform) || 'http://localhost:8000/v1'
              }
              note={localError ?? undefined}
            />
            {isModelListPlatform ? (
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
                      disabled={!localEnabled || platformModelsLoading}
                    >
                      <SelectTrigger
                        size="default"
                        title={t('setting.model-type')}
                        state={
                          localInputError || platformModelsError
                            ? 'error'
                            : undefined
                        }
                      >
                        <SelectValue
                          placeholder={
                            platformModelsLoading
                              ? t('setting.loading-models')
                              : t('setting.select-model')
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {(() => {
                          const modelList =
                            currentType && !platformModels.includes(currentType)
                              ? [currentType, ...platformModels]
                              : [
                                  ...new Set([currentType, ...platformModels]),
                                ].filter(Boolean);
                          return modelList.length > 0 ? (
                            modelList.map((model) => (
                              <SelectItem key={model} value={model}>
                                {model}
                              </SelectItem>
                            ))
                          ) : (
                            <SelectItem value="_no_models" disabled>
                              {t('setting.no-models-found')}
                            </SelectItem>
                          );
                        })()}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    variant="ghost"
                    tone="neutral"
                    size="md"
                    buttonContent="icon-only"
                    textWeight="bold"
                    onClick={() =>
                      void fetchModelsForPlatform(
                        platform,
                        currentEndpoint || getDefaultLocalEndpoint(platform)
                      )
                    }
                    disabled={!localEnabled || platformModelsLoading}
                    className="mb-1 shrink-0"
                  >
                    {platformModelsLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {platformModelsError && (
                  <span className="text-ds-text-base text-ds-text-status-error-strong-default">
                    {platformModelsError}
                  </span>
                )}
              </div>
            ) : (
              <Input
                size="default"
                title={t('setting.model-type')}
                state={localInputError ? 'error' : 'default'}
                placeholder={t('setting.enter-your-local-model-type')}
                value={currentType}
                onChange={(e) =>
                  setLocalTypes((prev) => ({
                    ...prev,
                    [platform]: e.target.value,
                  }))
                }
                disabled={!localEnabled}
              />
            )}
          </div>
          {/* Action Button */}
          <div className="flex justify-end gap-2 px-6 py-4">
            <Button
              variant="ghost"
              tone="neutral"
              size="sm"
              buttonContent="text"
              textWeight="medium"
              buttonRadius="full"
              onClick={handleLocalReset}
            >
              {t('setting.reset')}
            </Button>
            <Button
              onClick={handleLocalVerify}
              disabled={!localEnabled || localVerifying}
              variant="primary"
              tone="neutral"
              size="sm"
              buttonContent="text"
              textWeight="bold"
              buttonRadius="full"
            >
              {localVerifying ? t('setting.configuring') : t('setting.save')}
            </Button>
          </div>
        </ConfigModelCard>
      );
    }

    return null;
  };

  return (
    <SettingsSectionPage>
      {providersError ? (
        <span
          role="alert"
          className="block rounded-xl bg-ds-bg-error-subtle-default px-4 py-3 text-ds-text-base text-ds-text-error-strong-default"
        >
          {providersError}
        </span>
      ) : null}
      {/* Default Model Cascading Dropdown */}
      <SettingsSection
        title={t('setting.models-default-setting-title')}
        boxClassName="items-center justify-between gap-4"
        variant="horizontal"
      >
        <div className="flex w-full flex-col items-start justify-center gap-1">
          <div className="text-ds-text-base">
            {t('setting.models-default-setting-description')}
          </div>
        </div>
        <DropdownMenu
          onOpenChange={(open) => {
            if (open) void fetchCloudModels();
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="primary"
              size="sm"
              buttonContent="text"
              textWeight="semibold"
              buttonRadius="lg"
              disabled={providersLoading}
              aria-busy={providersLoading}
            >
              {getDefaultModelDisplayText()}
              {providersLoading ? (
                <Loader2
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                <ChevronDown />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[180px]">
            {/* Cloud Category */}
            {import.meta.env.VITE_USE_LOCAL_PROXY !== 'true' && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="gap-2">
                  <img src={eigentImage} alt="" className="h-5 w-5" />
                  <span className="text-ds-text-base">
                    {t('setting.eigent-cloud')}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="scrollbar-always-visible max-h-[300px] w-[200px] overflow-y-auto">
                  {cloudModelOptions.map((model) => (
                    <DefaultModelMenuItem
                      key={model.id}
                      configured
                      selected={
                        cloudPrefer && effectiveCloudModelId === model.id
                      }
                      statusLabel={t('setting.configured')}
                      onSelect={() =>
                        handleDefaultModelSelect('cloud', model.id)
                      }
                    >
                      {model.name}
                    </DefaultModelMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}

            {/* Custom Model Category */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                <Key className="h-5 w-5 text-ds-ink-default-default" />
                <span className="text-ds-text-base">
                  {t('setting.custom-model')}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="scrollbar-always-visible max-h-[440px] w-[220px] overflow-y-auto">
                {items.map((item, idx) => {
                  const isSubscriptionAuth =
                    item.authMode === 'oauth_subscription';
                  const isConfigured = isSubscriptionAuth
                    ? codexStatus.connected
                    : !!form[idx]?.provider_id;
                  const isPreferred = isSubscriptionAuth
                    ? modelType === 'codex_subscription'
                    : form[idx]?.prefer;

                  return (
                    <DefaultModelMenuItem
                      key={item.id}
                      configured={isConfigured}
                      selected={isPreferred}
                      statusLabel={t(
                        isConfigured
                          ? 'setting.configured'
                          : 'setting.not-configured'
                      )}
                      onSelect={() => {
                        if (isSubscriptionAuth) {
                          if (isConfigured) {
                            handleCodexSetDefault();
                          } else {
                            setSelectedTab(`byok-${item.id}` as SidebarTab);
                          }
                          return;
                        }
                        handleDefaultModelSelect('custom', item.id);
                      }}
                    >
                      {item.name}
                    </DefaultModelMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {/* Local Host Category */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                <Server className="h-5 w-5 text-ds-ink-default-default" />
                <span className="text-ds-text-base">
                  {t('setting.local-model')}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="scrollbar-always-visible max-h-[300px] w-[200px] overflow-y-auto">
                {LOCAL_MODEL_OPTIONS.map((model) => {
                  const isConfigured = !!localProviderIds[model.id];
                  const isPreferred = localPrefer && localPlatform === model.id;

                  return (
                    <DefaultModelMenuItem
                      key={model.id}
                      configured={isConfigured}
                      selected={isPreferred}
                      statusLabel={t(
                        isConfigured
                          ? 'setting.configured'
                          : 'setting.not-configured'
                      )}
                      onSelect={() =>
                        handleDefaultModelSelect('local', model.id)
                      }
                    >
                      {model.name}
                    </DefaultModelMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </SettingsSection>

      {/* Content Section with Sidebar */}
      <SettingsSection
        title={t('setting.models-configuration')}
        boxClassName="items-start gap-2"
      >
        <div className="flex w-full flex-row items-start justify-between">
          {/* Sidebar */}
          <div className="mr-4 -ml-2 h-full w-[240px] rounded-2xl bg-ds-neutral-default-default">
            <div className="flex flex-col gap-4">
              {/* Eigent Cloud Section */}
              <div className="flex flex-col gap-1">
                <div className="px-3 py-2 text-ds-text-base font-bold text-ds-ink-default-default">
                  {t('setting.eigent-cloud')}
                </div>
                {import.meta.env.VITE_USE_LOCAL_PROXY !== 'true' &&
                  renderSidebarItem(
                    'cloud',
                    t('setting.eigent-cloud'),
                    'cloud',
                    selectedTab === 'cloud',
                    false,
                    cloudPrefer,
                    creditsError
                      ? 'muted'
                      : Number(credits) > 0
                        ? 'success'
                        : 'error'
                  )}
              </div>
              {/* Custom Model Section */}
              <div className="flex flex-col gap-1">
                <div className="px-3 py-2 text-ds-text-base font-bold text-ds-ink-default-default">
                  {t('setting.custom-model')}
                </div>
                <div className="flex flex-col gap-2">
                  {/* Subscription sub-accordion (OAuth login providers) */}
                  {items.some(
                    (item) => item.authMode === 'oauth_subscription'
                  ) && (
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() =>
                          setSubscriptionCollapsed(!subscriptionCollapsed)
                        }
                        className="flex items-center justify-between rounded-lg bg-transparent px-3 py-2 transition-colors hover:bg-ds-neutral-default-default"
                      >
                        <div className="text-ds-text-base font-medium text-ds-ink-muted-default">
                          {t('setting.subscription', {
                            defaultValue: 'Subscription',
                          })}
                        </div>
                        {subscriptionCollapsed ? (
                          <ChevronDown className="h-4 w-4 text-ds-ink-muted-default" />
                        ) : (
                          <ChevronUp className="h-4 w-4 text-ds-ink-muted-default" />
                        )}
                      </button>
                      <div
                        className={`overflow-hidden transition-opacity duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${
                          subscriptionCollapsed
                            ? 'max-h-0 opacity-0'
                            : 'max-h-[2000px] opacity-100'
                        }`}
                      >
                        {items.map((item) =>
                          item.authMode === 'oauth_subscription'
                            ? renderSidebarItem(
                                `byok-${item.id}` as SidebarTab,
                                item.name,
                                item.id,
                                selectedTab === `byok-${item.id}`,
                                true,
                                codexStatus.connected
                              )
                            : null
                        )}
                      </div>
                    </div>
                  )}
                  {/* BYOK (API key) sub-accordion */}
                  {items.some(
                    (item) => item.authMode !== 'oauth_subscription'
                  ) && (
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() =>
                          setByokGroupCollapsed(!byokGroupCollapsed)
                        }
                        className="flex items-center justify-between rounded-lg bg-transparent px-3 py-2 transition-colors hover:bg-ds-neutral-default-default"
                      >
                        <div className="text-ds-text-base font-medium text-ds-ink-muted-default">
                          {t('setting.byok', { defaultValue: 'BYOK' })}
                        </div>
                        {byokGroupCollapsed ? (
                          <ChevronDown className="h-4 w-4 text-ds-ink-muted-default" />
                        ) : (
                          <ChevronUp className="h-4 w-4 text-ds-ink-muted-default" />
                        )}
                      </button>
                      <div
                        className={`overflow-hidden transition-opacity duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${
                          byokGroupCollapsed
                            ? 'max-h-0 opacity-0'
                            : 'max-h-[2000px] opacity-100'
                        }`}
                      >
                        {items.map((item, idx) =>
                          item.authMode === 'oauth_subscription'
                            ? null
                            : renderSidebarItem(
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
                  )}
                </div>
              </div>

              {/* Local Model Section */}
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => setLocalCollapsed(!localCollapsed)}
                  className="flex items-center justify-between rounded-lg bg-transparent px-3 py-2 transition-colors hover:bg-ds-neutral-default-default"
                >
                  <div className="text-ds-text-base font-bold text-ds-ink-default-default">
                    {t('setting.local-model')}
                  </div>
                  {localCollapsed ? (
                    <ChevronDown className="h-4 w-4 text-ds-ink-muted-default" />
                  ) : (
                    <ChevronUp className="h-4 w-4 text-ds-ink-muted-default" />
                  )}
                </button>
                <div
                  className={`overflow-hidden transition-opacity duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${
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
                    !!localProviderIds[OLLAMA_PROVIDER_ID]
                  )}
                  {renderSidebarItem(
                    'local-vllm',
                    'vLLM',
                    'local-vllm',
                    selectedTab === 'local-vllm',
                    true,
                    !!localProviderIds[VLLM_PROVIDER_ID]
                  )}
                  {renderSidebarItem(
                    'local-sglang',
                    'SGLang',
                    'local-sglang',
                    selectedTab === 'local-sglang',
                    true,
                    !!localProviderIds[SGLANG_PROVIDER_ID]
                  )}
                  {renderSidebarItem(
                    'local-lmstudio',
                    'LM Studio',
                    'local-lmstudio',
                    selectedTab === 'local-lmstudio',
                    true,
                    !!localProviderIds[LMSTUDIO_PROVIDER_ID]
                  )}
                  {renderSidebarItem(
                    'local-llama.cpp',
                    'LLaMA.cpp',
                    'local-llama.cpp',
                    selectedTab === 'local-llama.cpp',
                    true,
                    !!localProviderIds[LLAMA_CPP_PROVIDER_ID]
                  )}
                </div>
              </div>
            </div>
          </div>
          {/* Main Content */}
          <div className="sticky top-4 z-10 min-w-0 flex-1">
            {renderContent()}
          </div>
        </div>
      </SettingsSection>
    </SettingsSectionPage>
  );
}
