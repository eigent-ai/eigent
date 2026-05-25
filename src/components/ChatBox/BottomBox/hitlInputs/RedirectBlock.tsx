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
import { ExternalLink } from 'lucide-react';
import React from 'react';

interface Props {
  block: Extract<HitlInputBlock, { kind: 'redirect' }>;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}

export const RedirectBlock: React.FC<Props> = ({ block, disabled }) => (
  <Button
    type="button"
    variant="secondary"
    size="sm"
    disabled={disabled}
    onClick={() => window.open(block.href, '_blank', 'noopener,noreferrer')}
    className="gap-2 rounded-full"
  >
    <ExternalLink size={14} />
    {block.label}
  </Button>
);
