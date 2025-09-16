import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Laptop, CloudCog, X, ArrowRight } from "lucide-react";
import MonacoEditor from "@monaco-editor/react";
import loader from "@monaco-editor/loader";
import * as monaco from "monaco-editor";
import React, { useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogFooter,
	DialogTitle,
	DialogDescription,
	DialogClose,
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
			<DialogContent className="min-w-[340px] w-[600px] max-w-[95vw] p-0">
				<DialogHeader className=" bg-gray-100 rounded-t-xl px-6 ">
					<DialogTitle className="font-bold text-lg text-gray-800 ">
						{t("setting.add-your-mcp-server")}
					</DialogTitle>
				</DialogHeader>
				<div className="px-md py-md bg-white-100% rounded-b-xl">
					<div className="mb-4 text-sm text-gray-600 rounded-xl">
						{t("setting.add-a-local-mcp-server-by-providing-a-valid-json-configuration")}
						<a
							href="https://modelcontextprotocol.io/docs/getting-started/intro"
							target="_blank"
							rel="noopener noreferrer"
							className="text-blue-600 underline"
						>
							{t("setting.learn-more")}
						</a>
					</div>
					{jsonError && (
						<div className="mb-2 text-red-500 text-xs">{jsonError}</div>
					)}
					<div className="mb-4">
						<div className="rounded-xl overflow-hidden border border-gray-200">
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
					</div>
					<DialogFooter className="flex justify-end gap-2 mt-2 rounded-b-xl pt-sm">
						<Button
							onClick={onInstall}
							disabled={installing}
							variant="primary"
							size="sm"
						>
							{installing ? t("setting.installing") : t("setting.install")}
							<ArrowRight className="w-4 h-4" />
						</Button>
					</DialogFooter>
				</div>
			</DialogContent>
		</Dialog>
	);
}
