 
import MonacoEditor from "@monaco-editor/react";
import loader from "@monaco-editor/loader";
import * as monaco from "monaco-editor";
import React, { useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogFooter,
	DialogContentSection,
} from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";

if (typeof globalThis !== "undefined") {
	(globalThis as any).MonacoEnvironment = {
		getWorker(_: string, label: string) {
			if (["json", "css", "html", "typescript", "javascript"].includes(label)) {
				return new Worker(
					URL.createObjectURL(
						new Blob(
							[
								`
								self.onmessage = function () {};
								`,
							],
							{ type: "application/javascript" }
						)
					)
				);
			}
		},
	};
}

loader.config({ monaco }); // put at the top of the MCPAddDialog component file

interface MCPAddDialogProps {
	open: boolean;
	addType: "local" | "remote";
	setAddType: (type: "local" | "remote") => void;
	localJson: string;
	setLocalJson: (v: string) => void;
	remoteName: string;
	setRemoteName: (v: string) => void;
	remoteUrl: string;
	setRemoteUrl: (v: string) => void;
	installing: boolean;
	onClose: () => void;
	onInstall: () => void;
}

export default function MCPAddDialog({
	open,
	addType,
	setAddType,
	localJson,
	setLocalJson,
	remoteName,
	setRemoteName,
	remoteUrl,
	setRemoteUrl,
	installing,
	onClose,
	onInstall,
}: MCPAddDialogProps) {
	const [jsonError, setJsonError] = useState<string | null>(null);
	const { t } = useTranslation();
	// when the dialog is opened, automatically format the JSON
	React.useEffect(() => {
		if (open && localJson) {
			try {
				const obj = JSON.parse(localJson);
				setLocalJson(JSON.stringify(obj, null, 4));
				setJsonError(null);
			} catch (e: any) {
				// do not format invalid JSON, keep the original content
				setJsonError("JSON format error: " + (e.message || e.toString()));
			}
		} else if (open) {
			setJsonError(null);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	// when localJson changes, clear the error prompt
	React.useEffect(() => {
		setJsonError(null);
	}, [localJson]);

	return (
		<Dialog
			open={open}
			onOpenChange={(v) => {
				if (!v) onClose();
			}}
		>
			<DialogContent size="lg" showCloseButton onClose={onClose} className="p-0">
				<DialogHeader title={t("setting.add-your-agent")} />
				<DialogContentSection>
					<div className="mb-4 text-body-sm text-text-label">
						{t("setting.add-a-local-mcp-server-by-providing-a-valid-json-configuration")}
						<a
							href="https://modelcontextprotocol.io/docs/getting-started/intro"
							target="_blank"
							rel="noopener noreferrer"
							className="text-text-information underline"
						>
							{t("setting.learn-more")}
						</a>
					</div>
					{jsonError && (
						<div className="mb-2 text-text-cuation text-label-md">{jsonError}</div>
					)}
						<div className="rounded-xl overflow-hidden border border-border-primary">
							<MonacoEditor
								height="300px"
								width="100%"
								language="json"
								theme="vs-dark"
								value={localJson}
								onChange={(v) => {
									setLocalJson(v ?? "");
								}}
								options={{
									minimap: { enabled: false },
									fontSize: 14,
									scrollBeyondLastLine: false,
									readOnly: installing,
									automaticLayout: true,
								}}
							/>
						</div>
				</DialogContentSection>
				<DialogFooter
					showConfirmButton
					confirmButtonText={installing ? t("setting.installing") : t("setting.install")}
					onConfirm={onInstall}
					confirmButtonVariant="primary"
				/>
			</DialogContent>
		</Dialog>
	);
}
