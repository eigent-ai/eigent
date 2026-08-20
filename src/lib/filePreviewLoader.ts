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

import {
  decideFilePreview,
  FILE_PREVIEW_LIMITS,
  normalizePreviewFileType,
  type CsvFilePreview,
  type FilePreviewMetadata,
} from '@/shared/filePreviewContract';
import Papa from 'papaparse';

interface PreviewIpcInvoker {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

interface LoadFilePreviewOptions {
  ipcRenderer?: PreviewIpcInvoker | null;
  showSource?: boolean;
  signal?: AbortSignal;
}

interface PrefixReadResult {
  bytes: Uint8Array;
  bytesRead: number;
  totalBytes: number | null;
  contentType?: string;
  supportsRanges?: boolean;
}

const WEB_UNSUPPORTED_OFFICE_TYPES = new Set([
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
]);

function finiteSize(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function isRemotePreviewSource(file: FileInfo): boolean {
  return file.isRemote === true || /^https?:\/\//i.test(file.path);
}

function headerSize(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  return finiteSize(Number(value));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DOMException('Preview cancelled', 'AbortError');
}

function remoteTotalBytes(response: Response): number | null {
  const contentRange = response.headers.get('content-range');
  const rangeTotal = contentRange?.match(/\/(\d+)$/)?.[1];
  if (rangeTotal) return finiteSize(Number(rangeTotal));
  return headerSize(response.headers.get('content-length'));
}

async function probeRemoteMetadata(
  url: string,
  signal?: AbortSignal
): Promise<FilePreviewMetadata> {
  let headMetadata: FilePreviewMetadata | null = null;
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      // Local Brain runs on a different loopback port. Credentialed CORS is
      // incompatible with its safe wildcard fallback, and this endpoint does
      // not use browser cookies. Same-origin deployments still send cookies.
      credentials: 'same-origin',
      signal,
    });
    if (response.ok) {
      headMetadata = {
        size: headerSize(response.headers.get('content-length')),
        mimeType: response.headers.get('content-type') || undefined,
        modifiedAt: response.headers.get('last-modified')
          ? Date.parse(response.headers.get('last-modified') as string)
          : undefined,
        supportsRanges:
          response.headers.get('accept-ranges')?.toLowerCase() === 'bytes',
      };
      if (headMetadata.size !== null && headMetadata.supportsRanges) {
        return headMetadata;
      }
    }
  } catch (error) {
    if (signal?.aborted) throw error;
  }

  try {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { Range: 'bytes=0-0' },
      signal,
    });
    const supportsRanges =
      response.status === 206 &&
      /^bytes\s+0-0\//i.test(response.headers.get('content-range') || '');
    const metadata: FilePreviewMetadata = {
      size: remoteTotalBytes(response) ?? headMetadata?.size ?? null,
      mimeType: response.headers.get('content-type') || headMetadata?.mimeType,
      modifiedAt: headMetadata?.modifiedAt,
      supportsRanges,
    };
    await response.body?.cancel('Metadata probe complete');
    return metadata;
  } catch (error) {
    if (signal?.aborted) throw error;
    return headMetadata ?? { size: null, supportsRanges: false };
  }
}

async function readRemotePrefix(
  url: string,
  maxBytes: number,
  signal?: AbortSignal
): Promise<PrefixReadResult> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { Range: `bytes=0-${Math.max(0, maxBytes - 1)}` },
    signal,
  });
  if (!response.ok && response.status !== 206) {
    throw new Error(`Failed to preview file: HTTP ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return {
      bytes: new Uint8Array(),
      bytesRead: 0,
      totalBytes: remoteTotalBytes(response),
      contentType: response.headers.get('content-type') || undefined,
      supportsRanges:
        response.status === 206 ||
        response.headers.get('accept-ranges')?.toLowerCase() === 'bytes',
    };
  }

  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  while (bytesRead < maxBytes) {
    throwIfAborted(signal);
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - bytesRead;
    const chunk =
      value.byteLength > remaining ? value.slice(0, remaining) : value;
    chunks.push(chunk);
    bytesRead += chunk.byteLength;
    if (chunk.byteLength < value.byteLength || bytesRead >= maxBytes) {
      await reader.cancel('Preview byte limit reached');
      break;
    }
  }

  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    bytes,
    bytesRead,
    totalBytes: remoteTotalBytes(response),
    contentType: response.headers.get('content-type') || undefined,
    supportsRanges:
      response.status === 206 ||
      response.headers.get('accept-ranges')?.toLowerCase() === 'bytes',
  };
}

export function toLocalPreviewUrl(filePath: string): string {
  if (/^(localfile|https?|blob|data):/i.test(filePath)) return filePath;
  const normalized = filePath.replace(/\\/g, '/');
  return `localfile://preview/?path=${encodeURIComponent(normalized)}`;
}

function truncateCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return text.length > FILE_PREVIEW_LIMITS.csvCellCharacters
    ? `${text.slice(0, FILE_PREVIEW_LIMITS.csvCellCharacters)}…`
    : text;
}

export function parseBoundedCsvPreview(
  text: string,
  options: {
    bytesRead: number;
    totalBytes: number | null;
  }
): CsvFilePreview {
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
    preview: FILE_PREVIEW_LIMITS.csvRows + 1,
  });
  const allColumns = parsed.meta.fields || [];
  const columns = allColumns.slice(0, FILE_PREVIEW_LIMITS.csvColumns);
  const rows = parsed.data
    .slice(0, FILE_PREVIEW_LIMITS.csvRows)
    .map((row) => columns.map((column) => truncateCell(row[column])));
  const contentWasCut =
    options.totalBytes !== null && options.bytesRead < options.totalBytes;

  return {
    kind: 'csv',
    columns,
    rows,
    truncated:
      contentWasCut ||
      parsed.data.length > FILE_PREVIEW_LIMITS.csvRows ||
      allColumns.length > FILE_PREVIEW_LIMITS.csvColumns,
    rowLimit: FILE_PREVIEW_LIMITS.csvRows,
    columnLimit: FILE_PREVIEW_LIMITS.csvColumns,
    bytesRead: options.bytesRead,
    totalBytes: options.totalBytes,
  };
}

export async function resolveFilePreviewMetadata(
  file: FileInfo,
  options: LoadFilePreviewOptions
): Promise<FilePreviewMetadata> {
  const knownSize = finiteSize(file.size);
  const ipcRenderer = options.ipcRenderer;
  const isRemote = isRemotePreviewSource(file);
  throwIfAborted(options.signal);

  if (!isRemote && ipcRenderer) {
    const result = (await ipcRenderer.invoke(
      'get-file-preview-metadata',
      file.path
    )) as FilePreviewMetadata;
    throwIfAborted(options.signal);
    return {
      size: finiteSize(result?.size),
      modifiedAt: result?.modifiedAt,
      mimeType: result?.mimeType,
      supportsRanges: true,
    };
  }

  if (knownSize !== null) {
    if (
      normalizePreviewFileType(file.type) === 'pdf' &&
      file.supportsRanges !== true &&
      /^https?:|^\//i.test(file.path)
    ) {
      const probed = await probeRemoteMetadata(file.path, options.signal);
      return {
        ...probed,
        size: probed.size ?? knownSize,
        modifiedAt: probed.modifiedAt ?? file.modifiedAt,
        mimeType: probed.mimeType ?? file.mimeType,
      };
    }
    return {
      size: knownSize,
      modifiedAt: file.modifiedAt,
      mimeType: file.mimeType,
      supportsRanges: file.supportsRanges,
    };
  }

  if (!/^https?:|^\//i.test(file.path)) return { size: null };
  return probeRemoteMetadata(file.path, options.signal);
}

export async function loadFilePreview(
  file: FileInfo,
  options: LoadFilePreviewOptions
): Promise<FileInfo> {
  const isRemote = isRemotePreviewSource(file);
  const metadata = await resolveFilePreviewMetadata(file, options);
  const decision = decideFilePreview(
    file.type || metadata.mimeType || '',
    metadata
  );
  const baseFile: FileInfo = {
    ...file,
    size: metadata.size ?? undefined,
    modifiedAt: metadata.modifiedAt ?? file.modifiedAt,
    mimeType: metadata.mimeType ?? file.mimeType,
    preview: undefined,
  };
  throwIfAborted(options.signal);

  if (decision.mode === 'blocked') {
    return {
      ...baseFile,
      content: undefined,
      preview: {
        kind: 'blocked',
        reason: decision.reason || 'unsupported',
        size: metadata.size,
        limit: decision.limit,
      },
    };
  }

  if (decision.mode === 'range-pdf') {
    return {
      ...baseFile,
      content: isRemote ? file.path : toLocalPreviewUrl(file.path),
      preview: {
        kind: 'range-pdf',
        size: metadata.size as number,
      },
    };
  }

  if (decision.mode === 'stream-media') {
    return isRemote
      ? baseFile
      : { ...baseFile, content: toLocalPreviewUrl(file.path) };
  }

  if (decision.mode === 'bounded-csv') {
    let preview: CsvFilePreview;
    if (!isRemote && options.ipcRenderer) {
      preview = (await options.ipcRenderer.invoke(
        'preview-csv-file',
        file.path
      )) as CsvFilePreview;
    } else {
      const prefix = await readRemotePrefix(
        file.path,
        FILE_PREVIEW_LIMITS.csvScanBytes,
        options.signal
      );
      preview = parseBoundedCsvPreview(new TextDecoder().decode(prefix.bytes), {
        bytesRead: prefix.bytesRead,
        totalBytes: metadata.size ?? prefix.totalBytes,
      });
    }
    throwIfAborted(options.signal);
    return { ...baseFile, content: undefined, preview };
  }

  if (decision.mode === 'bounded-text') {
    const limit = decision.limit || FILE_PREVIEW_LIMITS.textBytes;
    let content = '';
    let bytesRead = 0;
    let totalBytes = metadata.size;
    if (!isRemote && options.ipcRenderer) {
      const result = (await options.ipcRenderer.invoke(
        'preview-text-file',
        file.path,
        limit
      )) as { content: string; bytesRead: number; totalBytes: number };
      content = result.content;
      bytesRead = result.bytesRead;
      totalBytes = result.totalBytes;
    } else {
      const prefix = await readRemotePrefix(file.path, limit, options.signal);
      content = new TextDecoder().decode(prefix.bytes);
      bytesRead = prefix.bytesRead;
      totalBytes = metadata.size ?? prefix.totalBytes;
    }
    throwIfAborted(options.signal);
    return {
      ...baseFile,
      content,
      preview: { kind: 'truncated-text', bytesRead, totalBytes },
    };
  }

  if (!isRemote && options.ipcRenderer) {
    const content = (await options.ipcRenderer.invoke(
      'open-file',
      file.type,
      file.path,
      options.showSource
    )) as string;
    throwIfAborted(options.signal);
    return { ...baseFile, content };
  }

  if (WEB_UNSUPPORTED_OFFICE_TYPES.has(file.type.toLowerCase())) {
    return {
      ...baseFile,
      preview: {
        kind: 'blocked',
        reason: 'unsupported',
        size: metadata.size,
        limit: decision.limit,
      },
    };
  }

  const limit = decision.limit || FILE_PREVIEW_LIMITS.defaultBytes;
  const result = await readRemotePrefix(file.path, limit + 1, options.signal);
  const contentBytes =
    result.bytesRead > limit ? result.bytes.slice(0, limit) : result.bytes;
  const content = new TextDecoder().decode(contentBytes);
  const totalBytes = metadata.size ?? result.totalBytes;
  throwIfAborted(options.signal);
  return {
    ...baseFile,
    content,
    preview:
      result.bytesRead > limit ||
      (totalBytes !== null && contentBytes.byteLength < totalBytes)
        ? {
            kind: 'truncated-text',
            bytesRead: contentBytes.byteLength,
            totalBytes,
          }
        : undefined,
  };
}
