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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Eye, EyeOff } from 'lucide-react';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MCPConfigForm, MCPUserItem } from './types';
interface MCPConfigDialogProps {
  open: boolean;
  form: MCPConfigForm | null;
  mcp: MCPUserItem | null;
  onChange: (form: MCPConfigForm) => void;
  onSave: (e: React.FormEvent) => void;
  onClose: () => void;
  loading: boolean;
  errorMsg?: string | null;
  onSwitchStatus: (checked: boolean) => void;
}

export default function MCPConfigDialog({
  open,
  form,
  mcp,
  onChange,
  onSave,
  onClose,
  loading,
  errorMsg,
}: MCPConfigDialogProps) {
  const [showEnvValues, setShowEnvValues] = useState<Record<string, boolean>>(
    {}
  );
  const { t } = useTranslation();
  const formRef = useRef<HTMLFormElement | null>(null);
  if (!form || !mcp) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent size="md" showCloseButton onClose={onClose}>
        <DialogHeader title={t('setting.edit-mcp-config')} />
        <form
          ref={formRef}
          onSubmit={onSave}
          className="flex flex-col gap-4 p-md"
        >
          <Input
            title={t('setting.name')}
            value={form.mcp_name}
            onChange={(e) => onChange({ ...form, mcp_name: e.target.value })}
            disabled
            readOnly
            placeholder={t('setting.name') as string}
          />
          <Input
            title={t('setting.description')}
            value={form.mcp_desc}
            onChange={(e) => onChange({ ...form, mcp_desc: e.target.value })}
            disabled={loading}
            placeholder={t('setting.description') as string}
          />
          <Input
            title={t('setting.command')}
            value={form.command}
            onChange={(e) => onChange({ ...form, command: e.target.value })}
            disabled={loading}
            placeholder={t('setting.command') as string}
          />

          <Textarea
            variant="enhanced"
            title={t('setting.args-one-per-line')}
            value={Array.isArray(form.argsArr) ? form.argsArr.join('\n') : ''}
            onChange={(e) =>
              onChange({ ...form, argsArr: e.target.value.split(/\r?\n/) })
            }
            disabled={loading}
            placeholder={t('setting.args-one-per-line') as string}
            rows={Math.max(
              3,
              form.argsArr && form.argsArr.length > 0 ? form.argsArr.length : 3
            )}
          />

          <div className="mb-1 block text-label-sm font-normal">
            Env (key-value)
          </div>
          {Object.entries(form.env).map(([k, v], idx) => (
            <div className="mb-2" key={k + idx}>
              <Input
                title={k}
                type={showEnvValues[k] ? 'text' : 'password'}
                value={String(v)}
                onChange={(e) => {
                  const newEnv = { ...form.env };
                  newEnv[k] = e.target.value;
                  onChange({ ...form, env: newEnv });
                }}
                disabled={loading}
                backIcon={
                  showEnvValues[k] ? (
                    <Eye className="h-5 w-5" />
                  ) : (
                    <EyeOff className="h-5 w-5" />
                  )
                }
                onBackIconClick={() =>
                  setShowEnvValues((prev) => ({ ...prev, [k]: !prev[k] }))
                }
                size="default"
                placeholder="Value"
              />
            </div>
          ))}
          {errorMsg && (
            <div className="mb-2 text-label-md text-text-cuation">
              {errorMsg}
            </div>
          )}
        </form>
        <DialogFooter
          showCancelButton
          cancelButtonText={t('setting.cancel')}
          onCancel={onClose}
          cancelButtonVariant="ghost"
          showConfirmButton
          confirmButtonText={t('setting.save')}
          onConfirm={() => formRef.current?.requestSubmit()}
          confirmButtonVariant="primary"
        />
      </DialogContent>
    </Dialog>
  );
}
