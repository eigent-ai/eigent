# Secrets Detection Patterns

Regex patterns and rules for detecting hardcoded secrets, credentials, and sensitive data in source code.

## Table of Contents

- [API Keys and Tokens](#api-keys-and-tokens)
- [Cloud Provider Credentials](#cloud-provider-credentials)
- [Database Connection Strings](#database-connection-strings)
- [Private Keys and Certificates](#private-keys-and-certificates)
- [Generic Patterns](#generic-patterns)
- [Files to Always Check](#files-to-always-check)
- [False Positive Reduction](#false-positive-reduction)

## API Keys and Tokens

| Service | Pattern | Example |
|---------|---------|---------|
| AWS Access Key | `AKIA[0-9A-Z]{16}` | AKIAIOSFODNN7EXAMPLE |
| AWS Secret Key | `(?i)aws_secret_access_key\s*=\s*\S{40}` | |
| GitHub Token | `gh[ps]_[A-Za-z0-9_]{36,}` | ghp_xxxxxxxxxxxx |
| GitHub Fine-grained | `github_pat_[A-Za-z0-9_]{22,}` | |
| GitLab Token | `glpat-[A-Za-z0-9\-]{20,}` | |
| Slack Token | `xox[baprs]-[A-Za-z0-9\-]{10,}` | |
| Slack Webhook | `https://hooks\.slack\.com/services/T[A-Z0-9]+/B[A-Z0-9]+/[A-Za-z0-9]+` | |
| Stripe Secret | `sk_live_[A-Za-z0-9]{24,}` | |
| Stripe Publishable | `pk_live_[A-Za-z0-9]{24,}` | |
| Twilio | `SK[0-9a-fA-F]{32}` | |
| SendGrid | `SG\.[A-Za-z0-9\-_]{22}\.[A-Za-z0-9\-_]{43}` | |
| Mailgun | `key-[0-9a-zA-Z]{32}` | |
| Google API Key | `AIza[0-9A-Za-z\-_]{35}` | |
| Google OAuth | `[0-9]+-[0-9A-Za-z_]{32}\.apps\.googleusercontent\.com` | |
| Heroku API Key | `[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}` | |
| npm Token | `npm_[A-Za-z0-9]{36}` | |
| PyPI Token | `pypi-[A-Za-z0-9\-_]{50,}` | |

## Cloud Provider Credentials

### AWS
```
# Access Key ID
AKIA[0-9A-Z]{16}

# Secret Access Key (in config context)
(?i)(aws_secret_access_key|aws_secret_key)\s*[=:]\s*[A-Za-z0-9/+=]{40}

# Session Token
(?i)aws_session_token\s*[=:]\s*\S+
```

### GCP
```
# Service account key file indicators
"type"\s*:\s*"service_account"
"private_key"\s*:\s*"-----BEGIN

# OAuth client secret
(?i)client_secret\s*[=:]\s*\S+
```

### Azure
```
# Storage account key
(?i)(AccountKey|account_key)\s*[=:]\s*[A-Za-z0-9+/=]{86,}

# Connection strings
(?i)(DefaultEndpointsProtocol|AccountName|AccountKey)=[^;\s]+
```

## Database Connection Strings

```
# Generic with embedded password
(?i)(mysql|postgres|postgresql|mongodb|redis|mssql|sqlserver)://[^:]+:[^@]+@

# Django DATABASE_URL
(?i)DATABASE_URL\s*=\s*\S+://\S+:\S+@

# JDBC with password
(?i)jdbc:[a-z]+://[^;]+password=[^;\s]+
```

## Private Keys and Certificates

```
# RSA private key
-----BEGIN RSA PRIVATE KEY-----

# Generic private key
-----BEGIN PRIVATE KEY-----

# EC private key
-----BEGIN EC PRIVATE KEY-----

# OpenSSH private key
-----BEGIN OPENSSH PRIVATE KEY-----

# PGP private key
-----BEGIN PGP PRIVATE KEY BLOCK-----

# Certificate (not a secret, but may indicate key nearby)
-----BEGIN CERTIFICATE-----
```

## Generic Patterns

These catch secrets not covered by service-specific patterns:

```
# Assignment patterns with secret-like variable names
(?i)(password|passwd|pwd|secret|token|api_key|apikey|api_secret|access_key|auth_token|credentials)\s*[=:]\s*['"][^'"]{8,}['"]

# Bearer tokens in code
(?i)bearer\s+[A-Za-z0-9\-._~+/]+=*

# Base64 encoded secrets (high entropy, 20+ chars)
(?i)(secret|key|token|password)\s*[=:]\s*['"][A-Za-z0-9+/]{20,}={0,2}['"]

# Hex-encoded secrets (32+ chars)
(?i)(secret|key|token)\s*[=:]\s*['"][0-9a-fA-F]{32,}['"]
```

## Files to Always Check

**High priority** (most likely to contain secrets):
```
.env, .env.*, .env.local, .env.production
config.json, config.yaml, config.yml, config.toml
settings.py, settings.json
application.properties, application.yml
docker-compose.yml, docker-compose.*.yml
.aws/credentials, .boto
.netrc, .npmrc, .pypirc
id_rsa, id_ecdsa, id_ed25519, *.pem, *.key
```

**Check .gitignore coverage**: Ensure these files are listed in `.gitignore`. If they are tracked by git, flag as a finding.

**Git history**: Secrets may have been committed and later removed. Check with:
```bash
git log --all --diff-filter=D -- "*.env" "*.pem" "*.key"
git log --all -p -S "AKIA" -- . # Search for AWS keys in history
```

## False Positive Reduction

Skip matches that are likely not real secrets:
- Values containing only placeholder text: `example`, `changeme`, `TODO`, `xxx`, `your_`, `placeholder`, `dummy`, `test`, `sample`
- Values from documentation or comments on the same line as `example`, `e.g.`, `doc`, `TODO`
- Values in test files matching `*_test.*`, `test_*.*`, `*.spec.*`, `**/test/**`, `**/tests/**`, `**/__tests__/**`
- Environment variable references: `${VAR}`, `$VAR`, `%VAR%`, `os.environ`, `process.env`
- Empty or whitespace-only values
