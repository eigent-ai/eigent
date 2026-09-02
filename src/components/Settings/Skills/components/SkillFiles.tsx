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

import { skillRead } from '@/api/brain';
import { FileViewerPanel, type FileInfo } from '@/components/Folder';
import { Button } from '@/components/ui/button';
import { DsText } from '@/components/ui/ds-text';
import { splitFrontmatter } from '@/lib/skillToolkit';
import { FILE_PREVIEW_LIMITS } from '@/shared/filePreviewContract';
import { useAuthStore } from '@/store/authStore';
import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { SkillLibraryEntry } from '../skillLibrary';
import { spaceSkillSettingsUrl } from './SkillActions';

type GlobalSkillEntry = Exclude<SkillLibraryEntry, { kind: 'space' }>;
type SkillDocument = { content: string; url: string; size: number };

function GlobalSkillDocument({
  entry,
  revision,
}: {
  entry: GlobalSkillEntry;
  revision: string | number;
}) {
  const { t } = useTranslation();
  const [documentFile, setDocumentFile] = useState<SkillDocument | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [source, setSource] = useState(false);
  const skillDirName = entry.skill.skillDirName;

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setDocumentFile(null);
    setError(false);

    const load = async () => {
      if (!skillDirName) throw new Error('Skill package has no folder');
      const result = await skillRead(skillDirName);
      if (!active) return;
      if (result?.success !== true || typeof result.content !== 'string') {
        throw new Error('Invalid skill document response');
      }
      const blob = new Blob([result.content], {
        type: 'text/markdown;charset=utf-8',
      });
      objectUrl = URL.createObjectURL(blob);
      setDocumentFile({
        content: result.content,
        url: objectUrl,
        size: blob.size,
      });
    };
    void load().catch(() => {
      if (active) setError(true);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [skillDirName, retry, revision]);

  if (!documentFile) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-ds-12 p-ds-24 text-center"
        role={error ? 'alert' : 'status'}
      >
        <DsText>
          {t(
            error
              ? 'agents.library-files-failed'
              : 'agents.library-loading-files'
          )}
        </DsText>
        {error && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setRetry((value) => value + 1)}
          >
            {t('agents.library-retry')}
          </Button>
        )}
      </div>
    );
  }

  const downloadDocument = () => {
    const link = document.createElement('a');
    link.href = documentFile.url;
    link.download = 'SKILL.md';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };
  const downloadAction = (
    <Button variant="ghost" size="sm" onClick={downloadDocument}>
      <Download />
      {t('agents.library-download-file')}
    </Button>
  );

  // The established Skills API returns the whole document. Bound rendering
  // without implying that it supports recursive package browsing or ranges.
  if (documentFile.size > FILE_PREVIEW_LIMITS.textBytes) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-ds-12 p-ds-24 text-center"
        role="status"
      >
        <DsText>{t('folder.preview-too-large')}</DsText>
        {downloadAction}
      </div>
    );
  }

  const file: FileInfo = {
    name: 'SKILL.md',
    path: documentFile.url,
    relativePath: 'SKILL.md',
    type: 'md',
    content: source
      ? documentFile.content
      : splitFrontmatter(documentFile.content).body,
    size: documentFile.size,
    isRemote: true,
  };
  return (
    <FileViewerPanel
      selectedFile={file}
      loading={false}
      isShowSourceCode={source}
      breadcrumbSegments={[entry.name, file.name]}
      projectFiles={[file]}
      embedded
      onRevealFile={downloadDocument}
      onDownloadFile={downloadDocument}
      onToggleSourceCode={() => setSource((value) => !value)}
      headerActionsExtra={downloadAction}
    />
  );
}

export default function SkillFiles({
  entry,
  revision = 0,
}: {
  entry: SkillLibraryEntry;
  revision?: string | number;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const email = useAuthStore((state) => state.email);
  const userId = useAuthStore((state) => state.user_id);
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-skill-file-browser
    >
      {entry.kind === 'space' ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-ds-12 p-ds-24 text-center"
          role="status"
        >
          <DsText>{t('agents.library-profile-files-unavailable')}</DsText>
          <DsText channel="code" role="small" className="break-all">
            {entry.ref}
          </DsText>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate(spaceSkillSettingsUrl(entry.spaceId))}
          >
            {t('agents.library-manage-profile')}
          </Button>
        </div>
      ) : (
        <GlobalSkillDocument
          key={JSON.stringify([
            entry.id,
            entry.skill.skillDirName,
            email,
            userId,
            revision,
          ])}
          entry={entry}
          revision={revision}
        />
      )}
    </div>
  );
}
