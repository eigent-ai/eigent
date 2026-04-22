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
// Web-only Vite config for frontend-backend separation (no Electron).
// Usage: npm run dev:web | npm run build:web

import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    resolve: {
      alias: {
        '@': path.join(__dirname, 'src'),
      },
    },
    plugins: [react()],
    optimizeDeps: {
      exclude: ['@stackframe/react'],
      force: true,
    },
    build: {
      outDir: 'dist-web',
      emptyOutDir: true,
      sourcemap: true,
    },
    server: {
      port: 5173,
      open: false,
      proxy: env.VITE_PROXY_URL
        ? {
            '/api': {
              target: env.VITE_PROXY_URL,
              changeOrigin: true,
            },
          }
        : undefined,
    },
  };
});
