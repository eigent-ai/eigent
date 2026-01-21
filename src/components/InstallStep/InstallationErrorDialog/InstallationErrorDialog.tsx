import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { t } from "i18next";
import React from "react";

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
  latestLog,
  retryInstallation,
  retryBackend,
}:InstallationErrorDialogProps) => {
  if (backendError) {
    return (
      <Dialog open={true}>
        <DialogContent size="sm">
          <DialogHeader title={t("layout.backend-startup-failed")} />
          <DialogContentSection>
            <div className="text-text-label text-xs font-normal leading-normal">
              <div className="mb-1">
                <span className="text-text-label">
                  {backendError}
                </span>
              </div>
            </div>
          </DialogContentSection>
          <DialogFooter
            showConfirmButton
            confirmButtonText={t("layout.retry")}
            onConfirm={retryBackend}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={installationState == "error"}>
      <DialogContent size="sm">
        <DialogHeader title={t("layout.installation-failed")} />
        <DialogContentSection>
          <div className="text-text-label text-xs font-normal leading-normal">
            <div className="mb-1">
              <span className="text-text-label">
                {error}
              </span>
            </div>
          </div>
        </DialogContentSection>
        <DialogFooter
          showConfirmButton
          confirmButtonText={t("layout.retry")}
          onConfirm={retryInstallation}
        />
      </DialogContent>
    </Dialog>
  );
};

export default InstallationErrorDialog;
