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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
        <DialogContent className="bg-white-100%">
          <DialogHeader>
            <DialogTitle>{t('layout.backend-startup-failed')}</DialogTitle>
          </DialogHeader>
          <div className="mb-4 text-xs font-normal leading-tight text-text-label">
            <div className="mb-1">
              <span className="text-text-label/60">{backendError}</span>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={retryBackend}>{t('layout.retry')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={installationState == 'error'}>
      <DialogContent className="bg-white-100%">
        <DialogHeader>
          <DialogTitle>{t('layout.installation-failed')}</DialogTitle>
        </DialogHeader>
        <div className="mb-4 text-xs font-normal leading-tight text-text-label">
          <div className="mb-1">
            <span className="text-text-label/60">{error}</span>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={retryInstallation}>{t('layout.retry')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default InstallationErrorDialog;
