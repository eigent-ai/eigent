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

import { fetchPost, proxyFetchPost, proxyFetchPut } from '@/api/http';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { DsText } from '@/components/ui/ds-text';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  fetchConfiguredProviders,
  notifyModelConfigurationsChanged,
  type ConfiguredProvider,
} from '@/lib/configuredModels';
import {
  buildProviderConfig,
  formatModelConfigJson,
  parseModelConfigJson,
  splitProviderConfig,
} from '@/lib/modelConfig';
import {
  fetchProviderModels,
  ProviderModelsError,
  type ProviderModelGroup,
} from '@/lib/providerModels';
import { toProviderValidStatus } from '@/lib/providerStatus';
import { getAuthStore } from '@/store/authStore';
import type { Provider } from '@/types';
import { ArrowLeft, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProviderModelCombobox } from './components/ProviderModelCombobox';
import {
  appendV1ToEndpoint,
  canAutoFixOllamaEndpoint,
  LOCAL_MODEL_OPTIONS,
  toEndpointBaseUrl,
} from './localModels';

type Props = {
  provider: Provider;
  record?: ConfiguredProvider;
  onClose: () => void;
  onBack?: () => void;
};

type ContentProps = Props & {
  onBusyChange?: (busy: boolean) => void;
};

export function ModelConfigurationContent({
  provider,
  record,
  onClose,
  onBack,
  onBusyChange,
}: ContentProps) {
  const { t } = useTranslation();
  const local = LOCAL_MODEL_OPTIONS.find((item) => item.id === provider.id);
  const stored = splitProviderConfig(record?.encrypted_config);
  const [key, setKey] = useState(
    record?.api_key === 'not-required' ? '' : (record?.api_key ?? '')
  );
  const [endpoint, setEndpoint] = useState(
    record?.endpoint_url || provider.apiHost
  );
  const [model, setModel] = useState(
    record?.model_type || String(record?.encrypted_config?.model_type ?? '')
  );
  const [parameters, setParameters] = useState(
    formatModelConfigJson(stored.modelConfigDict)
  );
  const [extra, setExtra] = useState<Record<string, unknown>>(() => ({
    ...Object.fromEntries(
      provider.externalConfig?.map((field) => [field.key, field.value]) ?? []
    ),
    ...stored.extraParams,
  }));
  const [visibleSecrets, setVisibleSecrets] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [groups, setGroups] = useState<ProviderModelGroup[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const request = useRef({ generation: 0 });
  const active = useRef(true);
  useEffect(() => {
    const pending = request.current;
    active.current = true;
    return () => {
      active.current = false;
      pending.generation++;
    };
  }, []);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  const discoverable = Boolean(provider.modelsEndpoint || local?.fetchPath);
  const optionalKey = Boolean(local) || provider.id === 'aws-bedrock-converse';
  const invalidateDiscovery = (preserveRequired = false) => {
    request.current.generation++;
    setGroups([]);
    setDiscovering(false);
    setDiscoveryError(null);
    setKeyError((current) =>
      preserveRequired && current === t('setting.api-key-can-not-be-empty')
        ? current
        : null
    );
  };

  async function discover() {
    const generation = ++request.current.generation;
    setDiscovering(true);
    setDiscoveryError(null);
    setKeyError(null);
    try {
      let result: ProviderModelGroup[];
      if (local?.fetchPath) {
        const response = await fetch(
          `${toEndpointBaseUrl(endpoint.trim())}${local.fetchPath}`,
          {
            headers: key ? { Authorization: `Bearer ${key}` } : undefined,
          }
        );
        if (!response.ok)
          throw new Error(t('setting.models-connection-failed'));
        const names = local.parseModels?.(await response.json()) ?? [];
        result = [
          { provider: local.name, models: names.map((id) => ({ id })) },
        ];
      } else {
        result = await fetchProviderModels(
          endpoint.trim(),
          provider.modelsEndpoint!,
          key.trim()
        );
      }
      if (generation === request.current.generation) setGroups(result);
    } catch (cause) {
      if (generation !== request.current.generation) return;
      const message =
        cause instanceof Error
          ? cause.message
          : t('setting.models-connection-failed');
      if (cause instanceof ProviderModelsError && cause.status === 401)
        setKeyError(message);
      else setDiscoveryError(message);
    } finally {
      if (generation === request.current.generation) setDiscovering(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const { user_id: savingAccount, email: savingEmail } = getAuthStore();
    setError('');
    if (!optionalKey && !key.trim()) {
      setKeyError(t('setting.api-key-can-not-be-empty'));
      return;
    }
    if (!model.trim()) {
      setError(t('setting.model-type-can-not-be-empty'));
      return;
    }
    if (!endpoint.trim()) {
      setError(t('setting.api-host-can-not-be-empty'));
      return;
    }
    setBusy(true);
    try {
      const config = parseModelConfigJson(parameters);
      // Thinking effort belongs to the input box, not a saved configuration.
      if ('reasoning_effort' in config || 'thinking_effort' in config)
        throw new Error(t('setting.model-list.effort-hint'));
      const url =
        provider.id === 'ollama' && canAutoFixOllamaEndpoint(endpoint)
          ? appendV1ToEndpoint(endpoint)
          : endpoint.trim();
      const apiKey = key.trim() || (local ? 'not-required' : '');
      if (provider.id === 'llama.cpp') {
        // Preserve llama.cpp's health-check path: its tool-call validation is not compatible.
        const health = await fetch(`${toEndpointBaseUrl(url)}/v1/health`, {
          headers: key ? { Authorization: `Bearer ${key}` } : undefined,
        });
        if (!health.ok) throw new Error(t('setting.models-connection-failed'));
      } else {
        const validation = await fetchPost('/model/validate', {
          model_platform: provider.id,
          model_type: model.trim(),
          api_key: apiKey || null,
          url,
          model_config_dict: config,
          extra_params: Object.fromEntries(
            Object.entries(extra).filter(
              ([key]) =>
                !['model_platform', 'model_type', 'api_key', 'url'].includes(
                  key
                )
            )
          ),
        });
        if (!validation.is_valid || !validation.is_tool_calls) {
          const message =
            validation.message ??
            validation.detail?.message ??
            validation.detail?.error?.message;
          throw new Error(
            typeof message === 'string' ? message : t('setting.validate-failed')
          );
        }
      }
      if (
        !active.current ||
        getAuthStore().user_id !== savingAccount ||
        getAuthStore().email !== savingEmail
      )
        return;
      // Editing model fields must not resurrect a removed record or overwrite a
      // default that changed while this dialog was open.
      const currentRecord = record
        ? (await fetchConfiguredProviders()).find(
            (item) => item.id === record.id
          )
        : undefined;
      if (record && !currentRecord)
        throw new Error(t('setting.model-list.missing-configuration'));
      if (
        !active.current ||
        getAuthStore().user_id !== savingAccount ||
        getAuthStore().email !== savingEmail
      )
        return;
      const payload = {
        provider_name: provider.id,
        model_type: model.trim(),
        api_key: apiKey,
        endpoint_url: url,
        is_valid: toProviderValidStatus(true),
        prefer: currentRecord?.prefer ?? false,
        encrypted_config: buildProviderConfig(
          local
            ? {
                ...extra,
                model_platform: provider.id,
                model_type: model.trim(),
              }
            : extra,
          config
        ),
      };
      if (record) await proxyFetchPut(`/api/v1/provider/${record.id}`, payload);
      else await proxyFetchPost('/api/v1/provider', payload);
      notifyModelConfigurationsChanged();
      if (active.current) onClose();
    } catch (cause) {
      if (active.current)
        setError(
          cause instanceof Error ? cause.message : t('setting.save-failed')
        );
    } finally {
      if (active.current) setBusy(false);
    }
  }

  const labels: Record<string, string> = {
    region_name: 'setting.region',
    aws_access_key_id: 'setting.access-key-id',
    aws_secret_access_key: 'setting.secret-access-key',
    aws_session_token: 'setting.session-token-optional',
    api_version: 'setting.api-version',
    azure_deployment_name: 'setting.deployment-name',
  };
  const toggleSecret = (id: string) =>
    setVisibleSecrets((old) =>
      old.includes(id) ? old.filter((item) => item !== id) : [...old, id]
    );

  return (
    <>
      <DialogHeader
        title={`${t(record ? 'setting.model-list.edit-model' : 'setting.model-list.add-model')} · ${provider.name}`}
        subtitle={t(
          provider.id === 'aws-bedrock-converse'
            ? 'setting.aws-bedrock-converse-description'
            : 'setting.provider-configuration-description',
          { provider: provider.name }
        )}
      />
      <form onSubmit={save} className="flex min-h-0 flex-col">
        <div className="scrollbar-always-visible min-h-0 overflow-y-auto">
          <fieldset
            disabled={busy}
            className="m-0 flex min-w-0 flex-col gap-ds-16 border-0 border-x-0 border-y-0 p-ds-panel-inset"
          >
            <div className="flex flex-col gap-ds-stack-related">
              <label htmlFor={`apiKey-${provider.id}`}>
                <DsText as="span" weight="medium">
                  {t('setting.api-key-setting')}
                  {optionalKey ? ` · ${t('setting.model-list.optional')}` : ''}
                </DsText>
              </label>
              <div className="flex items-center gap-ds-control-gap">
                <Input
                  id={`apiKey-${provider.id}`}
                  autoFocus
                  type={
                    visibleSecrets.includes('api-key') ? 'text' : 'password'
                  }
                  autoComplete="off"
                  value={key}
                  placeholder={t('setting.enter-your-api-key')}
                  aria-invalid={Boolean(keyError)}
                  aria-describedby={keyError ? 'model-key-error' : undefined}
                  onChange={(event) => {
                    setKey(event.target.value);
                    invalidateDiscovery();
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  buttonContent="icon-only"
                  aria-label={t(
                    visibleSecrets.includes('api-key')
                      ? 'setting.model-list.hide-key'
                      : 'setting.model-list.show-key'
                  )}
                  onClick={() => toggleSecret('api-key')}
                >
                  {visibleSecrets.includes('api-key') ? <EyeOff /> : <Eye />}
                </Button>
              </div>
              {keyError && (
                <DsText
                  id="model-key-error"
                  className="text-ds-text-error-default-default"
                >
                  {keyError}
                </DsText>
              )}
            </div>
            <div className="flex flex-col gap-ds-stack-related">
              <label htmlFor="model-endpoint">
                <DsText as="span" weight="medium">
                  {t('setting.api-host-setting')}
                </DsText>
              </label>
              <Input
                id="model-endpoint"
                value={endpoint}
                placeholder={provider.hostPlaceHolder || provider.apiHost}
                onChange={(event) => {
                  setEndpoint(event.target.value);
                  invalidateDiscovery(true);
                }}
              />
            </div>
            {provider.externalConfig?.map((field) => (
              <div
                key={field.key}
                className="flex flex-col gap-ds-stack-related"
              >
                <label htmlFor={`model-${field.key}`}>
                  <DsText as="span" weight="medium">
                    {labels[field.key] ? t(labels[field.key]) : field.name}
                  </DsText>
                </label>
                {field.options ? (
                  <Select
                    value={String(extra[field.key] ?? '')}
                    onValueChange={(value) =>
                      setExtra((old) => ({ ...old, [field.key]: value }))
                    }
                  >
                    <SelectTrigger id={`model-${field.key}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex items-center gap-ds-control-gap">
                    <Input
                      id={`model-${field.key}`}
                      type={
                        field.secret && !visibleSecrets.includes(field.key)
                          ? 'password'
                          : 'text'
                      }
                      autoComplete="off"
                      value={String(extra[field.key] ?? '')}
                      placeholder={field.placeholder}
                      onChange={(event) =>
                        setExtra((old) => ({
                          ...old,
                          [field.key]: event.target.value,
                        }))
                      }
                    />
                    {field.secret && (
                      <Button
                        type="button"
                        variant="ghost"
                        buttonContent="icon-only"
                        aria-label={t(
                          visibleSecrets.includes(field.key)
                            ? 'setting.model-list.hide-key'
                            : 'setting.model-list.show-key'
                        )}
                        onClick={() => toggleSecret(field.key)}
                      >
                        {visibleSecrets.includes(field.key) ? (
                          <EyeOff />
                        ) : (
                          <Eye />
                        )}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div className="flex flex-col gap-ds-stack-related">
              {discoverable && !manual ? (
                <ProviderModelCombobox
                  providerName={provider.name}
                  title={t('setting.model-type-setting')}
                  value={model}
                  onChange={setModel}
                  groups={groups}
                  loading={discovering}
                  error={null}
                  fetchError={discoveryError}
                  disabled={!optionalKey && !key.trim()}
                  disabledReason={t('setting.models-api-key-required')}
                  onRefresh={discover}
                />
              ) : (
                <>
                  <label htmlFor="model-type">
                    <DsText as="span" weight="medium">
                      {t('setting.model-type-setting')}
                    </DsText>
                  </label>
                  <Input
                    id="model-type"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder={
                      provider.model_type || t('setting.enter-your-model-type')
                    }
                  />
                </>
              )}
              {discoverable && (
                <Button
                  type="button"
                  variant="text"
                  size="sm"
                  className="self-start"
                  onClick={() => setManual(!manual)}
                >
                  {t(
                    manual
                      ? 'setting.model-list.choose-model'
                      : 'setting.model-list.enter-model'
                  )}
                </Button>
              )}
            </div>
            <div className="flex flex-col gap-ds-stack-related">
              <label htmlFor="model-parameters">
                <DsText as="span" weight="medium">
                  {t('setting.model-parameters-setting')}
                </DsText>
              </label>
              <Textarea
                id="model-parameters"
                variant="outlined"
                value={parameters}
                placeholder={t('setting.model-parameters-placeholder')}
                onChange={(event) => setParameters(event.target.value)}
              />
              <DsText role="meta" className="text-ds-ink-muted-default">
                {t('setting.model-list.effort-hint')}
              </DsText>
            </div>
            {error && (
              <div role="alert">
                <DsText className="text-ds-text-error-default-default">
                  {error}
                </DsText>
              </div>
            )}
          </fieldset>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-ds-control-gap border-x-0 border-y-0 border-t border-solid border-ds-hairline-default-default p-ds-panel-inset">
          {onBack && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={onBack}
            >
              <ArrowLeft />
              {t('layout.back')}
            </Button>
          )}
          <div className="ml-auto flex items-center gap-ds-control-gap">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={onClose}
            >
              {t('setting.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy && (
                <Loader2 className="animate-spin motion-reduce:animate-none" />
              )}
              {t('setting.save')}
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}

export function ModelConfigurationDialog(props: Props) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) props.onClose();
      }}
    >
      <DialogContent
        size="md"
        overlayVariant="dimmed"
        showCloseButton={!busy}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById(`add-model-${props.provider.id}`)?.focus();
          if (!document.getElementById(`add-model-${props.provider.id}`))
            document.getElementById('add-model-provider')?.focus();
        }}
      >
        <ModelConfigurationContent {...props} onBusyChange={setBusy} />
      </DialogContent>
    </Dialog>
  );
}
