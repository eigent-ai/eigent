// Real production adapter/worker/Brain integration. Native consent is mocked for
// this dedicated fixture window; it never captures the user's application.
const { app, BrowserWindow, WebContentsView, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { RecordingAdapter } = require(process.env.RECORDING_ADAPTER_BUNDLE);
const root = process.env.RECORDING_FIXTURE_ROOT;
const port = Number(process.env.RECORDING_FIXTURE_PORT);
const capability = process.env.EIGENT_LOCAL_CONTROL_CAPABILITY;
const bootstrap = process.env.EIGENT_RECORDING_BOOTSTRAP;
const attemptKey = String(Date.now());
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.on('window-all-closed', () => {});
fs.mkdirSync(path.join(root, 'electron'), { recursive: true });
app.setPath('userData', path.join(root, 'electron'));

async function api(route, body) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Eigent-Local-Capability': capability,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw Error(JSON.stringify(result));
  return result;
}
async function until(test, label) {
  for (let i = 0; i < 100; i++) {
    const value = await test();
    if (value) return value;
    await sleep(100);
  }
  throw Error(`timed out: ${label}`);
}
app.whenReady().then(async () => {
  let adapter;
  const report = {
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    nativeConsent: 'mocked for dedicated fixture',
    source: 'owned web contents and owned child views',
    clips: [],
  };
  try {
    const main = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: { backgroundThrottling: false },
    });
    const markup = (stage) =>
      'data:text/html,' +
      encodeURIComponent(
        `<body style="background:lightblue"><h1>Eigent ${stage} fixture</h1><div id="clock"></div><script>setInterval(()=>document.getElementById('clock').textContent=Date.now(),42)</script></body>`
      );
    await main.loadURL(markup('Session'));
    const guest = new WebContentsView();
    guest.setBounds({ x: 200, y: 150, width: 400, height: 300 });
    main.contentView.addChildView(guest);
    await guest.webContents.loadURL(
      'data:text/html,' +
        encodeURIComponent(
          '<body style="background:orange"><h1>EMBEDDED BROWSER FIXTURE</h1><script>setInterval(()=>document.body.style.background=`hsl(${Date.now()/50%360},80%,60%)`,42)</script>'
        )
    );
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
    adapter = new RecordingAdapter({
      window: main,
      port,
      bootstrap,
      workerDirectory: path.join(process.cwd(), 'electron/recording'),
      locale: () => 'en-US',
    });
    await until(
      async () => (await api('/recordings/capabilities')).available,
      'provider'
    );
    const grant = await adapter.authorize('run');
    const first = await api('/recordings', {
      run_id: 'run',
      grant_id: grant.grant_id,
      idempotency_key: 'first-' + attemptKey,
    });
    await until(
      async () => (await api(`/recordings/${first.id}`)).state === 'recording',
      'first frames'
    );
    await sleep(1500);
    // Destroy the Session document while main-owned capture continues.
    await main.loadURL(markup('Settings'));
    await sleep(1500);
    const busy = await fetch(`http://127.0.0.1:${port}/recordings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Eigent-Local-Capability': capability,
      },
      body: JSON.stringify({
        run_id: 'run',
        grant_id: grant.grant_id,
        idempotency_key: 'busy',
      }),
    });
    report.concurrentStart = { status: busy.status, body: await busy.json() };
    await api(`/recordings/${first.id}/stop`, {});
    const completed = await until(async () => {
      const row = await api(`/recordings/${first.id}`);
      return row.state === 'completed' ? row : null;
    }, 'first publication');
    report.clips.push(completed);
    // Headless restart using the same live grant, with no Session document.
    const second = await api('/recordings', {
      run_id: 'run',
      grant_id: grant.grant_id,
      idempotency_key: 'headless-second-' + attemptKey,
    });
    await until(
      async () => (await api(`/recordings/${second.id}`)).state === 'recording',
      'headless actual frames'
    );
    await sleep(1500);
    await api(`/recordings/${second.id}/stop`, {});
    report.clips.push(
      await until(async () => {
        const row = await api(`/recordings/${second.id}`);
        return row.state === 'completed' ? row : null;
      }, 'second publication')
    );
    report.success = true;
    console.log('fixture: disposing adapter');
    await adapter.dispose();
    console.log('fixture: adapter disposed');
    adapter = null;
    main.destroy();
  } catch (error) {
    report.success = false;
    report.error = String(error);
  } finally {
    await adapter?.dispose();
    fs.writeFileSync(
      path.join(root, 'report.json'),
      JSON.stringify(report, null, 2)
    );
    console.log(
      JSON.stringify({
        success: report.success,
        error: report.error,
        recordings: report.clips.map((row) => ({
          state: row.state,
          clips: row.clips,
        })),
      })
    );
    app.exit(report.success ? 0 : 1);
  }
});
