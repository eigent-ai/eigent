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

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Find the index of the first line that starts with the specified string
 */
function findLicenseStartLine(lines, startWith) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(startWith)) {
      return i;
    }
  }
  return null;
}

/**
 * Find the index of the last line that starts with the specified string
 */
function findLicenseEndLine(lines, startWith) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith(startWith)) {
      return i;
    }
  }
  return null;
}

/**
 * Update license header in a single file
 */
function updateLicenseInFile(
  filePath,
  licenseTemplate,
  startLineStartWith,
  endLineStartWith,
  commentMarker
) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const newLicense = licenseTemplate.trim();

  // Extract all comment lines from the beginning of the file
  const commentLines = [];
  const lines = content.split('\n');

  for (const line of lines) {
    if (line.trim().startsWith(commentMarker)) {
      commentLines.push(line);
    } else if (line.trim() === '') {
      // Allow empty lines in the header
      continue;
    } else {
      // Stop at first non-comment, non-empty line
      break;
    }
  }

  const startIndex = findLicenseStartLine(commentLines, startLineStartWith);
  const endIndex = findLicenseEndLine(commentLines, endLineStartWith);

  let hasChanges = false;

  if (startIndex !== null && endIndex !== null) {
    // License header exists, check if it needs updating
    const existingLicense = commentLines
      .slice(startIndex, endIndex + 1)
      .join('\n');

    if (existingLicense.trim() !== newLicense.trim()) {
      // Replace existing license
      const replacedContent = content.replace(existingLicense, newLicense);
      fs.writeFileSync(filePath, replacedContent, 'utf-8');
      console.log(`✓ Updated license in ${filePath}`);
      hasChanges = true;
    }
  } else {
    // No license header, add it to the beginning
    fs.writeFileSync(filePath, newLicense + '\n\n' + content, 'utf-8');
    console.log(`✓ Added license to ${filePath}`);
    hasChanges = true;
  }

  return hasChanges;
}

/**
 * Recursively update licenses in all files in a directory
 */
function updateLicenseInDirectory(
  directoryPath,
  licenseTemplate,
  startLineStartWith,
  endLineStartWith,
  commentMarker,
  extensions = ['.ts', '.tsx', '.d.ts']
) {
  let fileCount = 0;

  function processDirectory(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Skip hidden files and directories
      if (entry.name.startsWith('.')) {
        continue;
      }

      // Skip node_modules and other common directories
      if (entry.isDirectory()) {
        const skipDirs = [
          'node_modules',
          'dist',
          'build',
          'coverage',
          '.git',
          '__pycache__',
        ];
        if (skipDirs.includes(entry.name)) {
          continue;
        }
        processDirectory(fullPath);
      } else if (entry.isFile()) {
        // Check if file has one of the target extensions
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          if (
            updateLicenseInFile(
              fullPath,
              licenseTemplate,
              startLineStartWith,
              endLineStartWith,
              commentMarker
            )
          ) {
            fileCount++;
          }
        }
      }
    }
  }

  processDirectory(directoryPath);
  console.log(`\nLicense check complete: ${fileCount} file(s) updated`);

  // Exit with code 0 on success (files were properly updated)
  process.exit(0);
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: node update_license.js <file1> [file2] [file3] ...');
    console.error('\nProcesses individual files passed by lint-staged');
    process.exit(1);
  }

  // Process each file passed as argument (from lint-staged)
  let filesUpdated = 0;

  for (const filePath of args) {
    // Determine template and comment marker based on file extension
    const ext = path.extname(filePath);
    let licenseTemplatePath, commentMarker;

    if (['.ts', '.tsx', '.d.ts', '.js', '.jsx'].includes(ext)) {
      licenseTemplatePath = path.join(__dirname, 'license_template_ts.txt');
      commentMarker = '//';
    } else if (ext === '.py') {
      licenseTemplatePath = path.join(__dirname, 'license_template_py.txt');
      commentMarker = '#';
    } else {
      console.log(`⊘ Skipping ${filePath} (unsupported extension)`);
      continue;
    }

    // Check if license template exists
    if (!fs.existsSync(licenseTemplatePath)) {
      console.error(`Error: ${licenseTemplatePath} not found`);
      continue;
    }

    const licenseTemplate = fs.readFileSync(licenseTemplatePath, 'utf-8');
    const startLineStartWith = `${commentMarker} ========= Copyright`;
    const endLineStartWith = `${commentMarker} ========= Copyright`;

    if (
      updateLicenseInFile(
        filePath,
        licenseTemplate,
        startLineStartWith,
        endLineStartWith,
        commentMarker
      )
    ) {
      filesUpdated++;
    }
  }

  if (filesUpdated > 0) {
    console.log(`\n✔ License check complete: ${filesUpdated} file(s) updated`);
  }

  // Exit with success code
  process.exit(0);
}

main();
