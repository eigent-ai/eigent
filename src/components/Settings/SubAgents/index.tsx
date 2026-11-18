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

import { proxyFetchDelete, proxyFetchGet } from '@/api/http';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { Switch } from '@/components/ui/switch';
import {
  GEMINI_REMOTE_SUB_AGENT_PROVIDER,
  hasRemoteSubAgentSettings,
  normalizeRemoteSubAgentProviders,
  REMOTE_SUB_AGENT_PROVIDERS,
  remoteSubAgentProviderDefinition,
  type RemoteSubAgentFormState,
  type RemoteSubAgentProviderName,
} from '@/lib/remoteSubAgent';
import {
  getModelImage,
  needsInvertModelImage,
} from '@/shared/modelProviderImages';
import { useAuthStore } from '@/store/authStore';
import { LoaderCircle, MoreHorizontal } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import SettingsSectionPage from '../SettingsSectionPage';
import {
  checkRemoteSubAgentConnection,
  REMOTE_SUB_AGENT_PROVIDERS_PATH,
  remoteSubAgentErrorMessage,
  saveRemoteSubAgentForm,
} from './requests';
import { SubAgentConfigurationDialog } from './SubAgentConfigurationDialog';

const detailRowClass =
  'flex min-h-[var(--ds-row-comfortable-min-height)] items-center justify-between gap-ds-12 px-ds-12 py-ds-12';

export default function SubAgents() {
  const { t } = useTranslation();
  const appearance = useAuthStore((state) => state.appearance);
  const [forms, setForms] = useState(() =>
    normalizeRemoteSubAgentProviders([])
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<RemoteSubAgentProviderName | null>(
    null
  );
  const [removing, setRemoving] = useState<RemoteSubAgentProviderName | null>(
    null
  );
  const [removeError, setRemoveError] = useState('');
  const [busy, setBusy] = useState<RemoteSubAgentProviderName | null>(null);

  const load = useCallback(async () => {
    const res = await proxyFetchGet(REMOTE_SUB_AGENT_PROVIDERS_PATH);
    const providerList = Array.isArray(res) ? res : res?.items || [];
    setForms(normalizeRemoteSubAgentProviders(providerList));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      await load();
    } catch (error) {
      console.error('Error fetching remote sub agent providers:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const providerName = (provider: RemoteSubAgentProviderName) =>
    provider === GEMINI_REMOTE_SUB_AGENT_PROVIDER
      ? t('setting.gemini-agent')
      : t('setting.sub-agent-list.modelark-name');
  const providerDescription = (provider: RemoteSubAgentProviderName) =>
    provider === GEMINI_REMOTE_SUB_AGENT_PROVIDER
      ? t('setting.sub-agent-list.gemini-description')
      : t('setting.sub-agent-list.modelark-description');

  async function toggle(provider: RemoteSubAgentProviderName, on: boolean) {
    const form = forms[provider];
    if (on && !hasRemoteSubAgentSettings(form)) {
      setEditing(provider);
      return;
    }
    setBusy(provider);
    try {
      const next = { ...form, enabled: on };
      if (on) {
        await checkRemoteSubAgentConnection(next, t('setting.validate-failed'));
      }
      await saveRemoteSubAgentForm(next);
      // Turning one provider on turns the others off on the server.
      await load();
    } catch (error) {
      toast.error(
        remoteSubAgentErrorMessage(error, t('setting.validate-failed'))
      );
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    const form = removing ? forms[removing] : null;
    if (!removing || !form?.provider_id) return;
    setBusy(removing);
    setRemoveError('');
    try {
      await proxyFetchDelete(
        `${REMOTE_SUB_AGENT_PROVIDERS_PATH}/${form.provider_id}`
      );
      setRemoving(null);
      toast.success(t('setting.sub-agent-list.removed'));
      await load();
    } catch (error) {
      console.error('Error removing remote sub agent provider:', error);
      setRemoveError(t('setting.reset-failed'));
    } finally {
      setBusy(null);
    }
  }

  function logo(provider: RemoteSubAgentProviderName) {
    const id = remoteSubAgentProviderDefinition(provider).logo;
    const src = getModelImage(id);
    return src ? (
      <img
        src={src}
        alt=""
        className={`size-ds-24 shrink-0 object-contain ${needsInvertModelImage(id, appearance) ? 'invert' : ''}`}
      />
    ) : null;
  }

  function status(form: RemoteSubAgentFormState) {
    if (loading) {
      return (
        <Badge variant="secondary" size="xs" role="status">
          <DsIcon
            icon={LoaderCircle}
            recipe="main-compact"
            className="motion-safe:animate-spin"
          />
          <span className="sr-only">{t('setting.sub-agent-list.loading')}</span>
        </Badge>
      );
    }
    // Without the saved list the status is unknown, not "Not configured".
    if (loadError) return null;
    if (!hasRemoteSubAgentSettings(form)) {
      return (
        <Badge variant="secondary" size="xs">
          {t('setting.not-configured')}
        </Badge>
      );
    }
    return (
      <>
        <Badge variant="secondary" size="xs" tone="success">
          {t('setting.configured')}
        </Badge>
        {form.enabled && (
          <Badge variant="secondary" size="xs" tone="information">
            {t('setting.sub-agent-list.in-use')}
          </Badge>
        )}
      </>
    );
  }

  function detail(label: string, value: string) {
    return (
      <div className={detailRowClass}>
        <DsText className="shrink-0 text-ds-ink-muted-default">{label}</DsText>
        <DsText
          channel="code"
          className="min-w-0 truncate text-right"
          title={value}
        >
          {value}
        </DsText>
      </div>
    );
  }

  const editingForm = editing ? forms[editing] : null;
  const otherProviderEnabled = REMOTE_SUB_AGENT_PROVIDERS.some(
    ({ id }) => id !== editing && forms[id].enabled
  );

  return (
    <>
      <SettingsSectionPage className="gap-ds-24 py-ds-24">
        <DsText className="text-ds-ink-muted-default">
          {t('setting.sub-agent-list.intro')}
        </DsText>
        {loadError && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-ds-control-gap"
          >
            <DsText>{t('setting.sub-agent-list.load-error')}</DsText>
            <Button variant="secondary" size="sm" onClick={refresh}>
              {t('setting.sub-agent-list.retry')}
            </Button>
          </div>
        )}
        <div className="flex flex-col gap-ds-16">
          {REMOTE_SUB_AGENT_PROVIDERS.map(({ id, requiresEnvironment }) => {
            const form = forms[id];
            const name = providerName(id);
            const configured = hasRemoteSubAgentSettings(form);
            const controlsDisabled = loading || loadError || busy !== null;
            return (
              <section
                key={id}
                data-sub-agent-provider={id}
                aria-label={name}
                aria-busy={busy === id}
                className="overflow-hidden rounded-2xl bg-ds-neutral-default-default"
              >
                <header className="flex flex-wrap items-center justify-between gap-ds-control-gap px-ds-card-inset py-ds-12">
                  <div className="flex min-w-0 items-center gap-ds-control-gap">
                    {logo(id)}
                    <div className="flex min-w-0 flex-wrap items-center gap-ds-8">
                      <DsText as="h2" role="body-large" weight="semibold">
                        {name}
                      </DsText>
                      {status(form)}
                    </div>
                  </div>
                  <div className="flex items-center gap-ds-8">
                    <Button
                      id={`sub-agent-configure-${id}`}
                      variant="secondary"
                      size="sm"
                      disabled={controlsDisabled}
                      onClick={() => setEditing(id)}
                    >
                      {t(
                        configured
                          ? 'setting.edit'
                          : 'setting.sub-agent-list.set-up'
                      )}
                    </Button>
                    {form.provider_id !== undefined && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            buttonContent="icon-only"
                            disabled={controlsDisabled}
                            aria-label={t('setting.sub-agent-list.actions', {
                              provider: name,
                            })}
                          >
                            <DsIcon icon={MoreHorizontal} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => {
                              setRemoveError('');
                              setRemoving(id);
                            }}
                          >
                            {t('setting.sub-agent-list.remove')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    <Switch
                      size="sm"
                      variant="outline"
                      aria-label={t('setting.sub-agent-list.use-provider', {
                        provider: name,
                      })}
                      checked={form.enabled}
                      disabled={controlsDisabled}
                      onCheckedChange={(checked) => void toggle(id, checked)}
                    />
                  </div>
                </header>
                {!loading && !loadError && (
                  <div className="mx-ds-16 flex flex-col divide-y divide-ds-hairline-subtle-disabled border-x-0 border-t border-b-0 border-solid border-ds-hairline-subtle-default">
                    {configured ? (
                      <>
                        {detail(t('setting.agent-id'), form.agentName.trim())}
                        {requiresEnvironment &&
                          detail(
                            t('setting.sub-agent-list.environment-id'),
                            form.environmentId.trim()
                          )}
                        {detail(
                          t('setting.sub-agent-list.api-host'),
                          form.baseUrl.trim()
                        )}
                      </>
                    ) : (
                      <DsText className="px-ds-12 py-ds-12 text-ds-ink-muted-default">
                        {providerDescription(id)}{' '}
                        {t('setting.sub-agent-list.not-configured-hint')}
                      </DsText>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </SettingsSectionPage>
      {editingForm && (
        <SubAgentConfigurationDialog
          key={editingForm.provider}
          form={editingForm}
          providerName={providerName(editingForm.provider)}
          description={providerDescription(editingForm.provider)}
          enableOnSave={!otherProviderEnabled}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && busy === null) setRemoving(null);
        }}
      >
        <DialogContent
          size="sm"
          overlayVariant="dimmed"
          showCloseButton={busy === null}
        >
          <DialogHeader
            title={
              removing
                ? t('setting.sub-agent-list.remove-title', {
                    provider: providerName(removing),
                  })
                : undefined
            }
            subtitle={
              removing
                ? t('setting.sub-agent-list.remove-hint', {
                    provider: providerName(removing),
                  })
                : undefined
            }
          />
          <div className="flex flex-col gap-ds-stack-related p-ds-panel-inset">
            {removeError && (
              <div role="alert">
                <DsText className="text-ds-text-error-default-default">
                  {removeError}
                </DsText>
              </div>
            )}
            <div className="flex justify-end gap-ds-control-gap">
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() => setRemoving(null)}
              >
                {t('setting.cancel')}
              </Button>
              <Button
                variant="primary"
                tone="error"
                disabled={busy !== null}
                onClick={remove}
              >
                {t('setting.sub-agent-list.remove')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
