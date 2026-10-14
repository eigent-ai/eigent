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
import { DsText } from '@/components/ui/ds-text';
import { Input } from '@/components/ui/input';
import { createHost } from '@/host/createHost';
import { notifyModelConfigurationsChanged } from '@/lib/configuredModels';
import { useAuthStore } from '@/store/authStore';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  connected: boolean;
  accountLabel: string;
  onClose: () => void;
  onBack?: () => void;
};

type ContentProps = Props & {
  onBusyChange?: (busy: boolean) => void;
};

export function CodexConfigurationContent({
  connected,
  accountLabel,
  onClose,
  onBack,
  onBusyChange,
}: ContentProps) {
  const { t } = useTranslation();
  const { email, codex_model_type, modelType, setCodexModelType } =
    useAuthStore();
  const [model, setModel] = useState(codex_model_type);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  async function authenticate(disconnect: boolean) {
    setBusy(true);
    setError('');
    try {
      if (!email) throw new Error(t('setting.login-required'));
      const api = createHost().electronAPI;
      const result = disconnect
        ? await api?.codexSubscriptionDisconnect?.(email)
        : await api?.codexSubscriptionLogin?.(email);
      if (!result?.success) {
        const errors: Record<string, string> = {
          oauth_callback_port_in_use: 'codex-port-in-use',
          oauth_callback_unavailable: 'codex-callback-unavailable',
          oauth_open_browser_failed: 'codex-open-browser-failed',
          oauth_state_expired: 'codex-state-expired',
          oauth_state_mismatch: 'codex-state-mismatch',
          access_denied: 'codex-access-denied',
        };
        throw new Error(
          t(
            `setting.${errors[result?.error_code ?? ''] ?? 'codex-login-failed'}`
          )
        );
      }
      notifyModelConfigurationsChanged();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t('setting.save-failed')
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <DialogHeader
        title="Codex"
        subtitle={t('setting.provider-configuration-description', {
          provider: 'Codex',
        })}
      />
      <div className="flex flex-col gap-ds-stack-section p-ds-panel-inset">
        <div className="flex flex-wrap items-center justify-between gap-ds-control-gap">
          <DsText>
            {connected
              ? accountLabel || t('connectors.connected')
              : t('setting.not-configured')}
          </DsText>
          <Button
            variant="secondary"
            disabled={busy || (connected && modelType === 'codex_subscription')}
            onClick={() => authenticate(connected)}
          >
            {t(connected ? 'setting.disconnect' : 'layout.login')}
          </Button>
        </div>
        {connected && modelType === 'codex_subscription' && (
          <DsText role="meta" className="text-ds-ink-muted-default">
            {t('setting.model-list.default-guard')}
          </DsText>
        )}
        <label htmlFor="codex-model">
          <DsText as="span">{t('setting.model-type')}</DsText>
        </label>
        <Input
          id="codex-model"
          autoFocus
          value={model}
          onChange={(event) => setModel(event.target.value)}
          disabled={busy}
        />
        {error && (
          <div role="alert">
            <DsText className="text-ds-text-error-default-default">
              {error}
            </DsText>
          </div>
        )}
        <div className="flex items-center justify-between gap-ds-control-gap">
          {onBack && (
            <Button variant="ghost" disabled={busy} onClick={onBack}>
              <ArrowLeft />
              {t('layout.back')}
            </Button>
          )}
          <div className="ml-auto flex items-center gap-ds-control-gap">
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              {t('setting.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={busy || !model.trim()}
              onClick={() => {
                setCodexModelType(model.trim());
                notifyModelConfigurationsChanged();
                onClose();
              }}
            >
              {t('setting.save')}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

export function CodexConfigurationDialog(props: Props) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) props.onClose();
      }}
    >
      <DialogContent size="md" overlayVariant="dimmed" showCloseButton={!busy}>
        <CodexConfigurationContent {...props} onBusyChange={setBusy} />
      </DialogContent>
    </Dialog>
  );
}
