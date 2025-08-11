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

