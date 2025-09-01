import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { MCPConfigForm, MCPUserItem } from "./types";
import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

interface MCPConfigDialogProps {
	open: boolean;
	form: MCPConfigForm | null;
	mcp: MCPUserItem | null;
	onChange: (form: MCPConfigForm) => void;
	onSave: (e: React.FormEvent) => void;
	onClose: () => void;
	loading: boolean;
	errorMsg?: string | null;
	onSwitchStatus: (checked: boolean) => void;
}

export default function MCPConfigDialog({
	open,
	form,
	mcp,
	onChange,
	onSave,
	onClose,
	loading,
	errorMsg,
	onSwitchStatus,
}: MCPConfigDialogProps) {
	const [showEnvValues, setShowEnvValues] = useState<Record<string, boolean>>(
		{},
	);

	if (!open || !form || !mcp) return null;
	return (
		<div className="fixed inset-0 z-30 flex items-center justify-center ">
			<div className="bg-white-100% rounded-lg shadow-lg p-6 min-w-[340px] max-w-[90vw] w-[480px] relative">
				<div className="flex items-center justify-between mb-2">
					<div className="font-bold">Edit MCP Config</div>
					<Switch
						checked={mcp.status === 1}
						disabled={loading}
						onCheckedChange={onSwitchStatus}
					/>
				</div>
				<form onSubmit={onSave} className="space-y-4">
					<div>
						<label className="block text-sm font-medium mb-1">Name</label>
						<input
							autoComplete="off"
							className="w-full border rounded px-3 py-2 text-sm"
							value={form.mcp_name}
							onChange={(e) => onChange({ ...form, mcp_name: e.target.value })}
							disabled={loading}
						/>
					</div>
					<div>
						<label className="block text-sm font-medium mb-1">
							Description
						</label>
						<input
							autoComplete="off"
							className="w-full border rounded px-3 py-2 text-sm"
							value={form.mcp_desc}
							onChange={(e) => onChange({ ...form, mcp_desc: e.target.value })}
							disabled={loading}
						/>
					</div>
					<div>
						<label className="block text-sm font-medium mb-1">Command</label>
						<input
							autoComplete="off"
							className="w-full border rounded px-3 py-2 text-sm"
							value={form.command}
							onChange={(e) => onChange({ ...form, command: e.target.value })}
							disabled={loading}
						/>
					</div>
					<div>
						<label className="block text-sm font-medium mb-1">
							Args (one per line)
						</label>
						<textarea
							autoComplete="off"
							className="w-full border rounded px-3 py-2 text-sm"
							rows={Math.max(
								3,
								form.argsArr && form.argsArr.length > 0
									? form.argsArr.length
									: 3,
							)}
							value={Array.isArray(form.argsArr) ? form.argsArr.join("\n") : ""}
							onChange={(e) =>
								onChange({ ...form, argsArr: e.target.value.split(/\r?\n/) })
							}
							disabled={loading}
						/>
					</div>
					<div>
						<label className="block text-sm font-medium mb-1">
							Env (key-value)
						</label>
						{Object.entries(form.env).map(([k, v], idx) => (
							<div className="flex gap-2 mb-1" key={k + idx}>
								<input
									autoComplete="off"
									className="flex-1 border rounded px-2 py-1 text-xs"
									placeholder="Key"
									value={k}
									readOnly
								/>
								<div className="relative flex-1">
									<input
										autoComplete="off"
										className="w-full border rounded px-2 py-1 pr-8 text-xs"
										placeholder="Value"
										type={showEnvValues[k] ? "text" : "password"}
										value={String(v)}
										onChange={(e) => {
											const newEnv = { ...form.env };
											newEnv[k] = e.target.value;
											onChange({ ...form, env: newEnv });
										}}
										disabled={loading}
									/>
									<span
										className="absolute inset-y-0 right-1 flex items-center cursor-pointer text-gray-500"
										onClick={() =>
											setShowEnvValues((prev) => ({ ...prev, [k]: !prev[k] }))
										}
									>
										{showEnvValues[k] ? (
											<Eye className="w-3 h-3" />
										) : (
											<EyeOff className="w-3 h-3" />
										)}
									</span>
								</div>
							</div>
						))}
					</div>
					{errorMsg && (
						<div className="text-red-500 text-xs mb-2">{errorMsg}</div>
					)}
					<div className="flex justify-end mt-4 gap-2">
						<Button
							size="md"
							type="button"
							variant="outline"
							onClick={onClose}
							disabled={loading}
						>
							Cancel
						</Button>
						<Button size="md" type="submit" disabled={loading}>
							Save
						</Button>
					</div>
				</form>
			</div>
		</div>
	);
}
