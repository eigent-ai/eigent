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

/**
 * Consistent font style tag for HTML content rendering.
 * Uses system fonts with !important to override inline styles.
 */
export const FONT_STYLE_TAG = `<style data-eigent-fonts>
  *, *::before, *::after {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif !important;
  }
  code, pre, kbd, samp {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace !important;
  }
</style>`;

/**
 * Injects font styles into HTML content.
 * Smart injection that handles different HTML structures:
 * - Injects after <head> if present
 * - Injects after <html> if no <head>
 * - Prepends to content otherwise
 */
export function injectFontStyles(html: string): string {
  // If HTML has <head>, inject after <head>
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1${FONT_STYLE_TAG}`);
  }
  // If HTML has <html>, inject after <html>
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/(<html[^>]*>)/i, `$1${FONT_STYLE_TAG}`);
  }
  // Otherwise prepend to content
  return FONT_STYLE_TAG + html;
}

/**
 * Checks if content is a pure HTML document (starts with <!DOCTYPE html> or <html>).
 * Used to determine if content should be rendered as raw HTML vs markdown.
 */
export function isHtmlDocument(text: string): boolean {
  const trimmed = text.trim();
  return /^<!doctype\s+html/i.test(trimmed) || /^<html/i.test(trimmed);
}

/** Defers inline scripts until window load when the document has external <script src="...">, so CDN scripts (e.g. Chart.js) are available before chart code runs. */
export function deferInlineScriptsUntilLoad(html: string): string {
  const lower = html.toLowerCase();
  let idx = lower.indexOf('<script');
  let hasExternal = false;
  while (idx !== -1) {
    const end = html.indexOf('>', idx);
    if (end !== -1 && /\bsrc\s*=/.test(html.slice(idx, end))) {
      hasExternal = true;
      break;
    }
    idx = lower.indexOf('<script', idx + 1);
  }
  if (!hasExternal) return html;

  let result = '';
  let i = 0;
  while (i < html.length) {
    const scriptStart = lower.indexOf('<script', i);
    if (scriptStart === -1) {
      result += html.slice(i);
      break;
    }
    result += html.slice(i, scriptStart);
    const afterOpen = scriptStart + '<script'.length;
    const attrEnd = html.indexOf('>', afterOpen);
    if (attrEnd === -1) {
      result += html.slice(scriptStart);
      break;
    }
    const attrs = html.slice(afterOpen, attrEnd);
    const hasSrc = /\bsrc\s*=/.test(attrs);
    const contentStart = attrEnd + 1;
    const endTag = '</script>';
    const contentEnd = html.toLowerCase().indexOf(endTag, contentStart);
    if (contentEnd === -1) {
      result += html.slice(scriptStart);
      break;
    }
    const fullTag = html.slice(scriptStart, contentEnd + endTag.length);
    const content = html.slice(contentStart, contentEnd);
    if (!hasSrc && content.trim().length > 0) {
      const escaped = content.replace(/<\/script>/gi, '<\\/script>');
      result += `<script>window.addEventListener('load',function(){${escaped}});</script>`;
    } else {
      result += fullTag;
    }
    i = contentEnd + endTag.length;
  }
  return result;
}
