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

/* global console, process */
// @ts-check
import fs from 'fs';
import http from 'http';
import https from 'https';
import tls from 'tls';
import { URL } from 'url';

/**
 * Check if the target URL should bypass proxy based on NO_PROXY env var.
 * @param {string} targetUrl - The target URL
 * @returns {boolean} True if proxy should be bypassed
 */
function shouldBypassProxy(targetUrl) {
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  if (!noProxy) return false;

  try {
    const targetHost = new URL(targetUrl).hostname.toLowerCase();
    const noProxyList = noProxy.split(',').map((s) => s.trim().toLowerCase());

    for (const pattern of noProxyList) {
      if (!pattern) continue;
      if (pattern === '*') return true;
      if (targetHost === pattern) return true;
      if (pattern.startsWith('.') && targetHost.endsWith(pattern)) return true;
      if (targetHost.endsWith('.' + pattern)) return true;
    }
  } catch (error) {
    console.warn(`Warning: Failed to parse NO_PROXY: ${error.message}`);
  }
  return false;
}

/**
 * Get proxy URL from environment variables.
 * @param {string} targetUrl - The target URL to determine which proxy to use
 * @returns {string | null} The proxy URL or null if not configured
 */
function getProxyUrl(targetUrl) {
  // Check NO_PROXY first
  if (shouldBypassProxy(targetUrl)) {
    return null;
  }

  const isHttps = targetUrl.startsWith('https://');

  // Priority order for proxy env vars (check both uppercase and lowercase)
  const envVars = isHttps
    ? ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']
    : ['HTTP_PROXY', 'http_proxy'];

  for (const envVar of envVars) {
    const value = process.env[envVar];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

/**
 * Mask credentials in a proxy URL for safe logging.
 * @param {string} url - The URL to mask
 * @returns {string} The masked URL
 */
function maskProxyUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = parsed.username ? '***' : '';
      parsed.password = parsed.password ? '***' : '';
      return parsed.toString();
    }
  } catch (error) {
    // Not a valid URL, return as-is
    console.warn(`Warning: Failed to parse proxy URL: ${error.message}`);
  }
  return url;
}

/**
 * Make an HTTP GET request with optional proxy support.
 * For HTTPS URLs through HTTP proxy, uses CONNECT tunnel with TLS.
 * @param {string} url - The URL to request
 * @param {(response: http.IncomingMessage) => void} callback - Response callback
 * @param {(error: Error) => void} onError - Error callback
 */
function makeRequest(url, callback, onError) {
  const proxyUrl = getProxyUrl(url);
  const isHttps = url.startsWith('https://');
  const targetUrl = new URL(url);
  const targetPort = parseInt(targetUrl.port, 10) || (isHttps ? 443 : 80);

  if (!proxyUrl) {
    // Direct connection (no proxy)
    const httpModule = isHttps ? https : http;
    const req = httpModule.get(url, callback);
    req.on('error', onError);
    return;
  }

  console.log(`Using proxy: ${maskProxyUrl(proxyUrl)}`);

  const proxy = new URL(proxyUrl);
  const proxyPort = parseInt(proxy.port, 10) || 80;

  // Build proxy auth header if credentials provided
  const proxyAuthHeader =
    proxy.username || proxy.password
      ? {
          'Proxy-Authorization': `Basic ${Buffer.from(
            `${decodeURIComponent(proxy.username || '')}:${decodeURIComponent(proxy.password || '')}`
          ).toString('base64')}`,
        }
      : {};

  if (isHttps) {
    // HTTPS through HTTP proxy: Use CONNECT tunnel
    const connectReq = http.request({
      host: proxy.hostname,
      port: proxyPort,
      method: 'CONNECT',
      path: `${targetUrl.hostname}:${targetPort}`,
      headers: {
        Host: `${targetUrl.hostname}:${targetPort}`,
        ...proxyAuthHeader,
      },
    });

    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        onError(
          new Error(
            `Proxy CONNECT failed with status ${res.statusCode}: ${res.statusMessage}`
          )
        );
        return;
      }

      // Upgrade socket to TLS
      const tlsSocket = tls.connect(
        {
          host: targetUrl.hostname,
          port: targetPort,
          socket: socket,
          servername: targetUrl.hostname, // SNI
        },
        () => {
          // Make HTTPS request over TLS socket
          const req = https.request(
            {
              hostname: targetUrl.hostname,
              port: targetPort,
              path: targetUrl.pathname + targetUrl.search,
              method: 'GET',
              headers: { Host: targetUrl.host },
              agent: false,
              // Use createConnection to provide the pre-established TLS socket
              createConnection: () => tlsSocket,
            },
            callback
          );
          req.on('error', (err) => {
            onError(new Error(`HTTPS request error: ${err.message}`));
          });
          req.end();
        }
      );

      tlsSocket.on('error', (err) => {
        onError(new Error(`TLS connection error: ${err.message}`));
      });
    });

    connectReq.on('error', (err) => {
      onError(new Error(`Proxy connection error: ${err.message}`));
    });

    connectReq.setTimeout(30000, () => {
      connectReq.destroy();
      onError(new Error('Proxy connection timeout after 30 seconds'));
    });

    connectReq.end();
  } else {
    // HTTP through HTTP proxy: Use proxy as target with full URL as path
    const req = http.request(
      {
        host: proxy.hostname,
        port: proxyPort,
        path: url, // Full URL for HTTP proxy
        method: 'GET',
        headers: {
          Host: targetUrl.host,
          ...proxyAuthHeader,
        },
      },
      callback
    );
    req.on('error', (err) => {
      onError(new Error(`HTTP proxy request error: ${err.message}`));
    });
    req.end();
  }
}

/**
 * Downloads a file from a URL with redirect handling and proxy support.
 * Proxy is automatically detected from environment variables:
 * - HTTPS_PROXY / https_proxy (for HTTPS URLs)
 * - HTTP_PROXY / http_proxy (for HTTP URLs, or as fallback for HTTPS)
 * - NO_PROXY / no_proxy (to bypass proxy for specific hosts)
 *
 * @param {string} url The URL to download from
 * @param {string} destinationPath The path to save the file to
 * @returns {Promise<void>} Promise that resolves when download is complete
 */
export async function downloadWithRedirects(url, destinationPath) {
  return new Promise((resolve, reject) => {
    const timeoutMs = 10 * 60 * 1000; // 10 minutes
    let timeoutId = null;

    // Use flag to prevent multiple resolve/reject calls
    let settled = false;

    const safeReject = (error) => {
      if (!settled) {
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        reject(error);
      }
    };

    const safeResolve = () => {
      if (!settled) {
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        resolve();
      }
    };

    timeoutId = setTimeout(() => {
      safeReject(new Error(`Download timeout after ${timeoutMs / 1000} seconds`));
    }, timeoutMs);

    const request = (requestUrl) => {
      makeRequest(
        requestUrl,
        (response) => {
          const statusCode = response.statusCode || 0;

          // Handle redirects (301, 302, 307, 308)
          if (
            statusCode >= 301 &&
            statusCode <= 308 &&
            response.headers.location
          ) {
            let redirectUrl = response.headers.location;

            // Handle relative redirects
            if (redirectUrl.startsWith('/')) {
              try {
                const originalUrl = new URL(requestUrl);
                redirectUrl = `${originalUrl.protocol}//${originalUrl.host}${redirectUrl}`;
              } catch (error) {
                safeReject(new Error(`Failed to parse redirect URL: ${error.message}`));
                return;
              }
            }

            console.log(`Following redirect to: ${redirectUrl}`);
            request(redirectUrl);
            return;
          }

          if (statusCode !== 200) {
            safeReject(
              new Error(
                `Download failed with status ${statusCode}: ${response.statusMessage || 'Unknown error'}`
              )
            );
            return;
          }

          const file = fs.createWriteStream(destinationPath);
          let downloadedBytes = 0;
          const expectedBytes = parseInt(
            response.headers['content-length'] || '0',
            10
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
                } catch (cleanupError) {
                  console.warn(
                    `Warning: Failed to delete incomplete file: ${cleanupError.message}`
                  );
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
              } catch (verifyError) {
                safeReject(
                  new Error(`Failed to verify download: ${verifyError.message}`)
                );
              }
            });
          });

          file.on('error', (err) => {
            try {
              if (fs.existsSync(destinationPath)) {
                fs.unlinkSync(destinationPath);
              }
            } catch (cleanupError) {
              console.warn(
                `Warning: Failed to delete file after error: ${cleanupError.message}`
              );
            }
            safeReject(new Error(`File write error: ${err.message}`));
          });
        },
        safeReject
      );
    };

    request(url);
  });
}
