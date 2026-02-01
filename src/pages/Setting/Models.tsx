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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { INIT_PROVODERS } from '@/lib/llm';
import { useAuthStore } from '@/store/authStore';
import { Provider } from '@/types';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Settings,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

const LOCAL_PROVIDER_NAMES = ['ollama', 'vllm', 'sglang', 'lmstudio'];

export default function SettingModels() {
  const { modelType, cloud_model_type, setModelType, setCloudModelType } =
    useAuthStore();
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
  const [collapsed, setCollapsed] = useState(false);

  // Cloud Model
  const [cloudPrefer, setCloudPrefer] = useState(false);

  // Local Model independent state
  const [localEnabled, setLocalEnabled] = useState(true);
  const [localPlatform, setLocalPlatform] = useState('ollama');
  const [localEndpoint, setLocalEndpoint] = useState('');
  const [localType, setLocalType] = useState('');
  const [localVerifying, setLocalVerifying] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localInputError, setLocalInputError] = useState(false);
  const [localPrefer, setLocalPrefer] = useState(false); // Local model prefer state
  const [localProviderId, setLocalProviderId] = useState<number | undefined>(
    undefined
  ); // Local model provider_id

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
                apiHost: found.endpoint_url || '',
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
        // Handle local model
        const local = providerList.find((p: any) =>
          LOCAL_PROVIDER_NAMES.includes(p.provider_name)
        );
        console.log(123123, local);
        if (local) {
          setLocalEndpoint(local.endpoint_url || '');
          setLocalPlatform(
            local.encrypted_config?.model_platform ||
              local.provider_name ||
              'ollama'
          );
          setLocalType(local.encrypted_config?.model_type || 'llama3.2');
          setLocalEnabled(local.is_valid ?? true);
          setLocalPrefer(local.prefer ?? false);
          setLocalProviderId(local.id);
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
        console.error(e);
        // ignore error
      }
    })();

    if (import.meta.env.VITE_USE_LOCAL_PROXY !== 'true') {
      fetchSubscription();
      updateCredits();
    }
  }, [items, modelType]);

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
              apiHost: found.endpoint_url || '',
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
      handleSwitch(idx, true);
    } finally {
      setLoading(null);
    }
  };

  // Local Model verification
  const handleLocalVerify = async () => {
    setLocalVerifying(true);
    setLocalError(null);
    setLocalInputError(false);
    if (!localEndpoint) {
      setLocalError(t('setting.endpoint-url-can-not-be-empty'));
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
          model_type: localType,
          api_key: 'not-required',
          url: localEndpoint,
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
      const data: any = {
        provider_name: localPlatform,
        api_key: 'not-required',
        endpoint_url: localEndpoint, // Save base URL without specific endpoints
        is_valid: true,
        model_type: localType,
        encrypted_config: {
          model_platform: localPlatform,
          model_type: localType,
        },
      };
      await proxyFetchPost('/api/provider', data);
      setLocalError(null);
      setLocalInputError(false);
      // add: refresh provider list after saving, update localProviderId and localPrefer
      const res = await proxyFetchGet('/api/providers');
      const providerList = Array.isArray(res) ? res : res.items || [];
      const local = providerList.find(
        (p: any) => p.provider_name === localPlatform
      );
      if (local) {
        setLocalProviderId(local.id);
        setLocalPrefer(local.prefer ?? false);
        setLocalPlatform(
          local.encrypted_config?.model_platform ||
            local.provider_name ||
            localPlatform
        );
        await handleLocalSwitch(true, local.id);
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
      console.error(e);
      // Optional: add error message
    }
  };
  const handleLocalSwitch = async (checked: boolean, providerId?: number) => {
    if (!checked) {
      setLocalEnabled(false);
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
        providerId !== undefined ? providerId : localProviderId;
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
      console.error(e);
      // Optional: add error message
    }
  };

  const handleLocalReset = async () => {
    try {
      if (localProviderId !== undefined) {
        await proxyFetchDelete(`/api/provider/${localProviderId}`);
      }
      setLocalEndpoint('');
      setLocalType('');
      setLocalPrefer(false);
      setLocalProviderId(undefined);
      setLocalEnabled(true);
      setActiveModelIdx(null);
      toast.success(t('setting.reset-success'));
    } catch (e) {
      console.error(e);
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
            apiHost: '',
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
      console.error(e);
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

  return (
    <div className="flex flex-col gap-4 pb-40">
      {import.meta.env.VITE_USE_LOCAL_PROXY !== 'true' && (
        <div className="inline-flex w-full flex-col items-start justify-start gap-4 self-stretch rounded-2xl border-solid border-border-disabled bg-gradient-to-t from-orange-50 to-surface-tertiary px-6 py-4 pt-4">
          <div className="flex flex-col items-start justify-start gap-1 self-stretch">
            <div className="inline-flex items-center justify-start gap-2 self-stretch">
              <div className="flex-1 justify-center text-body-lg font-bold text-text-heading">
                {t('setting.eigent-cloud-version')}
              </div>
              {cloudPrefer ? (
                <Button
                  variant="success"
                  size="sm"
                  className="focus-none"
                  onClick={() => {
                    // currently selected -> unselect
                    setCloudPrefer(false);
                    setModelType('custom');
                  }}
                >
                  Default
                  <Check />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="!text-text-label"
                  onClick={() => {
                    // not selected -> select cloud prefer
                    setLocalPrefer(false);
                    setActiveModelIdx(null);
                    setForm((f) => f.map((fi) => ({ ...fi, prefer: false })));
                    setCloudPrefer(true);
                    setModelType('cloud');
                  }}
                >
                  Set as Default
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
              <span className="font-['Inter'] text-xs font-normal leading-tight text-text-body">
                .
              </span>
            </div>
          </div>
          <div className="flex w-full flex-row items-center justify-start gap-4 pb-2">
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
            <div className="text-body-sm text-text-body">
              {t('setting.credits')}:{' '}
              {loadingCredits ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                credits
              )}
            </div>
          </div>
          <div className="flex w-full flex-1 items-center justify-between border-x-0 border-b-0 border-solid border-border-disabled pt-6">
            <div className="flex min-w-0 flex-1 items-center">
              <span className="overflow-hidden text-ellipsis whitespace-nowrap text-body-sm">
                {t('setting.select-model-type')}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="ml-1 inline-flex cursor-pointer items-center">
                    <Info className="h-4 w-4 text-icon-secondary" />
                  </span>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="flex min-h-[40px] min-w-[220px] items-center justify-center text-center"
                >
                  <span className="flex w-full items-center justify-center">
                    {cloud_model_type === 'gpt-4.1-mini'
                      ? t('setting.gpt-4.1-mini')
                      : cloud_model_type === 'gpt-4.1'
                        ? t('setting.gpt-4.1')
                        : cloud_model_type === 'claude-sonnet-4-5'
                          ? t('setting.claude-sonnet-4-5')
                          : cloud_model_type === 'gemini-3-pro-preview'
                            ? t('setting.gemini-3-pro-preview')
                            : cloud_model_type === 'gpt-5'
                              ? t('setting.gpt-5')
                              : cloud_model_type === 'gpt-5.1'
                                ? t('setting.gpt-5')
                                : cloud_model_type === 'gpt-5.2'
                                  ? t('setting.gpt-5')
                                  : cloud_model_type === 'gpt-5-mini'
                                    ? t('setting.gpt-5-mini')
                                    : t('setting.gemini-3-flash-preview')}
                  </span>
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="flex-shrink-0">
              <Select
                value={cloud_model_type}
                onValueChange={setCloudModelType}
              >
                <SelectTrigger size="sm">
                  <SelectValue placeholder="Select Model Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gemini-3-pro-preview">
                    Gemini 3 Pro Preview
                  </SelectItem>
                  <SelectItem value="gemini-3-flash-preview">
                    Gemini 3 Flash Preview
                  </SelectItem>
                  <SelectItem value="gpt-4.1-mini">GPT-4.1 mini</SelectItem>
                  <SelectItem value="gpt-4.1">GPT-4.1</SelectItem>
                  <SelectItem value="gpt-5">GPT-5</SelectItem>
                  <SelectItem value="gpt-5.1">GPT-5.1</SelectItem>
                  <SelectItem value="gpt-5.2">GPT-5.2</SelectItem>
                  <SelectItem value="gpt-5-mini">GPT-5 mini</SelectItem>
                  <SelectItem value="claude-sonnet-4-5">
                    Claude Sonnet 4-5
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}
      {/* customer models */}
      <div className="my-2 inline-flex flex-col items-start justify-start self-stretch border-x-0 border-solid border-border-disabled">
        {/* header */}
        <div className="sticky top-[87px] z-10 my-6 inline-flex items-start justify-start gap-2 self-stretch border-y-0 border-r-0 border-solid border-border-secondary bg-surface-tertiary py-2 pl-6 pr-2">
          <div className="flex w-full flex-col items-start gap-1">
            <span className="justify-center text-body-md font-bold text-text-body">
              {t('setting.custom-model')}
            </span>
            <span className="justify-center text-label-sm font-normal text-text-body">
              {t('setting.use-your-own-api-keys-or-set-up-a-local-model')}
            </span>
          </div>
          <Button
            variant="ghost"
            size="md"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setCollapsed((c) => !c);
            }}
          >
            {collapsed ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/*  model list */}
        <div
          className={`inline-flex flex-col items-start justify-start gap-8 self-stretch overflow-hidden transition-all duration-300 ease-in-out ${
            collapsed ? 'pointer-events-none max-h-0 opacity-0' : 'opacity-100'
          }`}
          style={{
            transform: collapsed ? 'translateY(-10px)' : 'translateY(0)',
          }}
        >
          {items.map((item, idx) => {
            const canSwitch = !!form[idx].provider_id;
            return (
              <div
                key={item.id}
                className="w-full overflow-hidden rounded-2xl bg-surface-secondary"
              >
                <div className="flex flex-col items-start justify-between gap-1 px-6 py-4">
                  <div className="inline-flex items-center justify-between gap-2 self-stretch">
                    <div className="flex-1 justify-center text-body-lg font-bold text-text-heading">
                      {item.name}
                    </div>
                    {form[idx].prefer ? (
                      <Button
                        variant="success"
                        size="sm"
                        className="focus-none"
                        disabled={!canSwitch || loading === idx}
                        onClick={() => handleSwitch(idx, false)}
                      >
                        Default
                        <Check />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canSwitch || loading === idx}
                        onClick={() => handleSwitch(idx, true)}
                        className={canSwitch ? '!text-text-label' : ''}
                      >
                        {!canSwitch ? 'Not Configured' : 'Set as Default'}
                      </Button>
                    )}
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
                    title="API Key Setting"
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
                      setShowApiKey((arr) =>
                        arr.map((v, i) => (i === idx ? !v : v))
                      )
                    }
                    value={form[idx].apiKey}
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm((f) =>
                        f.map((fi, i) =>
                          i === idx ? { ...fi, apiKey: v } : fi
                        )
                      );
                      setErrors((errs) =>
                        errs.map((er, i) =>
                          i === idx ? { ...er, apiKey: '' } : er
                        )
                      );
                    }}
                  />
                  {/* API Host Setting */}
                  <Input
                    id={`apiHost-${item.id}`}
                    size="default"
                    title="API Host Setting"
                    state={errors[idx]?.apiHost ? 'error' : 'default'}
                    note={errors[idx]?.apiHost ?? undefined}
                    placeholder={`${t('setting.enter-your-api-host')} ${
                      item.name
                    } ${t('setting.url')}`}
                    value={form[idx].apiHost}
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm((f) =>
                        f.map((fi, i) =>
                          i === idx ? { ...fi, apiHost: v } : fi
                        )
                      );
                      setErrors((errs) =>
                        errs.map((er, i) =>
                          i === idx ? { ...er, apiHost: '' } : er
                        )
                      );
                    }}
                  />
                  {/* Model Type Setting */}
                  <Input
                    id={`modelType-${item.id}`}
                    size="default"
                    title="Model Type Setting"
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
                  {/* externalConfig render */}
                  {item.externalConfig &&
                    form[idx].externalConfig &&
                    form[idx].externalConfig.map((ec, ecIdx) => (
                      <div
                        key={ec.key}
                        className="flex h-full w-full flex-col gap-4"
                      >
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
                                            i2 === ecIdx
                                              ? { ...eec, value: v }
                                              : eec
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
                                errors[idx]?.externalConfig
                                  ? 'error'
                                  : undefined
                              }
                              note={errors[idx]?.externalConfig ?? undefined}
                            >
                              <SelectValue placeholder="please select" />
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
                            state={
                              errors[idx]?.externalConfig ? 'error' : undefined
                            }
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
                                            i2 === ecIdx
                                              ? { ...eec, value: v }
                                              : eec
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
                <div className="mt-6 flex justify-end gap-2 border-x-0 border-b-0 border-solid border-border-secondary px-6 py-4">
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
                      {loading === idx ? 'Configuring...' : 'Save'}
                    </span>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* Local Model */}
      <div className="mt-2 flex flex-col gap-4 rounded-2xl bg-surface-secondary">
        <div className="mb-2 flex items-center justify-between px-6 pt-4">
          <div className="text-body-lg font-bold text-text-heading">
            {t('setting.local-model')}
          </div>
          {localPrefer ? (
            <Button
              variant="success"
              size="sm"
              className="focus-none"
              disabled={!localEndpoint}
              onClick={() => handleLocalSwitch(false)}
            >
              Default
              <Check />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={!localEndpoint}
              onClick={() => handleLocalSwitch(true)}
              className={localEndpoint ? '!text-text-success' : ''}
            >
              {!localEndpoint ? 'Not Configured' : 'Set as Default'}
            </Button>
          )}
        </div>
        <div className="flex flex-col gap-4 px-6">
          <Select
            value={localPlatform}
            onValueChange={(v) => {
              console.log(v);
              setLocalPlatform(v);
            }}
            disabled={!localEnabled}
          >
            <SelectTrigger
              size="default"
              title={t('setting.model-platform')}
              state={localInputError ? 'error' : undefined}
              note={localError ?? undefined}
            >
              <SelectValue placeholder="Select platform" />
            </SelectTrigger>
            <SelectContent className="bg-white-100%">
              <SelectItem value="ollama">Ollama</SelectItem>
              <SelectItem value="vllm">vLLM</SelectItem>
              <SelectItem value="sglang">SGLang</SelectItem>
              <SelectItem value="lmstudio">LMStudio</SelectItem>
            </SelectContent>
          </Select>

          <Input
            size="default"
            title={t('setting.model-endpoint-url')}
            state={localInputError ? 'error' : 'default'}
            value={localEndpoint}
            onChange={(e) => {
              setLocalEndpoint(e.target.value);
              setLocalInputError(false);
              setLocalError(null);
            }}
            disabled={!localEnabled}
            placeholder="http://localhost:11434/v1"
            note={localError ?? undefined}
          />
          <Input
            size="default"
            title={t('setting.model-type')}
            state={localInputError ? 'error' : 'default'}
            placeholder={t('setting.enter-your-local-model-type')}
            value={localType}
            onChange={(e) => setLocalType(e.target.value)}
            disabled={!localEnabled}
          />
        </div>
        <div className="mt-2 flex justify-end gap-2 border-x-0 border-b-0 border-solid border-border-secondary px-6 py-4">
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
              {localVerifying ? 'Configuring...' : 'Save'}
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
