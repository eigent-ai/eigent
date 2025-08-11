export interface MCPUserItem {
  mcp_id: number;
  mcp_name: string;
  mcp_key: string;
  mcp_desc: string;
  status: number;
  command?: string;
  args?: string;
  env?: Record<string, string>;
  type?: number;
  server_url?: string | null;
  id: number;
}

export interface MCPConfigForm {
  mcp_name: string;
  mcp_desc: string;
  command: string;
  argsArr: string[];
  env: Record<string, string>;
} 