import React from "react";
import { Bot, Users, Folder, Zap, Sparkles, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function Workforce() {
	return (
		<div className="w-full h-full flex gap-4 p-4 bg-surface-primary border border-border-tertiary rounded-2xl overflow-hidden">
			{/* Left Side - Agent Screen */}
			<div className="flex-[0.6] flex flex-col bg-surface-primary border border-border-tertiary rounded-xl overflow-hidden">
				{/* Agent Screen Header */}
				<div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-border-tertiary">
					<div className="flex items-center gap-2">
						<Bot className="w-5 h-5 text-icon-primary" />
						<h2 className="text-base font-bold text-text-heading">Agent Screen</h2>
					</div>
					<Button size="icon" variant="ghost" className="h-8 w-8">
						<MoreVertical className="w-4 h-4 text-icon-primary" />
					</Button>
				</div>

				{/* Agent Screen Content */}
				<div className="flex-1 overflow-auto p-4">
					<div className="w-full h-full flex items-center justify-center">
						<div className="text-center space-y-2">
							<Bot className="w-16 h-16 text-icon-primary mx-auto opacity-50" />
							<p className="text-sm text-text-label">Agent content area</p>
						</div>
					</div>
				</div>
			</div>

			{/* Right Side - Four Sections */}
			<div className="flex-[0.4] flex flex-col gap-4">
				{/* Workforce Section */}
				<Card className="flex-1 flex flex-col bg-surface-primary border border-border-tertiary rounded-xl overflow-hidden">
					<div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-border-tertiary">
						<Users className="w-4 h-4 text-icon-primary" />
						<h3 className="text-sm font-bold text-text-heading">Workforce</h3>
					</div>
					<div className="flex-1 overflow-auto p-4">
						<div className="space-y-2">
							<div className="text-xs text-text-label">Workforce content</div>
						</div>
					</div>
				</Card>

				{/* Agent Folder Section */}
				<Card className="flex-1 flex flex-col bg-surface-primary border border-border-tertiary rounded-xl overflow-hidden">
					<div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-border-tertiary">
						<Folder className="w-4 h-4 text-icon-primary" />
						<h3 className="text-sm font-bold text-text-heading">Agent Folder</h3>
					</div>
					<div className="flex-1 overflow-auto p-4">
						<div className="space-y-2">
							<div className="text-xs text-text-label">Agent folder content</div>
						</div>
					</div>
				</Card>

				{/* Trigger Section */}
				<Card className="flex-1 flex flex-col bg-surface-primary border border-border-tertiary rounded-xl overflow-hidden">
					<div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-border-tertiary">
						<Zap className="w-4 h-4 text-icon-primary" />
						<h3 className="text-sm font-bold text-text-heading">Trigger</h3>
					</div>
					<div className="flex-1 overflow-auto p-4">
						<div className="space-y-2">
							<div className="text-xs text-text-label">Trigger content</div>
						</div>
					</div>
				</Card>

				{/* Skills Section */}
				<Card className="flex-1 flex flex-col bg-surface-primary border border-border-tertiary rounded-xl overflow-hidden">
					<div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-border-tertiary">
						<Sparkles className="w-4 h-4 text-icon-primary" />
						<h3 className="text-sm font-bold text-text-heading">Skills</h3>
					</div>
					<div className="flex-1 overflow-auto p-4">
						<div className="space-y-2">
							<div className="text-xs text-text-label">Skills content</div>
						</div>
					</div>
				</Card>
			</div>
		</div>
	);
}
