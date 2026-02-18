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
  DialogHeader,
} from '@/components/ui/dialog';
import { parseSkillMd } from '@/lib/skillToolkit';
import { useSkillsStore } from '@/store/skillsStore';
import { AlertCircle, File, Upload, X } from 'lucide-react';
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
  const { addSkill, syncFromDisk } = useSkillsStore();
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [_isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isZip, setIsZip] = useState(false);
  const [uploadError, setUploadError] = useState<
    'invalid_format' | 'invalid_yaml' | null
  >(null);

  const handleClose = useCallback(() => {
    setSelectedFile(null);
    setFileContent('');
    setIsDragging(false);
    setIsZip(false);
    setUploadError(null);
    onClose();
  }, [onClose]);

  const handleUpload = useCallback(
    async (
      fileArg?: File,
      options?: { isZipOverride?: boolean; contentOverride?: string }
    ) => {
      const fileToUse = fileArg ?? selectedFile;
      if (!fileToUse) return;

      const isZipToUse = options?.isZipOverride ?? isZip;
      const fileContentToUse = options?.contentOverride ?? fileContent;

      setIsUploading(true);
      try {
        // Zip import: read file in renderer and send buffer to main (no path in sandbox)
        if (isZipToUse) {
          if (!(window as any).electronAPI?.skillImportZip) {
            toast.error(t('agents.skill-add-error'));
            return;
          }
          let buffer: ArrayBuffer;
          try {
            buffer = await fileToUse.arrayBuffer();
          } catch {
            toast.error(t('agents.file-read-error'));
            return;
          }
          const result = await (window as any).electronAPI.skillImportZip(
            buffer
          );
          if (!result?.success) {
            toast.error(result?.error || t('agents.skill-add-error'));
            return;
          }
          await syncFromDisk();
          toast.success(t('agents.skill-added-success'));
          handleClose();
          return;
        }

        if (!fileContentToUse) return;

        const fileName = fileToUse.name.replace(/\.[^/.]+$/, '');

        // Prefer SKILL.md frontmatter (name + description) at upload time
        const meta = parseSkillMd(fileContentToUse);
        let name = meta?.name ?? fileName;
        let description = meta?.description ?? '';

        // Fallback: no frontmatter — use first heading and first paragraph
        if (!meta && fileContentToUse.startsWith('#')) {
          const lines = fileContentToUse.split('\n');
          const headingMatch = lines[0].match(/^#\s+(.+)/);
          if (headingMatch) name = headingMatch[1];
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
          description: description || t('agents.custom-skill'),
          filePath: fileToUse.name,
          fileContent: fileContentToUse,
          scope: { isGlobal: true, selectedAgents: [] },
          enabled: true,
        });

        toast.success(t('agents.skill-added-success'));
        handleClose();
      } catch (_error) {
        toast.error(t('agents.skill-add-error'));
      } finally {
        setIsUploading(false);
      }
    },
    [addSkill, fileContent, handleClose, isZip, selectedFile, syncFromDisk, t]
  );

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
      // Only .zip or skill package (.skill, .md) are valid
      const skillPackageExtensions = ['.zip', '.skill', '.md'];
      const extension = file.name
        .substring(file.name.lastIndexOf('.'))
        .toLowerCase();

      if (!skillPackageExtensions.includes(extension)) {
        setSelectedFile(file);
        setUploadError('invalid_format');
        return;
      }

      // Validate file size (max 5MB to allow small zip bundles)
      if (file.size > 5 * 1024 * 1024) {
        toast.error(t('agents.file-too-large'));
        return;
      }

      try {
        setUploadError(null);
        setSelectedFile(file);
        if (extension === '.zip') {
          setIsZip(true);
          setFileContent('');
          await handleUpload(file, {
            isZipOverride: true,
            contentOverride: '',
          });
        } else {
          const content = await file.text();
          setIsZip(false);
          setFileContent(content);
          // .skill / .md must have YAML frontmatter (name + description)
          const meta = parseSkillMd(content);
          if (!meta) {
            setUploadError('invalid_yaml');
            return;
          }
          await handleUpload(file, {
            isZipOverride: false,
            contentOverride: content,
          });
        }
      } catch (_error) {
        toast.error(t('agents.file-read-error'));
      }
    },
    [handleUpload, t]
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

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setFileContent('');
    setUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const errorMessage =
    uploadError === 'invalid_format'
      ? t('agents.upload-error-invalid-format')
      : uploadError === 'invalid_yaml'
        ? t('agents.upload-error-invalid-yaml')
        : null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent
        size="sm"
        showCloseButton
        onClose={handleClose}
        overlayVariant="dark"
      >
        <DialogHeader title={t('agents.add-skill')} />
        <DialogContentSection>
          <div className="flex flex-col gap-4">
            {/* Drop Zone */}
            <div
              className={`relative cursor-pointer rounded-xl border-2 border-dashed p-8 transition-colors duration-300 ease-in ${
                uploadError
                  ? 'border-border-cuation bg-surface-cuation'
                  : isDragging
                    ? 'border-border-focus bg-surface-tertiary'
                    : 'border-border-secondary hover:border-border-primary hover:bg-surface-secondary'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".skill,.md,.zip"
                onChange={handleFileSelect}
                className="hidden"
              />

              {selectedFile ? (
                <div className="flex flex-col items-center gap-6">
                  <div className="flex items-center gap-2">
                    <div
                      className={`flex flex-shrink-0 items-center justify-center rounded-lg p-1 ${
                        uploadError
                          ? 'bg-surface-cuation'
                          : 'bg-surface-tertiary'
                      }`}
                    >
                      <File
                        className={`h-4 w-4 ${
                          uploadError
                            ? 'text-icon-cuation'
                            : 'text-icon-primary'
                        }`}
                      />
                    </div>
                    <div className="flex w-full min-w-0 flex-col">
                      <span
                        className={`truncate text-body-sm font-medium ${
                          uploadError
                            ? 'text-text-cuation'
                            : 'text-text-heading'
                        }`}
                      >
                        {selectedFile.name}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFile();
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  <span
                    className={`text-label-sm ${
                      uploadError ? 'text-text-cuation' : 'text-text-label'
                    }`}
                  >
                    {uploadError
                      ? t('agents.reupload-file')
                      : `${(selectedFile.size / 1024).toFixed(1)} KB`}
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className="flex h-12 w-12 items-center justify-center">
                    <Upload className="h-6 w-6 text-icon-secondary" />
                  </div>
                  <div className="flex flex-col items-center gap-1 text-center">
                    <span className="text-body-sm font-medium text-text-heading">
                      {t('agents.drag-and-drop')}
                    </span>
                    <span className="mt-1 text-label-sm text-text-label">
                      {t('agents.or-click-to-browse')}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Error notice */}
            {uploadError && errorMessage && (
              <div
                className="flex items-center gap-4 rounded-xl border border-border-cuation bg-surface-cuation px-4 py-3"
                role="alert"
              >
                <AlertCircle className="h-4 w-4 shrink-0 text-icon-cuation" />
                <span className="text-label-sm text-text-cuation">
                  {errorMessage}
                </span>
              </div>
            )}

            {/* File Requirements */}
            <div className="rounded-xl bg-surface-secondary p-4">
              <span className="text-label-sm font-bold text-text-body">
                {t('agents.file-requirements')}
              </span>
              <span className="mt-2 flex items-start gap-2 text-label-sm text-text-label">
                <span className="text-text-label">•</span>
                <span>{t('agents.file-requirements-detail-1')}</span>
              </span>
              <span className="mt-1 flex items-start gap-2 text-label-sm text-text-label">
                <span className="text-text-label">•</span>
                <span>{t('agents.file-requirements-detail-2')}</span>
              </span>
            </div>
          </div>
        </DialogContentSection>
      </DialogContent>
    </Dialog>
  );
}
