import { getBackendPath, getBinaryPath, getCachePath, isBinaryExists, runInstallScript } from "./utils/process";
import { spawn, exec } from 'child_process'
import log from 'electron-log'
import fs from 'fs'
import path from 'path'
import * as net from "net";
import { ipcMain, BrowserWindow, app } from 'electron'
import { promisify } from 'util'

const execAsync = promisify(exec);

// helper function to get main window
function getMainWindow(): BrowserWindow | null {
    const windows = BrowserWindow.getAllWindows();
    return windows.length > 0 ? windows[0] : null;
}


export async function checkToolInstalled() {
    return new Promise(async (resolve, reject) => {
        if (!(await isBinaryExists('uv'))) {
            resolve(false)
        }

        if (!(await isBinaryExists('bun'))) {
            resolve(false)
        }

        resolve(true)
    })

}

/**
 * Check if command line tools are installed, install if not
 */
export async function installCommandTool() {
    return new Promise(async (resolve, reject) => {
        let isAllInstalled = true
        console.log('Checking if command line tools are installed, installing if not')
        if (!(await isBinaryExists('uv'))) {
            console.log('start install uv')
            await runInstallScript('install-uv.js')
            const uv_installed = await isBinaryExists('uv')
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (uv_installed) {

                    mainWindow.webContents.send('install-dependencies-log', { type: 'stdout', data: '' });
                } else {
                    isAllInstalled = false
                    mainWindow.webContents.send('install-dependencies-complete', { success: false, code: 2, error: `Script exited with code ${2}` });
                }
            }
        }

        if (!(await isBinaryExists('bun'))) {
            console.log('start install bun')
            await runInstallScript('install-bun.js')
            const bun_installed = await isBinaryExists('bun')
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (bun_installed) {
                    mainWindow.webContents.send('install-dependencies-log', { type: 'stdout', data: '' });
                } else {
                    isAllInstalled = false
                    mainWindow.webContents.send('install-dependencies-complete', { success: false, code: 2, error: `Script exited with code ${2}` });
                }
            }
        }
        resolve(isAllInstalled)
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
export async function installDependencies() {
    return new Promise<boolean>(async (resolve, reject) => {
        console.log('start install dependencies')

        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('install-dependencies-start');
        }

        const isInstalCommandTool = await installCommandTool()
        if (!isInstalCommandTool) {
            resolve(false)
            return
        }

        const uv_path = await getBinaryPath('uv')
        const backendPath = getBackendPath()

        if (!fs.existsSync(backendPath)) {
            fs.mkdirSync(backendPath, { recursive: true })
        }

        const installingLockPath = path.join(backendPath, 'uv_installing.lock')
        fs.writeFileSync(installingLockPath, '')

        const installedLockPath = path.join(backendPath, 'uv_installed.lock')
        const proxyArgs = ['--default-index', 'https://pypi.tuna.tsinghua.edu.cn/simple']

        const runInstall = (extraArgs: string[]) => {
            return new Promise<boolean>((resolveInner) => {
                const node_process = spawn(uv_path, [
                    'sync',
                    '--no-dev',
                    '--cache-dir', getCachePath('uv_cache'),
                    ...extraArgs], {
                    cwd: backendPath,
                    env: {
                        ...process.env,
                        UV_TOOL_DIR: getCachePath('uv_tool'),
                        UV_PYTHON_INSTALL_DIR: getCachePath('uv_python'),
                    }
                })
                console.log('start install dependencies',extraArgs)
                node_process.stdout.on('data', (data) => {
                    
                    log.info(`Script output: ${data}`)
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('install-dependencies-log', { type: 'stdout', data: data.toString() });
                    }
                })

                node_process.stderr.on('data', (data) => {
                    log.error(`Script error: ${data}`)
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('install-dependencies-log', { type: 'stderr', data: data.toString() });
                    }
                })

                node_process.on('close', (code) => {
                    console.log('install dependencies end',code===0)
                    resolveInner(code === 0)
                })
            })
        }

        // try default install
        const installSuccess = await runInstall([])

        if (installSuccess) {
            fs.unlinkSync(installingLockPath)
            fs.writeFileSync(installedLockPath, '')
            log.info('Script completed successfully')
            console.log('end install dependencies')
            spawn(uv_path, ['run', 'task', 'babel'], { cwd: backendPath })
            resolve(true)
            return
        }

        // try mirror install
        const mirrorInstallSuccess = await runInstall(proxyArgs)

        fs.existsSync(installingLockPath) && fs.unlinkSync(installingLockPath)

        if (mirrorInstallSuccess) {
            fs.writeFileSync(installedLockPath, '')
            log.info('Mirror script completed successfully')
            console.log('end install dependencies (mirror)')
            spawn(uv_path, ['run', 'task', 'babel'], { cwd: backendPath })
            resolve(true)
        } else {
            log.error('Both default and mirror install failed')
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('install-dependencies-complete', { success: false, error: 'Both default and mirror install failed' });
            }
            resolve(false)
        }
    })
}



export async function startBackend(setPort?: (port: number) => void): Promise<any> {
    console.log('start fastapi')
    const uv_path = await getBinaryPath('uv')
    const backendPath = getBackendPath()
    const userData = app.getPath('userData');
    console.log('userData', userData)
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

    const env = {
        ...process.env,
        SERVER_URL: "https://dev.eigent.ai/api",
        PYTHONIOENCODING: 'utf-8'
    }
    return new Promise((resolve, reject) => {
        const node_process = spawn(
            uv_path,
            ["run", "uvicorn", "main:api", "--port", port.toString(), "--loop", "asyncio"],
            { cwd: backendPath, env: env, detached: false }
        );


        let started = false;
        const startTimeout = setTimeout(() => {
            if (!started) {
                node_process.kill();
                reject(new Error('Backend failed to start within timeout'));
            }
        }, 30000); // 30 second timeout


        node_process.stdout.on('data', (data) => {
            log.info(`fastapi output: ${data}`);
            // check output content, judge if start success
            if (!started && data.toString().includes("Uvicorn running on")) {
                started = true;
                clearTimeout(startTimeout);
                resolve(node_process);
            }
        });

        node_process.stderr.on('data', (data) => {
            log.error(`fastapi stderr output: ${data}`);
            if (!started && data.toString().includes("Uvicorn running on")) {
                started = true;
                clearTimeout(startTimeout);
                resolve(node_process);
            }

            // Check for port binding errors
            if (data.toString().includes("Address already in use") ||
                data.toString().includes("bind() failed")) {
                started = true; // Prevent multiple rejections
                clearTimeout(startTimeout);
                node_process.kill();
                reject(new Error(`Port ${port} is already in use`));
            }
        });

        node_process.on('close', (code) => {
            clearTimeout(startTimeout);
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
    let port = startPort;
    let attemptedKill = false;

    for (let i = 0; i < maxAttempts; i++) {
        const available = await checkPortAvailable(port);
        if (available) {
            return port;
        }

        // If port is occupied and we haven't tried killing processes yet
        if (!attemptedKill && i >= 5) {
            log.info(`Attempting to free ports ${startPort} to ${startPort + maxAttempts}...`);

            // Try to kill processes on a range of ports
            for (let killPort = startPort; killPort < startPort + 10; killPort++) {
                await killProcessOnPort(killPort);
            }

            attemptedKill = true;

            // Reset to start port and try again
            port = startPort;
            continue;
        }

        port++;
    }
    throw new Error('No available port found');
}