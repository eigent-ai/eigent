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

import { deferInlineScriptsUntilLoad } from '@/lib/htmlFontStyles';
import { describe, expect, it } from 'vitest';

describe('deferInlineScriptsUntilLoad', () => {
  it('only defers inline scripts that appear after an external script', () => {
    const input = `<!doctype html><html><head>
<script>window.preConfig = true;</script>
<script src="https://cdn.example.com/chart.js"></script>
<script>window.postInit = true;</script>
</head></html>`;

    const output = deferInlineScriptsUntilLoad(input);

    expect(output).toContain('<script>window.preConfig = true;</script>');
    expect(output).toContain(
      '<script src="https://cdn.example.com/chart.js"></script>'
    );
    expect(output).not.toContain('<script>window.postInit = true;</script>');
    expect(output).toContain("window.addEventListener('load'");
  });

  it('treats uppercase SRC as external and defers following inline scripts', () => {
    const input = `<script SRC="https://cdn.example.com/lib.js"></script><script>window.after = 1;</script>`;

    const output = deferInlineScriptsUntilLoad(input);

    expect(output).not.toContain('<script>window.after = 1;</script>');
    expect(output).toContain("window.addEventListener('load'");
  });

  it('does not mistake data-src as an external script source', () => {
    const input =
      '<script data-src="fake.js"></script><script>window.inline = 1;</script>';

    const output = deferInlineScriptsUntilLoad(input);

    expect(output).toBe(input);
  });

  it('preserves inline script global execution via dynamic script injection', () => {
    const input = `<script src="https://cdn.example.com/lib.js"></script><script>window.shared = 1;</script>`;

    const output = deferInlineScriptsUntilLoad(input);

    expect(output).toContain("document.createElement('script')");
    expect(output).toContain('window.shared = 1;');
  });

  it('does not rewrite non-javascript script types', () => {
    const input = `<script src="https://cdn.example.com/lib.js"></script><script type="application/json">{"k":"v"}</script><script type="text/template"><div>{{name}}</div></script>`;

    const output = deferInlineScriptsUntilLoad(input);

    expect(output).toContain(
      '<script type="application/json">{"k":"v"}</script>'
    );
    expect(output).toContain(
      '<script type="text/template"><div>{{name}}</div></script>'
    );
  });

  it('supports javascript mime types with parameters', () => {
    const input = `<script src="https://cdn.example.com/lib.js"></script><script type="text/javascript; charset=utf-8">window.paramType = 1;</script>`;

    const output = deferInlineScriptsUntilLoad(input);

    expect(output).not.toContain('window.paramType = 1;</script>');
    expect(output).toContain("window.addEventListener('load'");
  });
});
