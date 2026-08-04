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

import { mcpInstall, mcpRemove } from '@/api/brain';
import {
  proxyFetchDelete,
  proxyFetchGet,
  proxyFetchPost,
  proxyFetchPut,
} from '@/api/http';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import loader from '@monaco-editor/loader';
import MonacoEditor from '@monaco-editor/react';
import { Server, Wrench } from 'lucide-react';
import * as monaco from 'monaco-editor';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { ConnectorInstallHint, MCPUserItem } from './types';

if (typeof globalThis !== 'undefined') {
  (globalThis as any).MonacoEnvironment = {
    // Vite does not bundle Monaco's language workers, so hand every label a
    // no-op worker: language services (JSON diagnostics etc.) stay disabled,
    // but the editor itself works and Monaco never throws for a missing
    // worker. Our own parse errors surface via installCustom's JSON.parse.
    getWorker() {
      return new Worker(
        URL.createObjectURL(
          new Blob([`self.onmessage = function () {};`], {
            type: 'application/javascript',
          })
        )
      );
    },
  };
}

loader.config({ monaco });

const LOCAL_MCP_EXAMPLE = `{
  "mcpServers": {
    "sequential-thinking": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-sequential-thinking"
      ]
    }
  }
}`;

interface AddCustomConnectorDialogProps {
  open: boolean;
  customMcps: MCPUserItem[];
  onOpenChange: (open: boolean) => void;
  onInstalled: (hint: ConnectorInstallHint) => void | Promise<void>;
}

export default function AddCustomConnectorDialog({
  open,
  customMcps,
  onOpenChange,
  onInstalled,
}: AddCustomConnectorDialogProps) {
  const { t } = useTranslation();
  const [customType, setCustomType] = useState<'local' | 'remote'>('local');
  const [localJson, setLocalJson] = useState(LOCAL_MCP_EXAMPLE);
  const [remoteName, setRemoteName] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCustomType('local');
    setRemoteName('');
    setRemoteUrl('');
    setFormError(null);
    setJsonError(null);
    setSaving(false);
    try {
      setLocalJson(JSON.stringify(JSON.parse(LOCAL_MCP_EXAMPLE), null, 4));
    } catch {
      setLocalJson(LOCAL_MCP_EXAMPLE);
    }
  }, [open]);

  useEffect(() => {
    setJsonError(null);
  }, [localJson]);

  const closeDialog = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const installCustom = useCallback(async () => {
    setSaving(true);
    setFormError(null);
    try {
      if (customType === 'local') {
        let parsed: {
          mcpServers?: Record<string, Record<string, unknown>>;
        };
        try {
          parsed = JSON.parse(localJson);
        } catch (error: any) {
          throw new Error(
            t('connectors.invalid-json', {
              message: error?.message || t('connectors.parse-failed'),
            })
          );
        }
        if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
          throw new Error(t('connectors.missing-mcp-servers'));
        }
        const names = Object.keys(parsed.mcpServers);
        if (!names.length) {
          throw new Error(t('connectors.add-at-least-one'));
        }
        const duplicate = names.find((name) =>
          customMcps.some(
            (item) => item.mcp_name.toLowerCase() === name.toLowerCase()
          )
        );
        if (duplicate) {
          throw new Error(t('connectors.already-exists', { name: duplicate }));
        }

        const response = await proxyFetchPost(
          '/api/v1/mcp/import/local',
          parsed
        );
        if (response?.detail) throw new Error(String(response.detail));
        const installedNames: string[] = [];
        try {
          for (const [name, config] of Object.entries(parsed.mcpServers)) {
            await mcpInstall(name, config);
            installedNames.push(name);
          }
        } catch (installError) {
          // The import already created DB records; remove them so a retry
          // does not fail the duplicate-name check. Cleanup is best-effort.
          for (const name of installedNames) {
            try {
              await mcpRemove(name);
            } catch {
              // Preserve the install error.
            }
          }
          try {
            const users = await proxyFetchGet('/api/v1/mcp/users');
            const rows: MCPUserItem[] = Array.isArray(users)
              ? users
              : Array.isArray(users?.items)
                ? users.items
                : [];
            const lowerNames = new Set(names.map((n) => n.toLowerCase()));
            for (const row of rows) {
              if (lowerNames.has((row.mcp_name || '').toLowerCase())) {
                await proxyFetchDelete(`/api/v1/mcp/users/${row.id}`);
              }
            }
          } catch {
            // Preserve the install error.
          }
          throw installError;
        }
        toast.success(t('connectors.custom-installed', { num: names.length }));
        await onInstalled({ source: 'custom', key: names[0] });
        closeDialog();
        return;
      }

      const name = remoteName.trim();
      const url = remoteUrl.trim();
      if (!name) throw new Error(t('connectors.name-required'));
      if (
        customMcps.some(
          (item) => item.mcp_name.toLowerCase() === name.toLowerCase()
        )
      ) {
        throw new Error(t('connectors.already-exists', { name }));
      }
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        throw new Error(t('connectors.invalid-remote-url'));
      }
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error(t('connectors.remote-url-protocol'));
      }

      const response = await proxyFetchPost('/api/v1/mcp/import/remote', {
        server_name: name,
        server_url: url,
      });
      if (response?.detail) throw new Error(String(response.detail));
      const importedId = Number(response?.mcp_user?.id);
      if (!Number.isInteger(importedId) || importedId <= 0) {
        throw new Error(t('connectors.remote-missing-id'));
      }
      try {
        await proxyFetchPut(`/api/v1/mcp/users/${importedId}`, {
          mcp_key: name,
          mcp_desc: name,
        });
      } catch (error) {
        try {
          await proxyFetchDelete(`/api/v1/mcp/users/${importedId}`);
        } catch {
          // Preserve the update error; cleanup is best-effort.
        }
        throw error;
      }
      try {
        await mcpInstall(name, { url });
      } catch (installError) {
        try {
          await proxyFetchDelete(`/api/v1/mcp/users/${importedId}`);
        } catch {
          // Preserve the runtime install error; cleanup is best-effort.
        }
        throw installError;
      }
      toast.success(t('connectors.installed-toast', { name }));
      await onInstalled({ source: 'custom', key: name });
      closeDialog();
    } catch (error: any) {
      setFormError(error?.message || t('connectors.install-custom-failed'));
    } finally {
      setSaving(false);
    }
  }, [
    closeDialog,
    customMcps,
    customType,
    localJson,
    onInstalled,
    remoteName,
    remoteUrl,
    t,
  ]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDialog();
      }}
    >
      <DialogContent
        size="lg"
        showCloseButton
        onClose={closeDialog}
        overlayVariant="dimmed"
        className="h-[min(640px,90vh)] !max-w-[720px]"
      >
        <DialogHeader
          title={t('connectors.custom-title')}
          subtitle={t('connectors.custom-subtitle')}
          className="pr-12"
        />

        <DialogContentSection className="flex min-h-0 flex-col overflow-hidden p-0">
          <div className="scrollbar-always-visible min-h-0 flex-1 overflow-y-auto p-5">
            <div className="mx-auto flex max-w-3xl flex-col gap-5">
              <Tabs
                value={customType}
                onValueChange={(value) => {
                  const next = value as 'local' | 'remote';
                  setCustomType(next);
                  setFormError(null);
                  if (next !== 'local') return;
                  try {
                    setLocalJson(
                      JSON.stringify(JSON.parse(localJson), null, 4)
                    );
                    setJsonError(null);
                  } catch (error: any) {
                    setJsonError(
                      t('connectors.json-format-error', {
                        message: error?.message || String(error),
                      })
                    );
                  }
                }}
              >
                <TabsList appearance="default">
                  <TabsTrigger value="local">
                    <Wrench className="h-3.5 w-3.5" />
                    <span className="!text-body-sm font-bold text-ds-text-neutral-default-default">
                      {t('connectors.source-local')}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="remote">
                    <Server className="h-3.5 w-3.5" />
                    <span className="!text-body-sm font-bold text-ds-text-neutral-default-default">
                      {t('connectors.source-remote')}
                    </span>
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="rounded-xl border border-solid border-ds-border-warning-default-default bg-ds-bg-warning-subtle-default p-4 text-body-sm text-ds-text-warning-strong-default">
                {t('connectors.custom-warning')}
              </div>

              {customType === 'local' ? (
                <div className="space-y-2">
                  <span className="block text-body-sm text-ds-text-neutral-muted-default">
                    {t('connectors.local-json-desc')}{' '}
                    <a
                      href="https://modelcontextprotocol.io/docs/getting-started/intro"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-ds-text-information-strong-default underline underline-offset-2"
                    >
                      {t('connectors.learn-more')}
                    </a>
                  </span>
                  {jsonError ? (
                    <span className="block text-label-sm text-ds-text-error-strong-default">
                      {jsonError}
                    </span>
                  ) : null}
                  <div className="overflow-hidden rounded-xl border border-solid border-ds-border-neutral-strong-default">
                    <MonacoEditor
                      height="300px"
                      width="100%"
                      language="json"
                      theme="vs-dark"
                      value={localJson}
                      onChange={(value) => setLocalJson(value ?? '')}
                      options={{
                        minimap: { enabled: false },
                        fontSize: 14,
                        scrollBeyondLastLine: false,
                        readOnly: saving,
                        automaticLayout: true,
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <Input
                    title={t('connectors.connector-name')}
                    required
                    value={remoteName}
                    onChange={(event) => setRemoteName(event.target.value)}
                    placeholder={t('connectors.remote-name-placeholder')}
                    leadingIcon={<Wrench className="h-4 w-4" />}
                  />
                  <Input
                    title={t('connectors.remote-url')}
                    required
                    value={remoteUrl}
                    onChange={(event) => setRemoteUrl(event.target.value)}
                    placeholder="https://example.com/mcp"
                    leadingIcon={<Server className="h-4 w-4" />}
                    note={t('connectors.remote-url-note')}
                  />
                </div>
              )}

              {formError ? (
                <div className="rounded-xl bg-ds-bg-error-subtle-default p-3 text-body-sm text-ds-text-error-strong-default">
                  {formError}
                </div>
              ) : null}
            </div>
          </div>

          <DialogFooter
            showCancelButton
            cancelButtonText={t('connectors.cancel')}
            onCancel={closeDialog}
            showConfirmButton
            confirmButtonText={
              saving ? t('connectors.installing') : t('connectors.install')
            }
            onConfirm={() => void installCustom()}
            confirmButtonDisabled={saving}
          />
        </DialogContentSection>
      </DialogContent>
    </Dialog>
  );
}
