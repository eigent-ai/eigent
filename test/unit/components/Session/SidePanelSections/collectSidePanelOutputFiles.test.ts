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

import {
  collectSidePanelOutputFiles,
  getSidePanelOutputFilesRevision,
} from '@/components/Session/SidePanel/sections/collectSidePanelOutputFiles';
import { describe, expect, it } from 'vitest';

const reportFile = (): FileInfo => ({
  name: 'report.md',
  type: 'md',
  path: '/workspace/report.md',
  relativePath: 'report.md',
});

describe('side-panel output file projection', () => {
  it('deduplicates display rows but changes revision when a path is rewritten', () => {
    const firstWrite = { fileList: [reportFile()] };
    const secondWrite = { fileList: [reportFile(), reportFile()] };

    expect(collectSidePanelOutputFiles(secondWrite)).toHaveLength(1);
    expect(getSidePanelOutputFilesRevision(secondWrite)).not.toBe(
      getSidePanelOutputFilesRevision(firstWrite)
    );
  });
});
