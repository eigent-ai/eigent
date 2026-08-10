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

import { useShellBackTarget } from '@/hooks/useShellBackTarget';
import { ArrowLeft } from 'lucide-react';
import { TOP_BAR_PILL_CLASS } from './controlStyles';

export interface ShellBackButtonProps {
  /** Where to go when no origin was recorded (defaults to the workspace). */
  fallbackTo?: string;
}

/**
 * Title-bar leading control on full-page shell surfaces (Home, Settings):
 * returns to the page the user opened them from. Chrome matches the Home tab
 * it replaces, so the leading slot keeps the same shape across routes.
 */
export default function ShellBackButton({
  fallbackTo = '/',
}: ShellBackButtonProps) {
  const { label, goBack } = useShellBackTarget(fallbackTo);

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label={label}
      className={TOP_BAR_PILL_CLASS}
    >
      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
      {label}
    </button>
  );
}
