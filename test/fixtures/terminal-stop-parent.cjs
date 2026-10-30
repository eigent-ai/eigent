// A test-owned Node parent; its child ignores TERM/HUP and expires by itself.
const { spawn } = require('node:child_process');

const child = spawn(
  process.execPath,
  [
    '-e',
    `
  process.on('SIGTERM', () => {});
  process.on('SIGHUP', () => {});
  setTimeout(() => process.exit(0), 10000);
  process.send('ready');
`,
  ],
  {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: {},
  }
);

child.once('message', () => process.send({ childPid: child.pid }));
setTimeout(() => {
  child.kill('SIGKILL');
  process.exit(0);
}, 10000).unref();
