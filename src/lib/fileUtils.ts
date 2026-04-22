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

import { uploadFileToBrain } from '@/api/http';
import { isWeb } from '@/client/platform';
import type { FileAttachment } from '@/components/ChatBox/BottomBox/InputBox';
import type { AppHost } from '@/host';
import { createHost } from '@/host';

/**
 * Process dropped files: resolve paths via Electron, send through IPC,
 * and merge with existing attachments (deduplicated by filePath).
 */
export async function processDroppedFiles(
  droppedFiles: globalThis.File[],
  existingFiles: FileAttachment[],
  host?: AppHost | null
): Promise<
  | { success: true; files: FileAttachment[]; added: number }
  | { success: false; error: string }
> {
  if (isWeb()) {
    const uploadedFiles: FileAttachment[] = [];

    for (const droppedFile of droppedFiles) {
      try {
        const result = await uploadFileToBrain(droppedFile);
        uploadedFiles.push({
          fileName: result.filename,
          filePath: result.file_id,
          fileId: result.file_id,
          source: 'upload',
        });
      } catch (error) {
        console.error('[Drag-Drop] Upload failed:', droppedFile.name, error);
      }
    }

    if (uploadedFiles.length === 0) {
      return {
        success: false,
        error: 'Failed to upload dropped files.',
      };
    }

    const mergedFiles = [
      ...existingFiles.filter(
        (existing) =>
          !uploadedFiles.find(
            (uploaded) => uploaded.filePath === existing.filePath
          )
      ),
      ...uploadedFiles.filter(
        (uploaded) =>
          !existingFiles.find(
            (existing) => existing.filePath === uploaded.filePath
          )
      ),
    ];

    return {
      success: true,
      files: mergedFiles,
      added: uploadedFiles.length,
    };
  }

  const electronAPI = host?.electronAPI ?? createHost().electronAPI;
  if (!electronAPI) {
    return {
      success: false,
      error: 'Desktop file access is unavailable.',
    };
  }

  const fileData = droppedFiles.map((f) => {
    try {
      return { name: f.name, path: electronAPI.getPathForFile(f) };
    } catch {
      console.error('[Drag-Drop] Failed to get path for:', f.name);
      return { name: f.name, path: undefined };
    }
  });

  const validFiles = fileData.filter((f) => f.path);
  if (validFiles.length === 0) {
    return {
      success: false,
      error: 'Unable to access file paths. Please use the file picker instead.',
    };
  }

  const result = await electronAPI.processDroppedFiles(validFiles);
  if (!result.success || !result.files) {
    return {
      success: false,
      error: result.error || 'Failed to process dropped files',
    };
  }

  const mergedFiles = [
    ...existingFiles.filter(
      (f: FileAttachment) =>
        !result.files!.find((m: any) => m.filePath === f.filePath)
    ),
    ...result.files.filter(
      (m: any) => !existingFiles.find((f) => f.filePath === m.filePath)
    ),
  ];

  return { success: true, files: mergedFiles, added: result.files.length };
}
