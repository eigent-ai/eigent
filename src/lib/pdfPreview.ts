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
  getDocument,
  GlobalWorkerOptions,
  PDFDataRangeTransport,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { readPdfRange } from './pdfPreviewRange';

GlobalWorkerOptions.workerSrc = workerUrl;

// Vite owns these URLs in both desktop and web builds; no CDN dependency.
const assets = import.meta.glob<string>(
  '/node_modules/pdfjs-dist/{cmaps,standard_fonts,wasm}/*',
  { query: '?url', import: 'default', eager: true }
);
class PdfBinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const directory = {
      cMapUrl: 'cmaps',
      standardFontDataUrl: 'standard_fonts',
      wasmUrl: 'wasm',
    }[kind];
    const url = assets[`/node_modules/pdfjs-dist/${directory}/${filename}`];
    if (!url) throw new Error('PDF support asset is unavailable');
    const response = await fetch(url);
    if (!response.ok) throw new Error('PDF support asset could not be loaded');
    return new Uint8Array(await response.arrayBuffer());
  }
}

export function openPdfPreview(
  url: string,
  size: number,
  onError: (error: unknown) => void
) {
  const controller = new AbortController();
  class PreviewRangeTransport extends PDFDataRangeTransport {
    requestDataRange(begin: number, end: number) {
      void readPdfRange(url, begin, end, size, controller.signal)
        .then((bytes) => {
          if (!controller.signal.aborted) this.onDataRange(begin, bytes);
        })
        .catch((error) => {
          if (!controller.signal.aborted) onError(error);
        });
    }
    abort() {
      controller.abort();
    }
  }
  const range = new PreviewRangeTransport(size, new Uint8Array(), true);
  return getDocument({
    range,
    length: size,
    rangeChunkSize: 64 * 1024,
    disableAutoFetch: true,
    disableStream: true,
    isEvalSupported: false,
    stopAtErrors: true,
    useWorkerFetch: false,
    BinaryDataFactory: PdfBinaryDataFactory,
    canvasMaxAreaInBytes: 64 * 1024 * 1024,
  });
}
