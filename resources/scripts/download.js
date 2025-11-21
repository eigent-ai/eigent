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

    // Use flag to prevent multiple resolve/reject calls
    let settled = false;

    const safeReject = (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    };

    const safeResolve = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve();
      }
    };

    const request = (url) => {
      https
        .get(url, (response) => {
          if (response.statusCode == 301 || response.statusCode == 302) {
            request(response.headers.location)
            return
          }
          if (response.statusCode !== 200) {
            safeReject(new Error(`Download failed: ${response.statusCode} ${response.statusMessage}`))
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
              // Don't proceed if already rejected (e.g., by error handler)
              if (settled) return;

              // Verify the download is complete
              if (expectedBytes > 0 && downloadedBytes !== expectedBytes) {
                try {
                  if (fs.existsSync(destinationPath)) {
                    fs.unlinkSync(destinationPath)
                  }
                } catch (err) {
                  console.error('Failed to delete incomplete file:', err);
                }
                safeReject(new Error(`Download incomplete: received ${downloadedBytes} bytes, expected ${expectedBytes}`))
                return
              }

              // Check if file exists and has size > 0
              try {

                if (fs.existsSync(destinationPath)) {
                  const stats = fs.statSync(destinationPath)
                  if (stats.size === 0) {
                    fs.unlinkSync(destinationPath)
                    safeReject(new Error('Downloaded file is empty'))
                    return
                  }
                  safeResolve()
                } else {
                  safeReject(new Error('Downloaded file does not exist'))
                }
              } catch (err) {
                safeReject(new Error(`Failed to verify download: ${err.message}`))

              }
            })
          })

          file.on('error', (err) => {
            try {
              if (fs.existsSync(destinationPath)) {
                fs.unlinkSync(destinationPath)
              }
            } catch (deleteErr) {
              console.error('Failed to delete file after error:', deleteErr);
            }
            safeReject(err)
          })
        })
        .on('error', (err) => {
          safeReject(err)
        })
    }
    request(url)
  })
}

