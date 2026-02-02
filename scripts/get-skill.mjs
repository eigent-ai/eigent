import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';

const skillName = process.argv[2] || 'pptx-skill';
const outputPath = process.argv[3] || 'pptx_skill_details.json';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['mcp/skills-loader/index.js'],
});

const client = new Client(
  { name: 'skills-client', version: '0.1.0' },
  { capabilities: {} }
);

await client.connect(transport);

const res = await client.callTool({
  name: 'get_skill',
  arguments: { name: skillName },
});

const jsonText = res?.content?.[0]?.text ?? '';
console.log(jsonText);
fs.writeFileSync(outputPath, jsonText, 'utf-8');

await client.close();
