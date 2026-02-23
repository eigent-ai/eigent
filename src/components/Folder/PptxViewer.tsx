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

/** Get text from any element that has a:txBody (e.g. shape or table cell). */
function getTextFromTxBody(container: Element): string {
  const txBody =
    container.getElementsByTagNameNS(PRESENTATION_NS, 'txBody')[0] ||
    container.getElementsByTagNameNS(DRAWINGML_NS, 'txBody')[0];
  if (!txBody) return '';
  const paragraphs = txBody.getElementsByTagNameNS(DRAWINGML_NS, 'p');
  let out = '';
  for (let i = 0; i < paragraphs.length; i++) {
    const runs = paragraphs[i].getElementsByTagNameNS(DRAWINGML_NS, 't');
    for (let j = 0; j < runs.length; j++) {
      const t = runs[j].textContent;
      if (t) out += t;
    }
  }
  return out.trim();
}

/** Extract table from p:graphicFrame (a:graphic -> a:graphicData -> a:tbl). */
function getTableFromGraphicFrame(gf: Element): string[][] | null {
  const tbl = gf.getElementsByTagNameNS(DRAWINGML_NS, 'tbl')[0];
  if (!tbl) return null;
  const rows = tbl.getElementsByTagNameNS(DRAWINGML_NS, 'tr');
  const grid: string[][] = [];
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].getElementsByTagNameNS(DRAWINGML_NS, 'tc');
    const row: string[] = [];
    for (let c = 0; c < cells.length; c++) {
      row.push(getTextFromTxBody(cells[c]));
    }
    if (row.length > 0) grid.push(row);
  }
  return grid.length > 0 ? grid : null;
}

/** Get solid fill color from shape (p:spPr or a:spPr -> a:solidFill -> a:srgbClr @val). */
function getShapeFill(sp: Element): string | null {
  const spPr =
    sp.getElementsByTagNameNS(PRESENTATION_NS, 'spPr')[0] ||
    sp.getElementsByTagNameNS(DRAWINGML_NS, 'spPr')[0];
  if (!spPr) return null;
  const solid = spPr.getElementsByTagNameNS(DRAWINGML_NS, 'solidFill')[0];
  if (!solid) return null;
  const srgb = solid.getElementsByTagNameNS(DRAWINGML_NS, 'srgbClr')[0];
  const val = srgb?.getAttribute('val');
  return val ? `#${val}` : null;
}

/** Get preset geometry (e.g. roundRect) from shape. */
function getShapePreset(sp: Element): string | null {
  const spPr =
    sp.getElementsByTagNameNS(PRESENTATION_NS, 'spPr')[0] ||
    sp.getElementsByTagNameNS(DRAWINGML_NS, 'spPr')[0];
  if (!spPr) return null;
  const geom = spPr.getElementsByTagNameNS(DRAWINGML_NS, 'prstGeom')[0];
  return geom?.getAttribute('prst') ?? null;
}

type SlideBlock =
  | { type: 'title'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'table'; rows: string[][] }
  | { type: 'shape'; text: string; fill: string; rounded: boolean };

/**
 * Walk content tree in document order and collect title, paragraphs, tables, shapes.
 * Tables from p:graphicFrame (a:tbl). Shapes with fill rendered as colored blocks.
 */
function walkSlideContent(
  parent: Element,
  blocks: SlideBlock[],
  state: { firstText: boolean }
): void {
  for (let i = 0; i < parent.children.length; i++) {
    const el = parent.children[i];
    const local = el.localName;
    const ns = el.namespaceURI;
    if (ns !== PRESENTATION_NS) continue;
    if (local === 'grpSp') {
      walkSlideContent(el, blocks, state);
      continue;
    }
    if (local === 'sp') {
      const paras = getShapeParagraphs(el);
      const fill = getShapeFill(el);
      const preset = getShapePreset(el);
      const rounded = preset === 'roundRect';
      if (fill && paras.length > 0) {
        blocks.push({
          type: 'shape',
          text: paras.join(' '),
          fill,
          rounded,
        });
      } else {
        for (const p of paras) {
          if (state.firstText) {
            blocks.push({ type: 'title', text: p });
            state.firstText = false;
          } else {
            blocks.push({ type: 'paragraph', text: p });
          }
        }
      }
    } else if (local === 'graphicFrame') {
      const grid = getTableFromGraphicFrame(el);
      if (grid) blocks.push({ type: 'table', rows: grid });
    }
  }
}

function extractSlideContent(xmlString: string): SlideBlock[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');
  const spTree = doc.getElementsByTagNameNS(PRESENTATION_NS, 'spTree')[0];
  if (!spTree) return [];
  const blocks: SlideBlock[] = [];
  walkSlideContent(spTree, blocks, { firstText: true });
  return blocks;
}

function renderBlocksToHtml(blocks: SlideBlock[], slideNum: number): string {
  const parts: string[] = [
    `<div class="mb-2 text-xs font-medium text-text-tertiary">Slide ${slideNum}</div>`,
  ];
  for (const b of blocks) {
    if (b.type === 'title') {
      parts.push(
        `<h2 class="text-xl font-semibold text-text-primary mb-3">${escapeHtml(b.text)}</h2>`
      );
    } else if (b.type === 'paragraph') {
      parts.push(
        `<p class="text-text-primary text-sm">${escapeHtml(b.text)}</p>`
      );
    } else if (b.type === 'table') {
      const headerRow = b.rows[0] || [];
      const bodyRows = b.rows.slice(1);
      parts.push(
        `<div class="my-3 overflow-x-auto"><table class="w-full border-collapse border border-border-subtle text-sm text-text-primary">`,
        `<thead><tr>${headerRow.map((c) => `<th class="border border-border-subtle bg-muted px-3 py-2 text-left font-medium">${escapeHtml(c)}</th>`).join('')}</tr></thead>`,
        `<tbody>${bodyRows.map((row) => `<tr>${row.map((c) => `<td class="border border-border-subtle px-3 py-2">${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>`,
        `</table></div>`
      );
    } else if (b.type === 'shape') {
      const rounded = b.rounded ? 'rounded-lg' : '';
      parts.push(
        `<div class="my-2 inline-block px-4 py-2 text-sm font-medium text-white ${rounded}" style="background-color:${escapeHtml(b.fill)}">${escapeHtml(b.text)}</div>`
      );
    }
  }
  return `<div class="pptx-slide-content">${parts.join('')}</div>`;
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
    const blocks = extractSlideContent(xmlString);
    const html = renderBlocksToHtml(blocks, i + 1);
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
