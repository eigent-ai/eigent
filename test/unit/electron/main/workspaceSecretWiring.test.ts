import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Workspace secret Electron wiring', () => {
  it('guards IPC with the main renderer and supplies only broker coordinates to Brain', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'electron/main/index.ts'),
      'utf8'
    );

    expect(source).toMatch(
      /registerWorkspaceSecretIpcHandlers\([\s\S]*?assertMainRendererSender[\s\S]*?\)/u
    );
    expect(source).toContain('EIGENT_WORKSPACE_SECRET_BROKER_ENDPOINT');
    expect(source).toContain('EIGENT_WORKSPACE_SECRET_BROKER_CAPABILITY');
    expect(source).not.toMatch(
      /EIGENT_WORKSPACE_SECRET_(?:VALUE|TOKEN|PLAINTEXT)/u
    );

    const terminalSource = fs.readFileSync(
      path.resolve(process.cwd(), 'electron/main/terminal.ts'),
      'utf8'
    );
    expect(terminalSource).toMatch(/PRIVATE_KEY\|CAPABILITY/u);
  });
});
