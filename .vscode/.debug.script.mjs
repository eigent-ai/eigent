import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'

const pkg = createRequire(import.meta.url)('../package.json')
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// write .debug.env
const envContent = Object.entries(pkg.debug.env).map(([key, val]) => `${key}=${val}`)
fs.writeFileSync(path.join(__dirname, '.debug.env'), envContent.join('\n'))

// bootstrap
spawn(
  // TODO: terminate `npm run dev` when Debug exits.
  'npm',
  ['run', 'dev'],
  {
    shell: true,
    stdio: 'inherit',
    // On Windows, Node's spawn can throw EINVAL if the env object contains
    // special keys that start with '=' (e.g. '=C:'). Filter those out.
    env: (() => {
      const env = {}
      for (const [key, val] of Object.entries(process.env)) {
        if (!key || key.startsWith('=') || key.includes('\0')) continue
        if (typeof val !== 'string' || val.includes('\0')) continue
        env[key] = val
      }
      env.VSCODE_DEBUG = 'true'
      return env
    })(),
  },
)