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
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tag as TagComponent } from '@/components/ui/tag';
import { useAuthStore } from '@/store/authStore';
import { AlertTriangle, Check, Circle, Eye } from 'lucide-react';
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

interface SearchEngineConfigDialogProps {
  open: boolean;
  onClose: () => void;
}

function buildSearchEngines(
  modelType: 'cloud' | 'local' | 'custom'
): SearchEngineProvider[] {
  // Only Google search engine, with custom mode requiring API key configuration
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

  // cloud or local → Google enabled by default, no config required
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

export default function SearchEngineConfigDialog({
  open,
  onClose,
}: SearchEngineConfigDialogProps) {
  const { t } = useTranslation();
  const { modelType } = useAuthStore();
  const [selectedProvider, setSelectedProvider] =
    useState<SearchEngineProvider>(buildSearchEngines(modelType)[0]);
  const [configs, setConfigs] = useState<any[]>([]);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [_testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const engines = useMemo(() => buildSearchEngines(modelType), [modelType]);

  // Load existing configurations
  useEffect(() => {
    if (open) {
      proxyFetchGet('/api/configs')
        .then((res) => {
          setConfigs(Array.isArray(res) ? res : []);
          // Initialize form data with existing values
          const existingData: Record<string, string> = {};
          engines.forEach((engine) => {
            engine.fields.forEach((field) => {
              const config = res.find((c: any) => c.config_name === field.key);
              if (config) {
                existingData[field.key] = config.config_value || '';
              }
            });
          });
          setFormData(existingData);
        })
        .catch((err) => {
          console.error('Failed to load configs:', err);
          setConfigs([]);
        });
    }
  }, [open, engines]);

  const getProviderStatus = (provider: SearchEngineProvider) => {
    // For providers that are enabled by default, always show as configured
    if (provider.enabledByDefault) {
      return 'configured';
    }

    if (!provider.requiresApiKey) {
      // For providers that don't require API keys, check if they're enabled
      const isEnabled = configs.some(
        (c: any) =>
          c.config_group?.toLowerCase() === 'search' &&
          c.config_name === `ENABLE_${provider.id.toUpperCase()}_SEARCH` &&
          c.config_value === 'true'
      );
      return isEnabled ? 'configured' : 'not-configured';
    }

    // For providers that require API keys, check if all required fields are filled
    const requiredFields = provider.fields.map((f) => f.key);
    const filledFields = requiredFields.filter((fieldKey) => {
      const config = configs.find((c: any) => c.config_name === fieldKey);
      return config && config.config_value && config.config_value.trim() !== '';
    });

    if (filledFields.length === 0) {
      return 'not-configured';
    } else if (filledFields.length === requiredFields.length) {
      return 'configured';
    } else {
      return 'incomplete';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'configured':
        return <Check className="h-4 w-4 text-text-success" />;
      case 'incomplete':
        return <AlertTriangle className="h-4 w-4 text-text-cuation" />;
      default:
        return <Circle className="h-4 w-4 text-text-label" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'configured':
        return t('setting.configured');
      case 'incomplete':
        return t('setting.incomplete');
      default:
        return t('setting.not-configured');
    }
  };

  const handleFieldChange = (fieldKey: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [fieldKey]: value,
    }));
  };

  const _testConnection = async () => {
    if (!selectedProvider.requiresApiKey) {
      toast.success(t('setting.this-service-does-not-require-an-api-key'));
      return;
    }

    setTesting(true);
    try {
      // Here you would implement actual connection testing
      // For now, we'll just simulate a test
      await new Promise((resolve) => setTimeout(resolve, 1000));
      toast.success(t('setting.connection-test-successful'));
    } catch (error) {
      console.error(error);
      toast.error(t('setting.connection-test-failed'));
    } finally {
      setTesting(false);
    }
  };

  const saveConfiguration = async () => {
    // Skip saving for engines that are enabled by default
    if (selectedProvider.enabledByDefault) {
      toast.info(t('setting.this-service-is-already-enabled-by-default'));
      return;
    }

    setSaving(true);
    try {
      if (selectedProvider.requiresApiKey) {
        // Save API key fields
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
        // Enable the service
        await proxyFetchPost('/api/configs', {
          config_group: 'Search',
          config_name: `ENABLE_${selectedProvider.id.toUpperCase()}_SEARCH`,
          config_value: 'true',
        });
      }

      toast.success(t('setting.configuration-saved-successfully'));
      // Refresh configs
      const res = await proxyFetchGet('/api/configs');
      setConfigs(Array.isArray(res) ? res : []);
    } catch (error) {
      console.error(error);
      toast.error(t('setting.failed-to-save-configuration'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent size="lg">
        <DialogHeader title={t('setting.search-engine-integrations')} />

        <DialogContentSection className="flex h-full">
          {/* Left Panel - Provider List */}
          <div className="w-1/3 border border-y-0 border-l-0 border-solid border-border-secondary pr-4">
            <div className="flex flex-col gap-2">
              {engines.map((provider) => {
                const status = getProviderStatus(provider);
                const isSelected = selectedProvider.id === provider.id;
                return (
                  <Button
                    variant="ghost"
                    size="md"
                    key={provider.id}
                    onClick={() => setSelectedProvider(provider)}
                    className={`w-full justify-between border border-solid border-transparent bg-transparent transition-colors duration-200 ease-in-out ${isSelected ? 'border border-solid border-border-primary bg-surface-secondary' : 'hover:bg-surface-secondary'}`}
                  >
                    <div className="flex items-center gap-3">
                      {getStatusIcon(status)}
                      <div className="flex items-center gap-2 text-label-sm font-bold">
                        <span>{provider.name}</span>
                        {provider.recommended ? (
                          <TagComponent asChild>
                            <span>{t('setting.recommended')}</span>
                          </TagComponent>
                        ) : null}
                      </div>
                    </div>
                    <div className="text-xs font-extralight text-text-label">
                      {getStatusText(status)}
                    </div>
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Right Panel - Configuration Detail */}
          <div className="h-[400px] flex-1 pl-4">
            <div className="flex h-full flex-col">
              {/* Provider Header */}
              <div className="flex flex-col gap-2 pb-2">
                <div className="text-label-lg font-bold">
                  {selectedProvider.name}
                </div>
                <div className="text-label-sm font-normal text-text-label">
                  {selectedProvider.description}
                </div>
              </div>

              {/* Configuration Form */}
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

              {/* Action Buttons */}
              {!selectedProvider.enabledByDefault && (
                <div className="flex items-center justify-end gap-3">
                  {/* {selectedProvider.requiresApiKey && (
										<Button
											variant="outline"
											size="sm"
											onClick={testConnection}
											disabled={testing}
										>
											 {testing ? t("setting.testing") : t("setting.test-connection")}
										</Button>
									)} */}
                  <Button
                    size="sm"
                    onClick={saveConfiguration}
                    disabled={saving}
                  >
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
        </DialogContentSection>
        <DialogFooter className="justify-between !rounded-b-xl bg-white-100% p-md">
          <p className="flex items-center gap-1 text-label-xs text-text-label">
            {t(
              'setting.your-api-keys-are-stored-securely-and-never-shared-externally'
            )}
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
