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
  DANGEROUS_PATTERNS,
  STRICT_SANITIZE_CONFIG,
  containsDangerousContent,
  sanitizeHtml,
  sanitizeHtmlStrict,
} from '@/lib/htmlSanitization';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// DANGEROUS_PATTERNS
// ---------------------------------------------------------------------------
describe('DANGEROUS_PATTERNS', () => {
  it('is a non-empty array of RegExp', () => {
    expect(Array.isArray(DANGEROUS_PATTERNS)).toBe(true);
    expect(DANGEROUS_PATTERNS.length).toBeGreaterThan(0);
    for (const p of DANGEROUS_PATTERNS) {
      expect(p).toBeInstanceOf(RegExp);
    }
  });

  it('includes patterns for ipcRenderer access', () => {
    const joined = DANGEROUS_PATTERNS.map((r) => r.source).join(' ');
    expect(joined).toContain('ipcRenderer');
  });

  it('includes patterns for electron require', () => {
    const joined = DANGEROUS_PATTERNS.map((r) => r.source).join(' ');
    expect(joined).toContain('electron');
  });

  it('includes patterns for nodeIntegration / contextIsolation / webSecurity', () => {
    const joined = DANGEROUS_PATTERNS.map((r) => r.source).join(' ');
    expect(joined).toContain('nodeIntegration');
    expect(joined).toContain('contextIsolation');
    expect(joined).toContain('webSecurity');
  });
});

// ---------------------------------------------------------------------------
// containsDangerousContent
// ---------------------------------------------------------------------------
describe('containsDangerousContent', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  // ---- Electron / Node.js access patterns ---------------------------------

  it('detects ipcRenderer reference', () => {
    expect(containsDangerousContent('window.ipcRenderer.send("msg")')).toBe(
      true
    );
  });

  it('detects ipcRenderer via bracket notation', () => {
    expect(containsDangerousContent('window["ipcRenderer"].send()')).toBe(true);
    expect(containsDangerousContent("window['ipcRenderer']")).toBe(true);
    expect(containsDangerousContent('window[`ipcRenderer`]')).toBe(true);
  });

  it('detects parent.ipcRenderer access', () => {
    expect(containsDangerousContent('parent.ipcRenderer.invoke()')).toBe(true);
  });

  it('detects top.ipcRenderer access', () => {
    expect(containsDangerousContent('top.ipcRenderer.invoke()')).toBe(true);
  });

  it('detects frames[n].ipcRenderer access', () => {
    expect(containsDangerousContent('frames[0].ipcRenderer')).toBe(true);
  });

  it('detects require("electron") call', () => {
    expect(containsDangerousContent('require("electron")')).toBe(true);
    expect(containsDangerousContent("require('electron')")).toBe(true);
  });

  it('detects process.versions.electron check', () => {
    expect(containsDangerousContent('process.versions.electron')).toBe(true);
  });

  it('detects nodeIntegration string', () => {
    expect(containsDangerousContent('nodeIntegration: true')).toBe(true);
  });

  it('detects webSecurity string', () => {
    expect(containsDangerousContent('webSecurity: false')).toBe(true);
  });

  it('detects contextIsolation string', () => {
    expect(containsDangerousContent('contextIsolation: false')).toBe(true);
  });

  // ---- Case-insensitivity -------------------------------------------------

  it('detects ipcRenderer regardless of case', () => {
    expect(containsDangerousContent('IPCRenderer')).toBe(true);
    expect(containsDangerousContent('IpcRenderer')).toBe(true);
    expect(containsDangerousContent('ipcrenderer')).toBe(true);
  });

  // ---- Safe content -------------------------------------------------------

  it('returns false for plain text', () => {
    expect(containsDangerousContent('Hello, world!')).toBe(false);
  });

  it('returns false for safe HTML', () => {
    expect(
      containsDangerousContent(
        '<b>Bold</b> and <a href="https://example.com">link</a>'
      )
    ).toBe(false);
  });

  it('returns false for legitimate JavaScript that does not reference Electron APIs', () => {
    expect(
      containsDangerousContent(
        'document.querySelector(".app").textContent = "ok"'
      )
    ).toBe(false);
  });

  // ---- Edge cases ---------------------------------------------------------

  it('returns false for empty string', () => {
    expect(containsDangerousContent('')).toBe(false);
  });

  it('returns true when dangerous pattern is embedded in large content', () => {
    const safe = '<div>'.repeat(200);
    const malicious = safe + 'require("electron")' + safe;
    expect(containsDangerousContent(malicious)).toBe(true);
  });

  it('logs a console.warn when dangerous content is detected', () => {
    containsDangerousContent('ipcRenderer');
    expect(console.warn).toHaveBeenCalledWith(
      'Detected forbidden content:',
      expect.any(RegExp)
    );
  });

  it('does not log a warning for safe content', () => {
    containsDangerousContent('safe content');
    expect(console.warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// STRICT_SANITIZE_CONFIG
// ---------------------------------------------------------------------------
describe('STRICT_SANITIZE_CONFIG', () => {
  it('enables the html profile', () => {
    expect(STRICT_SANITIZE_CONFIG.USE_PROFILES).toEqual({ html: true });
  });

  it('allows safe formatting tags', () => {
    const tags = STRICT_SANITIZE_CONFIG.ALLOWED_TAGS!;
    for (const tag of [
      'b',
      'i',
      'u',
      'strong',
      'em',
      'p',
      'br',
      'span',
      'div',
    ]) {
      expect(tags).toContain(tag);
    }
  });

  it('allows heading tags h1-h6', () => {
    const tags = STRICT_SANITIZE_CONFIG.ALLOWED_TAGS!;
    for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      expect(tags).toContain(tag);
    }
  });

  it('allows list tags', () => {
    const tags = STRICT_SANITIZE_CONFIG.ALLOWED_TAGS!;
    for (const tag of ['ul', 'ol', 'li']) {
      expect(tags).toContain(tag);
    }
  });

  it('allows table tags', () => {
    const tags = STRICT_SANITIZE_CONFIG.ALLOWED_TAGS!;
    for (const tag of ['table', 'thead', 'tbody', 'tr', 'td', 'th']) {
      expect(tags).toContain(tag);
    }
  });

  it('allows img tag', () => {
    expect(STRICT_SANITIZE_CONFIG.ALLOWED_TAGS).toContain('img');
  });

  it('allows code-related tags', () => {
    const tags = STRICT_SANITIZE_CONFIG.ALLOWED_TAGS!;
    expect(tags).toContain('pre');
    expect(tags).toContain('code');
  });

  it('allows structural tags (html, head, body, style, canvas)', () => {
    const tags = STRICT_SANITIZE_CONFIG.ALLOWED_TAGS!;
    for (const tag of [
      'html',
      'head',
      'body',
      'style',
      'canvas',
      'title',
      'meta',
    ]) {
      expect(tags).toContain(tag);
    }
  });

  it('allows safe attributes', () => {
    const attrs = STRICT_SANITIZE_CONFIG.ALLOWED_ATTR!;
    for (const attr of [
      'href',
      'src',
      'alt',
      'title',
      'width',
      'height',
      'target',
      'rel',
      'class',
      'id',
      'style',
      'colspan',
      'rowspan',
    ]) {
      expect(attrs).toContain(attr);
    }
  });

  it('forbids event handler attributes', () => {
    const forbidden = STRICT_SANITIZE_CONFIG.FORBID_ATTR!;
    for (const attr of [
      'onclick',
      'onerror',
      'onload',
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
    ]) {
      expect(forbidden).toContain(attr);
    }
  });

  it('forbids dangerous tags', () => {
    const forbidden = STRICT_SANITIZE_CONFIG.FORBID_TAGS!;
    for (const tag of [
      'script',
      'iframe',
      'object',
      'embed',
      'form',
      'input',
      'button',
    ]) {
      expect(forbidden).toContain(tag);
    }
  });

  it('adds target attribute', () => {
    expect(STRICT_SANITIZE_CONFIG.ADD_ATTR).toContain('target');
  });

  it('enables SANITIZE_DOM', () => {
    expect(STRICT_SANITIZE_CONFIG.SANITIZE_DOM).toBe(true);
  });

  it('disables KEEP_CONTENT for forbidden tags', () => {
    expect(STRICT_SANITIZE_CONFIG.KEEP_CONTENT).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sanitizeHtml
// ---------------------------------------------------------------------------
describe('sanitizeHtml', () => {
  // ---- XSS Prevention: Script tags ----------------------------------------

  it('removes <script> tags', () => {
    expect(sanitizeHtml('<script>alert("xss")</script>')).not.toContain(
      'script'
    );
    expect(sanitizeHtml('<script>alert("xss")</script>')).not.toContain(
      'alert'
    );
  });

  it('removes <script src=...> tags', () => {
    expect(
      sanitizeHtml('<script src="https://evil.com/payload.js"></script>')
    ).not.toContain('script');
  });

  it('removes <script> with uppercase tag', () => {
    expect(sanitizeHtml('<SCRIPT>alert(1)</SCRIPT>')).not.toContain('script');
    expect(sanitizeHtml('<SCRIPT>alert(1)</SCRIPT>')).not.toContain('alert');
  });

  // ---- XSS Prevention: Event handlers -------------------------------------

  it('removes onclick attribute', () => {
    const result = sanitizeHtml('<div onclick="alert(1)">click me</div>');
    expect(result).not.toContain('onclick');
    expect(result).toContain('click me');
  });

  it('removes onerror attribute from img', () => {
    const result = sanitizeHtml('<img src="x" onerror="alert(1)" alt="test">');
    expect(result).not.toContain('onerror');
  });

  it('removes onload attribute', () => {
    const result = sanitizeHtml('<body onload="alert(1)">hello</body>');
    expect(result).not.toContain('onload');
  });

  it('removes onmouseover attribute', () => {
    const result = sanitizeHtml('<div onmouseover="alert(1)">hover</div>');
    expect(result).not.toContain('onmouseover');
  });

  it('removes onfocus attribute', () => {
    const result = sanitizeHtml('<div onfocus="alert(1)">focus</div>');
    expect(result).not.toContain('onfocus');
  });

  // ---- XSS Prevention: javascript: URLs -----------------------------------

  it('removes javascript: URLs in href', () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain('javascript:');
  });

  it('removes javascript: URLs with mixed case', () => {
    const result = sanitizeHtml('<a href="JaVaScRiPt:alert(1)">click</a>');
    expect(result).not.toContain('javascript');
    expect(result).not.toContain('JaVaScRiPt');
  });

  // ---- XSS Prevention: data: URLs -----------------------------------------

  it('removes data: URLs in src', () => {
    const result = sanitizeHtml(
      '<img src="data:text/html,<script>alert(1)</script>" alt="xss">'
    );
    expect(result).not.toContain('data:');
  });

  // ---- XSS Prevention: Dangerous tags -------------------------------------

  it('removes <iframe> tags', () => {
    expect(
      sanitizeHtml('<iframe src="https://evil.com"></iframe>')
    ).not.toContain('iframe');
  });

  it('removes <object> tags', () => {
    expect(sanitizeHtml('<object data="evil.swf"></object>')).not.toContain(
      'object'
    );
  });

  it('removes <embed> tags', () => {
    expect(sanitizeHtml('<embed src="evil.swf">')).not.toContain('embed');
  });

  it('removes <form> tags', () => {
    expect(
      sanitizeHtml(
        '<form action="https://evil.com"><button>Submit</button></form>'
      )
    ).not.toContain('form');
  });

  it('removes <input> tags', () => {
    expect(sanitizeHtml('<input type="hidden" value="steal">')).not.toContain(
      'input'
    );
  });

  it('removes <button> tags', () => {
    expect(
      sanitizeHtml('<button onclick="alert(1)">Click</button>')
    ).not.toContain('button');
  });

  // ---- XSS Prevention: Nested dangerous content ---------------------------

  it('removes nested script inside safe tags', () => {
    const result = sanitizeHtml('<div><b><script>alert(1)</script></b></div>');
    expect(result).not.toContain('script');
    expect(result).not.toContain('alert');
  });

  it('removes deeply nested event handlers', () => {
    const result = sanitizeHtml(
      '<div><p><span onclick="alert(1)">deep</span></p></div>'
    );
    expect(result).not.toContain('onclick');
    expect(result).toContain('deep');
  });

  it('handles multiple dangerous elements in one string', () => {
    const input = `
      <script>alert(1)</script>
      <iframe src="evil.com"></iframe>
      <div onclick="alert(2)">click</div>
      <a href="javascript:alert(3)">link</a>
    `;
    const result = sanitizeHtml(input);
    expect(result).not.toContain('script');
    expect(result).not.toContain('iframe');
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('javascript:');
  });

  // ---- Safe HTML Preservation ---------------------------------------------

  it('preserves <b> tags', () => {
    expect(sanitizeHtml('<b>bold</b>')).toContain('<b>bold</b>');
  });

  it('preserves <i> tags', () => {
    expect(sanitizeHtml('<i>italic</i>')).toContain('<i>italic</i>');
  });

  it('preserves <strong> tags', () => {
    expect(sanitizeHtml('<strong>strong</strong>')).toContain(
      '<strong>strong</strong>'
    );
  });

  it('preserves <em> tags', () => {
    expect(sanitizeHtml('<em>emphasis</em>')).toContain('<em>emphasis</em>');
  });

  it('preserves <u> tags', () => {
    expect(sanitizeHtml('<u>underline</u>')).toContain('<u>underline</u>');
  });

  it('preserves <p> tags', () => {
    expect(sanitizeHtml('<p>paragraph</p>')).toContain('<p>paragraph</p>');
  });

  it('preserves <br> tags', () => {
    expect(sanitizeHtml('line1<br>line2')).toContain('<br>');
  });

  it('preserves <a> tags with valid href', () => {
    const result = sanitizeHtml('<a href="https://example.com">link</a>');
    expect(result).toContain('href');
    expect(result).toContain('example.com');
    expect(result).toContain('link');
  });

  it('preserves <img> tags with safe attributes', () => {
    const result = sanitizeHtml(
      '<img src="https://example.com/img.png" alt="desc" width="100" height="50">'
    );
    expect(result).toContain('src');
    expect(result).toContain('alt');
    expect(result).toContain('width');
    expect(result).toContain('height');
  });

  it('preserves heading tags', () => {
    expect(sanitizeHtml('<h1>Title</h1>')).toContain('<h1>Title</h1>');
    expect(sanitizeHtml('<h2>Subtitle</h2>')).toContain('<h2>Subtitle</h2>');
    expect(sanitizeHtml('<h3>Section</h3>')).toContain('<h3>Section</h3>');
  });

  it('preserves list tags', () => {
    const result = sanitizeHtml('<ul><li>item 1</li><li>item 2</li></ul>');
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>');
    expect(result).toContain('item 1');
  });

  it('preserves ordered list tags', () => {
    const result = sanitizeHtml('<ol><li>first</li><li>second</li></ol>');
    expect(result).toContain('<ol>');
    expect(result).toContain('first');
  });

  it('preserves <pre> and <code> tags', () => {
    const result = sanitizeHtml('<pre><code>const x = 1;</code></pre>');
    expect(result).toContain('<pre>');
    expect(result).toContain('<code>');
    expect(result).toContain('const x = 1;');
  });

  it('preserves table tags', () => {
    const result = sanitizeHtml(
      '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>D</td></tr></tbody></table>'
    );
    expect(result).toContain('<table>');
    expect(result).toContain('<th>');
    expect(result).toContain('<td>');
  });

  it('preserves <div> and <span> tags', () => {
    expect(sanitizeHtml('<div>block</div>')).toContain('<div>block</div>');
    expect(sanitizeHtml('<span>inline</span>')).toContain(
      '<span>inline</span>'
    );
  });

  it('preserves class and id attributes', () => {
    const result = sanitizeHtml(
      '<div class="container" id="main">content</div>'
    );
    expect(result).toContain('class="container"');
    expect(result).toContain('id="main"');
  });

  it('preserves style attribute', () => {
    const result = sanitizeHtml('<span style="color: red;">red</span>');
    expect(result).toContain('style');
    expect(result).toContain('color');
  });

  it('preserves colspan and rowspan on table cells', () => {
    const result = sanitizeHtml(
      '<table><tr><td colspan="2" rowspan="3">cell</td></tr></table>'
    );
    expect(result).toContain('colspan');
    expect(result).toContain('rowspan');
  });

  // ---- Edge cases ---------------------------------------------------------

  it('returns a string for empty string input', () => {
    const result = sanitizeHtml('');
    expect(typeof result).toBe('string');
  });

  it('handles plain text without any HTML', () => {
    const result = sanitizeHtml('just some text');
    expect(result).toContain('just some text');
  });

  it('handles very long HTML content', () => {
    const longContent = '<p>paragraph</p>'.repeat(1000);
    const result = sanitizeHtml(longContent);
    expect(result).toContain('<p>paragraph</p>');
  });

  it('handles HTML entities', () => {
    const result = sanitizeHtml('&lt;script&gt;alert(1)&lt;/script&gt;');
    // DOMPurify should not double-encode already-encoded entities
    expect(result).toContain('&lt;');
  });

  it('strips unknown / disallowed tags but may keep content', () => {
    const result = sanitizeHtml('<marquee>scrolled</marquee>');
    expect(result).toContain('scrolled');
  });
});

// ---------------------------------------------------------------------------
// sanitizeHtmlStrict
// ---------------------------------------------------------------------------
describe('sanitizeHtmlStrict', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  // ---- Dangerous content returns empty string -----------------------------

  it('returns empty string when ipcRenderer is detected', () => {
    expect(sanitizeHtmlStrict('window.ipcRenderer.send()')).toBe('');
  });

  it('returns empty string when require("electron") is detected', () => {
    expect(sanitizeHtmlStrict('require("electron")')).toBe('');
  });

  it('returns empty string when nodeIntegration is detected', () => {
    expect(sanitizeHtmlStrict('nodeIntegration')).toBe('');
  });

  it('returns empty string when contextIsolation is detected', () => {
    expect(sanitizeHtmlStrict('contextIsolation')).toBe('');
  });

  it('returns empty string when webSecurity is detected', () => {
    expect(sanitizeHtmlStrict('webSecurity')).toBe('');
  });

  it('returns empty string when process.versions.electron is detected', () => {
    expect(sanitizeHtmlStrict('process.versions.electron')).toBe('');
  });

  // ---- Safe content passes through DOMPurify ------------------------------

  it('sanitizes safe HTML through DOMPurify', () => {
    const result = sanitizeHtmlStrict('<b>bold</b> and <em>italic</em>');
    expect(result).toContain('<b>bold</b>');
    expect(result).toContain('<em>italic</em>');
  });

  it('removes scripts even when content is not dangerous to Electron', () => {
    const result = sanitizeHtmlStrict(
      '<p>Hello</p><script>alert("xss")</script>'
    );
    expect(result).not.toContain('script');
    expect(result).toContain('Hello');
  });

  // ---- Difference from sanitizeHtml ---------------------------------------

  it('behaves differently from sanitizeHtml when dangerous patterns are present', () => {
    const malicious = '<b>ipcRenderer</b>';
    // sanitizeHtml just sanitizes HTML, doesn't check for Electron patterns
    const regularResult = sanitizeHtml(malicious);
    const strictResult = sanitizeHtmlStrict(malicious);
    // sanitizeHtml returns sanitized output, sanitizeHtmlStrict returns ''
    expect(regularResult).toContain('ipcRenderer');
    expect(strictResult).toBe('');
  });

  it('produces the same result as sanitizeHtml for safe content', () => {
    const safe = '<p>Hello <strong>world</strong></p>';
    expect(sanitizeHtmlStrict(safe)).toBe(sanitizeHtml(safe));
  });

  // ---- Edge cases ---------------------------------------------------------

  it('returns empty-ish result for empty string (no dangerous content)', () => {
    const result = sanitizeHtmlStrict('');
    expect(result).toBe('');
  });

  it('handles mixed dangerous pattern inside HTML', () => {
    const result = sanitizeHtmlStrict(
      '<div>safe</div><div>require("electron")</div>'
    );
    expect(result).toBe('');
  });
});
