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

import { describe, expect, it, vi } from 'vitest';

import {
  getRelativePathFromDir,
  inlineLocalHtmlImgElements,
  inlineLocalHtmlScriptElements,
  inlineLocalProjectImagePaths,
  toLocalFileUrl,
} from '@/lib/htmlLocalAssets';

describe('toLocalFileUrl', () => {
  it('converts absolute unix paths to localfile base hrefs', () => {
    expect(toLocalFileUrl('/Users/test/canvas_map')).toBe(
      'localfile://preview/Users/test/canvas_map/'
    );
  });

  it('upgrades existing localfile urls to the navigable fixed-host format', () => {
    expect(toLocalFileUrl('localfile:///Users/test/canvas_map/')).toBe(
      'localfile://preview/Users/test/canvas_map/'
    );
  });

  it('converts query-based preview urls to the navigable fixed-host format', () => {
    expect(
      toLocalFileUrl(
        'localfile://preview/?path=%2FUsers%2FExample%20User%2Fcanvas_map'
      )
    ).toBe('localfile://preview/Users/Example%20User/canvas_map/');
  });

  it('emits standard localfile urls for Windows drive paths', () => {
    expect(toLocalFileUrl('C:\\Users\\test\\canvas_map')).toBe(
      'localfile://preview/C:/Users/test/canvas_map/'
    );
  });
});

describe('getRelativePathFromDir', () => {
  it('returns relative image paths within the html directory', () => {
    expect(
      getRelativePathFromDir(
        '/Users/test/canvas_map',
        '/Users/test/canvas_map/assets/home.png'
      )
    ).toBe('assets/home.png');
  });
});

describe('inlineLocalHtmlImgElements', () => {
  it('rewrites real image elements without replacing identical script strings', async () => {
    const html = `
      <script>
        const thumbnail = '<img src="assets/home.png" alt="home">';
      </script>
      <img src="assets/home.png" alt="home">
    `;

    const readFileAsDataUrl = vi
      .fn()
      .mockResolvedValue('data:image/png;base64,abc123');

    const result = await inlineLocalHtmlImgElements(
      html,
      '/Users/test/canvas_map',
      readFileAsDataUrl
    );

    expect(readFileAsDataUrl).toHaveBeenCalledTimes(1);
    expect(readFileAsDataUrl).toHaveBeenCalledWith(
      '/Users/test/canvas_map/assets/home.png'
    );
    expect(result).toContain(
      `const thumbnail = '<img src="assets/home.png" alt="home">';`
    );
    expect(result).toContain('<img src="data:image/png;base64,abc123"');
  });
});

describe('inlineLocalProjectImagePaths', () => {
  it('replaces quoted relative image paths with data urls', async () => {
    const html = `
      <script>
        const CANVAS_DATA = {
          nodes: [{ id: "home", image: "assets/home.png" }]
        };
      </script>
    `;

    const readFileAsDataUrl = vi
      .fn()
      .mockResolvedValue('data:image/png;base64,abc123');

    const result = await inlineLocalProjectImagePaths(
      html,
      '/Users/test/canvas_map',
      [
        {
          path: '/Users/test/canvas_map/assets/home.png',
        },
      ],
      readFileAsDataUrl
    );

    expect(readFileAsDataUrl).toHaveBeenCalledWith(
      '/Users/test/canvas_map/assets/home.png'
    );
    expect(result).toContain('data:image/png;base64,abc123');
    expect(result).not.toContain('"assets/home.png"');
  });

  it('does not read project images that are not referenced in the html', async () => {
    const html = `
      <script>
        const CANVAS_DATA = {
          nodes: [{ id: "home", image: "assets/home.png" }]
        };
      </script>
    `;

    const readFileAsDataUrl = vi
      .fn()
      .mockResolvedValue('data:image/png;base64,abc123');

    await inlineLocalProjectImagePaths(
      html,
      '/Users/test/canvas_map',
      [
        {
          path: '/Users/test/canvas_map/assets/home.png',
        },
        {
          path: '/Users/test/canvas_map/assets/unused.png',
        },
      ],
      readFileAsDataUrl
    );

    expect(readFileAsDataUrl).toHaveBeenCalledTimes(1);
    expect(readFileAsDataUrl).toHaveBeenCalledWith(
      '/Users/test/canvas_map/assets/home.png'
    );
  });
});

describe('inlineLocalHtmlScriptElements', () => {
  it('inlines relative scripts without changing authorized remote scripts', async () => {
    const html = `<!doctype html><html><head>
      <script src="https://cdnjs.cloudflare.com/p5.min.js"></script>
    </head><body><script src="sketch.js?v=1"></script></body></html>`;
    const readTextFile = vi
      .fn()
      .mockResolvedValue('function setup() { createCanvas(100, 100); }');

    const result = await inlineLocalHtmlScriptElements(
      html,
      '/Users/test/P5-new',
      readTextFile
    );

    expect(readTextFile).toHaveBeenCalledOnce();
    expect(readTextFile).toHaveBeenCalledWith('/Users/test/P5-new/sketch.js');
    expect(result).toContain('src="https://cdnjs.cloudflare.com/p5.min.js"');
    expect(result).toContain('data-source="sketch.js?v=1"');
    expect(result).toContain('function setup() { createCanvas(100, 100); }');
    expect(result).not.toContain('src="sketch.js?v=1"');
  });

  it('leaves a local script reference in place when the file cannot be read', async () => {
    const html = '<html><body><script src="missing.js"></script></body></html>';
    const readTextFile = vi.fn().mockRejectedValue(new Error('missing'));

    const result = await inlineLocalHtmlScriptElements(
      html,
      '/Users/test/P5-new',
      readTextFile
    );

    expect(result).toContain('src="missing.js"');
  });

  it('does not treat explicit URL schemes as local script paths', async () => {
    const html =
      '<html><body><script src="vbscript:alert(1)"></script></body></html>';
    const readTextFile = vi.fn();

    const result = await inlineLocalHtmlScriptElements(
      html,
      '/Users/test/P5-new',
      readTextFile
    );

    expect(readTextFile).not.toHaveBeenCalled();
    expect(result).toContain('src="vbscript:alert(1)"');
  });
});
