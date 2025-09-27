import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { error } from "electron-log";
import { t } from "i18next";
import React from "react";

interface InstallationErrorDialogProps {
  error: string;
  installationState: string;
  latestLog: any;
  retryInstallation: () => void;
}

const InstallationErrorDialog = ({
  error,
  installationState,
  latestLog,
  retryInstallation,
}:InstallationErrorDialogProps) => {
  return (
    <Dialog open={installationState == "error"}>
      <DialogContent className="bg-white-100%">
        <DialogHeader>
          <DialogTitle>{t("layout.installation-failed")}</DialogTitle>
        </DialogHeader>
        <div className="text-text-label text-xs font-normal leading-tight mb-4">
          {
            <div className="mb-1">
              <span className="text-text-label/60">
                Error: {error} <br />
                Log: {latestLog?.data}
              </span>
            </div>
          }
        </div>
        <DialogFooter>
          <Button onClick={retryInstallation}>{t("layout.retry")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default InstallationErrorDialog;
