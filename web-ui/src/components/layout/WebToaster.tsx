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

import { cn } from '@/lib/utils';
import { useIsMobile } from '@web/hooks/useWebAuth';
import { useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';

export function WebToaster() {
  const location = useLocation();
  const isMobile = useIsMobile();
  const isDispatchTaskPage =
    !isMobile && /^\/projects\/[^/]+/.test(location.pathname);

  return (
    <Toaster
      position="top-center"
      richColors
      className={cn(isDispatchTaskPage && 'web-toaster-task-page')}
      toastOptions={{
        classNames: {
          toast: 'web-toaster-toast',
        },
      }}
    />
  );
}
