---
name: skill-security-auditor
description: "Security auditing for code, configs, and infrastructure. Use when the user wants to audit or improve security: scan for vulnerabilities (SQL injection, XSS, command injection, path traversal), detect hardcoded secrets and credentials, review auth and authorization, check dependencies for known CVEs, audit config files for insecure defaults, or generate security reports. Trigger on \"security audit\", \"vulnerability scan\", \"code review for security\", \"find secrets\", \"check for vulnerabilities\", \"OWASP\", \"CVE\", or questions about code security."
license: Complete terms in LICENSE.txt
---

# Security Auditor Guide

## Overview

This guide covers security auditing workflows for source code, dependencies, and configurations. For detailed vulnerability patterns and detection rules, see references/vulnerability-patterns.md. For secrets detection patterns, see references/secrets-patterns.md.

## Quick Start

Run the bundled scan script against a project directory:

```bash
python scripts/scan_project.py /path/to/project
```

This performs a lightweight scan for common issues: hardcoded secrets, dangerous function calls, and insecure patterns. For deeper analysis, follow the workflows below.

### Testing the scripts

```bash
python scripts/scan_project.py /path/to/some/project --format text
python scripts/scan_secrets.py /path/to/some/project --format text
```

## Audit Workflow

### 1. Reconnaissance

Before auditing, understand the project:

```bash
# Identify languages, frameworks, and entry points
find . -type f -name "*.py" -o -name "*.js" -o -name "*.ts" -o -name "*.go" -o -name "*.java" | head -20
cat package.json pyproject.toml requirements.txt go.mod pom.xml 2>/dev/null
```

Key questions:
- What frameworks are used? (Express, Django, Flask, Spring, etc.)
- Where are the entry points? (routes, controllers, API handlers)
- How is authentication handled?
- What external services are called?
- Is user input accepted? Where?

### 2. Secrets Detection

Scan for hardcoded credentials, API keys, and tokens. See references/secrets-patterns.md for the full pattern list.

```bash
python scripts/scan_secrets.py /path/to/project
```

Common patterns to check:
- API keys and tokens in source files
- Database connection strings with embedded passwords
- Private keys or certificates committed to the repo
- `.env` files or config files with plaintext secrets
- Secrets in CI/CD configuration files

### 3. Vulnerability Scanning

#### OWASP Top 10 Checklist

| # | Category | What to Look For |
|---|----------|-----------------|
| A01 | Broken Access Control | Missing auth checks, IDOR, privilege escalation |
| A02 | Cryptographic Failures | Weak algorithms, plaintext storage, missing TLS |
| A03 | Injection | SQL, NoSQL, OS command, LDAP, XSS |
| A04 | Insecure Design | Missing rate limits, business logic flaws |
| A05 | Security Misconfiguration | Debug mode, default credentials, verbose errors |
| A06 | Vulnerable Components | Outdated dependencies with known CVEs |
| A07 | Auth Failures | Weak passwords, missing MFA, session issues |
| A08 | Data Integrity Failures | Insecure deserialization, unsigned updates |
| A09 | Logging Failures | Missing audit logs, sensitive data in logs |
| A10 | SSRF | Unvalidated URLs in server-side requests |

#### Language-Specific Checks

**Python**
```python
# Dangerous: SQL injection
cursor.execute(f"SELECT * FROM users WHERE id = {user_id}")
# Safe: Parameterized query
cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))

# Dangerous: Command injection
os.system(f"ping {hostname}")
# Safe: Use subprocess with list args
subprocess.run(["ping", hostname], capture_output=True)

# Dangerous: Path traversal
open(f"/data/{user_input}")
# Safe: Validate and resolve path
path = pathlib.Path("/data") / user_input
path.resolve().relative_to(pathlib.Path("/data").resolve())
```

**JavaScript/TypeScript**
```javascript
// Dangerous: XSS via innerHTML
element.innerHTML = userInput;
// Safe: Use textContent or sanitize
element.textContent = userInput;

// Dangerous: Prototype pollution
Object.assign(target, JSON.parse(userInput));
// Safe: Validate input structure
const parsed = JSON.parse(userInput);
if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
const sanitized = Object.fromEntries(
  Object.entries(parsed).filter(([k]) => !k.startsWith('__'))
);

// Dangerous: eval or Function constructor
eval(userInput);
// Safe: Never use eval with user input
```

**Go**
```go
// Dangerous: SQL injection
db.Query("SELECT * FROM users WHERE id = " + id)
// Safe: Parameterized query
db.Query("SELECT * FROM users WHERE id = $1", id)

// Dangerous: Path traversal
http.ServeFile(w, r, filepath.Join(baseDir, r.URL.Path))
// Safe: Clean and validate path
cleaned := filepath.Clean(r.URL.Path)
full := filepath.Join(baseDir, cleaned)
if !strings.HasPrefix(full, baseDir) { http.Error(...) }
```

### 4. Dependency Audit

Check for known vulnerabilities in project dependencies:

```bash
# Python
pip audit
safety check -r requirements.txt

# Node.js
npm audit
npx auditjs ossi

# Go
govulncheck ./...

# General (if Trivy is available)
trivy fs --scanners vuln /path/to/project
```

Review the output and categorize by severity (critical, high, medium, low). Critical and high severity findings should be addressed before deployment.

### 5. Configuration Review

Check for insecure defaults in configuration files:

```yaml
# Common misconfigurations to flag:
DEBUG: true                    # Debug mode in production
ALLOWED_HOSTS: ["*"]          # Unrestricted host access
CORS_ALLOW_ALL_ORIGINS: true  # Open CORS policy
SECRET_KEY: "default"         # Default or weak secret key
SSL_VERIFY: false             # Disabled TLS verification
```

Check infrastructure configs:
- Dockerfiles: Running as root, exposing unnecessary ports
- CI/CD: Secrets in plaintext, overly permissive permissions
- Cloud configs: Public S3 buckets, open security groups

### 6. Authentication and Authorization Review

Key areas to verify:
- Password hashing uses strong algorithms (bcrypt, argon2, scrypt)
- Sessions have appropriate timeouts and rotation
- JWT tokens are validated properly (algorithm, expiry, signature)
- API endpoints enforce authorization checks
- Role-based access control is consistently applied
- Rate limiting is in place for login and sensitive endpoints

## Report Format

When generating a security audit report, use this structure:

```markdown
# Security Audit Report

## Summary
- **Project**: [name]
- **Date**: [date]
- **Scope**: [what was audited]
- **Risk Level**: [Critical/High/Medium/Low]

## Findings

### [SEVERITY] Finding Title
- **Category**: [OWASP category]
- **Location**: [file:line]
- **Description**: [what the issue is]
- **Impact**: [what could happen if exploited]
- **Recommendation**: [how to fix]

## Statistics
- Total findings: [count]
- Critical: [count] | High: [count] | Medium: [count] | Low: [count]
```

## Next Steps

- For detailed vulnerability patterns and code examples, see references/vulnerability-patterns.md
- For secrets detection regex patterns, see references/secrets-patterns.md
