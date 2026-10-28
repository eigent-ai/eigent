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

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { Input } from '@/components/ui/input';
import {
  hasRemoteSubAgentSettings,
  remoteSubAgentProviderDefinition,
  type RemoteSubAgentFormState,
} from '@/lib/remoteSubAgent';
import { ArrowUpRight, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  checkRemoteSubAgentConnection,
  remoteSubAgentErrorMessage,
  saveRemoteSubAgentForm,
} from './requests';

type Props = {
  form: RemoteSubAgentFormState;
  providerName: string;
  description: string;
  /** Turn the provider on when saving, because no other provider is on. */
  enableOnSave: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

const isPositive = (value: string) => {
  const parsed = Number(value.trim());
  return value.trim() !== '' && Number.isFinite(parsed) && parsed > 0;
};

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-ds-stack-related">
      <label htmlFor={id}>
        <DsText as="span" weight="medium">
          {label}
        </DsText>
      </label>
      {children}
    </div>
  );
}

export function SubAgentConfigurationDialog({
  form,
  providerName,
  description,
  enableOnSave,
  onClose,
  onSaved,
}: Props) {
  const { t } = useTranslation();
  const definition = remoteSubAgentProviderDefinition(form.provider);
  const [apiKey, setApiKey] = useState(form.apiKey);
  const [baseUrl, setBaseUrl] = useState(form.baseUrl);
  const [agentName, setAgentName] = useState(form.agentName);
  const [environmentId, setEnvironmentId] = useState(form.environmentId);
  const [maxWallTimeSeconds, setMaxWallTimeSeconds] = useState(
    form.maxWallTimeSeconds
  );
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState(
    form.pollIntervalSeconds
  );
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const fieldId = (name: string) => `sub-agent-${form.provider}-${name}`;
  const errorId = fieldId('error');
  const describedBy = error ? errorId : undefined;
  const editing = hasRemoteSubAgentSettings(form);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    const next: RemoteSubAgentFormState = {
      ...form,
      enabled: form.enabled || enableOnSave,
      apiKey,
      baseUrl,
      agentName,
      environmentId,
      maxWallTimeSeconds,
      pollIntervalSeconds,
    };
    if (!hasRemoteSubAgentSettings(next)) {
      setError(
        t(
          definition.requiresEnvironment
            ? 'setting.sub-agent-list.required-fields-environment'
            : 'setting.sub-agent-list.required-fields'
        )
      );
      return;
    }
    if (
      !isPositive(maxWallTimeSeconds) ||
      (definition.usesPollInterval && !isPositive(pollIntervalSeconds))
    ) {
      setError(t('setting.sub-agent-list.positive-seconds'));
      return;
    }

    setBusy(true);
    try {
      await checkRemoteSubAgentConnection(next, t('setting.validate-failed'));
      await saveRemoteSubAgentForm(next);
      toast.success(t('setting.sub-agent-list.saved'));
      await onSaved();
      if (active.current) onClose();
    } catch (cause) {
      if (active.current)
        setError(remoteSubAgentErrorMessage(cause, t('setting.save-failed')));
    } finally {
      if (active.current) setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        size="md"
        overlayVariant="dimmed"
        showCloseButton={!busy}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document
            .getElementById(`sub-agent-configure-${form.provider}`)
            ?.focus();
        }}
      >
        <DialogHeader
          title={t(
            editing
              ? 'setting.sub-agent-list.edit-title'
              : 'setting.sub-agent-list.set-up-title',
            { provider: providerName }
          )}
          subtitle={description}
        />
        <form onSubmit={save} className="flex min-h-0 flex-col">
          <div className="scrollbar-always-visible min-h-0 overflow-y-auto">
            <fieldset
              disabled={busy}
              className="m-0 flex min-w-0 flex-col gap-ds-16 border-0 border-x-0 border-y-0 p-ds-panel-inset"
            >
              <Field
                id={fieldId('api-key')}
                label={t('setting.sub-agent-list.api-key')}
              >
                <div className="flex items-center gap-ds-control-gap">
                  <Input
                    id={fieldId('api-key')}
                    autoFocus
                    type={showKey ? 'text' : 'password'}
                    autoComplete="off"
                    value={apiKey}
                    placeholder={t('setting.enter-your-api-key')}
                    aria-describedby={describedBy}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    buttonContent="icon-only"
                    aria-label={t(
                      showKey
                        ? 'setting.model-list.hide-key'
                        : 'setting.model-list.show-key'
                    )}
                    onClick={() => setShowKey((visible) => !visible)}
                  >
                    {showKey ? <DsIcon icon={EyeOff} /> : <DsIcon icon={Eye} />}
                  </Button>
                </div>
              </Field>
              <Field
                id={fieldId('api-host')}
                label={t('setting.sub-agent-list.api-host')}
              >
                <Input
                  id={fieldId('api-host')}
                  autoComplete="off"
                  value={baseUrl}
                  placeholder={definition.defaultBaseUrl}
                  aria-describedby={describedBy}
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
              </Field>
              <Field id={fieldId('agent-id')} label={t('setting.agent-id')}>
                <Input
                  id={fieldId('agent-id')}
                  autoComplete="off"
                  value={agentName}
                  aria-describedby={describedBy}
                  onChange={(event) => setAgentName(event.target.value)}
                />
              </Field>
              {definition.requiresEnvironment && (
                <Field
                  id={fieldId('environment-id')}
                  label={t('setting.sub-agent-list.environment-id')}
                >
                  <Input
                    id={fieldId('environment-id')}
                    autoComplete="off"
                    value={environmentId}
                    aria-describedby={describedBy}
                    onChange={(event) => setEnvironmentId(event.target.value)}
                  />
                </Field>
              )}
              <div className="grid grid-cols-1 gap-ds-16 sm:grid-cols-2">
                <Field
                  id={fieldId('max-run-time')}
                  label={t('setting.sub-agent-list.max-run-time')}
                >
                  <Input
                    id={fieldId('max-run-time')}
                    inputMode="numeric"
                    value={maxWallTimeSeconds}
                    aria-describedby={describedBy}
                    onChange={(event) =>
                      setMaxWallTimeSeconds(event.target.value)
                    }
                  />
                </Field>
                {definition.usesPollInterval && (
                  <Field
                    id={fieldId('poll-interval')}
                    label={t('setting.sub-agent-list.poll-interval')}
                  >
                    <Input
                      id={fieldId('poll-interval')}
                      inputMode="decimal"
                      value={pollIntervalSeconds}
                      aria-describedby={describedBy}
                      onChange={(event) =>
                        setPollIntervalSeconds(event.target.value)
                      }
                    />
                  </Field>
                )}
              </div>
              {definition.docsUrl && (
                <div className="flex flex-col gap-ds-stack-related">
                  <DsText role="meta" className="text-ds-ink-muted-default">
                    {t('setting.sub-agent-list.modelark-hint')}
                  </DsText>
                  <Button
                    asChild
                    variant="text"
                    size="sm"
                    className="self-start"
                  >
                    <a
                      href={definition.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('setting.sub-agent-list.modelark-docs')}
                      <DsIcon icon={ArrowUpRight} />
                    </a>
                  </Button>
                </div>
              )}
              {error && (
                <div role="alert">
                  <DsText
                    id={errorId}
                    className="text-ds-text-error-default-default"
                  >
                    {error}
                  </DsText>
                </div>
              )}
            </fieldset>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-ds-control-gap border-x-0 border-y-0 border-t border-solid border-ds-hairline-default-default p-ds-panel-inset">
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
                <DsIcon
                  icon={Loader2}
                  className="animate-spin motion-reduce:animate-none"
                />
              )}
              {t('setting.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
