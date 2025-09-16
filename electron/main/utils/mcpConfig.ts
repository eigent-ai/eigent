import fs from 'fs';
import path from 'path';
import os from 'os';

const MCP_CONFIG_DIR = path.join(os.homedir(), '.eigent');
const MCP_CONFIG_PATH = path.join(MCP_CONFIG_DIR, 'mcp.json');

type McpServerConfig = {
  command: string;
  args: string[];
  description?: string;
  env?: Record<string, string>;
} | {
  url: string;
};

type McpServersConfig = {
  [name: string]: McpServerConfig;
};

export type ConfigFile = {
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
    
    // Normalize args field - ensure it's always an array
    Object.keys(parsed.mcpServers).forEach(serverName => {
      const server = parsed.mcpServers[serverName];
      if (server.args) {
        const args = server.args as any;
        if (typeof args === 'string') {
          try {
            // Try to parse as JSON string first
            server.args = JSON.parse(args);
          } catch (e) {
            // If parsing fails, split by comma as fallback
            server.args = args.split(',').map((arg: string) => arg.trim()).filter((arg: string) => arg !== '');
          }
        }
        // Ensure it's always an array of strings
        if (Array.isArray(server.args)) {
          server.args = server.args.map((arg: any) => String(arg));
        }
      }
    });
    
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
    // Ensure args is an array before adding
    const normalizedMcp = { ...mcp };
    if ('args' in normalizedMcp && normalizedMcp.args) {
      const args = normalizedMcp.args as any;
      if (typeof args === 'string') {
        try {
          normalizedMcp.args = JSON.parse(args);
        } catch (e) {
          normalizedMcp.args = args.split(',').map((arg: string) => arg.trim()).filter((arg: string) => arg !== '');
        }
      }
      if (Array.isArray(normalizedMcp.args)) {
        normalizedMcp.args = normalizedMcp.args.map((arg: any) => String(arg));
      }
    }
    config.mcpServers[name] = normalizedMcp;
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
  // Ensure args is an array before updating
  const normalizedMcp = { ...mcp };
  if ('args' in normalizedMcp && normalizedMcp.args) {
    const args = normalizedMcp.args as any;
    if (typeof args === 'string') {
      try {
        normalizedMcp.args = JSON.parse(args);
      } catch (e) {
        normalizedMcp.args = args.split(',').map((arg: string) => arg.trim()).filter((arg: string) => arg !== '');
      }
    }
    if (Array.isArray(normalizedMcp.args)) {
      normalizedMcp.args = normalizedMcp.args.map((arg: any) => String(arg));
    }
  }
  config.mcpServers[name] = normalizedMcp;
  writeMcpConfig(config);
} 