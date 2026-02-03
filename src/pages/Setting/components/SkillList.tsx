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

import { Button } from '@/components/ui/button';
import { Download, FileText, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface SkillInfo {
  name: string;
  size: number;
  created_at: number;
  modified_at: number;
}

interface SkillListProps {
  skills: SkillInfo[];
  onDownload: (skill: SkillInfo) => void;
  onDelete: (skill: SkillInfo) => void;
}

export default function SkillList({
  skills,
  onDownload,
  onDelete,
}: SkillListProps) {
  const { t } = useTranslation();

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp * 1000).toLocaleDateString();
  };

  if (skills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <FileText className="mb-4 h-12 w-12 text-gray-400" />
        <p className="text-gray-500">No skills uploaded yet</p>
        <p className="mt-2 text-sm text-gray-400">
          Upload skill files (.md, .txt) to get started
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {skills.map((skill) => (
        <div
          key={skill.name}
          className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <FileText className="h-5 w-5 flex-shrink-0 text-blue-500" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{skill.name}</p>
              <p className="text-sm text-gray-500">
                {formatFileSize(skill.size)} · Updated{' '}
                {formatDate(skill.modified_at)}
              </p>
            </div>
          </div>
          <div className="ml-4 flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDownload(skill)}
              title="Download skill"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(skill)}
              title="Delete skill"
              className="text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
