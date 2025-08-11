// @ts-check
import https from 'https'
import fs from 'fs'

/**
 * Downloads a file from a URL with redirect handling
 * @param {string} url The URL to download from
 * @param {string} destinationPath The path to save the file to
 * @returns {Promise<void>} Promise that resolves when download is complete
 */
export async function downloadWithRedirects(url, destinationPath) {
  return new Promise((resolve, reject) => {
    const timeoutMs = 3 * 60 * 1000; // 3 minutes
    const timeout = setTimeout(() => {
      reject(new Error(`timeout（${timeoutMs / 1000} seconds）`));
    }, timeoutMs);

    const request = (url) => {
      https
        .get(url, (response) => {
          if (response.statusCode == 301 || response.statusCode == 302) {
            request(response.headers.location)
            return
          }
          if (response.statusCode !== 200) {
            clearTimeout(timeout);
            reject(new Error(`Download failed: ${response.statusCode} ${response.statusMessage}`))
            return
          }
          const file = fs.createWriteStream(destinationPath)
          response.pipe(file)
          file.on('finish', () => {
            clearTimeout(timeout);
            resolve()
          })
        })
        .on('error', (err) => {
          clearTimeout(timeout);
          reject(err)
        })
    }
    request(url)
  })
}

