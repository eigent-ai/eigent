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
  endLineStartWith
) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const newLicense = licenseTemplate.trim();

  // Extract all comment lines from the beginning of the file
  const commentLines = [];
  const lines = content.split('\n');

  for (const line of lines) {
    if (line.trim().startsWith('//')) {
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
 * Recursively update licenses in all TypeScript files in a directory
 */
function updateLicenseInDirectory(
  directoryPath,
  licenseTemplate,
  startLineStartWith,
  endLineStartWith,
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
              endLineStartWith
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

  // Exit with code 1 if any files were modified (for pre-commit hook to catch)
  if (fileCount > 0) {
    process.exit(1);
  }
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error(
      'Usage: node update_license_ts.js <directory_path> <license_template_path>'
    );
    process.exit(1);
  }

  const [directoryPath, licenseTemplatePath] = args;

  // Check if directory exists
  if (
    !fs.existsSync(directoryPath) ||
    !fs.statSync(directoryPath).isDirectory()
  ) {
    console.error(`Error: ${directoryPath} is not a valid directory`);
    process.exit(1);
  }

  // Check if license template exists
  if (
    !fs.existsSync(licenseTemplatePath) ||
    !fs.statSync(licenseTemplatePath).isFile()
  ) {
    console.error(`Error: ${licenseTemplatePath} not found`);
    process.exit(1);
  }

  const licenseTemplate = fs.readFileSync(licenseTemplatePath, 'utf-8');
  const startLineStartWith = '// ========= Copyright';
  const endLineStartWith = '// ========= Copyright';

  updateLicenseInDirectory(
    directoryPath,
    licenseTemplate,
    startLineStartWith,
    endLineStartWith
  );
}

main();
