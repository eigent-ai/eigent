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

import JSZip from 'jszip';
import { useCallback, useEffect, useState } from 'react';

const DRAWINGML_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PRESENTATION_NS =
  'http://schemas.openxmlformats.org/presentationml/2006/main';

export type PptxSlide = {
  index: number;
  html: string;
};

type PptxViewerProps = {
  /** Data URL of the PPTX file (e.g. from getFileAsDataUrl). */
  dataUrl: string;
  /** Optional file name for display. */
  fileName?: string;
  className?: string;
};

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Extract text from a single shape by paragraph (a:p).
 * Each a:p can have multiple runs (a:r -> a:t); we concatenate runs within
 * a paragraph so "Test " + "PPT" + " Title" becomes "Test PPT Title".
 */
function getShapeParagraphs(shape: Element): string[] {
  const txBody = shape.getElementsByTagNameNS(PRESENTATION_NS, 'txBody')[0];
  if (!txBody) return [];
  const paragraphs = txBody.getElementsByTagNameNS(DRAWINGML_NS, 'p');
  const result: string[] = [];
  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const para = paragraphs[pIdx];
    const runs = para.getElementsByTagNameNS(DRAWINGML_NS, 't');
    let line = '';
    for (let rIdx = 0; rIdx < runs.length; rIdx++) {
      const t = runs[rIdx].textContent;
      if (t) line += t;
    }
    const trimmed = line.trim();
    if (trimmed) result.push(trimmed);
  }
  return result;
}

/**
 * Extract slide content by shape: first shape = title + body, then rest = body.
 * Text is grouped by paragraph so runs (e.g. "Test ", "PPT", " Title") become one line.
 */
function extractSlideContent(xmlString: string): {
  title: string;
  body: string[];
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');
  const shapes = doc.getElementsByTagNameNS(PRESENTATION_NS, 'sp');
  const allParagraphs: string[] = [];
  for (let i = 0; i < shapes.length; i++) {
    const paras = getShapeParagraphs(shapes[i]);
    for (const p of paras) allParagraphs.push(p);
  }
  if (allParagraphs.length === 0) return { title: '', body: [] };
  const title = allParagraphs[0];
  const body = allParagraphs.slice(1);
  return { title, body };
}

async function parsePptxInBrowser(
  arrayBuffer: ArrayBuffer
): Promise<PptxSlide[]> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const slideEntries = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10);
      const numB = parseInt(b.replace(/\D/g, ''), 10);
      return numA - numB;
    });

  const slides: PptxSlide[] = [];
  for (let i = 0; i < slideEntries.length; i++) {
    const entry = zip.files[slideEntries[i]];
    const xmlString = await entry.async('string');
    const { title, body } = extractSlideContent(xmlString);
    const titleHtml = title
      ? `<h2 class="text-xl font-semibold text-text-primary mb-3">${escapeHtml(title)}</h2>`
      : '';
    const bodyHtml =
      body.length > 0
        ? `<div class="text-text-primary space-y-2">${body
            .map((line) => `<p class="text-sm">${escapeHtml(line)}</p>`)
            .join('')}</div>`
        : '';
    const html = `<div class="pptx-slide-content">
      <div class="mb-2 text-xs font-medium text-text-tertiary">Slide ${i + 1}</div>
      ${titleHtml}
      ${bodyHtml}
    </div>`;
    slides.push({ index: i, html });
  }
  return slides;
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

export default function PptxViewer({
  dataUrl,
  fileName,
  className = '',
}: PptxViewerProps) {
  const [slides, setSlides] = useState<PptxSlide[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSlides([]);
    setCurrentIndex(0);

    if (!dataUrl || !dataUrl.startsWith('data:')) {
      setError('Invalid file data');
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const arrayBuffer = dataUrlToArrayBuffer(dataUrl);
        const parsed = await parsePptxInBrowser(arrayBuffer);
        if (!cancelled) {
          setSlides(parsed);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to parse PPTX');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dataUrl]);

  const goTo = useCallback(
    (index: number) => {
      setCurrentIndex((_prev) =>
        Math.max(0, Math.min(slides.length - 1, index))
      );
    },
    [slides.length]
  );

  if (loading) {
    return (
      <div
        className={`flex h-full items-center justify-center text-text-secondary ${className}`}
      >
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
          <p className="text-sm">Loading presentation…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`text-destructive flex h-full items-center justify-center ${className}`}
      >
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (slides.length === 0) {
    return (
      <div
        className={`flex h-full items-center justify-center text-text-secondary ${className}`}
      >
        <p className="text-sm">No slides found in this presentation.</p>
      </div>
    );
  }

  const current = slides[currentIndex];

  return (
    <div
      className={`bg-background flex h-full flex-col overflow-hidden ${className}`}
    >
      {/* Filmstrip: slide thumbnails */}
      <div className="bg-muted/30 flex-shrink-0 border-b border-border-subtle">
        <div className="flex items-center gap-1 overflow-x-auto px-2 py-2">
          {slides.map((slide, idx) => (
            <button
              key={slide.index}
              type="button"
              onClick={() => goTo(idx)}
              className={`min-w-[72px] rounded border px-2 py-1.5 text-center text-xs font-medium transition-colors ${
                idx === currentIndex
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'bg-background hover:bg-muted border-border-subtle text-text-secondary'
              }`}
            >
              Slide {idx + 1}
            </button>
          ))}
        </div>
      </div>

      {/* Navigation and current slide */}
      <div className="flex min-h-0 flex-1 items-stretch gap-2 p-4">
        <button
          type="button"
          onClick={() => goTo(currentIndex - 1)}
          disabled={currentIndex === 0}
          className="bg-background flex-shrink-0 self-center rounded border border-border-subtle px-3 py-2 text-text-primary disabled:opacity-40"
          aria-label="Previous slide"
        >
          ←
        </button>
        <div className="bg-background min-w-0 flex-1 overflow-auto rounded border border-border-subtle p-6">
          <div
            className="prose prose-sm max-w-none text-text-primary"
            dangerouslySetInnerHTML={{ __html: current.html }}
          />
        </div>
        <button
          type="button"
          onClick={() => goTo(currentIndex + 1)}
          disabled={currentIndex === slides.length - 1}
          className="bg-background flex-shrink-0 self-center rounded border border-border-subtle px-3 py-2 text-text-primary disabled:opacity-40"
          aria-label="Next slide"
        >
          →
        </button>
      </div>

      {fileName && (
        <div className="flex-shrink-0 border-t border-border-subtle px-4 py-1 text-xs text-text-tertiary">
          {fileName} · Slide {currentIndex + 1} of {slides.length}
        </div>
      )}
    </div>
  );
}
