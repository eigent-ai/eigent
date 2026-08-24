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

import i18next from 'i18next';

export const FILE_PREVIEW_LIMITS = {
  csvScanBytes: 2 * 1024 * 1024,
  csvRows: 500,
  csvColumns: 50,
  csvCellCharacters: 4096,
  textBytes: 1024 * 1024,
  richHtmlBytes: 1024 * 1024,
  officeBytes: 20 * 1024 * 1024,
  pdfBytes: 100 * 1024 * 1024,
  imageBytes: 25 * 1024 * 1024,
  defaultBytes: 20 * 1024 * 1024,
} as const;

export type FilePreviewMode =
  | 'full'
  | 'bounded-csv'
  | 'bounded-text'
  | 'range-pdf'
  | 'stream-media'
  | 'blocked';

export type FilePreviewBlockedReason =
  'too-large' | 'metadata-unavailable' | 'unsupported';

export interface FilePreviewMetadata {
  size: number | null;
  modifiedAt?: number;
  mimeType?: string;
  supportsRanges?: boolean;
}

export interface CsvFilePreview {
  kind: 'csv';
  columns: string[];
  rows: string[][];
  truncated: boolean;
  rowLimit: number;
  columnLimit: number;
  bytesRead: number;
  totalBytes: number | null;
}

export interface TruncatedTextFilePreview {
  kind: 'truncated-text';
  bytesRead: number;
  totalBytes: number | null;
}

export interface RangePdfFilePreview {
  kind: 'range-pdf';
  size: number;
}

export interface BlockedFilePreview {
  kind: 'blocked';
  reason: FilePreviewBlockedReason;
  size: number | null;
  limit: number | null;
}

export type FilePreviewPayload =
  | CsvFilePreview
  | TruncatedTextFilePreview
  | RangePdfFilePreview
  | BlockedFilePreview;

export interface FilePreviewDecision {
  mode: FilePreviewMode;
  limit: number | null;
  reason?: FilePreviewBlockedReason;
}

const TEXT_TYPES = new Set([
  'md',
  'txt',
  'json',
  'xml',
  'yaml',
  'yml',
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'java',
  'go',
  'rs',
  'c',
  'cpp',
  'h',
  'hpp',
  'css',
  'scss',
  'sql',
  'log',
  'sh',
  'env',
]);
const OFFICE_TYPES = new Set(['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx']);
const IMAGE_TYPES = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'avif',
  'heic',
]);
const STREAM_MEDIA_TYPES = new Set([
  'mp3',
  'wav',
  'ogg',
  'flac',
  'aac',
  'm4a',
  'opus',
  'mp4',
  'webm',
  'mov',
  'mkv',
]);

export function normalizePreviewFileType(type: string): string {
  const normalized = type.trim().toLowerCase();
  if (normalized.includes('/')) {
    if (normalized === 'application/pdf') return 'pdf';
    if (normalized.includes('csv')) return 'csv';
    if (normalized.startsWith('text/')) return 'txt';
  }
  return normalized.replace(/^\./, '');
}

export function decideFilePreview(
  type: string,
  metadata: FilePreviewMetadata
): FilePreviewDecision {
  const normalized = normalizePreviewFileType(type);
  const size = metadata.size;

  if (normalized === 'csv' || normalized === 'tsv') {
    return { mode: 'bounded-csv', limit: FILE_PREVIEW_LIMITS.csvScanBytes };
  }

  if (normalized === 'pdf') {
    if (size === null) {
      return {
        mode: 'blocked',
        limit: FILE_PREVIEW_LIMITS.pdfBytes,
        reason: 'metadata-unavailable',
      };
    }
    if (size > FILE_PREVIEW_LIMITS.pdfBytes) {
      return {
        mode: 'blocked',
        limit: FILE_PREVIEW_LIMITS.pdfBytes,
        reason: 'too-large',
      };
    }
    if (metadata.supportsRanges === false) {
      return {
        mode: 'blocked',
        limit: FILE_PREVIEW_LIMITS.pdfBytes,
        reason: 'unsupported',
      };
    }
    return { mode: 'range-pdf', limit: FILE_PREVIEW_LIMITS.pdfBytes };
  }

  if (STREAM_MEDIA_TYPES.has(normalized)) {
    return { mode: 'stream-media', limit: null };
  }

  if (IMAGE_TYPES.has(normalized)) {
    if (size === null) {
      return {
        mode: 'blocked',
        limit: FILE_PREVIEW_LIMITS.imageBytes,
        reason: 'metadata-unavailable',
      };
    }
    if (size > FILE_PREVIEW_LIMITS.imageBytes) {
      return {
        mode: 'blocked',
        limit: FILE_PREVIEW_LIMITS.imageBytes,
        reason: 'too-large',
      };
    }
    return { mode: 'stream-media', limit: FILE_PREVIEW_LIMITS.imageBytes };
  }

  if (normalized === 'html' || TEXT_TYPES.has(normalized)) {
    const limit =
      normalized === 'html'
        ? FILE_PREVIEW_LIMITS.richHtmlBytes
        : FILE_PREVIEW_LIMITS.textBytes;
    if (size === null || size > limit) {
      return { mode: 'bounded-text', limit };
    }
    return { mode: 'full', limit };
  }

  if (!OFFICE_TYPES.has(normalized)) {
    // Unknown files may be binary and their size says nothing about the cost
    // of decoding and mounting a giant <pre>. Keep every unrecognised format
    // on the same bounded reader used by known text files.
    return { mode: 'bounded-text', limit: FILE_PREVIEW_LIMITS.textBytes };
  }

  const limit = FILE_PREVIEW_LIMITS.officeBytes;
  if (size === null) {
    return {
      mode: 'blocked',
      limit,
      reason: 'metadata-unavailable',
    };
  }
  if (size > limit) {
    return { mode: 'blocked', limit, reason: 'too-large' };
  }
  return { mode: 'full', limit };
}

export function formatFileSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes))
    return i18next.t('layout.file-size-unknown', {
      defaultValue: 'Unknown size',
    });
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
}
