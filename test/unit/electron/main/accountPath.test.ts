// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import { describe, expect, it } from 'vitest';

import {
  accountDirName,
  assertUsableAccountDirName,
  legacyAccountDirName,
} from '../../../../electron/main/utils/accountPath';

describe('accountDirName', () => {
  /**
   * The reported defect: the previous derivation threw the domain away, so
   * three different accounts shared one directory — and therefore one `.env`
   * file holding all three sets of API keys.
   */
  it('keeps accounts apart when only the domain differs', () => {
    const personal = accountDirName('alice@personal.com');
    const work = accountDirName('alice@work.com');
    const corp = accountDirName('alice@corp.internal');

    expect(new Set([personal, work, corp]).size).toBe(3);
  });

  it('does not reproduce the legacy collisions', () => {
    const accounts = [
      'alice@personal.com',
      'alice@work.com',
      'alice@corp.internal',
    ];
    const legacy = new Set(accounts.map(legacyAccountDirName));
    expect(legacy.size).toBe(1); // the bug being fixed

    const current = new Set(accounts.map(accountDirName));
    expect(current.size).toBe(3);
  });

  it('keeps apart addresses that differ only by an unsafe character', () => {
    // Sanitisation is lossy: a space and an underscore both become `_`, so
    // these two produce identical readable text. Only the digest of the
    // untouched address keeps them apart, and that is what stops one account
    // from reading another's credentials.
    const spaced = accountDirName('a b@x.com');
    const underscored = accountDirName('a_b@x.com');
    expect(spaced).not.toBe(underscored);
    expect(spaced.split('~')[0]).toBe(underscored.split('~')[0]);
  });

  it('is deterministic', () => {
    expect(accountDirName('john.doe@example.com')).toBe(
      accountDirName('john.doe@example.com')
    );
  });

  it('stays readable', () => {
    // The issue also complained that the generated path could not be traced
    // back to the address.
    expect(accountDirName('john.doe@example.com')).toContain(
      'john.doe@example.com'
    );
  });

  it('keeps dots, which are valid and expected on POSIX', () => {
    expect(accountDirName('juan.perez.garcia@mail.com')).toContain(
      'juan.perez.garcia@mail.com'
    );
  });

  it('replaces characters that are unsafe on Windows', () => {
    const name = accountDirName('a\\b/c:d*e?f"g<h>i|j@x.com');
    expect(name).not.toMatch(/[\\/<>:"|?*]/);
  });

  it('never produces an empty name', () => {
    // The legacy derivation returned '' here, which made the account directory
    // ~/.eigent itself — shared by every malformed address.
    expect(accountDirName('')).not.toBe('');
    expect(accountDirName('@')).not.toBe('');
  });

  it('cannot escape its parent directory', () => {
    expect(accountDirName('../../etc')).not.toMatch(/^\.+/);
    expect(accountDirName('..')).not.toBe('..');
  });

  it('stays within the filesystem component limit', () => {
    const name = accountDirName(`${'a'.repeat(400)}@example.com`);
    expect(name.length).toBeLessThanOrEqual(255);
  });
});

describe('assertUsableAccountDirName', () => {
  it('accepts a derived name', () => {
    expect(() =>
      assertUsableAccountDirName(accountDirName('user@example.com'))
    ).not.toThrow();
  });

  it('rejects an empty name', () => {
    expect(() => assertUsableAccountDirName('')).toThrow(/empty/i);
  });

  it('rejects traversal', () => {
    expect(() => assertUsableAccountDirName('..')).toThrow(/Refusing/);
    expect(() => assertUsableAccountDirName('../evil')).toThrow(/Refusing/);
  });
});
