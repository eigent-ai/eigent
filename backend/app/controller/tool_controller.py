from fastapi import APIRouter, HTTPException
from app.utils.toolkit.notion_mcp_toolkit import NotionMCPToolkit
from app.utils.toolkit.google_calendar_toolkit import GoogleCalendarToolkit
from app.utils.oauth_state_manager import oauth_state_manager
from utils import traceroot_wrapper as traceroot
from camel.toolkits.hybrid_browser_toolkit.hybrid_browser_toolkit_ts import (
    HybridBrowserToolkit as BaseHybridBrowserToolkit,
)
from app.utils.cookie_manager import CookieManager
import os
import uuid

logger = traceroot.get_logger("tool_controller")
router = APIRouter()


@router.post("/install/tool/{tool}", name="install tool")
async def install_tool(tool: str):
    """
    Install and pre-instantiate a specific MCP tool for authentication

    Args:
        tool: Tool name to install (notion)

    Returns:
        Installation result with tool information
    """
    if tool == "notion":
        try:
            # Use a dummy task_id for installation, as this is just for pre-authentication
            toolkit = NotionMCPToolkit("install_auth")

            try:
                # Pre-instantiate by connecting (this completes authentication)
                await toolkit.connect()

                # Get available tools to verify connection
                tools = [tool_func.func.__name__ for tool_func in
                         toolkit.get_tools()]
                logger.info(
                    f"Successfully pre-instantiated {tool} toolkit with {len(tools)} tools")

                # Disconnect, authentication info is saved
                await toolkit.disconnect()

                return {
                    "success": True,
                    "tools": tools,
                    "message": f"Successfully installed and authenticated {tool} toolkit",
                    "count": len(tools),
                    "toolkit_name": "NotionMCPToolkit"
                }
            except Exception as connect_error:
                logger.warning(
                    f"Could not connect to {tool} MCP server: {connect_error}")
                # Even if connection fails, mark as installed so user can use it later
                return {
                    "success": True,
                    "tools": [],
                    "message": f"{tool} toolkit installed but not connected. Will connect when needed.",
                    "count": 0,
                    "toolkit_name": "NotionMCPToolkit",
                    "warning": "Could not connect to Notion MCP server. You may need to authenticate when using the tool."
                }
        except Exception as e:
            logger.error(f"Failed to install {tool} toolkit: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to install {tool}: {str(e)}"
            )
    elif tool == "google_calendar":
        try:
            # Try to initialize toolkit - will succeed if credentials exist
            try:
                toolkit = GoogleCalendarToolkit("install_auth")
                tools = [tool_func.func.__name__ for tool_func in toolkit.get_tools()]
                logger.info(f"Successfully initialized Google Calendar toolkit with {len(tools)} tools")

                return {
                    "success": True,
                    "tools": tools,
                    "message": f"Successfully installed {tool} toolkit",
                    "count": len(tools),
                    "toolkit_name": "GoogleCalendarToolkit"
                }
            except ValueError as auth_error:
                # No credentials - need authorization
                logger.info(f"No credentials found, starting authorization: {auth_error}")

                # Start background authorization in a new thread
                logger.info("Starting background Google Calendar authorization")
                GoogleCalendarToolkit.start_background_auth("install_auth")

                return {
                    "success": False,
                    "status": "authorizing",
                    "message": "Authorization required. Browser should open automatically. Complete authorization and try installing again.",
                    "toolkit_name": "GoogleCalendarToolkit",
                    "requires_auth": True
                }
        except Exception as e:
            logger.error(f"Failed to install {tool} toolkit: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to install {tool}: {str(e)}"
            )
    else:
        raise HTTPException(
            status_code=404,
            detail=f"Tool '{tool}' not found. Available tools: ['notion', 'google_calendar']"
        )


@router.get("/tools/available", name="list available tools")
async def list_available_tools():
    """
    List all available MCP tools that can be installed

    Returns:
        List of available tools with their information
    """
    return {
        "tools": [
            {
                "name": "notion",
                "display_name": "Notion MCP",
                "description": "Notion workspace integration for reading and managing Notion pages",
                "toolkit_class": "NotionMCPToolkit",
                "requires_auth": True
            },
            {
                "name": "google_calendar",
                "display_name": "Google Calendar",
                "description": "Google Calendar integration for managing events and schedules",
                "toolkit_class": "GoogleCalendarToolkit",
                "requires_auth": True
            }
        ]
    }


@router.get("/oauth/status/{provider}", name="get oauth status")
async def get_oauth_status(provider: str):
    """
    Get the current OAuth authorization status for a provider

    Args:
        provider: OAuth provider name (e.g., 'google_calendar')

    Returns:
        Current authorization status
    """
    state = oauth_state_manager.get_state(provider)

    if not state:
        return {
            "provider": provider,
            "status": "not_started",
            "message": "No authorization in progress"
        }

    return state.to_dict()


@router.post("/oauth/cancel/{provider}", name="cancel oauth")
async def cancel_oauth(provider: str):
    """
    Cancel an ongoing OAuth authorization flow

    Args:
        provider: OAuth provider name (e.g., 'google_calendar')

    Returns:
        Cancellation result
    """
    state = oauth_state_manager.get_state(provider)

    if not state:
        raise HTTPException(
            status_code=404,
            detail=f"No authorization found for provider '{provider}'"
        )

    if state.status not in ["pending", "authorizing"]:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel authorization with status '{state.status}'"
        )

    state.cancel()
    logger.info(f"Cancelled OAuth authorization for {provider}")

    return {
        "success": True,
        "provider": provider,
        "message": "Authorization cancelled successfully"
    }


@router.delete("/uninstall/tool/{tool}", name="uninstall tool")
async def uninstall_tool(tool: str):
    """
    Uninstall a tool and clean up its authentication data

    Args:
        tool: Tool name to uninstall (notion, google_calendar)

    Returns:
        Uninstallation result
    """
    import os
    import shutil

    if tool == "notion":
        try:
            import hashlib
            import glob

            # Calculate the hash for Notion MCP URL
            # mcp-remote uses MD5 hash of the URL to generate file names
            notion_url = "https://mcp.notion.com/mcp"
            url_hash = hashlib.md5(notion_url.encode()).hexdigest()

            # Find and remove Notion-specific auth files
            mcp_auth_dir = os.path.join(os.path.expanduser("~"), ".mcp-auth")
            deleted_files = []

            if os.path.exists(mcp_auth_dir):
                # Look for all files with the Notion hash prefix
                for version_dir in os.listdir(mcp_auth_dir):
                    version_path = os.path.join(mcp_auth_dir, version_dir)
                    if os.path.isdir(version_path):
                        # Find all files matching the hash pattern
                        pattern = os.path.join(version_path, f"{url_hash}_*")
                        notion_files = glob.glob(pattern)

                        for file_path in notion_files:
                            try:
                                os.remove(file_path)
                                deleted_files.append(file_path)
                                logger.info(f"Removed Notion auth file: {file_path}")
                            except Exception as e:
                                logger.warning(f"Failed to remove {file_path}: {e}")

            message = f"Successfully uninstalled {tool}"
            if deleted_files:
                message += f" and cleaned up {len(deleted_files)} authentication file(s)"

            return {
                "success": True,
                "message": message,
                "deleted_files": deleted_files
            }
        except Exception as e:
            logger.error(f"Failed to uninstall {tool}: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to uninstall {tool}: {str(e)}"
            )

    elif tool == "google_calendar":
        try:
            # Clean up Google Calendar token directories (user-scoped + legacy)
            token_dirs = set()
            try:
                token_dirs.add(os.path.dirname(GoogleCalendarToolkit._build_canonical_token_path()))
            except Exception as e:
                logger.warning(f"Failed to resolve canonical Google Calendar token path: {e}")

            token_dirs.add(os.path.join(os.path.expanduser("~"), ".eigent", "tokens", "google_calendar"))

            for token_dir in token_dirs:
                if os.path.exists(token_dir):
                    shutil.rmtree(token_dir)
                    logger.info(f"Removed Google Calendar token directory: {token_dir}")

            # Clear OAuth state manager cache (this is the key fix!)
            # This removes the cached credentials from memory
            state = oauth_state_manager.get_state("google_calendar")
            if state:
                if state.status in ["pending", "authorizing"]:
                    state.cancel()
                    logger.info("Cancelled ongoing Google Calendar authorization")
                # Clear the state completely to remove cached credentials
                oauth_state_manager._states.pop("google_calendar", None)
                logger.info("Cleared Google Calendar OAuth state cache")

            return {
                "success": True,
                "message": f"Successfully uninstalled {tool} and cleaned up authentication tokens"
            }
        except Exception as e:
            logger.error(f"Failed to uninstall {tool}: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to uninstall {tool}: {str(e)}"
            )
    else:
        raise HTTPException(
            status_code=404,
            detail=f"Tool '{tool}' not found. Available tools: ['notion', 'google_calendar']"
        )


@router.post("/browser/login", name="open browser for login")
async def open_browser_login():
    """
    Open an Electron-based Chrome browser for user login with a dedicated user data directory

    Returns:
        Browser session information
    """
    try:
        import subprocess
        import platform
        import socket
        import json
        
        # Use fixed profile name for persistent logins (no port suffix)
        session_id = "user_login"
        cdp_port = 9223

        # IMPORTANT: Use dedicated profile for tool_controller browser
        # This is the SOURCE OF TRUTH for login data
        # On Eigent startup, this data will be copied to WebView partition (one-way sync)
        browser_profiles_base = os.path.expanduser("~/.eigent/browser_profiles")
        user_data_dir = os.path.join(browser_profiles_base, "profile_user_login")

        os.makedirs(user_data_dir, exist_ok=True)

        logger.info(
            f"Creating browser session {session_id} with profile at: {user_data_dir}")
        
        # Check if browser is already running on this port
        def is_port_in_use(port):
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                return s.connect_ex(('localhost', port)) == 0
        
        if is_port_in_use(cdp_port):
            logger.info(f"Browser already running on port {cdp_port}")
            return {
                "success": True,
                "session_id": session_id,
                "user_data_dir": user_data_dir,
                "cdp_port": cdp_port,
                "message": "Browser already running. Use existing window to log in.",
                "note": "Your login data will be saved in the profile."
            }
        
        # Create Electron browser script with .cjs extension for CommonJS
        electron_script_path = os.path.join(os.path.dirname(__file__), "electron_browser.cjs")
        electron_script_content = '''
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const userDataDir = args[0];
const cdpPort = args[1];
const startUrl = args[2] || 'https://www.google.com';

// This must be called before app.ready
app.commandLine.appendSwitch('remote-debugging-port', cdpPort);

console.log('[ELECTRON BROWSER] Starting with:');
console.log('  Chrome version:', process.versions.chrome);
console.log('  User data dir (requested):', userDataDir);
console.log('  CDP port:', cdpPort);
console.log('  Start URL:', startUrl);

// Set app paths - must be done before app.ready
// Do NOT use commandLine.appendSwitch('user-data-dir') as it conflicts with setPath
app.setPath('userData', userDataDir);
app.setPath('sessionData', userDataDir);

app.whenReady().then(async () => {
  const { session } = require('electron');
  const fs = require('fs');
  const path = require('path');

  // Log actual paths being used
  console.log('[ELECTRON BROWSER] Actual paths:');
  console.log('  app.getPath("userData"):', app.getPath('userData'));
  console.log('  app.getPath("sessionData"):', app.getPath('sessionData'));
  console.log('  app.getPath("cache"):', app.getPath('cache'));
  console.log('  app.getPath("temp"):', app.getPath('temp'));
  console.log('  process.argv:', process.argv);

  // Check command line switches
  console.log('[ELECTRON BROWSER] Command line switches:');
  console.log('  user-data-dir:', app.commandLine.getSwitchValue('user-data-dir'));
  console.log('  remote-debugging-port:', app.commandLine.getSwitchValue('remote-debugging-port'));

  // Log partition session info
  const userLoginSession = session.fromPartition('persist:user_login');
  console.log('[ELECTRON BROWSER] Session info:');
  console.log('  Partition: persist:user_login');
  console.log('  Session storage path:', userLoginSession.getStoragePath());

  // Check if Cookies file exists
  const cookiesPath = path.join(app.getPath('userData'), 'Partitions', 'user_login', 'Cookies');
  console.log('[ELECTRON BROWSER] Cookies path:', cookiesPath);
  console.log('[ELECTRON BROWSER] Cookies exists:', fs.existsSync(cookiesPath));
  if (fs.existsSync(cookiesPath)) {
    const stats = fs.statSync(cookiesPath);
    console.log('[ELECTRON BROWSER] Cookies file size:', stats.size, 'bytes');
  }
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Eigent Browser - Login',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true
    }
  });

  // Create navigation bar and webview
  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    
    #nav-bar {
      display: flex;
      align-items: center;
      padding: 8px;
      background: #f5f5f5;
      border-bottom: 1px solid #ddd;
      gap: 8px;
    }
    
    button {
      padding: 6px 12px;
      border: 1px solid #ccc;
      background: white;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    
    button:hover:not(:disabled) {
      background: #f0f0f0;
    }
    
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    #url-input {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 14px;
    }
    
    #url-input:focus {
      outline: none;
      border-color: #4285f4;
    }
    
    #webview {
      flex: 1;
      width: 100%;
      border: none;
    }
    
    .nav-icon {
      font-size: 16px;
    }
    
    #loading-indicator {
      width: 20px;
      height: 20px;
      border: 2px solid #f3f3f3;
      border-top: 2px solid #4285f4;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      display: none;
    }
    
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    .loading #loading-indicator {
      display: block;
    }
    
    .loading #reload-btn .nav-icon {
      display: none;
    }
  </style>
</head>
<body>
  <div id="nav-bar">
    <button id="back-btn" title="Back">
      <span class="nav-icon">←</span>
    </button>
    <button id="forward-btn" title="Forward">
      <span class="nav-icon">→</span>
    </button>
    <button id="reload-btn" title="Reload">
      <span class="nav-icon">↻</span>
      <div id="loading-indicator"></div>
    </button>
    <button id="home-btn" title="Home">
      <span class="nav-icon">🏠</span>
    </button>
    <input type="text" id="url-input" placeholder="Enter URL..." />
    <button id="go-btn">Go</button>
    <button id="linkedin-btn" style="background: #0077B5; color: white; border-color: #0077B5;">
      LinkedIn
    </button>
    <button id="info-btn" title="Show Info">ℹ️</button>
  </div>
  
  <webview id="webview" src="${startUrl}" partition="persist:user_login"></webview>
  
  <div id="info-panel" style="display: none; position: absolute; top: 50px; right: 10px; background: white; border: 1px solid #ccc; padding: 15px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); z-index: 1000; max-width: 400px; font-size: 12px;">
    <h4 style="margin: 0 0 10px 0;">Browser Info</h4>
    <div id="info-content"></div>
    <button onclick="document.getElementById('info-panel').style.display='none'" style="margin-top: 10px;">Close</button>
  </div>
  
  <script>
    const webview = document.getElementById('webview');
    const backBtn = document.getElementById('back-btn');
    const forwardBtn = document.getElementById('forward-btn');
    const reloadBtn = document.getElementById('reload-btn');
    const homeBtn = document.getElementById('home-btn');
    const urlInput = document.getElementById('url-input');
    const goBtn = document.getElementById('go-btn');
    const linkedinBtn = document.getElementById('linkedin-btn');
    const navBar = document.getElementById('nav-bar');
    const infoBtn = document.getElementById('info-btn');
    const infoPanel = document.getElementById('info-panel');
    const infoContent = document.getElementById('info-content');
    
    // Show info panel
    infoBtn.addEventListener('click', () => {
      const { ipcRenderer } = require('electron');
      
      // Get browser info
      const info = {
        'Chrome Version': process.versions.chrome,
        'Electron Version': process.versions.electron,
        'Node Version': process.versions.node,
        'User Data Dir (requested)': '${userDataDir}',
        'CDP Port': '${cdpPort}',
        'Platform': process.platform,
        'Architecture': process.arch
      };
      
      // Also check webview partition info
      const partition = webview.partition || 'default';
      info['WebView Partition'] = partition;
      
      // Format info as HTML
      let html = '<table style="width: 100%; border-collapse: collapse;">';
      for (const [key, value] of Object.entries(info)) {
        html += '<tr><td style="padding: 4px; border-bottom: 1px solid #eee;"><strong>' + key + ':</strong></td><td style="padding: 4px; border-bottom: 1px solid #eee; word-break: break-all;">' + value + '</td></tr>';
      }
      html += '</table>';
      
      infoContent.innerHTML = html;
      infoPanel.style.display = 'block';
    });
    
    // Update navigation buttons
    function updateNavButtons() {
      backBtn.disabled = !webview.canGoBack();
      forwardBtn.disabled = !webview.canGoForward();
    }
    
    // Navigate to URL
    function navigateToUrl() {
      let url = urlInput.value.trim();
      if (!url) return;
      
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      
      webview.loadURL(url);
    }
    
    // Event listeners
    backBtn.addEventListener('click', () => webview.goBack());
    forwardBtn.addEventListener('click', () => webview.goForward());
    reloadBtn.addEventListener('click', () => webview.reload());
    homeBtn.addEventListener('click', () => webview.loadURL('${startUrl}'));
    goBtn.addEventListener('click', navigateToUrl);
    linkedinBtn.addEventListener('click', () => webview.loadURL('https://www.linkedin.com'));
    
    urlInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        navigateToUrl();
      }
    });
    
    // WebView events
    webview.addEventListener('did-start-loading', () => {
      navBar.classList.add('loading');
    });
    
    webview.addEventListener('did-stop-loading', () => {
      navBar.classList.remove('loading');
      updateNavButtons();
    });
    
    webview.addEventListener('did-navigate', (e) => {
      urlInput.value = e.url;
      updateNavButtons();
    });
    
    webview.addEventListener('did-navigate-in-page', (e) => {
      urlInput.value = e.url;
      updateNavButtons();
    });
    
    webview.addEventListener('new-window', (e) => {
      // Open new windows in the same webview
      e.preventDefault();
      webview.loadURL(e.url);
    });
    
    // Initialize
    updateNavButtons();
  </script>
</body>
</html>`;

  win.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(html));

  // Show window when ready
  win.once('ready-to-show', () => {
    win.show();

    // Log cookies periodically to track changes
    setInterval(async () => {
      try {
        const cookies = await userLoginSession.cookies.get({});
        console.log('[ELECTRON BROWSER] Current cookies count:', cookies.length);
        if (cookies.length > 0) {
          console.log('[ELECTRON BROWSER] Cookie domains:', [...new Set(cookies.map(c => c.domain))]);
        }
      } catch (error) {
        console.error('[ELECTRON BROWSER] Failed to get cookies:', error);
      }
    }, 5000); // Check every 5 seconds
  });
  
  win.on('closed', async () => {
    console.log('[ELECTRON BROWSER] Window closed, preparing to quit...');

    // Flush storage data before quitting to ensure cookies are saved
    try {
      const { session } = require('electron');
      const fs = require('fs');
      const path = require('path');
      const userLoginSession = session.fromPartition('persist:user_login');

      // Log cookies before flush
      const cookiesBeforeFlush = await userLoginSession.cookies.get({});
      console.log('[ELECTRON BROWSER] Cookies count before flush:', cookiesBeforeFlush.length);

      // Flush storage
      console.log('[ELECTRON BROWSER] Flushing storage data...');
      await userLoginSession.flushStorageData();
      console.log('[ELECTRON BROWSER] Storage data flushed successfully');

      // Check cookies file after flush
      const cookiesPath = path.join(app.getPath('userData'), 'Partitions', 'user_login', 'Cookies');
      if (fs.existsSync(cookiesPath)) {
        const stats = fs.statSync(cookiesPath);
        console.log('[ELECTRON BROWSER] Cookies file size after flush:', stats.size, 'bytes');
      } else {
        console.log('[ELECTRON BROWSER] WARNING: Cookies file does not exist after flush!');
      }
    } catch (error) {
      console.error('[ELECTRON BROWSER] Failed to flush storage data:', error);
    }
    app.quit();
  });
});

let isQuitting = false;

app.on('before-quit', async (event) => {
  if (isQuitting) return;

  // Prevent immediate quit to allow storage flush and cookie sync
  event.preventDefault();
  isQuitting = true;

  console.log('[ELECTRON BROWSER] before-quit event triggered');

  try {
    const { session } = require('electron');
    const fs = require('fs');
    const path = require('path');
    const userLoginSession = session.fromPartition('persist:user_login');

    // Log cookies before flush
    const cookiesBeforeQuit = await userLoginSession.cookies.get({});
    console.log('[ELECTRON BROWSER] Cookies count before quit:', cookiesBeforeQuit.length);
    if (cookiesBeforeQuit.length > 0) {
      console.log('[ELECTRON BROWSER] Cookie domains before quit:', [...new Set(cookiesBeforeQuit.map(c => c.domain))]);
    }

    // Flush storage
    console.log('[ELECTRON BROWSER] Flushing storage on quit...');
    await userLoginSession.flushStorageData();
    console.log('[ELECTRON BROWSER] Storage data flushed on quit');
  } catch (error) {
    console.error('[ELECTRON BROWSER] Failed to sync cookies:', error);
  } finally {
    console.log('[ELECTRON BROWSER] Exiting now...');
    // Force quit after sync
    app.exit(0);
  }
});

app.on('window-all-closed', () => {
  if (!isQuitting) {
    app.quit();
  }
});
'''
        
        # Write the Electron script
        with open(electron_script_path, 'w') as f:
            f.write(electron_script_content)
        
        # Find Electron executable
        # Try to use the same Electron version as the main app
        electron_cmd = "npx"
        electron_args = [
            electron_cmd,
            "electron",
            electron_script_path,
            user_data_dir,
            str(cdp_port),
            "https://www.google.com"
        ]
        
        # Get the app's directory to run npx in the right context
        app_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
        
        logger.info(f"[PROFILE USER LOGIN] Launching Electron browser with CDP on port {cdp_port}")
        logger.info(f"[PROFILE USER LOGIN] Working directory: {app_dir}")
        logger.info(f"[PROFILE USER LOGIN] userData path: {user_data_dir}")
        logger.info(f"[PROFILE USER LOGIN] Electron args: {electron_args}")

        # Start process and capture output in real-time
        process = subprocess.Popen(
            electron_args,
            cwd=app_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  # Redirect stderr to stdout
            universal_newlines=True,
            bufsize=1  # Line buffered
        )

        # Create async task to log Electron output
        async def log_electron_output():
            for line in iter(process.stdout.readline, ''):
                if line:
                    logger.info(f"[ELECTRON OUTPUT] {line.strip()}")

        import asyncio
        asyncio.create_task(log_electron_output())
        
        # Wait a bit for Electron to start
        import asyncio
        await asyncio.sleep(3)
        
        # Clean up the script file after a delay
        async def cleanup_script():
            await asyncio.sleep(10)
            try:
                os.remove(electron_script_path)
            except:
                pass
        
        asyncio.create_task(cleanup_script())
        
        logger.info(f"[PROFILE USER LOGIN] Electron browser launched with PID {process.pid}")

        return {
            "success": True,
            "session_id": session_id,
            "user_data_dir": user_data_dir,
            "cdp_port": cdp_port,
            "pid": process.pid,
            "chrome_version": "130.0.6723.191",  # Electron 33's Chrome version
            "message": "Electron browser opened successfully. Please log in to your accounts.",
            "note": "The browser will remain open for you to log in. Your login data will be saved in the profile."
        }

    except Exception as e:
        logger.error(f"Failed to open Electron browser for login: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to open browser: {str(e)}"
        )


@router.get("/browser/cookies", name="list cookie domains")
async def list_cookie_domains(search: str = None):
    """
    list cookie domains

    Args:
        search: url

    Returns:
       list of cookie domains
    """
    try:
        # Use tool_controller browser's user data directory (source of truth)
        user_data_base = os.path.expanduser("~/.eigent/browser_profiles")
        user_data_dir = os.path.join(user_data_base, "profile_user_login")

        logger.info(f"[COOKIES CHECK] Tool controller user_data_dir: {user_data_dir}")
        logger.info(f"[COOKIES CHECK] Tool controller user_data_dir exists: {os.path.exists(user_data_dir)}")

        # Check partition path
        partition_path = os.path.join(user_data_dir, "Partitions", "user_login")
        logger.info(f"[COOKIES CHECK] partition path: {partition_path}")
        logger.info(f"[COOKIES CHECK] partition exists: {os.path.exists(partition_path)}")

        # Check cookies file
        cookies_file = os.path.join(partition_path, "Cookies")
        logger.info(f"[COOKIES CHECK] cookies file: {cookies_file}")
        logger.info(f"[COOKIES CHECK] cookies file exists: {os.path.exists(cookies_file)}")
        if os.path.exists(cookies_file):
            stat = os.stat(cookies_file)
            logger.info(f"[COOKIES CHECK] cookies file size: {stat.st_size} bytes")

            # Try to read actual cookie count
            try:
                import sqlite3
                conn = sqlite3.connect(cookies_file)
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) FROM cookies")
                count = cursor.fetchone()[0]
                logger.info(f"[COOKIES CHECK] actual cookie count in database: {count}")
                conn.close()
            except Exception as e:
                logger.error(f"[COOKIES CHECK] failed to read cookie count: {e}")

        if not os.path.exists(user_data_dir):
            return {
                "success": True,
                "domains": [],
                "message": "No browser profile found. Please login first using /browser/login."
            }

        cookie_manager = CookieManager(user_data_dir)

        if search:
            domains = cookie_manager.search_cookies(search)
        else:
            domains = cookie_manager.get_cookie_domains()

        return {
            "success": True,
            "domains": domains,
            "total": len(domains),
            "user_data_dir": user_data_dir
        }

    except Exception as e:
        logger.error(f"Failed to list cookie domains: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list cookies: {str(e)}"
        )


@router.get("/browser/cookies/{domain}", name="get domain cookies")
async def get_domain_cookies(domain: str):
    """
    get domain cookies

    Args:
        domain

    Returns:
        cookies
    """
    try:
        user_data_base = os.path.expanduser("~/.eigent/browser_profiles")
        user_data_dir = os.path.join(user_data_base, "profile_user_login")

        if not os.path.exists(user_data_dir):
            raise HTTPException(
                status_code=404,
                detail="No browser profile found. Please login first using /browser/login."
            )

        cookie_manager = CookieManager(user_data_dir)
        cookies = cookie_manager.get_cookies_for_domain(domain)

        return {
            "success": True,
            "domain": domain,
            "cookies": cookies,
            "count": len(cookies)
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get cookies for domain {domain}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get cookies: {str(e)}"
        )


@router.delete("/browser/cookies/{domain}", name="delete domain cookies")
async def delete_domain_cookies(domain: str):
    """
    Delete cookies

    Args:
        domain

    Returns:
        deleted cookies
    """
    try:
        user_data_base = os.path.expanduser("~/.eigent/browser_profiles")
        user_data_dir = os.path.join(user_data_base, "profile_user_login")

        if not os.path.exists(user_data_dir):
            raise HTTPException(
                status_code=404,
                detail="No browser profile found. Please login first using /browser/login."
            )

        cookie_manager = CookieManager(user_data_dir)
        success = cookie_manager.delete_cookies_for_domain(domain)

        if success:
            return {
                "success": True,
                "message": f"Successfully deleted cookies for domain: {domain}"
            }
        else:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to delete cookies for domain: {domain}"
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete cookies for domain {domain}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete cookies: {str(e)}"
        )


@router.delete("/browser/cookies", name="delete all cookies")
async def delete_all_cookies():
    """
    delete all cookies

    Returns:
        deleted cookies
    """
    try:
        user_data_base = os.path.expanduser("~/.eigent/browser_profiles")
        user_data_dir = os.path.join(user_data_base, "profile_user_login")

        if not os.path.exists(user_data_dir):
            raise HTTPException(
                status_code=404,
                detail="No browser profile found."
            )

        cookie_manager = CookieManager(user_data_dir)
        success = cookie_manager.delete_all_cookies()

        if success:
            return {
                "success": True,
                "message": "Successfully deleted all cookies"
            }
        else:
            raise HTTPException(
                status_code=500,
                detail="Failed to delete all cookies"
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete all cookies: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete cookies: {str(e)}"
        )
