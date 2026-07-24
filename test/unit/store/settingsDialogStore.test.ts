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
  openSettingsDialog,
  useSettingsDialogStore,
} from '@/store/settingsDialogStore';
import { beforeEach, describe, expect, it } from 'vitest';

describe('settingsDialogStore', () => {
  beforeEach(() => {
    useSettingsDialogStore.setState({
      isOpen: false,
      activeSection: 'workspace-profile',
    });
  });

  it('opens a requested settings section without route state', () => {
    openSettingsDialog('privacy');

    expect(useSettingsDialogStore.getState()).toMatchObject({
      isOpen: true,
      activeSection: 'privacy',
    });
  });

  it('reopens the last active section when no section is supplied', () => {
    useSettingsDialogStore.getState().setActiveSection('cookies');
    useSettingsDialogStore.getState().openSettings();

    expect(useSettingsDialogStore.getState()).toMatchObject({
      isOpen: true,
      activeSection: 'cookies',
    });
  });

  it('closes without losing the selected section', () => {
    openSettingsDialog('connectors');
    useSettingsDialogStore.getState().closeSettings();

    expect(useSettingsDialogStore.getState()).toMatchObject({
      isOpen: false,
      activeSection: 'connectors',
    });
  });
});
