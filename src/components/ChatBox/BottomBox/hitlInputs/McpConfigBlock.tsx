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
import type { HitlInputBlock } from '@/components/ChatBox/renderSession/types';
import { Button } from '@/components/ui/button';
import { Hammer } from 'lucide-react';
import React from 'react';
import { useNavigate } from 'react-router-dom';

interface Props {
  block: Extract<HitlInputBlock, { kind: 'mcp' }>;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}

export const McpConfigBlock: React.FC<Props> = ({
  block,
  onChange: _onChange,
  disabled,
}) => {
  const navigate = useNavigate();

  return (
    <div className="gap-1 flex w-full flex-col">
      {block.label && (
        <span className="text-label-xs font-medium text-ds-text-neutral-muted-default">
          {block.label}
        </span>
      )}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => navigate('/history?tab=connectors&connectorAction=add')}
        className="gap-2 w-fit rounded-full"
      >
        <Hammer size={14} />
        Configure MCP connector…
      </Button>
    </div>
  );
};
