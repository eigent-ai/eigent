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
import { defineConfig, loadEnv, Plugin } from 'vite';
import { applyRemoteControlDevRewrite, remoteControlCsp } from './remoteCsp';

const proxyHttpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
});
const proxyHttpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
});

/**
 * In dev, route requests for the public remote-control link (`/remote-control/...`)
 * to `remote.html` so the lean entry is served. Without this, Vite serves
 * `index.html` which loads the full dispatch UI bundle.
 */
function remoteControlDevRewrite(csp: string): Plugin {
  return {
    name: 'eigent-web-ui-remote-rewrite',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        applyRemoteControlDevRewrite(req, res, csp);
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.join(__dirname, '..'), '');
  const repoRoot = path.join(__dirname, '..');
  const useMockApi = env.VITE_WEB_UI_MOCK === 'true';
  const remoteCsp = remoteControlCsp(env);

  return {
    root: __dirname,
    envDir: repoRoot,
    resolve: {
      alias: {
        '@web': path.join(__dirname, 'src'),
        '@': path.join(__dirname, 'src'),
        ...(useMockApi
          ? {
              '@/api/http': path.join(__dirname, 'src/mock/http.ts'),
            }
          : {}),
      },
    },
    plugins: [react(), remoteControlDevRewrite(remoteCsp)],
    optimizeDeps: {
      exclude: ['@stackframe/react'],
    },
    build: {
      outDir: path.join(__dirname, 'dist'),
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        input: {
          // Full web-app bundle: login, projects, profile, dispatch workspace.
          app: path.join(__dirname, 'index.html'),
          // Lean public link bundle: only the remote-control link page.
          remote: path.join(__dirname, 'remote.html'),
        },
      },
    },
    server: {
      port: 5174,
      open: false,
      fs: {
        allow: [__dirname],
      },
      proxy:
        useMockApi || !env.VITE_PROXY_URL
          ? undefined
          : {
              '/api': {
                target: env.VITE_PROXY_URL,
                changeOrigin: true,
                ws: true,
                agent: env.VITE_PROXY_URL.startsWith('https')
                  ? proxyHttpsAgent
                  : proxyHttpAgent,
              },
            },
    },
    publicDir: path.join(__dirname, 'public'),
  };
});
