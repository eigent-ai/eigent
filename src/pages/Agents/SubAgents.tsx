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
import geminiImage from '@/assets/model/gemini.svg';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  createDefaultRemoteSubAgentForm,
  isRemoteSubAgentConfigured,
  normalizeRemoteSubAgentProvider,
  REMOTE_SUB_AGENT_DEFAULT_AGENT,
  REMOTE_SUB_AGENT_PROVIDER,
  REMOTE_SUB_AGENT_PROVIDER_ID,
  toRemoteSubAgentProviderPayload,
  type RemoteSubAgentFormState,
} from '@/lib/remoteSubAgent';
import { Eye, EyeOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

export default function SubAgents() {
  const { t } = useTranslation();
  const [remoteSubAgentForm, setRemoteSubAgentForm] = useState(
    createDefaultRemoteSubAgentForm
  );
  const [showRemoteSubAgentKey, setShowRemoteSubAgentKey] = useState(false);
  const [remoteSubAgentSaving, setRemoteSubAgentSaving] = useState(false);
  const [remoteSubAgentError, setRemoteSubAgentError] = useState<string | null>(
    null
  );
  const [selectedProvider, setSelectedProvider] = useState(
    REMOTE_SUB_AGENT_PROVIDER
  );

  const loadRemoteSubAgentProvider = useCallback(async () => {
    const res = await proxyFetchGet('/api/v1/remote-sub-agent-providers', {
      provider_name: REMOTE_SUB_AGENT_PROVIDER_ID,
    });
    const providerList = Array.isArray(res) ? res : res.items || [];
    setRemoteSubAgentForm(normalizeRemoteSubAgentProvider(providerList[0]));
  }, []);

  useEffect(() => {
    loadRemoteSubAgentProvider().catch((error) => {
      console.error('Error fetching remote sub agent providers:', error);
    });
  }, [loadRemoteSubAgentProvider]);

  const remoteSubAgentValidateMessage = (error: any) => {
    const detail = error?.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    if (detail?.message) return detail.message;
    if (error?.response?.data?.message) return error.response.data.message;
    if (error?.message) return error.message;
    return t('setting.validate-failed');
  };

  const getRemoteSubAgentRequiredError = (
    form: RemoteSubAgentFormState,
    requireFields = form.enabled
  ) => {
    const maxWallTimeSeconds = Number(form.maxWallTimeSeconds.trim());
    const pollIntervalSeconds = Number(form.pollIntervalSeconds.trim());

    if (
      requireFields &&
      (!form.apiKey.trim() ||
        !form.baseUrl.trim() ||
        !form.agentName.trim() ||
        !Number.isFinite(maxWallTimeSeconds) ||
        maxWallTimeSeconds <= 0 ||
        !Number.isFinite(pollIntervalSeconds) ||
        pollIntervalSeconds <= 0)
    ) {
      return t('setting.remote-sub-agent-required-fields');
    }
    return null;
  };

  const validateRemoteSubAgentConfig = async (
    form: RemoteSubAgentFormState
  ) => {
    const res = await fetchPost('/remote-sub-agent/validate', {
      provider: form.provider,
      api_key: form.apiKey.trim(),
      base_url: form.baseUrl.trim(),
      agent_name: form.agentName.trim(),
    });

    if (!res?.is_valid) {
      throw new Error(res?.message || t('setting.validate-failed'));
    }

    toast.success(t('setting.validate-success'), {
      description: res.message,
      closeButton: true,
    });
  };

  const persistRemoteSubAgentForm = async (
    form: RemoteSubAgentFormState,
    {
      requireFields = form.enabled,
      validateConnection = form.enabled,
    }: {
      requireFields?: boolean;
      validateConnection?: boolean;
    } = {}
  ) => {
    const requiredError = getRemoteSubAgentRequiredError(form, requireFields);
    if (requiredError) {
      setRemoteSubAgentError(requiredError);
      toast.error(requiredError);
      return false;
    }

    setRemoteSubAgentSaving(true);
    setRemoteSubAgentError(null);
    try {
      if (validateConnection) {
        await validateRemoteSubAgentConfig(form);
      }

      const data = toRemoteSubAgentProviderPayload(form);
      if (form.provider_id) {
        await proxyFetchPut(
          `/api/v1/remote-sub-agent-providers/${form.provider_id}`,
          data
        );
      } else {
        await proxyFetchPost('/api/v1/remote-sub-agent-providers', data);
      }

      await loadRemoteSubAgentProvider();
      toast.success(t('setting.configuration-saved-successfully'));
      return true;
    } catch (error) {
      console.error('Error saving remote sub agent:', error);
      const message = remoteSubAgentValidateMessage(error);
      setRemoteSubAgentError(message);
      toast.error(message);
      return false;
    } finally {
      setRemoteSubAgentSaving(false);
    }
  };

  const handleRemoteSubAgentSave = async () => {
    await persistRemoteSubAgentForm(remoteSubAgentForm, {
      requireFields: true,
      validateConnection: true,
    });
  };

  const handleRemoteSubAgentToggle = async (checked: boolean) => {
    const previousForm = remoteSubAgentForm;
    const nextForm = {
      ...remoteSubAgentForm,
      enabled: checked,
    };

    if (!checked && !remoteSubAgentForm.provider_id) {
      setRemoteSubAgentForm(nextForm);
      setRemoteSubAgentError(null);
      return;
    }

    const requiredError = getRemoteSubAgentRequiredError(nextForm, checked);
    if (requiredError) {
      setRemoteSubAgentError(requiredError);
      toast.error(requiredError);
      return;
    }

    setRemoteSubAgentForm(nextForm);
    const saved = await persistRemoteSubAgentForm(nextForm, {
      requireFields: checked,
      validateConnection: checked,
    });
    if (!saved) {
      setRemoteSubAgentForm(previousForm);
    }
  };

  const handleRemoteSubAgentReset = async () => {
    try {
      if (remoteSubAgentForm.provider_id) {
        await proxyFetchDelete(
          `/api/v1/remote-sub-agent-providers/${remoteSubAgentForm.provider_id}`
        );
      }
      setRemoteSubAgentForm(createDefaultRemoteSubAgentForm());
      setRemoteSubAgentError(null);
      toast.success(t('setting.reset-success'));
    } catch (error) {
      console.error('Error resetting remote sub agent:', error);
      toast.error(t('setting.reset-failed'));
    }
  };

  const isConfigured = isRemoteSubAgentConfigured(remoteSubAgentForm);

  const renderProviderItem = () => {
    const isActive = selectedProvider === REMOTE_SUB_AGENT_PROVIDER;

    return (
      <button
        key={REMOTE_SUB_AGENT_PROVIDER}
        onClick={() => setSelectedProvider(REMOTE_SUB_AGENT_PROVIDER)}
        className={`rounded-xl px-3 py-2 flex w-full items-center justify-between transition-all duration-200 ${
          isActive
            ? 'bg-fill-fill-transparent-active'
            : 'bg-fill-fill-transparent hover:bg-fill-fill-transparent-hover'
        }`}
      >
        <div className="min-w-0 gap-3 flex items-center justify-center">
          <img
            src={geminiImage}
            alt={t('setting.gemini-agent')}
            className="h-5 w-5 shrink-0"
          />
          <span
            className={`text-body-sm font-medium truncate ${
              isActive ? 'text-text-body' : 'text-text-label'
            }`}
          >
            {t('setting.gemini-agent')}
          </span>
        </div>
        {isConfigured ? (
          <div className="m-1 h-2 w-2 bg-text-success shrink-0 rounded-full" />
        ) : (
          <div className="m-1 h-2 w-2 bg-text-label shrink-0 rounded-full opacity-10" />
        )}
      </button>
    );
  };

  const renderGeminiProviderContent = () => (
    <div className="rounded-2xl bg-surface-tertiary flex w-full flex-col">
      <div className="mx-6 mb-4 border-border-secondary pb-4 pt-2 flex flex-col items-start justify-between border-x-0 border-t-0 border-b-[0.5px] border-solid">
        <div className="gap-2 inline-flex items-center justify-between self-stretch">
          <div className="text-body-base my-2 font-bold text-text-heading">
            {t('setting.gemini-remote-sub-agent')}
          </div>
          <div className="gap-3 flex items-center">
            {isConfigured ? (
              <div className="h-2 w-2 bg-text-success shrink-0 rounded-full" />
            ) : (
              <div className="h-2 w-2 bg-text-label shrink-0 rounded-full opacity-10" />
            )}
            <Switch
              checked={remoteSubAgentForm.enabled}
              disabled={remoteSubAgentSaving}
              onCheckedChange={handleRemoteSubAgentToggle}
            />
          </div>
        </div>
        <div className="text-body-sm text-text-label">
          {t('setting.remote-sub-agent-description')}
        </div>
      </div>

      <div className="gap-4 px-6 flex w-full flex-col items-center">
        <Input
          size="default"
          title={t('setting.api-key-setting')}
          type={showRemoteSubAgentKey ? 'text' : 'password'}
          value={remoteSubAgentForm.apiKey}
          placeholder={`${t('setting.enter-your-api-key')} Gemini ${t(
            'setting.key'
          )}`}
          state={remoteSubAgentError ? 'error' : 'default'}
          backIcon={
            showRemoteSubAgentKey ? (
              <Eye className="h-5 w-5" />
            ) : (
              <EyeOff className="h-5 w-5" />
            )
          }
          onBackIconClick={() =>
            setShowRemoteSubAgentKey((visible) => !visible)
          }
          onChange={(e) => {
            setRemoteSubAgentForm((prev) => ({
              ...prev,
              apiKey: e.target.value,
            }));
            setRemoteSubAgentError(null);
          }}
        />

        <Input
          size="default"
          title={t('setting.api-host-setting')}
          value={remoteSubAgentForm.baseUrl}
          placeholder="https://generativelanguage.googleapis.com/v1beta"
          state={remoteSubAgentError ? 'error' : 'default'}
          onChange={(e) => {
            setRemoteSubAgentForm((prev) => ({
              ...prev,
              baseUrl: e.target.value,
            }));
            setRemoteSubAgentError(null);
          }}
        />

        <Input
          size="default"
          title={t('setting.agent-id')}
          value={remoteSubAgentForm.agentName}
          placeholder={REMOTE_SUB_AGENT_DEFAULT_AGENT}
          state={remoteSubAgentError ? 'error' : 'default'}
          onChange={(e) => {
            setRemoteSubAgentForm((prev) => ({
              ...prev,
              agentName: e.target.value,
            }));
            setRemoteSubAgentError(null);
          }}
        />

        <div className="gap-4 grid w-full grid-cols-2">
          <Input
            size="default"
            title={t('setting.max-wall-time-seconds')}
            value={remoteSubAgentForm.maxWallTimeSeconds}
            onChange={(e) =>
              setRemoteSubAgentForm((prev) => ({
                ...prev,
                maxWallTimeSeconds: e.target.value,
              }))
            }
          />
          <Input
            size="default"
            title={t('setting.poll-interval-seconds')}
            value={remoteSubAgentForm.pollIntervalSeconds}
            onChange={(e) =>
              setRemoteSubAgentForm((prev) => ({
                ...prev,
                pollIntervalSeconds: e.target.value,
              }))
            }
          />
        </div>

        {remoteSubAgentError && (
          <span className="text-label-sm text-text-error w-full">
            {remoteSubAgentError}
          </span>
        )}
      </div>

      <div className="gap-2 px-6 py-4 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="!text-text-label"
          onClick={handleRemoteSubAgentReset}
        >
          {t('setting.reset')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleRemoteSubAgentSave}
          disabled={remoteSubAgentSaving}
        >
          <span className="text-text-inverse-primary">
            {remoteSubAgentSaving
              ? t('setting.configuring')
              : t('setting.save')}
          </span>
        </Button>
      </div>
    </div>
  );

  return (
    <div className="m-auto flex h-auto w-full flex-1 flex-col">
      <div className="bg-surface-primary px-6 pb-6 pt-8 flex w-full items-center justify-between">
        <div className="gap-4 flex w-full flex-col items-start justify-between">
          <div className="flex flex-col">
            <div className="text-heading-sm font-bold text-text-heading">
              {t('setting.sub-agents')}
            </div>
          </div>
        </div>
      </div>

      <div className="mb-8 gap-6 flex flex-col">
        <div className="gap-2 rounded-2xl bg-surface-secondary px-6 py-4 flex w-full flex-col items-start justify-between">
          <div className="text-body-base mb-2 border-border-secondary bg-surface-secondary pb-4 font-bold text-text-heading sticky top-[48px] z-10 w-full border-x-0 border-t-0 border-b-[0.5px] border-solid">
            {t('setting.models-configuration')}
          </div>

          <div className="flex w-full flex-row items-start justify-between">
            <div className="-ml-2 mr-4 rounded-2xl bg-surface-secondary h-full w-[240px]">
              <div className="gap-4 flex flex-col">
                <div className="gap-1 flex flex-col">
                  <div className="px-3 py-2 text-body-sm font-bold text-text-heading">
                    {t('setting.agent-provider')}
                  </div>
                  {renderProviderItem()}
                </div>
              </div>
            </div>
            <div className="min-w-0 sticky top-[136px] z-10 flex-1">
              {renderGeminiProviderContent()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
