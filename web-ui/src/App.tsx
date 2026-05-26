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

import { useExecutionSubscription } from '@/hooks/useExecutionSubscription';
import { queryClient } from '@/lib/queryClient';
import { useAuthStore } from '@/store/authStore';
import { QueryClientProvider } from '@tanstack/react-query';
import { WebToaster } from '@web/components/layout/WebToaster';
import { isWebUiMock } from '@web/lib/mockMode';
import WebRoutes from '@web/routes';

function WebExecutionSubscription() {
  const token = useAuthStore((state) => state.token);
  useExecutionSubscription(Boolean(token) && !isWebUiMock());
  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WebExecutionSubscription />
      <WebRoutes />
      <WebToaster />
    </QueryClientProvider>
  );
}
