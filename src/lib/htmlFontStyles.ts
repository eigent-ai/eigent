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
 * Scoped font style for HTML fragments rendered in the main document (e.g. CSV in FolderComponent).
 * Uses a wrapper class so styles do not leak to the rest of the app (sidebar, file list, etc.).
 */
const SCOPED_FONT_STYLE = `<style data-eigent-fonts>
  .eigent-file-content *, .eigent-file-content *::before, .eigent-file-content *::after {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif !important;
  }
  .eigent-file-content code, .eigent-file-content pre, .eigent-file-content kbd, .eigent-file-content samp {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace !important;
  }
</style>`;

/**
 * Unscoped font style for full HTML documents rendered in an iframe (e.g. HtmlRenderer).
 * Safe there because the iframe has its own document.
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
 * - For fragments (no head/html): uses scoped styles and a wrapper so the app layout is not affected.
 * - For full documents (iframe): injects global-style tag; scope is the iframe document only.
 */
export function injectFontStyles(html: string): string {
  // If HTML has <head>, inject after <head> (full document, typically in iframe)
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1${FONT_STYLE_TAG}`);
  }
  // If HTML has <html>, inject after <html> (full document, typically in iframe)
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/(<html[^>]*>)/i, `$1${FONT_STYLE_TAG}`);
  }
  // Fragment (e.g. CSV table): scope to wrapper so styles don't affect sidebar/app
  return (
    SCOPED_FONT_STYLE + '<div class="eigent-file-content">' + html + '</div>'
  );
}

/**
 * Checks if content is a pure HTML document (starts with <!DOCTYPE html> or <html>).
 * Used to determine if content should be rendered as raw HTML vs markdown.
 */
export function isHtmlDocument(text: string): boolean {
  const trimmed = text.trim();
  return /^<!doctype\s+html/i.test(trimmed) || /^<html/i.test(trimmed);
}
