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

import Spaces from './Spaces';
import { useHomeSection } from './hooks/useHomeSection';

/** Table / grid / board body for the section selected in the sidebar rail. */
export default function HomeSections() {
  const { section } = useHomeSection();

  return (
    <div className="w-full min-w-0 flex-1 pt-4 pb-12">
      {section === 'spaces' && <Spaces />}
    </div>
  );
}
