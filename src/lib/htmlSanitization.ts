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
  /ipcRenderer/i,
  /window\s*\[\s*['"`]ipcRenderer['"`]\s*\]/i,
  /parent\s*\.\s*ipcRenderer/i,
  /top\s*\.\s*ipcRenderer/i,
  /frames\s*\[\s*\d+\s*\]\s*\.\s*ipcRenderer/i,
  /require\s*\(\s*['"`]electron['"`]\s*\)/i,
  /process\s*\.\s*versions\s*\.\s*electron/i,
  /nodeIntegration/i,
  /webSecurity/i,
  /contextIsolation/i,
];

function normalizedPreviewOrigins(origins: readonly string[]): string[] {
  return Array.from(
    new Set(
      origins.flatMap((value) => {
        try {
          const url = new URL(value);
          return url.protocol === 'https:' ? [url.origin] : [];
        } catch {
          return [];
        }
      })
    )
  ).sort();
}

export function buildPreviewContentSecurityPolicy(
  allowedRemoteOrigins: readonly string[] = []
): string {
  const origins = normalizedPreviewOrigins(allowedRemoteOrigins);
  const remoteSources = origins.length ? ` ${origins.join(' ')}` : '';

  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' data: blob: localfile:${remoteSources}`,
    `style-src 'unsafe-inline' data: blob: localfile:${remoteSources}`,
    `img-src data: blob: localfile:${remoteSources}`,
    `font-src data: blob: localfile:${remoteSources}`,
    `media-src data: blob: localfile:${remoteSources}`,
    origins.length ? `connect-src ${origins.join(' ')}` : "connect-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "form-action 'none'",
    `worker-src blob:${remoteSources}`,
  ].join('; ');
}

export const PREVIEW_CONTENT_SECURITY_POLICY =
  buildPreviewContentSecurityPolicy();

function hasScriptSrcAttribute(script: HTMLScriptElement): boolean {
  return script.hasAttribute('src');
}

function isClassicScriptElement(script: HTMLScriptElement): boolean {
  const rawType = script.getAttribute('type')?.trim() ?? '';
  const normalizedType = rawType.split(';', 1)[0].trim().toLowerCase();
  if (!normalizedType) return true;

  if (normalizedType === 'module' || normalizedType === 'application/ld+json') {
    return false;
  }

  return new Set([
    'text/javascript',
    'application/javascript',
    'text/ecmascript',
    'application/ecmascript',
    'application/x-javascript',
    'text/x-javascript',
    'application/x-ecmascript',
    'text/x-ecmascript',
    'text/jscript',
    'text/livescript',
  ]).has(normalizedType);
}

function canParseClassicScript(script: string): boolean {
  try {
    // Parse only. The generated function is never executed.
    new Function(script);
    return true;
  } catch {
    return false;
  }
}

function normalizeGeneratedDoubleBraces(source: string): string {
  return source.replace(/\{\{/g, '{').replace(/\}\}/g, '}');
}

/**
 * Repair reports that contain template-escaped double braces.
 *
 * CSS commonly contains a completely valid `}}` when a nested rule such as
 * `@keyframes scan { to { ... } }` closes. Treating that closing pair alone as
 * corruption discards every rule that follows it. A doubled opening `{{` is
 * the unambiguous signal that a generated stylesheet needs normalization.
 */
export function repairGeneratedReportBraces(html: string): string {
  if (!html.includes('{{') && !html.includes('}}')) {
    return html;
  }

  if (typeof DOMParser === 'undefined') {
    return html;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const doctype = html.match(/<!doctype[^>]*>/i)?.[0] || '';
  let repaired = false;

  doc.querySelectorAll('style').forEach((style) => {
    const content = style.textContent ?? '';
    if (!content.includes('{{')) {
      return;
    }

    const normalizedContent = normalizeGeneratedDoubleBraces(content);
    if (normalizedContent !== content) {
      style.textContent = normalizedContent;
      repaired = true;
    }
  });

  doc.querySelectorAll('script').forEach((script) => {
    if (hasScriptSrcAttribute(script) || !isClassicScriptElement(script)) {
      return;
    }

    const content = script.textContent ?? '';
    if (!content.includes('{{') && !content.includes('}}')) {
      return;
    }

    const normalizedContent = normalizeGeneratedDoubleBraces(content);
    if (
      !canParseClassicScript(content) &&
      canParseClassicScript(normalizedContent)
    ) {
      script.textContent = normalizedContent;
      repaired = true;
    }
  });

  return repaired
    ? `${doctype}${doc.documentElement?.outerHTML || html}`
    : html;
}

function addRemoteOrigin(origins: Set<string>, rawUrl: string | null): void {
  if (!rawUrl) return;
  const value = rawUrl.trim();
  if (!value) return;
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (url.protocol === 'https:') origins.add(url.origin);
  } catch {
    // Relative, localfile, data, blob, and malformed references stay offline.
  }
}

function collectUrlsFromText(origins: Set<string>, text: string): void {
  for (const match of text.matchAll(/https:\/\/[^\s'"`)\\]+/gi)) {
    addRemoteOrigin(origins, match[0]);
  }
  for (const match of text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
    addRemoteOrigin(origins, match[2]);
  }
}

/** Return the exact HTTPS origins a report statically declares as resources. */
export function collectPreviewRemoteOrigins(html: string): string[] {
  if (typeof DOMParser === 'undefined') return [];

  const origins = new Set<string>();
  const doc = new DOMParser().parseFromString(html, 'text/html');

  doc
    .querySelectorAll(
      'script[src], link[href], img[src], img[srcset], source[src], source[srcset], video[src], audio[src]'
    )
    .forEach((element) => {
      addRemoteOrigin(origins, element.getAttribute('src'));
      addRemoteOrigin(origins, element.getAttribute('href'));
      const srcset = element.getAttribute('srcset');
      if (srcset) {
        srcset.split(',').forEach((candidate) => {
          addRemoteOrigin(origins, candidate.trim().split(/\s+/, 1)[0]);
        });
      }
    });

  doc.querySelectorAll('script[type="importmap" i]').forEach((script) => {
    try {
      const visit = (value: unknown): void => {
        if (typeof value === 'string') {
          addRemoteOrigin(origins, value);
        } else if (Array.isArray(value)) {
          value.forEach(visit);
        } else if (value && typeof value === 'object') {
          Object.values(value).forEach(visit);
        }
      };
      visit(JSON.parse(script.textContent || '{}'));
    } catch {
      // Invalid import maps will be reported by the isolated preview itself.
    }
  });

  doc.querySelectorAll('style').forEach((style) => {
    collectUrlsFromText(origins, style.textContent || '');
  });
  doc.querySelectorAll('script:not([src])').forEach((script) => {
    collectUrlsFromText(origins, script.textContent || '');
  });
  doc.querySelectorAll('[style]').forEach((element) => {
    collectUrlsFromText(origins, element.getAttribute('style') || '');
  });

  // Google Fonts stylesheets load font bytes from this separate stable origin.
  if (origins.has('https://fonts.googleapis.com')) {
    origins.add('https://fonts.gstatic.com');
  }
  return Array.from(origins).sort();
}

/**
 * Give every srcDoc preview its own deny-by-default policy. The iframe may run
 * report scripts, but those scripts cannot fetch, beacon, submit, frame, or
 * otherwise exfiltrate files obtained through localfile://.
 */
export function injectPreviewContentSecurityPolicy(
  html: string,
  allowedRemoteOrigins: readonly string[] = []
): string {
  if (typeof DOMParser === 'undefined') return html;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const doctype = html.match(/<!doctype[^>]*>/i)?.[0] || '';
  const head = doc.head || doc.createElement('head');
  const existing = head.querySelector(
    'meta[http-equiv="Content-Security-Policy" i]'
  );
  existing?.remove();

  const policy = doc.createElement('meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy');
  policy.setAttribute(
    'content',
    buildPreviewContentSecurityPolicy(allowedRemoteOrigins)
  );
  head.prepend(policy);

  if (!doc.head) {
    const htmlElement = doc.documentElement || doc.createElement('html');
    htmlElement.prepend(head);
    if (!doc.documentElement) doc.appendChild(htmlElement);
  }

  return `${doctype}${doc.documentElement?.outerHTML || html}`;
}

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

/** Skip JS template literal expressions such as `${escapeHtml(node.image)}`. */
export function isStaticImageSrc(src: string): boolean {
  return !src.includes('${');
}

/** Remove script blocks so img tag scans match real HTML, not JS template strings. */
export function stripScriptBlocks(html: string): string {
  if (typeof document === 'undefined') {
    return html;
  }

  const template = document.createElement('template');
  template.innerHTML = html;
  template.content
    .querySelectorAll('script')
    .forEach((script) => script.remove());

  return template.innerHTML;
}
