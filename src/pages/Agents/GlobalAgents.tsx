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

import AlertDialog from '@/components/ui/alertDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuthStore } from '@/store/authStore';
import {
  hasGlobalAgentTemplatesApi,
  useGlobalAgentTemplatesStore,
  type GlobalAgentTemplate,
} from '@/store/globalAgentTemplatesStore';
import {
  Copy,
  Download,
  FileUp,
  Loader2,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

function emailToUserId(email: string | null): string | null {
  if (!email) return null;
  return email
    .split('@')[0]
    .replace(/[\\/*?:"<>|\s]/g, '_')
    .replace(/^\.+|\.+$/g, '');
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function exportTemplate(t: GlobalAgentTemplate): void {
  const blob = new Blob(
    [JSON.stringify({ ...t, _exportVersion: 1 }, null, 2)],
    { type: 'application/json' }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `agent-template-${t.name.replace(/[^a-z0-9-_]/gi, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function GlobalAgents() {
  const { t } = useTranslation();
  const {
    templates,
    isLoading,
    loadTemplates,
    removeTemplate,
    duplicateTemplate,
    saveTemplates,
  } = useGlobalAgentTemplatesStore();
  const email = useAuthStore((s) => s.email);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const userId = emailToUserId(email);
  const hasApi = hasGlobalAgentTemplatesApi();

  useEffect(() => {
    if (userId && hasApi) loadTemplates();
  }, [userId, hasApi, loadTemplates]);

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const name = data.name ?? 'Imported';
        const template: GlobalAgentTemplate = {
          id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          name: data.name ?? 'Imported',
          description: data.description ?? '',
          tools: Array.isArray(data.tools) ? data.tools : [],
          mcp_tools: data.mcp_tools ?? { mcpServers: {} },
          custom_model_config: data.custom_model_config,
          updatedAt: Date.now(),
        };
        const list = [...templates, template];
        const ok = await saveTemplates(list);
        if (ok) toast.success(t('agents.skill-added-success'));
        else toast.error(t('agents.skill-add-error'));
      } catch (err) {
        toast.error(t('agents.skill-add-error'));
      }
    },
    [templates, saveTemplates, t]
  );

  if (!hasApi) {
    return (
      <div className="rounded-lg border border-border-subtle-strong bg-surface-primary p-6">
        <p className="text-body-sm text-text-body">
          {t('agents.global-agents-description')}
        </p>
        <p className="mt-2 text-body-sm text-text-body">
          Global Agent templates are available in the desktop app. Open Eigent
          in Electron to manage templates stored in ~/.eigent.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-heading-md font-bold text-text-body">
          {t('agents.global-agents')}
        </h2>
        <p className="mt-1 text-body-sm text-text-body">
          {t('agents.global-agents-description')}
        </p>
      </div>

      <div className="flex flex-row items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleImport}
          disabled={isLoading}
        >
          <FileUp className="mr-1 h-4 w-4" />
          {t('agents.global-agent-import-file')}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-body-sm text-text-body">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-lg border border-border-subtle-strong bg-surface-tertiary-subtle p-6">
          <p className="text-body-sm text-text-body">
            {t('agents.global-agents-empty')}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {templates.map((template) => (
            <div
              key={template.id}
              className="flex flex-row items-center justify-between rounded-lg border border-border-subtle-strong bg-surface-primary p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-text-body">
                  {template.name}
                </div>
                <div className="mt-0.5 line-clamp-2 text-body-sm text-text-body">
                  {template.description || '—'}
                </div>
                <div className="mt-1 flex flex-row gap-4 text-body-xs text-text-body">
                  <span>
                    {t('agents.global-agent-tools-count', {
                      count: template.tools?.length ?? 0,
                    })}
                  </span>
                  <span>
                    {t('agents.global-agent-last-edited')}:{' '}
                    {formatDate(template.updatedAt)}
                  </span>
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      duplicateTemplate(template.id);
                      toast.success(t('agents.skill-added-success'));
                    }}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    {t('agents.global-agent-duplicate')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportTemplate(template)}>
                    <Download className="mr-2 h-4 w-4" />
                    {t('agents.global-agent-export-file')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-text-error"
                    onClick={() => setDeleteId(template.id)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t('agents.global-agent-delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      <AlertDialog
        isOpen={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={async () => {
          if (deleteId) {
            await removeTemplate(deleteId);
            setDeleteId(null);
            toast.success(t('agents.skill-deleted-success'));
          }
        }}
        title={t('agents.delete-skill')}
        message={t('agents.delete-skill-confirmation', {
          name: deleteId
            ? (templates.find((x) => x.id === deleteId)?.name ?? '')
            : '',
        })}
        confirmText={t('layout.delete')}
        cancelText={t('workforce.cancel')}
      />
    </div>
  );
}
