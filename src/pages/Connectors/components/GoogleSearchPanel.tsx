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

import { proxyFetchGet, proxyFetchPost } from '@/api/http';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/store/authStore';
import { Eye } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

const FIELDS = [
  {
    key: 'GOOGLE_API_KEY',
    label: 'Google API Key',
    placeholder: 'Enter your Google API key from Google Cloud Console',
    note: 'Learn how to get your Google API key → https://developers.google.com/custom-search/v1/overview',
  },
  {
    key: 'SEARCH_ENGINE_ID',
    label: 'Search Engine ID',
    placeholder:
      'Enter the Custom Search Engine ID associated with your API key',
  },
] as const;

interface GoogleSearchPanelProps {
  /** Refresh parent MCP connection status after config changes. */
  onConfigured?: () => void;
}

export function GoogleSearchPanel({ onConfigured }: GoogleSearchPanelProps) {
  const { t } = useTranslation();
  const { modelType } = useAuthStore();
  const requiresApiKey = modelType === 'custom';

  const [formData, setFormData] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!requiresApiKey) return;
    proxyFetchGet('/api/v1/configs').then((configsRes) => {
      const list = Array.isArray(configsRes) ? configsRes : [];
      const data: Record<string, string> = {};
      FIELDS.forEach(({ key }) => {
        const match = list.find((c: any) => c.config_name === key);
        if (match) data[key] = match.config_value || '';
      });
      setFormData(data);
    });
  }, [requiresApiKey]);

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const { key } of FIELDS) {
        const value = formData[key];
        if (value?.trim()) {
          await proxyFetchPost('/api/v1/configs', {
            config_group: 'Search',
            config_name: key,
            config_value: value.trim(),
          });
        }
      }
      toast.success(t('setting.configuration-saved-successfully'));

      const res = await proxyFetchGet('/api/v1/configs');
      const list = Array.isArray(res) ? res : [];
      const refreshed: Record<string, string> = {};
      FIELDS.forEach(({ key }) => {
        const match = list.find((c: any) => c.config_name === key);
        if (match) refreshed[key] = match.config_value || '';
      });
      setFormData(refreshed);
      onConfigured?.();
    } catch {
      toast.error(t('setting.failed-to-save-configuration'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 px-6 py-4">
      {requiresApiKey ? (
        <>
          <span className="whitespace-pre-wrap text-body-sm text-ds-text-neutral-muted-default">
            {t('setting.google-search-custom-desc', {
              defaultValue:
                'Connect to Google Custom Search. Requires a Google API key and a Custom Search Engine (CSE) ID.',
            })}
          </span>

          <div className="text-body-sm font-bold text-ds-text-neutral-default-default">
            {t('setting.tools', { defaultValue: 'Configuration' })}
          </div>

          <div className="space-y-3">
            {FIELDS.map((field) => (
              <Input
                key={field.key}
                id={field.key}
                size="default"
                title={field.label}
                type={showKeys[field.key] ? 'text' : 'password'}
                placeholder={field.placeholder}
                value={formData[field.key] || ''}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    [field.key]: e.target.value,
                  }))
                }
                note={'note' in field ? field.note : undefined}
                backIcon={<Eye className="h-5 w-5" />}
                onBackIconClick={() =>
                  setShowKeys((prev) => ({
                    ...prev,
                    [field.key]: !prev[field.key],
                  }))
                }
              />
            ))}
          </div>

          <div className="flex items-center justify-end pt-2">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? t('setting.saving') : t('setting.save-changes')}
            </Button>
          </div>
        </>
      ) : (
        <div className="rounded-lg bg-ds-bg-neutral-default-default px-4 py-3 text-body-sm text-ds-text-neutral-muted-default">
          {t('setting.google-search-default-desc', {
            defaultValue:
              'Google Search is enabled by default. No API key required.',
          })}
        </div>
      )}
    </div>
  );
}
