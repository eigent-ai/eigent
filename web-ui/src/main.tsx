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

import { ThemeProvider } from '@/components/Layout/ThemeProvider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConnectionProvider } from '@/context/ConnectionContext';
import { createHost, HostProvider } from '@/host';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import App from '@web/App';
import '@web/styles.css';
import { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

const host = createHost();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <Suspense
    fallback={
      <div className="flex h-full items-center justify-center">Loading…</div>
    }
  >
    <BrowserRouter>
      <HostProvider host={host}>
        <ConnectionProvider channel="web">
          <ThemeProvider>
            <TooltipProvider>
              <App />
            </TooltipProvider>
          </ThemeProvider>
        </ConnectionProvider>
      </HostProvider>
    </BrowserRouter>
  </Suspense>
);
