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

/* global process, console, Buffer */

// Small file-system helpers for the macOS runtime pack spike.
//
//   node pack-tools.mjs list-macho <dir>       NUL-separated Mach-O file paths
//   node pack-tools.mjs list-macho-exec <dir>  ... only main executables (MH_EXECUTE)
//   node pack-tools.mjs list-macho-lib <dir>   ... everything else (dylibs, .so bundles)
//   node pack-tools.mjs list-bundles <dir>     NUL-separated .app/.framework dirs, deepest first
//   node pack-tools.mjs prune-symlinks <dir>   remove symlinks that are broken or leave <dir>
//   node pack-tools.mjs stats <dir>            JSON: files, symlinks, bytes, Mach-O count
//
// Mach-O detection reads the first 8 bytes instead of shelling out to `file`,
// which is slow on ~50,000 files.

import fs from 'node:fs';
import path from 'node:path';

const MACHO_MAGICS = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe]);
const FAT_MAGICS = new Set([0xcafebabe, 0xcafebabf]);

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      yield { full, kind: 'symlink' };
    } else if (entry.isDirectory()) {
      yield { full, kind: 'dir' };
      yield* walk(full);
    } else if (entry.isFile()) {
      yield { full, kind: 'file' };
    }
  }
}

function isMachO(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(8);
    const n = fs.readSync(fd, buf, 0, 8, 0);
    if (n < 8) return false;
    const magic = buf.readUInt32BE(0);
    if (MACHO_MAGICS.has(magic)) return true;
    // 0xcafebabe is also the Java class-file magic. A fat Mach-O stores a small
    // architecture count next; a class file stores its version (>= 45).
    if (FAT_MAGICS.has(magic)) return buf.readUInt32BE(4) < 45;
    return false;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const MH_EXECUTE = 2;

// Mach-O file type (MH_EXECUTE, MH_DYLIB, MH_BUNDLE, ...) of a thin file or of
// the first slice of a universal file.
function machOFileType(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(32);
    fs.readSync(fd, head, 0, 32, 0);
    let offset = 0;
    let magic = head.readUInt32BE(0);
    if (FAT_MAGICS.has(magic)) {
      // fat_arch: cputype, cpusubtype, offset, ... (fat_arch_64 uses a 64-bit offset)
      offset =
        magic === 0xcafebabf
          ? Number(head.readBigUInt64BE(16))
          : head.readUInt32BE(16);
      fs.readSync(fd, head, 0, 32, offset);
      magic = head.readUInt32BE(0);
    }
    const littleEndian = magic === 0xcefaedfe || magic === 0xcffaedfe;
    return littleEndian ? head.readUInt32LE(12) : head.readUInt32BE(12);
  } finally {
    fs.closeSync(fd);
  }
}

function writeNul(paths) {
  for (const p of paths) process.stdout.write(`${p}\0`);
}

function listMachO(root) {
  const out = [];
  for (const { full, kind } of walk(root)) {
    if (kind === 'file' && isMachO(full)) out.push(full);
  }
  return out;
}

function listBundles(root) {
  const out = [];
  for (const { full, kind } of walk(root)) {
    if (kind === 'dir' && /\.(app|framework)$/.test(full)) out.push(full);
  }
  // Sign nested bundles before the bundles that contain them.
  return out.sort(
    (a, b) => b.split(path.sep).length - a.split(path.sep).length
  );
}

function pruneSymlinks(root) {
  const realRoot = fs.realpathSync(root);
  let removed = 0;
  for (const { full, kind } of walk(root)) {
    if (kind !== 'symlink') continue;
    let keep = false;
    try {
      const target = fs.realpathSync(full);
      keep = target === realRoot || target.startsWith(realRoot + path.sep);
    } catch {
      keep = false;
    }
    if (!keep) {
      console.error(
        `removing symlink outside pack: ${path.relative(root, full)} -> ${fs.readlinkSync(full)}`
      );
      fs.unlinkSync(full);
      removed += 1;
    }
  }
  console.error(`pruned ${removed} symlink(s)`);
}

function stats(root) {
  const result = {
    files: 0,
    symlinks: 0,
    dirs: 0,
    bytes: 0,
    macho: 0,
    macho_bytes: 0,
  };
  for (const { full, kind } of walk(root)) {
    if (kind === 'symlink') result.symlinks += 1;
    else if (kind === 'dir') result.dirs += 1;
    else {
      const size = fs.statSync(full).size;
      result.files += 1;
      result.bytes += size;
      if (isMachO(full)) {
        result.macho += 1;
        result.macho_bytes += size;
      }
    }
  }
  return result;
}

const [command, dir] = process.argv.slice(2);
if (!command || !dir || !fs.existsSync(dir)) {
  console.error(
    'usage: pack-tools.mjs <list-macho|list-macho-exec|list-macho-lib|list-bundles|prune-symlinks|stats> <dir>'
  );
  process.exit(2);
}

switch (command) {
  case 'list-macho':
    writeNul(listMachO(dir));
    break;
  case 'list-macho-exec':
    writeNul(listMachO(dir).filter((f) => machOFileType(f) === MH_EXECUTE));
    break;
  case 'list-macho-lib':
    writeNul(listMachO(dir).filter((f) => machOFileType(f) !== MH_EXECUTE));
    break;
  case 'list-bundles':
    writeNul(listBundles(dir));
    break;
  case 'prune-symlinks':
    pruneSymlinks(dir);
    break;
  case 'stats':
    console.log(JSON.stringify(stats(dir)));
    break;
  default:
    console.error(`unknown command: ${command}`);
    process.exit(2);
}
