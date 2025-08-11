import fs from 'fs';
import path from 'path';
import os from 'os';

const MCP_CONFIG_DIR = path.join(os.homedir(), '.eigent');
const MCP_CONFIG_PATH = path.join(MCP_CONFIG_DIR, 'mcp.json');

type McpServerConfig = {
  command: string;
  args: string[];
  env?: Record<string, string>;
} | {
  url: string;
};

type McpServersConfig = {
  [name: string]: McpServerConfig;
};

type ConfigFile = {
  mcpServers: McpServersConfig;
};

export function getMcpConfigPath() {
  return MCP_CONFIG_PATH;
}

function getDefaultConfig(): ConfigFile {
  return { mcpServers: {} };
}

export function readMcpConfig(): ConfigFile {
  try {
    if (!fs.existsSync(MCP_CONFIG_PATH)) {
      // init config file
      writeMcpConfig(getDefaultConfig());
      return getDefaultConfig();
    }
    const data = fs.readFileSync(MCP_CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(data);
    // compatible with old format
    if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
      return getDefaultConfig();
    }
    return parsed;
  } catch (e) {
    return getDefaultConfig();
  }
}

export function writeMcpConfig(config: ConfigFile): void {
  if (!fs.existsSync(MCP_CONFIG_DIR)) {
    fs.mkdirSync(MCP_CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export function addMcp(name: string, mcp: McpServerConfig): void {
  const config = readMcpConfig();
  if (!config.mcpServers[name]) {
    config.mcpServers[name] = mcp;
    writeMcpConfig(config);
  }
}

export function removeMcp(name: string): void {
  const config = readMcpConfig();
  console.log('removeMcp', name)
  if (config.mcpServers[name]) {
    delete config.mcpServers[name];
    writeMcpConfig(config);
  }
}

export function updateMcp(name: string, mcp: McpServerConfig): void {
  const config = readMcpConfig();
  config.mcpServers[name] = mcp;
  writeMcpConfig(config);
} 