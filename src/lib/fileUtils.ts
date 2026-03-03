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

import type { FileAttachment } from '@/components/ChatBox/BottomBox/InputBox';

/**
 * Process dropped files: resolve paths via Electron, send through IPC,
 * and merge with existing attachments (deduplicated by filePath).
 */
export async function processDroppedFiles(
  droppedFiles: File[],
  existingFiles: FileAttachment[]
): Promise<
  | { success: true; files: FileAttachment[]; added: number }
  | { success: false; error: string }
> {
  const fileData = droppedFiles.map((f) => {
    try {
      return { name: f.name, path: window.electronAPI.getPathForFile(f) };
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

  const result = await window.electronAPI.processDroppedFiles(validFiles);
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
