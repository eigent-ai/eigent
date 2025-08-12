import fs from 'node:fs'
// @ts-ignore
import archiver from 'archiver'
import log from 'electron-log'

export function zipFolder(folderPath: string, outputZipPath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const output = fs.createWriteStream(outputZipPath)
		const archive = archiver('zip', { zlib: { level: 9 } })

		output.on('close', () => resolve(outputZipPath))
		
		archive.on('error', (err: any) => {
			log.error('Archive error:', err);
			reject(err);
		})

		archive.pipe(output)
		archive.directory(folderPath, false)
		archive.finalize()
	})
}



