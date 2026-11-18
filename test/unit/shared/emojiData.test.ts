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

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { Plugin } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import { emojiData, emojiDataFiles } from '../../../scripts/vite-emoji-data';
import {
  EMOJI_DATA_LOCALES,
  EMOJI_DATA_PACKAGE,
} from '../../../src/shared/emojiData';

const root = path.resolve(__dirname, '../../..');
const packageDir = path.join(root, 'node_modules', EMOJI_DATA_PACKAGE);

type Middleware = (
  request: { url?: string },
  response: PassThrough & { setHeader: (name: string, value: string) => void },
  next: () => void
) => void;

function devMiddleware(plugin: Plugin): Middleware {
  let middleware: Middleware | undefined;
  const configureServer = plugin.configureServer as unknown as (server: {
    middlewares: { use: (handler: Middleware) => void };
  }) => void;
  configureServer({
    middlewares: {
      use: (handler) => {
        middleware = handler;
      },
    },
  });
  if (!middleware) throw new Error('The plugin added no dev middleware');
  return middleware;
}

async function request(middleware: Middleware, url: string) {
  const headers: Record<string, string> = {};
  const response = Object.assign(new PassThrough(), {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  });
  const next = vi.fn();
  middleware({ url }, response, next);
  if (next.mock.calls.length) return { served: false as const };
  const chunks: Buffer[] = [];
  for await (const chunk of response) chunks.push(chunk as Buffer);
  return {
    served: true as const,
    headers,
    body: Buffer.concat(chunks).toString('utf8'),
  };
}

describe('the emoji lists the app ships', () => {
  const files = emojiDataFiles(packageDir);

  it('covers the list and its labels for every picker language', () => {
    expect(files.map((file) => file.fileName)).toEqual(
      EMOJI_DATA_LOCALES.flatMap((locale) => [
        `emojibase/${locale}/data.json`,
        `emojibase/${locale}/messages.json`,
      ])
    );
  });

  it('finds every file in the installed package', () => {
    expect(files.filter((file) => !existsSync(file.source))).toEqual([]);
  });

  it('holds what the picker reads: emojis, groups and skin tones', () => {
    const english = (name: string) =>
      JSON.parse(readFileSync(path.join(packageDir, 'en', name), 'utf8'));

    expect(english('data.json')[0]).toEqual(
      expect.objectContaining({
        emoji: expect.any(String),
        label: expect.any(String),
        version: expect.any(Number),
      })
    );
    expect(Object.keys(english('messages.json'))).toEqual(
      expect.arrayContaining(['groups', 'subgroups', 'skinTones'])
    );
  });

  it('is copied into a build next to index.html', () => {
    const emitFile = vi.fn();
    const generateBundle = emojiData(root).generateBundle as unknown as (this: {
      emitFile: typeof emitFile;
    }) => void;

    generateBundle.call({ emitFile });

    expect(emitFile).toHaveBeenCalledTimes(files.length);
    expect(emitFile).toHaveBeenCalledWith({
      type: 'asset',
      fileName: 'emojibase/en/data.json',
      source: readFileSync(path.join(packageDir, 'en', 'data.json')),
    });
  });

  it('is served by the dev server at the same path', async () => {
    const middleware = devMiddleware(emojiData(root));

    const served = await request(middleware, '/emojibase/ja/messages.json?v=1');

    expect(served.served).toBe(true);
    expect(served.headers?.['Content-Type']).toContain('application/json');
    expect(served.body).toBe(
      readFileSync(path.join(packageDir, 'ja', 'messages.json'), 'utf8')
    );
  });

  it('leaves every other request to the dev server', async () => {
    const middleware = devMiddleware(emojiData(root));

    for (const url of [
      '/',
      '/emojibase/en/compact.json',
      '/emojibase/../package.json',
      '/emojibase/pt/data.json',
    ]) {
      expect((await request(middleware, url)).served).toBe(false);
    }
  });

  it('stops a build that would ship without the lists', () => {
    const plugin = emojiData(path.join(root, 'no-such-folder'));
    const context = {
      error: vi.fn((message: string) => {
        throw new Error(message);
      }),
      warn: vi.fn(),
    };
    const configResolved = plugin.configResolved as unknown as (config: {
      command: string;
    }) => void;
    const buildStart = plugin.buildStart as unknown as (
      this: typeof context
    ) => void;

    configResolved({ command: 'build' });
    expect(() => buildStart.call(context)).toThrow('Emoji list not found');

    // The dev server still starts: the picker falls back to the CDN there.
    configResolved({ command: 'serve' });
    expect(() => buildStart.call(context)).not.toThrow();
    expect(context.warn).toHaveBeenCalledTimes(1);
  });
});
