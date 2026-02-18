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

import ConfirmModal from '@/components/ui/alertDialog';
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
  const [uploadError, setUploadError] = useState<'invalid_format' | null>(null);
  const [conflictDialog, setConflictDialog] = useState<{
    open: boolean;
    folderName: string;
    skillName: string;
  } | null>(null);
  const [pendingConflicts, setPendingConflicts] = useState<
    Array<{ folderName: string; skillName: string }>
  >([]);
  const [confirmedReplacements, setConfirmedReplacements] = useState<
    Set<string>
  >(new Set());
  const [pendingFileBuffer, setPendingFileBuffer] =
    useState<ArrayBuffer | null>(null);

  const handleClose = useCallback(() => {
    setSelectedFile(null);
    setFileContent('');
    setIsDragging(false);
    setIsZip(false);
    setUploadError(null);
    setConflictDialog(null);
    setPendingConflicts([]);
    setConfirmedReplacements(new Set());
    setPendingFileBuffer(null);
    onClose();
  }, [onClose]);

  const resetConflictState = useCallback(() => {
    setConflictDialog(null);
    setPendingConflicts([]);
    setConfirmedReplacements(new Set());
    setPendingFileBuffer(null);
  }, []);

  const handleConflictConfirm = useCallback(async () => {
    if (!conflictDialog) return;

    const { folderName } = conflictDialog;
    const newConfirmed = new Set(confirmedReplacements);
    newConfirmed.add(folderName);
    setConfirmedReplacements(newConfirmed);

    // Remove current conflict from pending list
    const remaining = pendingConflicts.filter(
      (c) => c.folderName !== folderName
    );
    setPendingConflicts(remaining);

    // If more conflicts, show next one
    if (remaining.length > 0) {
      setConflictDialog({
        open: true,
        folderName: remaining[0].folderName,
        skillName: remaining[0].skillName,
      });
    } else {
      // All conflicts handled, proceed with import
      setConflictDialog(null);
      if (!pendingFileBuffer) {
        resetConflictState();
        return;
      }

      try {
        const result = await (window as any).electronAPI.skillImportZip(
          pendingFileBuffer,
          Array.from(newConfirmed)
        );

        if (!result?.success) {
          toast.error(result?.error || t('agents.skill-add-error'));
          resetConflictState();
          return;
        }

        await syncFromDisk();
        toast.success(t('agents.skill-added-success'));
      } catch {
        toast.error(t('agents.skill-add-error'));
      }
      resetConflictState();
    }
  }, [
    conflictDialog,
    confirmedReplacements,
    pendingConflicts,
    pendingFileBuffer,
    resetConflictState,
    syncFromDisk,
    t,
  ]);

  const handleConflictCancel = useCallback(async () => {
    if (!conflictDialog) return;

    // Remove current conflict from pending list (user skipped this one)
    const remaining = pendingConflicts.filter(
      (c) => c.folderName !== conflictDialog.folderName
    );
    setPendingConflicts(remaining);

    // If more conflicts, show next one
    if (remaining.length > 0) {
      setConflictDialog({
        open: true,
        folderName: remaining[0].folderName,
        skillName: remaining[0].skillName,
      });
    } else {
      // All conflicts handled, proceed with import
      setConflictDialog(null);
      if (!pendingFileBuffer || confirmedReplacements.size === 0) {
        resetConflictState();
        return;
      }

      try {
        const result = await (window as any).electronAPI.skillImportZip(
          pendingFileBuffer,
          Array.from(confirmedReplacements)
        );

        if (!result?.success) {
          toast.error(result?.error || t('agents.skill-add-error'));
          resetConflictState();
          return;
        }

        await syncFromDisk();
        toast.success(t('agents.skill-added-success'));
      } catch {
        toast.error(t('agents.skill-add-error'));
      }
      resetConflictState();
    }
  }, [
    conflictDialog,
    confirmedReplacements,
    pendingConflicts,
    pendingFileBuffer,
    resetConflictState,
    syncFromDisk,
    t,
  ]);

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

          // First, check for conflicts
          const result = await (window as any).electronAPI.skillImportZip(
            buffer
          );

          if (result?.conflicts && result.conflicts.length > 0) {
            // Store conflicts and show dialog for first conflict
            setPendingConflicts(result.conflicts);
            setPendingFileBuffer(buffer);
            setConflictDialog({
              open: true,
              folderName: result.conflicts[0].folderName,
              skillName: result.conflicts[0].skillName,
            });
            // Reset file state and close the main upload dialog
            setSelectedFile(null);
            setFileContent('');
            if (fileInputRef.current) fileInputRef.current.value = '';
            onClose();
            return;
          }

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
    [
      addSkill,
      fileContent,
      handleClose,
      isZip,
      onClose,
      selectedFile,
      syncFromDisk,
      t,
    ]
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

        // Detect if file is a zip archive: .zip always, .skill by magic bytes
        let treatAsZip = extension === '.zip';
        if (extension === '.skill') {
          const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
          // ZIP magic bytes: PK\x03\x04
          if (
            header[0] === 0x50 &&
            header[1] === 0x4b &&
            header[2] === 0x03 &&
            header[3] === 0x04
          ) {
            treatAsZip = true;
          }
        }

        if (treatAsZip) {
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
          // Let handleUpload's fallback logic handle files without frontmatter
          // (it extracts name from # heading or filename)
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
      : null;

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
        <DialogContent
          size="sm"
          showCloseButton
          onClose={handleClose}
          overlayVariant="dark"
        >
          <DialogHeader title={t('agents.add-skill')} />
          <DialogContentSection>
            <div className="gap-4 flex flex-col">
              {/* Drop Zone */}
              <div
                className={`rounded-xl p-8 ease-in relative cursor-pointer border-2 border-dashed transition-colors duration-300 ${
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
                  <div className="gap-6 flex flex-col items-center">
                    <div className="gap-2 flex items-center">
                      <div
                        className={`p-1 rounded-lg flex flex-shrink-0 items-center justify-center ${
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
                      <div className="min-w-0 flex w-full flex-col">
                        <span
                          className={`text-body-sm font-medium truncate ${
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
                  <div className="gap-2 flex flex-col items-center">
                    <div className="h-12 w-12 flex items-center justify-center">
                      <Upload className="h-6 w-6 text-icon-secondary" />
                    </div>
                    <div className="gap-1 flex flex-col items-center text-center">
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
                  className="gap-4 rounded-xl border-border-cuation bg-surface-cuation px-4 py-3 flex items-center border"
                  role="alert"
                >
                  <AlertCircle className="h-4 w-4 text-icon-cuation shrink-0" />
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
                <span className="mt-2 gap-2 text-label-sm text-text-label flex items-start">
                  <span className="text-text-label">•</span>
                  <span>{t('agents.file-requirements-detail-1')}</span>
                </span>
                <span className="mt-1 gap-2 text-label-sm text-text-label flex items-start">
                  <span className="text-text-label">•</span>
                  <span>{t('agents.file-requirements-detail-2')}</span>
                </span>
              </div>
            </div>
          </DialogContentSection>
        </DialogContent>
      </Dialog>

      {/* Conflict confirmation dialog - rendered outside main dialog */}
      {conflictDialog && (
        <ConfirmModal
          isOpen={conflictDialog.open}
          onClose={handleConflictCancel}
          onConfirm={handleConflictConfirm}
          title={`Replace "${conflictDialog.skillName}" skill?`}
          message="There's an existing skill with the same name. Uploading this skill will replace the existing one, which can't be restored."
          confirmText="Update and Replace"
          cancelText="Cancel"
          confirmVariant="cuation"
        />
      )}
    </>
  );
}
