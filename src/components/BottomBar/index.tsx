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

import { Button } from '@/components/ui/button';
import { useWorkflowViewportStore } from '@/store/workflowViewportStore';
import { ChevronLeft, ChevronRight } from 'lucide-react';

function BottomBar() {
  const { moveLeft, moveRight } = useWorkflowViewportStore();

  return (
    <div className="h-12 pt-2 relative z-50 flex items-center justify-center">
      {(moveLeft || moveRight) && (
        <div className="right-2 pb-2 absolute flex items-center">
          <Button
            variant="ghost"
            size="md"
            className="px-2"
            onClick={moveLeft || undefined}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="md"
            className="px-2"
            onClick={moveRight || undefined}
          >
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}

export default BottomBar;
