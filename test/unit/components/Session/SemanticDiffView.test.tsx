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
  SemanticDiffView,
  semanticDiffKindForPath,
} from '@/components/Session/PreviewPanel/tabs/review/SemanticDiffView';
import type { ReviewFile } from '@/components/Session/PreviewPanel/tabs/review/useReviewChanges';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const file: ReviewFile = {
  id: 'json:config.json',
  path: 'config.json',
  status: 'modified',
  absPath: '',
  bakPath: null,
};

describe('SemanticDiffView', () => {
  it('detects the file types that have a semantic renderer', () => {
    expect(semanticDiffKindForPath('README.md')).toBe('markdown');
    expect(semanticDiffKindForPath('report.HTML')).toBe('html');
    expect(semanticDiffKindForPath('config.json')).toBe('json');
    expect(semanticDiffKindForPath('config.jsonc')).toBeNull();
    expect(semanticDiffKindForPath('assets/hero.webp')).toBe('image');
    expect(semanticDiffKindForPath('src/app.ts')).toBeNull();
  });

  it('renders JSON changes by stable paths instead of raw line positions', () => {
    render(
      <SemanticDiffView
        file={file}
        kind="json"
        sides={{
          original: '{"name":"before","enabled":false}',
          modified: '{"name":"after","enabled":true,"count":2}',
        }}
      />
    );

    expect(screen.getByText('$.name')).toBeInTheDocument();
    expect(screen.getByText('$.count')).toBeInTheDocument();
    expect(screen.getByText('"before"')).toBeInTheDocument();
    expect(screen.getByText('"after"')).toBeInTheDocument();
  });

  it('removes scripts and applies a restrictive policy to HTML previews', () => {
    render(
      <SemanticDiffView
        file={{ ...file, path: 'index.html' }}
        kind="html"
        sides={{
          original: '<h1>Before</h1>',
          modified: '<h1>After</h1><script>window.pwned = true</script>',
        }}
      />
    );

    const frames = screen.getAllByTitle('HTML preview');
    expect(frames).toHaveLength(2);
    const srcDoc = frames[1].getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('Content-Security-Policy');
    expect(srcDoc).not.toContain('<script');
    expect(frames[1]).toHaveAttribute('sandbox', '');
  });

  it('explains when a Git-backed image has no preview payload', async () => {
    render(
      <SemanticDiffView
        file={{ ...file, path: 'image.png', binary: true }}
        kind="image"
        sides={null}
      />
    );

    expect(
      await screen.findByText(
        'Image metadata is available, but this Git-backed change has no local preview payload.'
      )
    ).toBeInTheDocument();
  });

  it('loads a Git-backed image from its pinned commit and revokes the URL', async () => {
    const createObjectURL = vi.fn(() => 'blob:git-image');
    const revokeObjectURL = vi.fn();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });
    const loadPreview = vi.fn(() =>
      Promise.resolve(new Blob(['image'], { type: 'image/png' }))
    );

    const { container, unmount } = render(
      <SemanticDiffView
        file={{
          ...file,
          path: 'image.png',
          status: 'added',
          binary: true,
          loadPreview,
        }}
        kind="image"
        sides={null}
      />
    );

    await waitFor(() => expect(loadPreview).toHaveBeenCalledWith('after'));
    expect(loadPreview).not.toHaveBeenCalledWith('before');
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'blob:git-image'
    );
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:git-image');
  });

  it('shows the actual Git image load failure instead of a missing-payload message', async () => {
    const loadPreview = vi.fn(() =>
      Promise.reject(new Error('Image preview is too large'))
    );

    render(
      <SemanticDiffView
        file={{
          ...file,
          path: 'image.png',
          status: 'added',
          binary: true,
          loadPreview,
        }}
        kind="image"
        sides={null}
      />
    );

    expect(
      await screen.findByText(
        'Could not load this file: Image preview is too large'
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        'Image metadata is available, but this Git-backed change has no local preview payload.'
      )
    ).not.toBeInTheDocument();
  });

  it('renders sanitized SVG text from both Git sides', async () => {
    const { container } = render(
      <SemanticDiffView
        file={{ ...file, path: 'icon.svg' }}
        kind="image"
        sides={{
          original: '<svg><circle cx="5" cy="5" r="5" /></svg>',
          modified:
            '<svg><rect width="10" height="10" /><script>alert(1)</script></svg>',
        }}
      />
    );

    await screen.findByText('Before');
    const images = container.querySelectorAll('img');
    expect(images).toHaveLength(2);
    expect(decodeURIComponent(images[1].src)).not.toContain('<script');
  });
});
