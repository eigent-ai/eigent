import fs from 'fs';
import path from 'path';
import os from 'os'

export const ENV_START = '# === MCP INTEGRATION ENV START ===';
export const ENV_END = '# === MCP INTEGRATION ENV END ===';

export function getEnvPath(email: string) {
  const tempEmail = email.split("@")[0].replace(/[\\/*?:"<>|\s]/g, "_").replace(".", "_")
  const eigentDir = path.join(os.homedir(), '.eigent')

  // Ensure .eigent directory exists
  if (!fs.existsSync(eigentDir)) {
    fs.mkdirSync(eigentDir, { recursive: true });
  }

  const envPath = path.join(eigentDir, '.env.' + tempEmail)
  const defaultEnv = path.join(process.resourcesPath, 'backend', '.env');
  if (!fs.existsSync(envPath) && fs.existsSync(defaultEnv)) {
    fs.copyFileSync(defaultEnv, envPath);
    fs.chmodSync(envPath, 0o600);
  }

  return envPath;
}

export function parseEnvBlock(content: string) {
  const lines = content.split(/\r?\n/);
  let start = lines.findIndex(l => l.trim() === ENV_START);
  let end = lines.findIndex(l => l.trim() === ENV_END);
  if (start === -1) start = lines.length;
  if (end === -1) end = lines.length;
  return { lines, start, end };
}

export function updateEnvBlock(lines: string[], kv: Record<string, string>) {
  //  Extract block 
  let start = lines.findIndex(l => l.trim() === ENV_START);
  let end = lines.findIndex(l => l.trim() === ENV_END);
  if (start === -1 || end === -1 || end < start) {
    //  No block, append
    lines.push(ENV_START);
    Object.entries(kv).forEach(([k, v]) => {
      lines.push(`${k}=${v}`);
    });
    lines.push(ENV_END);
    return lines;
  }
  //  Parse block content
  const block = lines.slice(start + 1, end);
  const map: Record<string, string> = {};
  block.forEach(line => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) map[m[1]] = m[2];
  });
  //  Overwrite/add
  Object.entries(kv).forEach(([k, v]) => {
    map[k] = v;
  });
  //  Reassemble block
  const newBlock = Object.entries(map).map(([k, v]) => `${k}=${v}`);
  return [
    ...lines.slice(0, start + 1),
    ...newBlock,
    ...lines.slice(end)
  ];
}

export function removeEnvKey(lines: string[], key: string) {
  let start = lines.findIndex(l => l.trim() === ENV_START);
  let end = lines.findIndex(l => l.trim() === ENV_END);
  if (start === -1 || end === -1 || end < start) return lines;
  const block = lines.slice(start + 1, end);
  const newBlock = block.filter(line => !line.startsWith(key + '='));
  return [
    ...lines.slice(0, start + 1),
    ...newBlock,
    ...lines.slice(end)
  ];
}

export function getEmailFolderPath(email: string) {
  const tempEmail = email.split("@")[0].replace(/[\\/*?:"<>|\s]/g, "_").replace(".", "_")
  const MCP_CONFIG_DIR = path.join(os.homedir(), '.eigent');
  const MCP_REMOTE_CONFIG_DIR = path.join(MCP_CONFIG_DIR, tempEmail);
  if (!fs.existsSync(MCP_REMOTE_CONFIG_DIR)) {
    fs.mkdirSync(MCP_REMOTE_CONFIG_DIR, { recursive: true });
  }
  const mcpRemoteDir = path.join(MCP_REMOTE_CONFIG_DIR, 'mcp-remote-0.1.22');
  let hasToken = false;
  try {
    const tokenFile = fs.readdirSync(mcpRemoteDir).find((file) => file.includes('token'));
    if (tokenFile) {
      console.log("tokenFile", tokenFile);
      hasToken = true;
    }else{
      hasToken = false;
    }
  } catch (error) {
    hasToken = false;
  }

  return { MCP_REMOTE_CONFIG_DIR, MCP_CONFIG_DIR, tempEmail, hasToken };
}

