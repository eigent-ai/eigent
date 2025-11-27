import { getBackendPath, getBinaryPath, getCachePath, getVenvPath, getUvEnv, isBinaryExists, runInstallScript, killProcessByName } from "./utils/process";
import { spawn, exec } from 'child_process'
import log from 'electron-log'
import fs from 'fs'
import path from 'path'
import * as net from "net";
import * as http from "http";
import { ipcMain, BrowserWindow, app } from 'electron'
import { promisify } from 'util'
import { PromiseReturnType } from "./install-deps";

const execAsync = promisify(exec);

// helper function to get main window
export function getMainWindow(): BrowserWindow | null {
    const windows = BrowserWindow.getAllWindows();
    return windows.length > 0 ? windows[0] : null;
}


export async function checkToolInstalled() {
    return new Promise<PromiseReturnType>(async (resolve, reject) => {
        if (!(await isBinaryExists('uv'))) {
            resolve({ success: false, message: "uv doesn't exist" })
            return
        }

        if (!(await isBinaryExists('bun'))) {
            resolve({ success: false, message: "Bun doesn't exist" })
            return
        }

        resolve({ success: true, message: "Tools exist already" })
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

    const uvEnv = getUvEnv(currentVersion);
    const env = {
        ...process.env,
        ...uvEnv,
        SERVER_URL: "https://dev.eigent.ai/api",
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1',
        npm_config_cache: npmCacheDir,
    }

    const displayFilteredLogs = (data: String) => {
        if (!data) return;
        const msg = data.toString().trimEnd();

        // REMOVED: detectInstallationLogs(msg)
        // Reason: Removed keyword-based detection to avoid false positives when backend
        // outputs logs containing keywords like "Installing", "Updating", "Syncing" etc.
        // Installation is now only handled through the explicit installation flow.

        if (msg.toLowerCase().includes("error") || msg.toLowerCase().includes("traceback")) {
            log.error(`BACKEND: ${msg}`);
        } else if (msg.toLowerCase().includes("warn")) {
            // Skip warnings
        } else if (msg.includes("DEBUG")) {
            log.debug(`BACKEND: ${msg}`);
        } else {
            log.info(`BACKEND: ${msg}`);
        }
    }

    return new Promise(async (resolve, reject) => {
        log.info(`Spawning backend process: ${uv_path} run uvicorn main:api --port ${port} --loop asyncio`);
        log.info(`Backend working directory: ${backendPath}`);
        log.info(`Using venv: ${venvPath}`);

        try {
            const { stdout: uvVersion } = await execAsync(`${uv_path} --version`);
            log.info(`UV version check: ${uvVersion.trim()}`);

            const { stdout: pythonTest } = await execAsync(
                `${uv_path} run python -c "print('Python OK')"`,
                { cwd: backendPath, env: env }
            );
            log.info(`Python test output: ${pythonTest.trim()}`);
        } catch (testErr: any) {
            log.warn(`Pre-flight check failed, attempting repair: ${testErr}`);

            try {
                // Attempt to repair the environment
                log.info("Attempting to repair environment...");

                // Cleanup stale processes and locks
                log.info("Cleaning up stale processes and locks...");
                await killProcessByName('uv');
                await killProcessByName('python');

                // Try to remove the lock file explicitly if it exists
                try {
                    const lockFile = path.join(getCachePath('uv_python'), '.lock');
                    if (fs.existsSync(lockFile)) {
                        fs.unlinkSync(lockFile);
                    }
                } catch (e) {
                    log.warn(`Failed to remove lock file: ${e}`);
                }

                // Cleanup corrupted python cache
                try {
                    const pythonCacheDir = getCachePath('uv_python');
                    if (fs.existsSync(pythonCacheDir)) {
                        log.info(`Removing potentially corrupted Python cache: ${pythonCacheDir}`);
                        fs.rmSync(pythonCacheDir, { recursive: true, force: true });
                    }
                } catch (e) {
                    log.warn(`Failed to remove Python cache: ${e}`);
                }

                // Cleanup corrupted venv (pyvenv.cfg may reference non-existent Python version)
                try {
                    if (fs.existsSync(venvPath)) {
                        log.info(`Removing potentially corrupted venv: ${venvPath}`);
                        fs.rmSync(venvPath, { recursive: true, force: true });
                    }
                } catch (e) {
                    log.warn(`Failed to remove venv: ${e}`);
                }

                // Use proxy if in China (simple check based on timezone)
                // Add official PyPI as fallback for packages not available on mirror
                const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                const proxyArgs = timezone === 'Asia/Shanghai'
                    ? [
                        '--default-index', 'https://mirrors.aliyun.com/pypi/simple/',
                        '--index', 'https://pypi.org/simple/'
                    ]
                    : [];

                // Step 1: Ensure Python is installed (fixes corrupted/missing Python)
                log.info("Step 1: Ensuring Python is installed...");
                await execAsync(`${uv_path} python install 3.10`, { cwd: backendPath, env: env });

                // Step 2: Sync dependencies
                log.info("Step 2: Syncing dependencies...");
                const syncArgs = ['sync', '--no-dev', ...proxyArgs];
                await execAsync(`${uv_path} ${syncArgs.join(' ')}`, { cwd: backendPath, env: env });

                // Retry the check
                const { stdout: pythonTest } = await execAsync(
                    `${uv_path} run python -c "print('Python OK')"`,
                    { cwd: backendPath, env: env }
                );
                log.info(`Python test output after repair: ${pythonTest.trim()}`);
            } catch (repairErr) {
                log.error(`Repair failed: ${repairErr}`);
                reject(new Error(`Backend environment check failed: ${testErr}\nRepair failed: ${repairErr}`));
                return;
            }
        }

        const node_process = spawn(
            uv_path,
            ["run", "uvicorn", "main:api", "--port", port.toString(), "--loop", "asyncio"],
            {
                cwd: backendPath,
                env: env,
                detached: process.platform !== 'win32',
                stdio: ['ignore', 'pipe', 'pipe']
            }
        );

        // NOTE: Do NOT use unref() - we need to maintain the process reference
        // to properly capture stdout/stderr and manage the process lifecycle

        log.info(`Backend process spawned with PID: ${node_process.pid}`);

        setTimeout(() => {
            if (node_process.killed) {
                log.error('Backend process was killed immediately after spawn');
            } else if (!node_process.pid) {
                log.error('Backend process has no PID');
            } else {
                log.info(`Backend process still running after 1s with PID ${node_process.pid}`);
            }
        }, 1000);

        let started = false;
        let healthCheckInterval: NodeJS.Timeout | null = null;

        const startTimeout = setTimeout(() => {
            if (!started) {
                if (healthCheckInterval) clearInterval(healthCheckInterval);
                killBackendProcess(node_process);
                reject(new Error('Backend failed to start within timeout'));
            }
        }, 65000);

        const initialDelay = setTimeout(() => {
            if (!started) {
                log.info('Starting backend health check polling...');
                pollHealthEndpoint();
            }
        }, 2000);

        const killBackendProcess = (proc: any) => {
            if (!proc || !proc.pid) return;

            log.info(`Killing backend process ${proc.pid} and its children...`);
            try {
                if (process.platform === 'win32') {
                    spawn('taskkill', ['/pid', proc.pid.toString(), '/T', '/F']);
                } else {
                    try {
                        process.kill(-proc.pid, 'SIGTERM');
                        setTimeout(() => {
                            try {
                                process.kill(-proc.pid, 'SIGKILL');
                            } catch (e) { }
                        }, 1000);
                    } catch (e) {
                        log.error(`Failed to kill process group: ${e}`);
                        proc.kill('SIGKILL');
                    }
                }
            } catch (e) {
                log.error(`Failed to kill backend process: ${e}`);
            }
        };

        const pollHealthEndpoint = (): void => {
            let attempts = 0;
            const maxAttempts = 240;
            const intervalMs = 250;

            healthCheckInterval = setInterval(() => {
                attempts++;
                const healthUrl = `http://127.0.0.1:${port}/health`;
                log.debug(`Health check attempt ${attempts}/${maxAttempts}: ${healthUrl}`);

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
                            killBackendProcess(node_process);
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
                        killBackendProcess(node_process);
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
                        killBackendProcess(node_process);
                        reject(new Error('Backend health check timed out'));
                    }
                });
            }, intervalMs);
        };

        node_process.stdout.on('data', (data) => {
            log.debug(`Backend stdout received ${data.length} bytes`);
            displayFilteredLogs(data);
        });

        node_process.stderr.on('data', (data) => {
            log.debug(`Backend stderr received ${data.length} bytes`);
            displayFilteredLogs(data);

            if (data.toString().includes("Address already in use") ||
                data.toString().includes("bind() failed")) {
                if (!started) {
                    started = true;
                    clearTimeout(startTimeout);
                    clearTimeout(initialDelay);
                    if (healthCheckInterval) clearInterval(healthCheckInterval);
                    killBackendProcess(node_process);
                    reject(new Error(`Port ${port} is already in use`));
                }
            }
        });

        node_process.on('error', (err) => {
            log.error(`Backend process error: ${err.message}`);
            if (!started) {
                started = true;
                clearTimeout(startTimeout);
                clearTimeout(initialDelay);
                if (healthCheckInterval) clearInterval(healthCheckInterval);
                reject(new Error(`Failed to spawn backend process: ${err.message}`));
            }
        });

        node_process.on('close', async (code, signal) => {
            log.info(`Backend process closed with code ${code}, signal ${signal}`);
            clearTimeout(startTimeout);
            clearTimeout(initialDelay);
            if (healthCheckInterval) clearInterval(healthCheckInterval);

            if (!started) {
                log.info(`Backend exited before ready, cleaning up port ${port}...`);
                await killProcessOnPort(port);
                reject(new Error(`Backend exited prematurely with code ${code}`));
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