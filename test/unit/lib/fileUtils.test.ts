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
import { processDroppedFiles } from '@/lib/fileUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// processDroppedFiles
// ---------------------------------------------------------------------------
describe('processDroppedFiles', () => {
  beforeEach(() => {
    window.electronAPI = {
      getPathForFile: vi.fn(),
      processDroppedFiles: vi.fn(),
    } as any;
  });

  it('returns success with merged files when both mocks return valid data', async () => {
    const file1 = new File(['content1'], 'doc1.txt', { type: 'text/plain' });
    const file2 = new File(['content2'], 'doc2.txt', { type: 'text/plain' });

    (window.electronAPI.getPathForFile as any)
      .mockResolvedValueOnce('/path/to/doc1.txt')
      .mockResolvedValueOnce('/path/to/doc2.txt');

    const newAttachments: FileAttachment[] = [
      { fileName: 'doc1.txt', filePath: '/path/to/doc1.txt' },
      { fileName: 'doc2.txt', filePath: '/path/to/doc2.txt' },
    ];

    (window.electronAPI.processDroppedFiles as any).mockResolvedValue({
      success: true,
      files: newAttachments,
    });

    const result = await processDroppedFiles([file1, file2], []);

    expect(result).toEqual({
      success: true,
      files: newAttachments,
      added: 2,
    });
  });

  it('returns error when no valid paths (getPathForFile returns undefined for all)', async () => {
    const file1 = new File(['c'], 'unreadable.txt', { type: 'text/plain' });

    (window.electronAPI.getPathForFile as any).mockReturnValue(undefined);

    const result = await processDroppedFiles([file1], []);

    if (result.success) {
      expect.unreachable('Expected failure result');
    } else {
      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'Unable to access file paths. Please use the file picker instead.'
      );
    }
  });

  it('returns error when processDroppedFiles fails', async () => {
    const file1 = new File(['c'], 'file.txt', { type: 'text/plain' });

    (window.electronAPI.getPathForFile as any).mockReturnValue(
      '/path/file.txt'
    );
    (window.electronAPI.processDroppedFiles as any).mockResolvedValue({
      success: false,
      error: 'IPC processing error',
    });

    const result = await processDroppedFiles([file1], []);

    if (result.success) {
      expect.unreachable('Expected failure result');
    } else {
      expect(result.success).toBe(false);
      expect(result.error).toBe('IPC processing error');
    }
  });

  it('returns error with default message when processDroppedFiles fails without error', async () => {
    const file1 = new File(['c'], 'file.txt', { type: 'text/plain' });

    (window.electronAPI.getPathForFile as any).mockReturnValue(
      '/path/file.txt'
    );
    (window.electronAPI.processDroppedFiles as any).mockResolvedValue({
      success: false,
    });

    const result = await processDroppedFiles([file1], []);

    if (result.success) {
      expect.unreachable('Expected failure result');
    } else {
      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to process dropped files');
    }
  });

  it('deduplicates: files with same filePath in both existing and new are excluded (symmetric difference)', async () => {
    const file1 = new File(['new'], 'notes.txt', { type: 'text/plain' });

    (window.electronAPI.getPathForFile as any).mockReturnValue(
      '/docs/notes.txt'
    );

    const newFile: FileAttachment = {
      fileName: 'notes.txt',
      filePath: '/docs/notes.txt',
    };

    (window.electronAPI.processDroppedFiles as any).mockResolvedValue({
      success: true,
      files: [newFile],
    });

    const existing: FileAttachment[] = [
      { fileName: 'old-notes.txt', filePath: '/docs/notes.txt' },
      { fileName: 'other.txt', filePath: '/docs/other.txt' },
    ];

    const result = await processDroppedFiles([file1], existing);

    if (!result.success) {
      expect.unreachable('Expected success result');
    }

    // The merge logic is a symmetric difference:
    // - existing entries whose filePath also appears in new are removed
    // - new entries whose filePath also appears in existing are removed
    // So /docs/notes.txt is excluded from both sides; only /docs/other.txt remains
    const paths = result.files.map((f) => f.filePath);
    expect(paths).not.toContain('/docs/notes.txt');
    expect(paths).toContain('/docs/other.txt');
    expect(result.files).toHaveLength(1);
  });

  it('adds all new files when existingFiles is empty', async () => {
    const file1 = new File(['a'], 'a.txt', { type: 'text/plain' });
    const file2 = new File(['b'], 'b.txt', { type: 'text/plain' });

    (window.electronAPI.getPathForFile as any)
      .mockReturnValueOnce('/path/a.txt')
      .mockReturnValueOnce('/path/b.txt');

    const newFiles: FileAttachment[] = [
      { fileName: 'a.txt', filePath: '/path/a.txt' },
      { fileName: 'b.txt', filePath: '/path/b.txt' },
    ];

    (window.electronAPI.processDroppedFiles as any).mockResolvedValue({
      success: true,
      files: newFiles,
    });

    const result = await processDroppedFiles([file1, file2], []);

    if (!result.success) {
      expect.unreachable('Expected success result');
    }

    expect(result.files).toHaveLength(2);
    expect(result.added).toBe(2);
  });
});
