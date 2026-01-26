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

import fs from 'fs-extra'
import path from 'path'


export async function copyBrowserData(browserName: string, browserPath: string, electronUserDataPath: string) {
	const subdirs = ['Local Storage', 'IndexedDB']
	const cookieFile = 'Cookies'

	for (const dir of subdirs) {
		const src = path.join(browserPath, dir)
		const dest = path.join(electronUserDataPath, browserName, dir)
		if (fs.existsSync(src)) {
			await fs.copy(src, dest, { overwrite: true })
			console.log(`[${browserName}] copy ${dir} success`)
		}
	}

	// copy Cookies file
	const cookieSrc = path.join(browserPath, cookieFile)
	const cookieDest = path.join(electronUserDataPath, browserName, cookieFile)
	if (fs.existsSync(cookieSrc)) {
		await fs.copy(cookieSrc, cookieDest, { overwrite: true })
		console.log(`[${browserName}] copy Cookies success`)
	}
}

