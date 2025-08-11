import fs from 'node:fs'
import archiver from 'archiver'
export function zipFolder(folderPath: string, outputZipPath: string) {
	return new Promise((resolve, reject) => {
		const output = fs.createWriteStream(outputZipPath)
		const archive = archiver('zip', { zlib: { level: 9 } })

		output.on('close', () => resolve(outputZipPath))
		archive.on('error', reject)

		archive.pipe(output)
		archive.directory(folderPath, false)
		archive.finalize()
	})
}



