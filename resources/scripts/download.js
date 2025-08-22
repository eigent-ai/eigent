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
          let downloadedBytes = 0
          const expectedBytes = parseInt(response.headers['content-length'] || '0')
          
          response.on('data', (chunk) => {
            downloadedBytes += chunk.length
          })
          
          response.pipe(file)
          
          file.on('finish', () => {
            file.close(() => {
              clearTimeout(timeout);
              
              // Verify the download is complete
              if (expectedBytes > 0 && downloadedBytes !== expectedBytes) {
                fs.unlinkSync(destinationPath)
                reject(new Error(`Download incomplete: received ${downloadedBytes} bytes, expected ${expectedBytes}`))
                return
              }
              
              // Check if file exists and has size > 0
              const stats = fs.statSync(destinationPath)
              if (stats.size === 0) {
                fs.unlinkSync(destinationPath)
                reject(new Error('Downloaded file is empty'))
                return
              }
              
              resolve()
            })
          })
          
          file.on('error', (err) => {
            clearTimeout(timeout);
            fs.unlinkSync(destinationPath)
            reject(err)
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

