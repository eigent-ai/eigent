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

import { Minus, Square, X } from "lucide-react";
import { useRef, useEffect, useState } from "react";
import "./index.css";

export default function WindowControls() {
	const controlsRef = useRef<HTMLDivElement>(null);
	const [platform, setPlatform] = useState<string>("");

	useEffect(() => {
		const p = window.electronAPI.getPlatform();
		setPlatform(p);

		if (p === "darwin") {
			if (controlsRef.current) {
				controlsRef.current.style.display = "none";
			}
		}
	}, []);

	if (platform === "darwin") {
		return null;
	}

	return (
		<div
			className="window-controls h-full flex items-center"
			id="window-controls"
			ref={controlsRef}
			style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
		>
			<div
				className="control-btn h-full flex-1"
				onClick={() => window.electronAPI.minimizeWindow()}
			>
				<Minus className="w-4 h-4" />
			</div>
			<div
				className="control-btn h-full flex-1"
				onClick={() => window.electronAPI.toggleMaximizeWindow()}
			>
				<Square className="w-4 h-4" />
			</div>
			<div
				className="control-btn h-full flex-1"
				onClick={(e) => {
					e.stopPropagation();
					e.preventDefault();
					// Trigger window close - this will go through the before-close handler
					// which checks if tasks are running and shows confirmation if needed
					window.electronAPI.closeWindow(false);
				}}
				onMouseDown={(e) => {
					e.stopPropagation();
				}}
			>
				<X className="w-4 h-4" />
			</div>
		</div>
	);
}

