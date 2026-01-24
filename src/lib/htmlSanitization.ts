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

import DOMPurify, { Config } from 'dompurify';

/**
 * Patterns that indicate potentially dangerous Electron/Node.js access attempts.
 * These should be blocked even in sandboxed iframes as a defense-in-depth measure.
 */
export const DANGEROUS_PATTERNS = [
  /ipcRenderer/gi,
  /window\s*\[\s*['"`]ipcRenderer['"`]\s*\]/gi,
  /parent\s*\.\s*ipcRenderer/gi,
  /top\s*\.\s*ipcRenderer/gi,
  /frames\s*\[\s*\d+\s*\]\s*\.\s*ipcRenderer/gi,
  /require\s*\(\s*['"`]electron['"`]\s*\)/gi,
  /process\s*\.\s*versions\s*\.\s*electron/gi,
  /nodeIntegration/gi,
  /webSecurity/gi,
  /contextIsolation/gi,
];

/**
 * Check if HTML content contains dangerous patterns that could attempt
 * to access Electron/Node.js APIs.
 */
export function containsDangerousContent(html: string): boolean {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(html)) {
      console.warn('Detected forbidden content:', pattern);
      return true;
    }
  }
  return false;
}

/**
 * DOMPurify configuration for strict HTML sanitization.
 * This removes scripts, iframes, forms, and event handlers.
 */
export const STRICT_SANITIZE_CONFIG: Config = {
  USE_PROFILES: { html: true },
  ALLOWED_TAGS: [
    'a',
    'b',
    'i',
    'u',
    'strong',
    'em',
    'p',
    'br',
    'ul',
    'ol',
    'li',
    'img',
    'div',
    'span',
    'table',
    'thead',
    'tbody',
    'tr',
    'td',
    'th',
    'pre',
    'code',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'style',
    'canvas',
    'html',
    'head',
    'body',
    'title',
    'meta',
  ],
  ALLOWED_ATTR: [
    'href',
    'src',
    'alt',
    'title',
    'width',
    'height',
    'target',
    'rel',
    'colspan',
    'rowspan',
    'class',
    'id',
    'style',
  ],
  FORBID_ATTR: [
    'onerror',
    'onload',
    'onclick',
    'onmouseover',
    'onfocus',
    'onblur',
    'onchange',
    'onsubmit',
    'onreset',
    'onselect',
    'onabort',
    'onkeydown',
    'onkeypress',
    'onkeyup',
    'onunload',
  ],
  FORBID_TAGS: [
    'script',
    'iframe',
    'object',
    'embed',
    'form',
    'input',
    'button',
  ],
  ADD_ATTR: ['target'],
  SANITIZE_DOM: true,
  KEEP_CONTENT: false,
};

/**
 * Sanitize HTML content using DOMPurify with strict configuration.
 * Use this when you want to display HTML without any scripts or interactive elements.
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, STRICT_SANITIZE_CONFIG);
}

/**
 * Full HTML sanitization pipeline:
 * 1. Check for dangerous Electron/Node patterns
 * 2. Apply DOMPurify sanitization
 * 
 * Returns empty string if dangerous content is detected.
 */
export function sanitizeHtmlStrict(html: string): string {
  if (containsDangerousContent(html)) {
    return '';
  }
  return sanitizeHtml(html);
}
