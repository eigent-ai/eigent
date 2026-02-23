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

/** Run-level rich text: color, bold, italic from a:r / a:rPr. */
export type TextRun = {
  text: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
};

/** Paragraph with runs and alignment (a:p -> a:pPr @algn, a:r). */
export type RichParagraph = { runs: TextRun[]; align?: string };

/** Default hex for theme color names (when schemeClr is used without theme part). */
const THEME_COLOR_MAP: Record<string, string> = {
  accent1: '#4472C4',
  accent2: '#ED7D31',
  accent3: '#A5A5A5',
  accent4: '#FFC000',
  accent5: '#5B9BD5',
  accent6: '#70AD47',
  dk1: '#000000',
  lt1: '#FFFFFF',
  dk2: '#1F2E4D',
  lt2: '#EEEDF0',
};

/** First element by NS or by local name (avoids missing due to namespace). */
function firstByNsOrLocal(
  parent: Element,
  ns: string,
  tag: string
): Element | null {
  const byNs = parent.getElementsByTagNameNS(ns, tag)[0];
  if (byNs) return byNs;
  const list = getElementsByLocalName(parent, tag);
  return list.length > 0 ? list[0] : null;
}

/** Get run properties from a:r (a:rPr: color, @b, @i). */
function getRunProps(run: Element): {
  color: string | null;
  bold: boolean;
  italic: boolean;
} {
  let rPr = run.getElementsByTagNameNS(DRAWINGML_NS, 'rPr')[0];
  if (!rPr && run.children) {
    for (let i = 0; i < run.children.length; i++) {
      if (run.children[i].localName === 'rPr') {
        rPr = run.children[i];
        break;
      }
    }
  }
  let color: string | null = null;
  let bold = false;
  let italic = false;
  if (rPr) {
    const solid = firstByNsOrLocal(rPr, DRAWINGML_NS, 'solidFill');
    if (solid) {
      const srgb = firstByNsOrLocal(solid, DRAWINGML_NS, 'srgbClr');
      const val = srgb?.getAttribute('val');
      if (val) color = `#${val}`;
      else {
        const scheme = firstByNsOrLocal(solid, DRAWINGML_NS, 'schemeClr');
        const schemeVal = scheme?.getAttribute('val');
        if (schemeVal) color = THEME_COLOR_MAP[schemeVal] ?? `#${schemeVal}`;
      }
    }
    bold = rPr.getAttribute('b') === '1';
    italic = rPr.getAttribute('i') === '1';
  }
  return { color, bold, italic };
}

/** Normalize algn attribute value to our alignment string. */
function parseAlgnValue(algn: string | null): string | undefined {
  if (!algn) return undefined;
  const v = algn.toLowerCase();
  if (v === 'ctr') return 'center';
  if (v === 'r') return 'right';
  if (v === 'just' || v === 'dist') return 'left';
  return 'left';
}

/** Get paragraph alignment from a:p (a:pPr @algn). If not set, use lstStyle default for paragraph level (a:lstStyle -> a:lvlNpPr @algn). */
function getParagraphAlign(
  para: Element,
  lstStyle: Element | null
): string | undefined {
  let pPr = para.getElementsByTagNameNS(DRAWINGML_NS, 'pPr')[0];
  if (!pPr && para.children) {
    for (let i = 0; i < para.children.length; i++) {
      if (para.children[i].localName === 'pPr') {
        pPr = para.children[i];
        break;
      }
    }
  }
  const directAlgn = pPr?.getAttribute?.('algn');
  if (directAlgn) return parseAlgnValue(directAlgn);
  if (!lstStyle) return undefined;
  const lvl = Math.max(0, parseInt(pPr?.getAttribute?.('lvl') ?? '0', 10));
  const lvlTag = `lvl${lvl + 1}pPr`;
  let lvlPPr =
    lstStyle.getElementsByTagNameNS(DRAWINGML_NS, lvlTag)[0] ??
    getElementsByLocalName(lstStyle, lvlTag)[0];
  const defaultAlgn = lvlPPr?.getAttribute?.('algn');
  return parseAlgnValue(defaultAlgn ?? null);
}

/** Get direct or nested elements by local name (namespace-agnostic). */
function getElementsByLocalName(parent: Element, localName: string): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => {
    if (el.localName === localName) out.push(el);
    for (let i = 0; i < el.children.length; i++) walk(el.children[i]);
  };
  walk(parent);
  return out;
}

/**
 * Extract text from a single shape by paragraph (a:p), with run colors and alignment.
 * Uses XML alignment only (no hard-coded default). Falls back to localName when NS lookup misses.
 */
function getShapeParagraphs(shape: Element): RichParagraph[] {
  let txBody =
    shape.getElementsByTagNameNS(PRESENTATION_NS, 'txBody')[0] ||
    shape.getElementsByTagNameNS(DRAWINGML_NS, 'txBody')[0];
  if (!txBody && shape.children) {
    for (let i = 0; i < shape.children.length; i++) {
      if (shape.children[i].localName === 'txBody') {
        txBody = shape.children[i];
        break;
      }
    }
  }
  if (!txBody) return [];
  const lstStyle =
    txBody.getElementsByTagNameNS(DRAWINGML_NS, 'lstStyle')[0] ??
    getElementsByLocalName(txBody, 'lstStyle')[0] ??
    null;
  const byNsP = txBody.getElementsByTagNameNS(DRAWINGML_NS, 'p');
  const paragraphList =
    byNsP.length > 0 ? Array.from(byNsP) : getElementsByLocalName(txBody, 'p');
  const result: RichParagraph[] = [];
  for (const para of paragraphList) {
    const align = getParagraphAlign(para, lstStyle ?? null);
    const byNsR = para.getElementsByTagNameNS(DRAWINGML_NS, 'r');
    const runList =
      byNsR.length > 0 ? Array.from(byNsR) : getElementsByLocalName(para, 'r');
    const runs: TextRun[] = [];
    for (const run of runList) {
      const byNsT = run.getElementsByTagNameNS(DRAWINGML_NS, 't');
      const tList =
        byNsT.length > 0 ? Array.from(byNsT) : getElementsByLocalName(run, 't');
      let text = '';
      for (const t of tList) text += t.textContent ?? '';
      if (!text) continue;
      const { color, bold, italic } = getRunProps(run);
      runs.push({
        text,
        ...(color && { color }),
        ...(bold && { bold: true }),
        ...(italic && { italic: true }),
      });
    }
    if (runs.length > 0) {
      const joined = runs.map((r) => r.text).join('');
      if (joined.trim()) result.push({ runs, align });
    }
  }
  return result;
}

/** Plain text from a rich paragraph (for shape blocks and backward compat). */
function richParagraphToPlain(p: RichParagraph): string {
  return p.runs
    .map((r) => r.text)
    .join('')
    .trim();
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

/** Get position in EMUs from a:xfrm -> a:off (@x, @y). Used for ordering. */
function getShapePosition(shape: Element): { x: number; y: number } {
  let xfrm: Element | null = null;
  const spPr =
    shape.getElementsByTagNameNS(PRESENTATION_NS, 'spPr')[0] ||
    shape.getElementsByTagNameNS(DRAWINGML_NS, 'spPr')[0];
  if (spPr) xfrm = spPr.getElementsByTagNameNS(DRAWINGML_NS, 'xfrm')[0];
  if (!xfrm)
    xfrm =
      shape.getElementsByTagNameNS(PRESENTATION_NS, 'xfrm')[0] ||
      shape.getElementsByTagNameNS(DRAWINGML_NS, 'xfrm')[0];
  if (!xfrm) return { x: 0, y: 0 };
  const off = xfrm.getElementsByTagNameNS(DRAWINGML_NS, 'off')[0];
  if (!off) return { x: 0, y: 0 };
  const x = parseInt(off.getAttribute('x') ?? '0', 10) || 0;
  const y = parseInt(off.getAttribute('y') ?? '0', 10) || 0;
  return { x, y };
}

type SlideBlock =
  | { type: 'title'; content: RichParagraph }
  | { type: 'paragraph'; content: RichParagraph }
  | { type: 'table'; rows: string[][] }
  | { type: 'shape'; text: string; fill: string; rounded: boolean };

type PositionedItem =
  | { kind: 'text'; content: RichParagraph; y: number; x: number }
  | { kind: 'table'; rows: string[][]; y: number; x: number }
  | {
      kind: 'shape';
      text: string;
      fill: string;
      rounded: boolean;
      y: number;
      x: number;
    };

/**
 * Walk content tree, collect items with position (a:xfrm a:off), then sort by (y, x)
 * so the topmost-leftmost text is the title and the rest follow in visual order.
 */
function walkSlideContent(parent: Element, items: PositionedItem[]): void {
  for (let i = 0; i < parent.children.length; i++) {
    const el = parent.children[i];
    const local = el.localName;
    const ns = el.namespaceURI;
    if (ns !== PRESENTATION_NS) continue;
    if (local === 'grpSp') {
      walkSlideContent(el, items);
      continue;
    }
    if (local === 'sp') {
      const paras = getShapeParagraphs(el);
      const fill = getShapeFill(el);
      const preset = getShapePreset(el);
      const rounded = preset === 'roundRect';
      const pos = getShapePosition(el);
      if (fill && paras.length > 0) {
        items.push({
          kind: 'shape',
          text: paras.map(richParagraphToPlain).join(' '),
          fill,
          rounded,
          y: pos.y,
          x: pos.x,
        });
      } else {
        for (const p of paras) {
          items.push({ kind: 'text', content: p, y: pos.y, x: pos.x });
        }
      }
    } else if (local === 'graphicFrame') {
      const grid = getTableFromGraphicFrame(el);
      if (grid) {
        const pos = getShapePosition(el);
        items.push({ kind: 'table', rows: grid, y: pos.y, x: pos.x });
      }
    }
  }
}

function extractSlideContent(xmlString: string): SlideBlock[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');
  const spTree = doc.getElementsByTagNameNS(PRESENTATION_NS, 'spTree')[0];
  if (!spTree) return [];
  const items: PositionedItem[] = [];
  walkSlideContent(spTree, items);
  items.sort((a, b) => {
    const dy = a.y - b.y;
    if (dy !== 0) return dy;
    return a.x - b.x;
  });
  const blocks: SlideBlock[] = [];
  let firstText = true;
  for (const it of items) {
    if (it.kind === 'text') {
      blocks.push({
        type: firstText ? 'title' : 'paragraph',
        content: it.content,
      });
      firstText = false;
    } else if (it.kind === 'table') {
      blocks.push({ type: 'table', rows: it.rows });
    } else {
      blocks.push({
        type: 'shape',
        text: it.text,
        fill: it.fill,
        rounded: it.rounded,
      });
    }
  }
  return blocks;
}

/** Render a rich paragraph to HTML with run colors and alignment. */
function renderRichParagraph(
  content: RichParagraph,
  tag: 'h2' | 'p',
  baseClass: string
): string {
  const alignClass =
    content.align === 'center'
      ? ' text-center'
      : content.align === 'right'
        ? ' text-right'
        : '';
  const alignStyle =
    content.align === 'center'
      ? ' text-align:center'
      : content.align === 'right'
        ? ' text-align:right'
        : '';
  const styleAttr = alignStyle ? ` style="${alignStyle}"` : '';
  const inner = content.runs
    .map((r) => {
      const escaped = escapeHtml(r.text);
      let html = r.color
        ? `<span style="color:${escapeHtml(r.color)}">${escaped}</span>`
        : escaped;
      if (r.bold) html = `<strong>${html}</strong>`;
      if (r.italic) html = `<em>${html}</em>`;
      return html;
    })
    .join('');
  return `<${tag} class="${baseClass}${alignClass}"${styleAttr}>${inner}</${tag}>`;
}

function renderBlocksToHtml(blocks: SlideBlock[], slideNum: number): string {
  const parts: string[] = [
    `<div class="mb-2 text-xs font-medium text-text-tertiary">Slide ${slideNum}</div>`,
  ];
  for (const b of blocks) {
    if (b.type === 'title') {
      parts.push(
        renderRichParagraph(
          b.content,
          'h2',
          'text-xl font-semibold mb-3 text-text-primary'
        )
      );
    } else if (b.type === 'paragraph') {
      parts.push(
        renderRichParagraph(b.content, 'p', 'text-text-primary text-sm')
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
          const message =
            e instanceof Error ? e.message : 'Failed to parse PPTX';
          const friendlyMessage =
            message.includes('central directory') || message.includes('zip')
              ? 'Invalid or corrupted file. Add a valid .pptx to public/sample.pptx for mock testing.'
              : message;
          setError(friendlyMessage);
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
