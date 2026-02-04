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
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { useSkillsStore } from '@/store/skillsStore';
import { File, Upload, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface SkillUploadDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function SkillUploadDialog({
  open,
  onClose,
}: SkillUploadDialogProps) {
  const { t } = useTranslation();
  const { addSkill } = useSkillsStore();
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const processFile = useCallback(
    async (file: File) => {
      // Validate file type
      const validExtensions = ['.skill', '.md', '.txt', '.json'];
      const extension = file.name
        .substring(file.name.lastIndexOf('.'))
        .toLowerCase();

      if (!validExtensions.includes(extension)) {
        toast.error(t('capabilities.invalid-file-type'));
        return;
      }

      // Validate file size (max 1MB)
      if (file.size > 1024 * 1024) {
        toast.error(t('capabilities.file-too-large'));
        return;
      }

      try {
        const content = await file.text();
        setSelectedFile(file);
        setFileContent(content);
      } catch (_error) {
        toast.error(t('capabilities.file-read-error'));
      }
    },
    [t]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        processFile(files[0]);
      }
    },
    [processFile]
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !fileContent) return;

    setIsUploading(true);
    try {
      // Parse skill name from file name or content
      const fileName = selectedFile.name.replace(/\.[^/.]+$/, '');

      // Try to extract name and description from content
      let name = fileName;
      let description = '';

      // If it's a markdown file, try to parse the first heading and paragraph
      if (fileContent.startsWith('#')) {
        const lines = fileContent.split('\n');
        const headingMatch = lines[0].match(/^#\s+(.+)/);
        if (headingMatch) {
          name = headingMatch[1];
        }
        // Find first non-empty, non-heading line for description
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line && !line.startsWith('#')) {
            description = line;
            break;
          }
        }
      }

      addSkill({
        name,
        description: description || t('capabilities.custom-skill'),
        filePath: selectedFile.name,
        fileContent,
        scope: { isGlobal: true, selectedAgents: [] },
        enabled: true,
      });

      toast.success(t('capabilities.skill-added-success'));
      handleClose();
    } catch (_error) {
      toast.error(t('capabilities.skill-add-error'));
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    setSelectedFile(null);
    setFileContent('');
    setIsDragging(false);
    onClose();
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setFileContent('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent size="sm" showCloseButton onClose={handleClose}>
        <DialogHeader title={t('capabilities.add-skill')} />
        <DialogContentSection>
          <div className="flex flex-col gap-4">
            {/* Drop Zone */}
            <div
              className={`relative cursor-pointer rounded-xl border-2 border-dashed p-8 transition-colors ${
                isDragging
                  ? 'border-border-focus bg-surface-tertiary'
                  : 'border-border-secondary hover:border-border-primary'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".skill,.md,.txt,.json"
                onChange={handleFileSelect}
                className="hidden"
              />

              {selectedFile ? (
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-surface-tertiary">
                    <File className="h-5 w-5 text-icon-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-sm font-medium text-text-heading">
                      {selectedFile.name}
                    </p>
                    <p className="text-label-sm text-text-label">
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveFile();
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-tertiary">
                    <Upload className="h-6 w-6 text-icon-secondary" />
                  </div>
                  <div className="text-center">
                    <p className="text-body-sm font-medium text-text-heading">
                      {t('capabilities.drag-and-drop')}
                    </p>
                    <p className="mt-1 text-label-sm text-text-label">
                      {t('capabilities.or-click-to-browse')}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* File Requirements */}
            <div className="rounded-xl bg-surface-secondary p-4">
              <p className="text-label-sm font-bold text-text-body">
                {t('capabilities.file-requirements')}
              </p>
              <ul className="mt-2 space-y-1">
                <li className="flex items-start gap-2 text-label-sm text-text-label">
                  <span className="text-text-label">•</span>
                  <span>{t('capabilities.file-requirements-detail-1')}</span>
                </li>
                <li className="flex items-start gap-2 text-label-sm text-text-label">
                  <span className="text-text-label">•</span>
                  <span>{t('capabilities.file-requirements-detail-2')}</span>
                </li>
              </ul>
            </div>
          </div>
        </DialogContentSection>
        <DialogFooter
          showCancelButton
          showConfirmButton
          cancelButtonText={t('layout.cancel')}
          confirmButtonText={t('capabilities.upload')}
          onCancel={handleClose}
          onConfirm={handleUpload}
          confirmButtonDisabled={!selectedFile || isUploading}
        />
      </DialogContent>
    </Dialog>
  );
}
