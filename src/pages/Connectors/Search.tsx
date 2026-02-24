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
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface SearchEngineProvider {
  id: string;
  name: string;
  description: string;
  requiresApiKey: boolean;
  enabledByDefault?: boolean;
  recommended?: boolean;
  fields: Array<{
    key: string;
    label: string;
    placeholder?: string;
    note?: string;
  }>;
}

function buildSearchEngines(
  modelType: 'cloud' | 'local' | 'custom'
): SearchEngineProvider[] {
  if (modelType === 'custom') {
    return [
      {
        id: 'google',
        name: 'Google',
        description:
          'Connect to Google Custom Search (requires API key and CSE ID).',
        requiresApiKey: true,
        fields: [
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
        ],
      },
    ];
  }
  return [
    {
      id: 'google',
      name: 'Google',
      description:
        'Google Search integration available. No setup required — enabled by default.',
      requiresApiKey: false,
      enabledByDefault: true,
      recommended: true,
      fields: [],
    },
  ];
}

export default function Search() {
  const { t } = useTranslation();
  const { modelType } = useAuthStore();
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const engines = useMemo(() => buildSearchEngines(modelType), [modelType]);

  useEffect(() => {
    proxyFetchGet('/api/configs').then((configsRes) => {
      const configsList = Array.isArray(configsRes) ? configsRes : [];
      const existingData: Record<string, string> = {};
      engines.forEach((engine) => {
        engine.fields.forEach((field) => {
          const config = configsList.find(
            (c: any) => c.config_name === field.key
          );
          if (config) {
            existingData[field.key] = config.config_value || '';
          }
        });
      });
      setFormData(existingData);
    });
  }, [engines]);

  const selectedProvider = engines[0];

  const handleFieldChange = (fieldKey: string, value: string) => {
    setFormData((prev) => ({ ...prev, [fieldKey]: value }));
  };

  const saveConfiguration = async () => {
    if (selectedProvider.enabledByDefault) {
      toast.info(t('setting.this-service-is-already-enabled-by-default'));
      return;
    }
    setSaving(true);
    try {
      if (selectedProvider.requiresApiKey) {
        for (const field of selectedProvider.fields) {
          const value = formData[field.key];
          if (value && value.trim() !== '') {
            await proxyFetchPost('/api/configs', {
              config_group: 'Search',
              config_name: field.key,
              config_value: value.trim(),
            });
          }
        }
      } else {
        await proxyFetchPost('/api/configs', {
          config_group: 'Search',
          config_name: `ENABLE_${selectedProvider.id.toUpperCase()}_SEARCH`,
          config_value: 'true',
        });
      }
      toast.success(t('setting.configuration-saved-successfully'));
      const res = await proxyFetchGet('/api/configs');
      const configsList = Array.isArray(res) ? res : [];
      const existingData: Record<string, string> = {};
      engines.forEach((engine) => {
        engine.fields.forEach((field) => {
          const config = configsList.find(
            (c: any) => c.config_name === field.key
          );
          if (config) {
            existingData[field.key] = config.config_value || '';
          }
        });
      });
      setFormData(existingData);
    } catch (error) {
      console.error(error);
      toast.error(t('setting.failed-to-save-configuration'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="m-auto flex h-auto w-full flex-1 flex-col">
      {/* Header Section */}
      <div className="flex w-full items-center justify-between px-6 pb-6 pt-8">
        <div className="text-heading-sm font-bold text-text-heading">
          {t('setting.search-engine')}
        </div>
      </div>

      {/* Content Section - Google configuration */}
      <div className="mb-12">
        <div className="rounded-2xl bg-surface-secondary px-6 py-4">
          <div className="flex flex-col">
            <div className="flex flex-col gap-2 pb-2">
              <div className="text-label-lg font-bold">
                {selectedProvider.name}
              </div>
              <div className="text-label-sm font-normal text-text-label">
                {selectedProvider.description}
              </div>
            </div>

            <div className="flex-1 pt-4">
              {selectedProvider.requiresApiKey ? (
                <div className="space-y-4">
                  {selectedProvider.fields.map((field) => (
                    <div key={field.key}>
                      <Input
                        id={field.key}
                        size="default"
                        title={field.label}
                        type={showKeys[field.key] ? 'text' : 'password'}
                        placeholder={field.placeholder}
                        value={formData[field.key] || ''}
                        onChange={(e) =>
                          handleFieldChange(field.key, e.target.value)
                        }
                        note={field.note}
                        className="mt-1"
                        backIcon={<Eye className="h-5 w-5" />}
                        onBackIconClick={() =>
                          setShowKeys((prev) => ({
                            ...prev,
                            [field.key]: !prev[field.key],
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg bg-surface-primary p-4">
                  <p className="text-label-sm text-text-label">
                    {selectedProvider.id === 'wiki'
                      ? t(
                          'setting.this-service-is-public-and-does-not-require-credentials'
                        )
                      : t('setting.this-service-does-not-require-an-api-key')}
                  </p>
                </div>
              )}
            </div>

            {!selectedProvider.enabledByDefault && (
              <div className="flex items-center justify-end gap-3 pt-4">
                <Button size="sm" onClick={saveConfiguration} disabled={saving}>
                  {saving
                    ? t('setting.saving')
                    : selectedProvider.requiresApiKey
                      ? t('setting.save-changes')
                      : `${t('setting.enable')} ${selectedProvider.name} ${t('setting.search')}`}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
