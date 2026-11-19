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
  proxyFetchDelete,
  proxyFetchGet,
  proxyFetchPost,
  proxyFetchPut,
} from '@/api/http';
import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  GOOGLE_API_KEY,
  isQueritSearchEnabled,
  QUERIT_API_KEY,
  QUERIT_ENABLED,
  SEARCH_ENGINE_ID,
} from '@/lib/searchConfig';
import { useAuthStore } from '@/store/authStore';
import { ExternalLink, Eye, EyeOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

const QUERIT_PARTNER_URL = 'https://www.querit.ai/en?sa=eigenttt';

const GOOGLE_FIELDS = [
  {
    key: GOOGLE_API_KEY,
    labelKey: 'connectors.google-api-key',
    placeholderKey: 'connectors.google-api-key-placeholder',
    noteKey: 'connectors.google-api-key-note',
  },
  {
    key: SEARCH_ENGINE_ID,
    labelKey: 'connectors.search-engine-id',
    placeholderKey: 'connectors.search-engine-id-placeholder',
  },
] as const;

interface StoredConfig {
  id: string | number;
  config_group?: string;
  config_name: string;
  config_value?: string;
}

interface SearchSettingsPanelProps {
  onConfigured?: () => void;
}

export function SearchSettingsPanel({
  onConfigured,
}: SearchSettingsPanelProps) {
  const { t } = useTranslation();
  const { modelType } = useAuthStore();
  const requiresGoogleApiKey = modelType === 'custom';

  const [configs, setConfigs] = useState<StoredConfig[]>([]);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [queritEnabled, setQueritEnabled] = useState(false);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const queritSelectionTouched = useRef(false);
  const loadErrorMessage = t('connectors.search-config-load-failed');

  const loadConfigs = useCallback(async () => {
    const response = await proxyFetchGet('/api/v1/configs');
    const list: StoredConfig[] = Array.isArray(response)
      ? response.filter(
          (config: StoredConfig) =>
            config.config_group?.toLowerCase() === 'search'
        )
      : [];
    const nextFormData: Record<string, string> = {};
    for (const config of list) {
      nextFormData[config.config_name] = config.config_value || '';
    }
    setConfigs(list);
    setFormData(nextFormData);
    setQueritEnabled((current) =>
      queritSelectionTouched.current ? current : isQueritSearchEnabled(list)
    );
  }, []);

  useEffect(() => {
    let active = true;
    void loadConfigs()
      .catch(() => {
        if (active) {
          toast.error(loadErrorMessage);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadConfigs, loadErrorMessage]);

  const persistConfig = async (name: string, value: string) => {
    const existing = configs.find((config) => config.config_name === name);
    const normalized = value.trim();

    if (!normalized && name !== QUERIT_ENABLED) {
      if (existing) {
        await proxyFetchDelete(`/api/v1/configs/${existing.id}`);
        setConfigs((current) =>
          current.filter((config) => config.config_name !== name)
        );
      }
      return;
    }

    const payload = {
      config_group: 'Search',
      config_name: name,
      config_value: normalized,
    };
    const saved = existing
      ? await proxyFetchPut(`/api/v1/configs/${existing.id}`, payload)
      : await proxyFetchPost('/api/v1/configs', payload);
    if (saved?.id != null) {
      setConfigs((current) => {
        const next = current.filter((config) => config.config_name !== name);
        next.push(saved as StoredConfig);
        return next;
      });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const writes = [
        persistConfig(QUERIT_ENABLED, queritEnabled ? 'true' : 'false'),
        persistConfig(QUERIT_API_KEY, formData[QUERIT_API_KEY] || ''),
      ];
      if (requiresGoogleApiKey) {
        for (const { key } of GOOGLE_FIELDS) {
          writes.push(persistConfig(key, formData[key] || ''));
        }
      }
      await Promise.all(writes);
      queritSelectionTouched.current = false;
      onConfigured?.();
      toast.success(t('setting.configuration-saved-successfully'));
    } catch {
      toast.error(t('setting.failed-to-save-configuration'));
    } finally {
      setSaving(false);
    }
  };

  const renderSecretIcon = (key: string) => (
    <DsIcon icon={showKeys[key] ? EyeOff : Eye} recipe="main" />
  );

  return (
    <div className="flex flex-col gap-ds-stack-section px-6 py-4">
      <div className="space-y-4 rounded-xl border border-x border-y border-solid border-ds-hairline-default-default p-4">
        <div className="flex items-start gap-ds-control-gap">
          <div className="min-w-0 flex-1">
            <DsText as="h3" role="base" weight="semibold">
              {t('connectors.querit-configuration-title')}
            </DsText>
            <DsText
              as="p"
              role="base"
              className="mt-1 text-ds-ink-muted-default"
            >
              {t('connectors.querit-search-toggle-desc')}
            </DsText>
          </div>
          <Switch
            variant="outline"
            checked={queritEnabled}
            disabled={saving}
            onCheckedChange={(checked) => {
              queritSelectionTouched.current = true;
              setQueritEnabled(checked);
            }}
            aria-label={t('connectors.querit-search-toggle-title')}
          />
        </div>
        <div className="flex flex-col items-start">
          <Input
            id={QUERIT_API_KEY}
            size="default"
            title={t('connectors.querit-api-key')}
            optional
            type={showKeys[QUERIT_API_KEY] ? 'text' : 'password'}
            placeholder={t('connectors.querit-api-key-placeholder')}
            value={formData[QUERIT_API_KEY] || ''}
            disabled={loading || saving}
            onChange={(event) =>
              setFormData((previous) => ({
                ...previous,
                [QUERIT_API_KEY]: event.target.value,
              }))
            }
            note={t('connectors.querit-api-key-note')}
            backIcon={renderSecretIcon(QUERIT_API_KEY)}
            backIconAriaLabel={t(
              showKeys[QUERIT_API_KEY]
                ? 'connectors.hide-api-key'
                : 'connectors.show-api-key'
            )}
            onBackIconClick={() =>
              setShowKeys((previous) => ({
                ...previous,
                [QUERIT_API_KEY]: !previous[QUERIT_API_KEY],
              }))
            }
          />
          <Button asChild variant="text" size="xs" className="mt-ds-2 px-0">
            <a
              href={QUERIT_PARTNER_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('connectors.querit-get-api-key')}
              <DsIcon icon={ExternalLink} recipe="main-compact" />
            </a>
          </Button>
        </div>
      </div>

      <div className="space-y-3 border-x-0 border-t border-b-0 border-solid border-ds-hairline-default-default pt-4">
        <div>
          <DsText as="h3" role="base" weight="semibold">
            {t('connectors.google-fallback-title')}
          </DsText>
          <DsText as="p" role="base" className="mt-1 text-ds-ink-muted-default">
            {t('connectors.google-fallback-desc')}
          </DsText>
        </div>

        {requiresGoogleApiKey ? (
          <div className="space-y-3">
            {GOOGLE_FIELDS.map((field) => (
              <Input
                key={field.key}
                id={field.key}
                size="default"
                title={t(field.labelKey)}
                type={showKeys[field.key] ? 'text' : 'password'}
                placeholder={t(field.placeholderKey)}
                value={formData[field.key] || ''}
                disabled={loading || saving}
                onChange={(event) =>
                  setFormData((previous) => ({
                    ...previous,
                    [field.key]: event.target.value,
                  }))
                }
                note={'noteKey' in field ? t(field.noteKey) : undefined}
                backIcon={renderSecretIcon(field.key)}
                backIconAriaLabel={t(
                  showKeys[field.key]
                    ? 'connectors.hide-api-key'
                    : 'connectors.show-api-key'
                )}
                onBackIconClick={() =>
                  setShowKeys((previous) => ({
                    ...previous,
                    [field.key]: !previous[field.key],
                  }))
                }
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl bg-ds-neutral-subtle-default px-4 py-3">
            <DsText as="p" role="base" className="text-ds-ink-muted-default">
              {t('connectors.google-search-default-desc')}
            </DsText>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end pt-2">
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={loading || saving}
        >
          {saving ? t('setting.saving') : t('setting.save-changes')}
        </Button>
      </div>
    </div>
  );
}
