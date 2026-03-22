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
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { t } from 'i18next';

interface InstallationErrorDialogProps {
  error: string;
  backendError?: string;
  installationState: string;
  latestLog: any;
  retryInstallation: () => void;
  retryBackend?: () => void;
}

const InstallationErrorDialog = ({
  error,
  backendError,
  installationState,
  latestLog: _latestLog,
  retryInstallation,
  retryBackend,
}: InstallationErrorDialogProps) => {
  if (backendError) {
    return (
      <Dialog open={true}>
        <DialogContent size="sm">
          <DialogHeader title={t('layout.backend-startup-failed')} />
          <DialogContentSection>
            <div className="text-xs font-normal leading-normal text-text-label">
              <div className="mb-1">
                <span className="text-text-label">{backendError}</span>
              </div>
            </div>
          </DialogContentSection>
          <DialogFooter
            showConfirmButton
            confirmButtonText={t('layout.retry')}
            onConfirm={retryBackend}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={installationState == 'error'}>
      <DialogContent size="sm">
        <DialogHeader title={t('layout.installation-failed')} />
        <DialogContentSection>
          <div className="text-xs font-normal leading-normal text-text-label">
            <div className="mb-1">
              <span className="text-text-label">{error}</span>
            </div>
          </div>
        </DialogContentSection>
        <DialogFooter
          showConfirmButton
          confirmButtonText={t('layout.retry')}
          onConfirm={retryInstallation}
        />
      </DialogContent>
    </Dialog>
  );
};

export default InstallationErrorDialog;
