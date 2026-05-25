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

import react from '@vitejs/plugin-react';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';

const proxyHttpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
});
const proxyHttpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.join(__dirname, '..'), '');
  const repoRoot = path.join(__dirname, '..');

  return {
    root: __dirname,
    envDir: repoRoot,
    resolve: {
      alias: {
        '@web': path.join(__dirname, 'src'),
        '@desktop': path.join(repoRoot, 'src'),
        '@': path.join(repoRoot, 'src'),
      },
    },
    plugins: [react()],
    optimizeDeps: {
      exclude: ['@stackframe/react'],
    },
    build: {
      outDir: path.join(__dirname, 'dist'),
      emptyOutDir: true,
      sourcemap: true,
    },
    server: {
      port: 5174,
      open: false,
      fs: {
        allow: [repoRoot],
      },
      proxy: env.VITE_PROXY_URL
        ? {
            '/api': {
              target: env.VITE_PROXY_URL,
              changeOrigin: true,
              agent: env.VITE_PROXY_URL.startsWith('https')
                ? proxyHttpsAgent
                : proxyHttpAgent,
            },
          }
        : undefined,
    },
    publicDir: path.join(repoRoot, 'public'),
  };
});
