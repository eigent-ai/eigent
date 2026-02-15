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

/* global console, setTimeout, clearTimeout, require */
// @ts-check
import fs from 'fs';
import https from 'https';

/**
 * Downloads a file from a URL with redirect handling
 * @param {string} url The URL to download from
 * @param {string} destinationPath The path to save the file to
 * @returns {Promise<void>} Promise that resolves when download is complete
 */
export async function downloadWithRedirects(url, destinationPath) {
  return new Promise((resolve, reject) => {
    const timeoutMs = 10 * 60 * 1000; // 10 minutes
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
      // Support both http and https
      const httpModule = url.startsWith('https://') ? https : require('http');

      httpModule
        .get(url, (response) => {
          const statusCode = response.statusCode || 0;

          // Handle redirects (301, 302, 307, 308)
          if (
            statusCode >= 301 &&
            statusCode <= 308 &&
            response.headers.location
          ) {
            const redirectUrl = response.headers.location;
            console.log(`Following redirect to: ${redirectUrl}`);
            request(redirectUrl);
            return;
          }
          if (statusCode !== 200) {
            safeReject(
              new Error(
                `Download failed: ${statusCode} ${response.statusMessage || 'Unknown error'}`
              )
            );
            return;
          }

          const file = fs.createWriteStream(destinationPath);
          let downloadedBytes = 0;
          const expectedBytes = parseInt(
            response.headers['content-length'] || '0'
          );
          const startTime = Date.now();
          let lastProgressTime = Date.now();

          if (expectedBytes > 0) {
            console.log(
              `Downloading ${(expectedBytes / 1024 / 1024).toFixed(2)} MB...`
            );
          } else {
            console.log('Downloading...');
          }

          response.on('data', (chunk) => {
            downloadedBytes += chunk.length;

            // Show progress every 1 second
            const now = Date.now();
            if (now - lastProgressTime >= 1000) {
              if (expectedBytes > 0) {
                const percent = (
                  (downloadedBytes / expectedBytes) *
                  100
                ).toFixed(1);
                const speed =
                  downloadedBytes / ((now - startTime) / 1000) / 1024 / 1024;
                console.log(
                  `Progress: ${percent}% (${(downloadedBytes / 1024 / 1024).toFixed(2)} MB) - ${speed.toFixed(2)} MB/s`
                );
              } else {
                console.log(
                  `Downloaded: ${(downloadedBytes / 1024 / 1024).toFixed(2)} MB`
                );
              }
              lastProgressTime = now;
            }
          });

          response.pipe(file);

          file.on('finish', () => {
            file.close(() => {
              // Don't proceed if already rejected (e.g., by error handler)
              if (settled) return;

              // Verify the download is complete
              if (expectedBytes > 0 && downloadedBytes !== expectedBytes) {
                try {
                  if (fs.existsSync(destinationPath)) {
                    fs.unlinkSync(destinationPath);
                  }
                } catch (err) {
                  console.error('Failed to delete incomplete file:', err);
                }
                safeReject(
                  new Error(
                    `Download incomplete: received ${downloadedBytes} bytes, expected ${expectedBytes}`
                  )
                );
                return;
              }

              // Check if file exists and has size > 0
              try {
                if (fs.existsSync(destinationPath)) {
                  const stats = fs.statSync(destinationPath);
                  if (stats.size === 0) {
                    fs.unlinkSync(destinationPath);
                    safeReject(new Error('Downloaded file is empty'));
                    return;
                  }
                  safeResolve();
                } else {
                  safeReject(new Error('Downloaded file does not exist'));
                }
              } catch (err) {
                safeReject(
                  new Error(`Failed to verify download: ${err.message}`)
                );
              }
            });
          });

          file.on('error', (err) => {
            try {
              if (fs.existsSync(destinationPath)) {
                fs.unlinkSync(destinationPath);
              }
            } catch (deleteErr) {
              console.error('Failed to delete file after error:', deleteErr);
            }
            safeReject(err);
          });
        })
        .on('error', (err) => {
          safeReject(err);
        });
    };
    request(url);
  });
}
