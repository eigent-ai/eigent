import { getBackendPath, getBinaryPath, getCachePath, getVenvPath, isBinaryExists, runInstallScript } from "./utils/process";
import { spawn, exec } from 'child_process'
import log from 'electron-log'
import fs from 'fs'
import path from 'path'
import * as net from "net";
import * as http from "http";
import { ipcMain, BrowserWindow, app } from 'electron'
import { promisify } from 'util'
import { detectInstallationLogs, PromiseReturnType } from "./install-deps";

const execAsync = promisify(exec);

// helper function to get main window
export function getMainWindow(): BrowserWindow | null {
    const windows = BrowserWindow.getAllWindows();
    return windows.length > 0 ? windows[0] : null;
}


export async function checkToolInstalled() {
    return new Promise<PromiseReturnType>(async (resolve, reject) => {
        if (!(await isBinaryExists('uv'))) {
            resolve({success: false, message: "uv doesn't exist"})
            return
        }

        if (!(await isBinaryExists('bun'))) {
            resolve({success: false, message: "Bun doesn't exist"})
            return
        }

        resolve({success: true, message: "Tools exist already"})
    })

}

// export async function installDependencies() {
//     return new Promise<boolean>(async (resolve, reject) => {
//         console.log('start install dependencies')

//         // notify frontend start install
//         const mainWindow = getMainWindow();
//         if (mainWindow && !mainWindow.isDestroyed()) {
//             mainWindow.webContents.send('install-dependencies-start');
//         }

//         const isInstalCommandTool = await installCommandTool()
//         if (!isInstalCommandTool) {
//             resolve(false)
//             return
//         }
//         const uv_path = await getBinaryPath('uv')
//         const backendPath = getBackendPath()

//         // ensure backend directory exists and is writable
//         if (!fs.existsSync(backendPath)) {
//             fs.mkdirSync(backendPath, { recursive: true })
//         }

//         // touch installing lock file
//         const installingLockPath = path.join(backendPath, 'uv_installing.lock')
//         fs.writeFileSync(installingLockPath, '')
//         const proxy = ['--default-index', 'https://pypi.tuna.tsinghua.edu.cn/simple']
//         function isInChinaTimezone() {
//             const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
//             return timezone === 'Asia/Shanghai';
//         }
//         console.log('isInChinaTimezone', isInChinaTimezone())
//         const node_process = spawn(uv_path, ['sync', '--no-dev', ...(isInChinaTimezone() ? proxy : [])], { cwd: backendPath })
//         node_process.stdout.on('data', (data) => {
//             log.info(`Script output: ${data}`)
//             // notify frontend install log
//             const mainWindow = getMainWindow();
//             if (mainWindow && !mainWindow.isDestroyed()) {
//                 mainWindow.webContents.send('install-dependencies-log', { type: 'stdout', data: data.toString() });
//             }
//         })

//         node_process.stderr.on('data', (data) => {
//             log.error(`Script error: uv ${data}`)
//             // notify frontend install error log
//             const mainWindow = getMainWindow();
//             if (mainWindow && !mainWindow.isDestroyed()) {
//                 mainWindow.webContents.send('install-dependencies-log', { type: 'stderr', data: data.toString() });
//             }
//         })

//         node_process.on('close', async (code) => {
//             // delete installing lock file 
//             if (fs.existsSync(installingLockPath)) {
//                 fs.unlinkSync(installingLockPath)
//             }

//             if (code === 0) {
//                 log.info('Script completed successfully')

//                 // touch installed lock file
//                 const installedLockPath = path.join(backendPath, 'uv_installed.lock')
//                 fs.writeFileSync(installedLockPath, '')
//                 console.log('end install dependencies')


//                 spawn(uv_path, ['run', 'task', 'babel'], { cwd: backendPath })
//                 resolve(true);
//                 // resolve(isSuccess);
//             } else {
//                 log.error(`Script exited with code ${code}`)
//                 // notify frontend install failed
//                 const mainWindow = getMainWindow();
//                 if (mainWindow && !mainWindow.isDestroyed()) {
//                     mainWindow.webContents.send('install-dependencies-complete', { success: false, code, error: `Script exited with code ${code}` });
//                     resolve(false);
//                 }
//             }
//         })
//     })
// }

export async function startBackend(setPort?: (port: number) => void): Promise<any> {
    console.log('start fastapi')
    const uv_path = await getBinaryPath('uv')
    const backendPath = getBackendPath()
    const userData = app.getPath('userData');
    const currentVersion = app.getVersion();
    const venvPath = getVenvPath(currentVersion);
    console.log('userData', userData)
    console.log('Using venv path:', venvPath)
    // Try to find an available port, with aggressive cleanup if needed
    let port: number;
    const portFile = path.join(userData, 'port.txt');
    if (fs.existsSync(portFile)) {
        port = parseInt(fs.readFileSync(portFile, 'utf-8'));
        log.info(`Found port from file: ${port}`);
        await killProcessOnPort(port);
    }
    try {
        port = await findAvailablePort(5001);
        fs.writeFileSync(portFile, port.toString());
        log.info(`Found available port: ${port}`);
    } catch (error) {
        log.error('Failed to find available port, attempting cleanup...');

        // Last resort: try to kill all processes in the range
        for (let p = 5001; p <= 5050; p++) {
            await killProcessOnPort(p);
        }

        // Try once more
        port = await findAvailablePort(5001);
    }

    if (setPort) {
        setPort(port);
    }

    const npmCacheDir = path.join(venvPath, '.npm-cache');
    if (!fs.existsSync(npmCacheDir)) {
        fs.mkdirSync(npmCacheDir, { recursive: true });
    }

    const env = {
        ...process.env,
        SERVER_URL: "https://dev.eigent.ai/api",
        PYTHONIOENCODING: 'utf-8',
        UV_PROJECT_ENVIRONMENT: venvPath,
        npm_config_cache: npmCacheDir,
    }

    //Redirect output
    const displayFilteredLogs = (data: String) => {
        if (!data) return;
        const msg = data.toString().trimEnd();
        //Detect if uv sync is run
        detectInstallationLogs(msg);

        if (msg.toLowerCase().includes("error") || msg.toLowerCase().includes("traceback")) {
            log.error(`BACKEND: ${msg}`);
        } else if (msg.toLowerCase().includes("warn")) {
            //Skip Warnings
            // log.warn(`BACKEND: ${msg}`);
        } else if (msg.includes("DEBUG")) {
            log.debug(`BACKEND: ${msg}`);
        } else {
            log.info(`BACKEND: ${msg}`); // treat uvicorn info logs as normal
        }
    }

    return new Promise((resolve, reject) => {
        //Implicitly runs uv sync
        const node_process = spawn(
            uv_path,
            ["run", "uvicorn", "main:api", "--port", port.toString(), "--loop", "asyncio"],
            { cwd: backendPath, env: env, detached: false }
        );


        let started = false;
        let healthCheckInterval: NodeJS.Timeout | null = null;
        const startTimeout = setTimeout(() => {
            if (!started) {
                if (healthCheckInterval) clearInterval(healthCheckInterval);
                node_process.kill();
                reject(new Error('Backend failed to start within timeout'));
            }
        }, 30000); // 30 second timeout

        // Helper function to poll health endpoint
        const pollHealthEndpoint = (): void => {
            let attempts = 0;
            const maxAttempts = 20; // 5 seconds total (20 * 250ms)
            const intervalMs = 250;

            healthCheckInterval = setInterval(() => {
                attempts++;
                const healthUrl = `http://127.0.0.1:${port}/health`;
                
                const req = http.get(healthUrl, { timeout: 1000 }, (res) => {
                    if (res.statusCode === 200) {
                        log.info(`Backend health check passed after ${attempts} attempts`);
                        started = true;
                        clearTimeout(startTimeout);
                        if (healthCheckInterval) clearInterval(healthCheckInterval);
                        resolve(node_process);
                    } else {
                        // Non-200 status (e.g., 404), continue polling unless max attempts reached
                        if (attempts >= maxAttempts) {
                            log.error(`Backend health check failed after ${attempts} attempts with status ${res.statusCode}`);
                            started = true;
                            clearTimeout(startTimeout);
                            if (healthCheckInterval) clearInterval(healthCheckInterval);
                            node_process.kill();
                            reject(new Error(`Backend health check failed: HTTP ${res.statusCode}`));
                        }
                    }
                });

                req.on('error', () => {
                    // Connection error - backend might not be ready yet, continue polling
                    if (attempts >= maxAttempts) {
                        log.error(`Backend health check failed after ${attempts} attempts: unable to connect`);
                        started = true;
                        clearTimeout(startTimeout);
                        if (healthCheckInterval) clearInterval(healthCheckInterval);
                        node_process.kill();
                        reject(new Error('Backend health check failed: unable to connect'));
                    }
                });

                req.on('timeout', () => {
                    req.destroy();
                    if (attempts >= maxAttempts) {
                        log.error(`Backend health check timed out after ${attempts} attempts`);
                        started = true;
                        clearTimeout(startTimeout);
                        if (healthCheckInterval) clearInterval(healthCheckInterval);
                        node_process.kill();
                        reject(new Error('Backend health check timed out'));
                    }
                });
            }, intervalMs);
        };

        node_process.stdout.on('data', (data) => {
            displayFilteredLogs(data);
            // check output content, judge if start success
            if (!started && data.toString().includes("Uvicorn running on")) {
                log.info('Uvicorn startup detected, starting health check polling...');
                pollHealthEndpoint();
            }
        });

        node_process.stderr.on('data', (data) => {
            displayFilteredLogs(data);

            if (!started && data.toString().includes("Uvicorn running on")) {
                log.info('Uvicorn startup detected (stderr), starting health check polling...');
                pollHealthEndpoint();
            }

            // Check for port binding errors
            if (data.toString().includes("Address already in use") ||
                data.toString().includes("bind() failed")) {
                started = true; // Prevent multiple rejections
                clearTimeout(startTimeout);
                if (healthCheckInterval) clearInterval(healthCheckInterval);
                node_process.kill();
                reject(new Error(`Port ${port} is already in use`));
            }
        });

        node_process.on('close', (code) => {
            clearTimeout(startTimeout);
            if (healthCheckInterval) clearInterval(healthCheckInterval);
            if (!started) {
                reject(new Error(`fastapi exited with code ${code}`));
            }
        });
    });
    // const node_process = spawn(
    //     uv_path,
    //     ["run", "uvicorn", "main:api", "--port", port.toString(), "--loop", "asyncio"],
    //     { cwd: backendPath, env: env, detached: false }
    // );

    // node_process.stdout.on('data', (data) => {
    //     log.info(`fastapi output: ${data}`)
    // })

    // node_process.stderr.on('data', (data) => {
    //     log.error(`fastapi stderr output: ${data}`)
    // })

    // node_process.on('close', (code) => {
    //     if (code === 0) {
    //         log.info('fastapi start success')
    //     } else {
    //         log.error(`fastapi exited with code ${code}`)

    //     }
    // })
    // return node_process
}

function checkPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createServer();

        // Set a timeout to prevent hanging
        const timeout = setTimeout(() => {
            server.close();
            resolve(false);
        }, 1000);

        server.once('error', (err: any) => {
            clearTimeout(timeout);
            if (err.code === 'EADDRINUSE') {
                // Try to connect to the port to verify it's truly in use
                const client = new net.Socket();
                client.setTimeout(500);

                client.once('connect', () => {
                    client.destroy();
                    resolve(false); // Port is definitely in use
                });

                client.once('error', () => {
                    client.destroy();
                    // Port might be in a weird state, consider it unavailable
                    resolve(false);
                });

                client.once('timeout', () => {
                    client.destroy();
                    resolve(false);
                });

                client.connect(port, '127.0.0.1');
            } else {
                resolve(false);
            }
        });

        server.once('listening', () => {
            clearTimeout(timeout);
            server.close(() => {
                console.log('try port', port)
                resolve(true)
            }); // port available, close then return
        });

        // force listen all addresses, prevent judgment
        server.listen({ port, host: "127.0.0.1", exclusive: true });
    });
}

export async function killProcessOnPort(port: number): Promise<boolean> {
    try {
        const platform = process.platform;

        if (platform === 'win32') {
            // 1. get pid of process listen on port
            const { stdout: netstatOut } = await execAsync(`netstat -ano | findstr LISTENING | findstr :${port}`);
            const lines = netstatOut.trim().split(/\r?\n/).filter(Boolean);
            if (lines.length === 0) {
                console.log(`no process listen on port ${port}`);
                return true;
            }

            // get pid from last field
            const pid = lines[0].trim().split(/\s+/).pop();
            if (!pid || isNaN(Number(pid))) {
                console.log(`Invalid PID extracted for port ${port}: ${pid}`);
                return false;
            }

            console.log(`Killing PID: ${pid}`);
            await execAsync(`taskkill /F /PID ${pid}`);
        }
        else if (platform === 'darwin') {
            await execAsync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`);
        }
        else {
            await execAsync(`fuser -k ${port}/tcp 2>/dev/null || true`);
        }


        // Wait a bit for the process to be killed
        await new Promise(resolve => setTimeout(resolve, 500));

        // Check if port is now available
        return await checkPortAvailable(port);
    } catch (error) {
        log.error(`Failed to kill process on port ${port}:`, error);
        return false;
    }
}

export async function findAvailablePort(startPort: number, maxAttempts = 50): Promise<number> {
    const triedPorts = new Set<number>();

    const tryPort = async (port: number): Promise<number | null> => {
        if (triedPorts.has(port)) return null;
        triedPorts.add(port);

        const available = await checkPortAvailable(port);
        if (available) {
            return port;
        }

        const killed = await killProcessOnPort(port);
        if (killed) {
            return port;
        }

        return null;
    };

    // return when found port
    for (let offset = 0; offset < maxAttempts; offset++) {
        const port = startPort + offset;
        const found = await tryPort(port);
        if (found) return found;
    }

    throw new Error(`No available port found in range ${startPort} ~ ${startPort + maxAttempts - 1}`);
}