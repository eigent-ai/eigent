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

import { proxyFetchPost } from '@/api/http';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { useHost } from '@/host/context';
import {
  APPLE_INTELLIGENCE_API_KEY,
  APPLE_INTELLIGENCE_NAME,
  APPLE_INTELLIGENCE_PROVIDER_ID,
  APPLE_ON_DEVICE_MODEL,
  appleIntelligenceStatusKey,
  fetchAppleIntelligenceStatus,
  onDeviceModel,
  testAppleIntelligence,
  UNREADABLE_APPLE_INTELLIGENCE_STATUS,
  type AppleIntelligenceStatus,
} from '@/lib/appleIntelligence';
import {
  notifyModelConfigurationsChanged,
  type ConfiguredProvider,
} from '@/lib/configuredModels';
import { buildProviderConfig } from '@/lib/modelConfig';
import { toProviderValidStatus } from '@/lib/providerStatus';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  records: ConfiguredProvider[];
  onClose: () => void;
  onBack?: () => void;
};

type ContentProps = Props & {
  onBusyChange?: (busy: boolean) => void;
};

const RETRYABLE = new Set([
  'apple_intelligence_off',
  'model_not_ready',
  'bridge_unavailable',
]);

export function AppleIntelligenceConfigurationContent({
  records,
  onClose,
  onBack,
  onBusyChange,
}: ContentProps) {
  const { t } = useTranslation();
  const electronAPI = useHost()?.electronAPI;
  // Opening the provider is what starts the bridge (plan §4.2, Lifecycle).
  const [status, setStatus] = useState<AppleIntelligenceStatus | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | 'refresh' | null>(null);
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState('');
  useEffect(() => {
    onBusyChange?.(busy !== null);
  }, [busy, onBusyChange]);
  useEffect(() => {
    let active = true;
    void fetchAppleIntelligenceStatus().then((next) => {
      if (active) setStatus(next ?? UNREADABLE_APPLE_INTELLIGENCE_STATUS);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!status) {
    return (
      <>
        <DialogHeader
          title={APPLE_INTELLIGENCE_NAME}
          subtitle={t('setting.apple-intelligence.description')}
        />
        <div
          role="status"
          className="flex items-center gap-ds-control-gap p-ds-panel-inset"
        >
          <DsIcon
            icon={Loader2}
            className="animate-spin motion-reduce:animate-none"
          />
          <DsText>{t('setting.apple-intelligence.checking')}</DsText>
        </div>
      </>
    );
  }

  const model = onDeviceModel(status);
  const saved = records.some(
    (record) =>
      record.provider_name === APPLE_INTELLIGENCE_PROVIDER_ID &&
      record.model_type === APPLE_ON_DEVICE_MODEL
  );
  const canOpenSettings =
    status.reason === 'apple_intelligence_off' &&
    Boolean(electronAPI?.openAppleIntelligenceSettings);

  async function refresh() {
    setBusy('refresh');
    setError('');
    try {
      setStatus(
        (await fetchAppleIntelligenceStatus(true)) ??
          UNREADABLE_APPLE_INTELLIGENCE_STATUS
      );
    } finally {
      setBusy(null);
    }
  }

  async function runTest() {
    setBusy('test');
    setError('');
    setTestResult('');
    try {
      const result = await testAppleIntelligence();
      if (result.ok) {
        setTestResult(
          t('setting.apple-intelligence.test-passed', {
            seconds: ((result.elapsed_ms ?? 0) / 1000).toFixed(1),
          })
        );
      } else {
        setError(result.message || t('setting.apple-intelligence.test-failed'));
      }
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy('save');
    setError('');
    try {
      await proxyFetchPost('/api/v1/provider', {
        provider_name: APPLE_INTELLIGENCE_PROVIDER_ID,
        model_type: APPLE_ON_DEVICE_MODEL,
        api_key: APPLE_INTELLIGENCE_API_KEY,
        // The bridge's address changes every time it starts, so the backend
        // fills it in when the model is built.
        endpoint_url: '',
        is_valid: toProviderValidStatus(true),
        prefer: false,
        encrypted_config: buildProviderConfig(
          {
            model_platform: APPLE_INTELLIGENCE_PROVIDER_ID,
            model_type: APPLE_ON_DEVICE_MODEL,
          },
          {}
        ),
      });
      notifyModelConfigurationsChanged();
      onClose();
    } catch {
      setError(t('setting.save-failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <DialogHeader
        title={APPLE_INTELLIGENCE_NAME}
        subtitle={t('setting.apple-intelligence.description')}
      />
      <div className="flex flex-col gap-ds-stack-section p-ds-panel-inset">
        <div className="flex flex-col gap-ds-stack-related" role="status">
          <div className="flex flex-wrap items-center gap-ds-control-gap">
            <Badge
              variant="secondary"
              size="xs"
              tone={status.available ? 'success' : 'error'}
            >
              {t(
                status.available
                  ? 'setting.apple-intelligence.badge-ready'
                  : 'setting.apple-intelligence.badge-unavailable'
              )}
            </Badge>
            <DsText>{t(appleIntelligenceStatusKey(status))}</DsText>
          </div>
          {(canOpenSettings || RETRYABLE.has(status.reason ?? '')) && (
            <div className="flex flex-wrap items-center gap-ds-control-gap">
              {canOpenSettings && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    void electronAPI?.openAppleIntelligenceSettings?.()
                  }
                >
                  {t('setting.apple-intelligence.open-system-settings')}
                </Button>
              )}
              {RETRYABLE.has(status.reason ?? '') && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={refresh}
                >
                  {busy === 'refresh' && (
                    <DsIcon
                      icon={Loader2}
                      className="animate-spin motion-reduce:animate-none"
                    />
                  )}
                  {t('setting.apple-intelligence.try-again')}
                </Button>
              )}
            </div>
          )}
        </div>
        {model && status.available && (
          <div className="flex flex-col gap-ds-stack-related">
            <DsText weight="medium">
              {t('setting.apple-intelligence.on-device-model')}
            </DsText>
            <div className="flex flex-wrap items-center gap-ds-control-gap">
              <Badge variant="secondary" size="xs">
                {t('setting.apple-intelligence.on-this-mac')}
              </Badge>
              <Badge variant="secondary" size="xs">
                {t('setting.apple-intelligence.text-only')}
              </Badge>
              {model.context_size !== null && (
                <Badge variant="secondary" size="xs">
                  {t('setting.apple-intelligence.context', {
                    size: `${Math.round(model.context_size / 1024)}K`,
                  })}
                </Badge>
              )}
            </div>
          </div>
        )}
        <DsText role="meta" className="text-ds-ink-muted-default">
          {t('setting.apple-intelligence.privacy')}
        </DsText>
        <DsText role="meta" className="text-ds-ink-muted-default">
          {t('setting.apple-intelligence.limits')}
        </DsText>
        {testResult && (
          <DsText role="meta" className="text-ds-text-success-default-default">
            {testResult}
          </DsText>
        )}
        {error && (
          <div role="alert">
            <DsText className="text-ds-text-error-default-default">
              {error}
            </DsText>
          </div>
        )}
        <div className="flex items-center justify-between gap-ds-control-gap">
          {onBack && (
            <Button variant="ghost" disabled={busy !== null} onClick={onBack}>
              <DsIcon icon={ArrowLeft} />
              {t('layout.back')}
            </Button>
          )}
          <div className="ml-auto flex items-center gap-ds-control-gap">
            <Button variant="ghost" disabled={busy !== null} onClick={onClose}>
              {t('setting.cancel')}
            </Button>
            <Button
              variant="secondary"
              disabled={busy !== null || !status.available}
              onClick={runTest}
            >
              {busy === 'test' && (
                <DsIcon
                  icon={Loader2}
                  className="animate-spin motion-reduce:animate-none"
                />
              )}
              {t('setting.apple-intelligence.test')}
            </Button>
            <Button
              variant="primary"
              disabled={busy !== null || !status.available || saved}
              onClick={save}
            >
              {busy === 'save' && (
                <DsIcon
                  icon={Loader2}
                  className="animate-spin motion-reduce:animate-none"
                />
              )}
              {t(
                saved
                  ? 'setting.apple-intelligence.added'
                  : 'setting.apple-intelligence.add'
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

export function AppleIntelligenceConfigurationDialog(props: Props) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) props.onClose();
      }}
    >
      <DialogContent size="md" overlayVariant="dimmed" showCloseButton={!busy}>
        <AppleIntelligenceConfigurationContent
          {...props}
          onBusyChange={setBusy}
        />
      </DialogContent>
    </Dialog>
  );
}
