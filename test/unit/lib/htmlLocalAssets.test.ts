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
  createInlineAssetBudget,
  getRelativePathFromDir,
  inlineLocalHtmlImgElements,
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

describe('inline asset aggregate budget', () => {
  const dataUrl = `data:image/png;base64,${'A'.repeat(100)}`;

  it('stops inlining html <img> elements once the budget is exhausted', async () => {
    const html = '<img src="a.png"><img src="b.png"><img src="c.png">';
    const readFileAsDataUrl = vi.fn().mockResolvedValue(dataUrl);
    // Enough for the first asset (~123 chars) but not the second.
    const budget = createInlineAssetBudget(150);

    const result = await inlineLocalHtmlImgElements(
      html,
      '/dir',
      readFileAsDataUrl,
      budget
    );

    expect(budget.truncated).toBe(true);
    expect(result).toContain(`src="${dataUrl}"`);
    expect(result).toContain('src="b.png"');
    expect(result).toContain('src="c.png"');
  });

  it('leaves the budget untruncated when every asset fits', async () => {
    const html = '<img src="a.png">';
    const readFileAsDataUrl = vi.fn().mockResolvedValue(dataUrl);
    const budget = createInlineAssetBudget();

    const result = await inlineLocalHtmlImgElements(
      html,
      '/dir',
      readFileAsDataUrl,
      budget
    );

    expect(budget.truncated).toBe(false);
    expect(result).toContain(`src="${dataUrl}"`);
  });

  it('shares one budget across project-path inlining and skips over-budget assets', async () => {
    const html = '{ "x": "a.png", "y": "b.png" }';
    const readFileAsDataUrl = vi.fn().mockResolvedValue(dataUrl);
    const budget = createInlineAssetBudget(150);

    const result = await inlineLocalProjectImagePaths(
      html,
      '/dir',
      [{ path: '/dir/a.png' }, { path: '/dir/b.png' }],
      readFileAsDataUrl,
      budget
    );

    expect(budget.truncated).toBe(true);
    expect(result).toContain(dataUrl);
    expect(result).toContain('"b.png"');
  });
});
