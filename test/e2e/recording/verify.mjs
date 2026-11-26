import { build } from 'esbuild';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
);
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'eigent-recording-'));
const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
const bundle = path.join(output, 'adapter.cjs');
await build({
  entryPoints: [path.join(root, 'electron/main/recording/adapter.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  outfile: bundle,
});
const env = {
  ...process.env,
  RECORDING_FIXTURE_ROOT: output,
  RECORDING_FIXTURE_PORT: String(port),
  RECORDING_ADAPTER_BUNDLE: bundle,
  EIGENT_RUNTIME: 'electron',
  EIGENT_LOCAL_CONTROL_CAPABILITY: randomBytes(32).toString('hex'),
  EIGENT_RECORDING_BOOTSTRAP: randomBytes(32).toString('hex'),
  PYTHONPATH: path.join(root, 'backend'),
};
delete env.ELECTRON_RUN_AS_NODE;
const python =
  process.platform === 'win32'
    ? path.join(root, 'backend/.venv/Scripts/python.exe')
    : path.join(root, 'backend/.venv/bin/python');
const server = spawn(
  python,
  [path.join(root, 'test/e2e/recording/brain_fixture.py')],
  { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] }
);
server.stderr.on('data', (bytes) => {
  const message = bytes.toString();
  if (!message.includes('DeprecationWarning')) process.stderr.write(message);
});
let electron;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/recordings/capabilities`,
        {
          headers: {
            'X-Eigent-Local-Capability': env.EIGENT_LOCAL_CONTROL_CAPABILITY,
          },
        }
      );
      if (response.ok) break;
    } catch {}
    if (attempt === 99) throw Error('Brain fixture did not become ready');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const { default: executable } = await import('electron');
  electron = spawn(
    executable,
    [path.join(root, 'test/e2e/recording/fixture.cjs')],
    { cwd: root, env, stdio: 'inherit' }
  );
  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      electron.kill('SIGTERM');
      reject(Error('Recording fixture exceeded 60 seconds'));
    }, 60_000);
    electron.once('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
    electron.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  if (code !== 0)
    throw Error(`Electron fixture failed (${code}); inspect ${output}`);
  const report = JSON.parse(
    await fs.readFile(path.join(output, 'report.json'), 'utf8')
  );
  if (
    !report.success ||
    report.clips.length !== 2 ||
    report.concurrentStart.status !== 409
  )
    throw Error('Recording acceptance assertions failed');
  const ffprobe = spawnSync('ffprobe', ['-version']);
  if (ffprobe.status === 0) {
    report.externalMedia = [];
    for (const [index, row] of report.clips.entries()) {
      const clip = row.clips[0];
      const probe = spawnSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration,size:stream=codec_name,codec_type,width,height,avg_frame_rate',
          '-of',
          'json',
          clip.local_path,
        ],
        { encoding: 'utf8' }
      );
      if (probe.status !== 0) throw Error('External media inspection failed');
      const media = JSON.parse(probe.stdout);
      if (
        media.streams.length !== 1 ||
        media.streams[0].codec_type !== 'video' ||
        Number(media.format.duration) <= 1
      )
        throw Error('Clip profile mismatch');
      const seek = spawnSync('ffmpeg', [
        '-y',
        '-ss',
        '1',
        '-i',
        clip.local_path,
        '-frames:v',
        '1',
        path.join(output, `seek-${index}.png`),
        '-loglevel',
        'error',
      ]);
      if (seek.status !== 0) throw Error('External decode/seek failed');
      report.externalMedia.push(media);
    }
  } else
    report.externalMedia =
      'not run: ffprobe not installed (test-only dependency)';
  await fs.writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(report, null, 2)
  );
  console.log(`Recording integration passed. Evidence: ${output}`);
} finally {
  electron?.kill('SIGTERM');
  server.kill('SIGTERM');
}
