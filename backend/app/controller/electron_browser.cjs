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

  // Create navigation bar and webview HTML
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
      <span class="nav-icon">&#x2190;</span>
    </button>
    <button id="forward-btn" title="Forward">
      <span class="nav-icon">&#x2192;</span>
    </button>
    <button id="reload-btn" title="Reload">
      <span class="nav-icon">&#x21bb;</span>
      <div id="loading-indicator"></div>
    </button>
    <button id="home-btn" title="Home">
      <span class="nav-icon">&#x1F3E0;</span>
    </button>
    <input type="text" id="url-input" placeholder="Enter URL..." />
    <button id="go-btn">Go</button>
    <button id="linkedin-btn" style="background: #0077B5; color: white; border-color: #0077B5;">
      LinkedIn
    </button>
    <button id="info-btn" title="Show Info">&#x2139;&#xFE0F;</button>
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
