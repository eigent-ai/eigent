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

import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { DsIcon } from '@/components/ui/ds-icon';
import { SplitButton } from '@/components/ui/split-button';
import { useHost } from '@/host';
import { Download, ExternalLink, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FileViewerOpenAction } from './index';

export function FileOpenActions({
  canReveal,
  onReveal,
  onOpen,
  onDownload,
  destinations = [],
}: {
  canReveal: boolean;
  onReveal: () => void;
  onOpen?: () => void;
  onDownload?: () => void;
  destinations?: FileViewerOpenAction[];
}) {
  const { t } = useTranslation();
  const platform = useHost()?.electronAPI?.getPlatform?.();
  const revealLabel =
    platform === 'darwin'
      ? t('folder.show-in-finder', { defaultValue: 'Show in Finder' })
      : platform === 'win32'
        ? t('folder.show-in-explorer', {
            defaultValue: 'Show in File Explorer',
          })
        : t('folder.show-in-folder', { defaultValue: 'Show in folder' });
  const actions: FileViewerOpenAction[] = [...destinations];
  if (canReveal && !actions.some((action) => action.id === 'file-manager')) {
    actions.unshift({
      id: 'file-manager',
      label: revealLabel,
      icon: <DsIcon icon={FolderOpen} />,
      onSelect: onReveal,
    });
  }
  if (onOpen && !actions.some((action) => action.id === 'browser'))
    actions.push({
      id: 'default-app',
      label: t('folder.open-externally', { defaultValue: 'Open externally' }),
      icon: <DsIcon icon={ExternalLink} />,
      onSelect: onOpen,
    });
  if (onDownload)
    actions.push({
      id: 'download',
      label: t('folder.download', { defaultValue: 'Download' }),
      icon: <DsIcon icon={Download} />,
      onSelect: onDownload,
    });
  const primary =
    actions.find((action) => action.id === 'file-manager') ?? actions[0];
  if (!primary) return null;
  return (
    <SplitButton
      label={primary.label}
      icon={primary.icon}
      onClick={primary.onSelect}
      menuLabel={t('folder.open-in', { defaultValue: 'Open in' })}
    >
      {actions.map((action) => (
        <DropdownMenuItem key={action.id} onSelect={action.onSelect}>
          {action.icon}
          {action.label}
        </DropdownMenuItem>
      ))}
    </SplitButton>
  );
}
