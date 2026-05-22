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

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface WorkspaceInstructionMdProps {
  projectId: string;
}

function storageKey(projectId: string) {
  return `eigent-instructions-md-${projectId}`;
}

export function WorkspaceInstructionMd({
  projectId,
}: WorkspaceInstructionMdProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState<string>(
    () => localStorage.getItem(storageKey(projectId)) ?? ''
  );

  useEffect(() => {
    localStorage.setItem(storageKey(projectId), content);
  }, [content, projectId]);

  useEffect(() => {
    const onSave = (e: Event) => {
      const custom = e as CustomEvent<{ projectId?: string }>;
      if (!custom.detail?.projectId || custom.detail.projectId !== projectId)
        return;
      localStorage.setItem(storageKey(projectId), content);
    };

    window.addEventListener('workspace-instruction-md-save', onSave);
    return () => {
      window.removeEventListener('workspace-instruction-md-save', onSave);
    };
  }, [content, projectId]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center justify-center overflow-hidden">
      <textarea
        className="min-h-0 w-full max-w-3xl flex-1 resize-none border-none bg-transparent p-6 font-mono text-body-sm text-ds-text-neutral-default-default outline-none placeholder:text-ds-text-neutral-muted-default"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={t('layout.instruction-md-placeholder')}
        spellCheck={false}
      />
    </div>
  );
}
