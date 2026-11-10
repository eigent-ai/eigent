import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Brain device identity supply chain', () => {
  it('exports the main-process installation identity to the Brain process', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'electron/main/index.ts'),
      'utf-8'
    );

    expect(source).toContain(
      'EIGENT_DESKTOP_INSTANCE_ID: resolveDesktopInstanceId()'
    );
    expect(source).toContain('await primeDesktopInstanceIdFromRenderer()');
  });
});
