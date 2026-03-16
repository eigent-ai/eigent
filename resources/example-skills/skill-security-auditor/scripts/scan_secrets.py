#!/usr/bin/env python3
# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

"""Scan a project directory for hardcoded secrets and credentials.

Usage:
    python scan_secrets.py /path/to/project [--format json|text] [--include-tests]

Focused scanner for secrets, API keys, tokens, and credentials.
Uses pattern matching with false-positive reduction.
"""

import argparse
import json
import re
import sys
from pathlib import Path

PATTERNS = [
    # Cloud provider keys
    ("AWS Access Key ID", r"AKIA[0-9A-Z]{16}"),
    ("AWS Secret Key", r"(?i)(aws_secret_access_key|aws_secret_key)\s*[=:]\s*['\"]?[A-Za-z0-9/+=]{40}"),
    ("GCP Service Account", r'"type"\s*:\s*"service_account"'),
    ("Azure Storage Key", r"(?i)(AccountKey|account_key)\s*[=:]\s*[A-Za-z0-9+/=]{86,}"),

    # VCS and CI tokens
    ("GitHub Token", r"gh[ps]_[A-Za-z0-9_]{36,}"),
    ("GitHub Fine-grained PAT", r"github_pat_[A-Za-z0-9_]{22,}"),
    ("GitLab Token", r"glpat-[A-Za-z0-9\-]{20,}"),
    ("npm Token", r"npm_[A-Za-z0-9]{36}"),
    ("PyPI Token", r"pypi-[A-Za-z0-9\-_]{50,}"),

    # SaaS tokens
    ("Slack Token", r"xox[baprs]-[A-Za-z0-9\-]{10,}"),
    ("Slack Webhook", r"https://hooks\.slack\.com/services/T[A-Z0-9]+/B[A-Z0-9]+/[A-Za-z0-9]+"),
    ("Stripe Secret Key", r"sk_live_[A-Za-z0-9]{24,}"),
    ("Stripe Publishable Key", r"pk_live_[A-Za-z0-9]{24,}"),
    ("Twilio API Key", r"SK[0-9a-fA-F]{32}"),
    ("SendGrid API Key", r"SG\.[A-Za-z0-9\-_]{22}\.[A-Za-z0-9\-_]{43}"),
    ("Mailgun API Key", r"key-[0-9a-zA-Z]{32}"),
    ("Google API Key", r"AIza[0-9A-Za-z\-_]{35}"),

    # Private keys
    ("RSA Private Key", r"-----BEGIN RSA PRIVATE KEY-----"),
    ("Generic Private Key", r"-----BEGIN PRIVATE KEY-----"),
    ("EC Private Key", r"-----BEGIN EC PRIVATE KEY-----"),
    ("OpenSSH Private Key", r"-----BEGIN OPENSSH PRIVATE KEY-----"),
    ("PGP Private Key", r"-----BEGIN PGP PRIVATE KEY BLOCK-----"),

    # Database connection strings
    ("Database URL with Password", r"(?i)(mysql|postgres|postgresql|mongodb|redis|mssql)://[^:]+:[^@\s]+@"),

    # Generic secret assignments
    ("Hardcoded Password", r'(?i)(password|passwd|pwd)\s*[=:]\s*["\'][^"\']{8,}["\']'),
    ("Hardcoded Secret", r'(?i)(secret_key|api_secret|auth_token|access_token)\s*[=:]\s*["\'][^"\']{8,}["\']'),
    ("Hardcoded API Key", r'(?i)(api_key|apikey)\s*[=:]\s*["\'][^"\']{8,}["\']'),
]

FALSE_POSITIVE_INDICATORS = [
    "example", "changeme", "placeholder", "your_", "xxx",
    "dummy", "sample", "todo", "fixme", "replace_",
    "INSERT_", "<your", "${", "$(",  "os.environ",
    "process.env", "getenv", "config.get",
]

SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv",
    "dist", "build", "vendor", ".bundle",
    ".tox", ".mypy_cache", ".pytest_cache",
}

TEST_DIRS = {"test", "tests", "__tests__", "spec", "specs"}

TEST_FILE_PATTERNS = [
    r"_test\.\w+$",
    r"test_\w+\.\w+$",
    r"\.spec\.\w+$",
    r"\.test\.\w+$",
]

SKIP_EXTENSIONS = {
    ".pyc", ".pyo", ".so", ".dylib", ".dll", ".exe",
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg",
    ".woff", ".woff2", ".ttf", ".eot",
    ".zip", ".tar", ".gz", ".jar",
    ".mp3", ".mp4", ".pdf",
}

MAX_FILE_SIZE = 1_000_000


def should_skip(path: Path, root: Path) -> bool:
    """Return True if path should be skipped (e.g. .git, node_modules)."""
    return any(part in SKIP_DIRS for part in path.relative_to(root).parts)


def is_test_file(filepath: Path) -> bool:
    """Return True if filepath is under a test directory or matches test patterns."""
    parts = set(filepath.parts)
    if parts & TEST_DIRS:
        return True
    name = filepath.name
    return any(re.search(pat, name) for pat in TEST_FILE_PATTERNS)


def is_false_positive(line: str) -> bool:
    """Return True if line looks like a placeholder or env reference, not a secret."""
    lower = line.lower()
    return any(indicator in lower for indicator in FALSE_POSITIVE_INDICATORS)


def scan_file(filepath: Path, root: Path, include_tests: bool = False) -> list:
    """Scan a single file for hardcoded secrets.

    Args:
        filepath: Path to the file to scan.
        root: Project root directory for relative path calculation.
        include_tests: If False, skip files in test dirs or matching test patterns.

    Returns:
        List of finding dicts with type, file, line, snippet.
    """

    findings = []
    if filepath.suffix.lower() in SKIP_EXTENSIONS:
        return findings
    if should_skip(filepath, root):
        return findings
    if not include_tests and is_test_file(filepath):
        return findings

    try:
        if filepath.stat().st_size > MAX_FILE_SIZE:
            return findings
        content = filepath.read_text(encoding="utf-8", errors="ignore")
    except (OSError, UnicodeDecodeError):
        return findings

    lines = content.splitlines()
    for line_num, line in enumerate(lines, 1):
        if is_false_positive(line):
            continue

        for label, pattern in PATTERNS:
            if re.search(pattern, line):
                findings.append({
                    "type": label,
                    "file": str(filepath),
                    "line": line_num,
                    "snippet": line.strip()[:120],
                })

    return findings


def scan_project(project_dir, include_tests: bool = False) -> tuple:
    """Scan a project directory for hardcoded secrets.

    Args:
        project_dir: Path or path string to the project root.
        include_tests: If True, include test files in the scan.

    Returns:
        Tuple of (list of findings, number of files scanned).
    """
    root = Path(project_dir).resolve()
    if not root.is_dir():
        print(f"Error: {project_dir} is not a directory", file=sys.stderr)
        sys.exit(1)

    all_findings = []
    scanned = 0

    for filepath in root.rglob("*"):
        if not filepath.is_file():
            continue
        results = scan_file(filepath, root, include_tests)
        all_findings.extend(results)
        scanned += 1

    return all_findings, scanned


def format_text(findings, scanned):
    type_counts = {}
    for f in findings:
        type_counts[f["type"]] = type_counts.get(f["type"], 0) + 1

    lines = [
        f"Scanned {scanned} files, found {len(findings)} potential secret(s)",
        "",
    ]

    if type_counts:
        lines.append("By type:")
        for t, c in sorted(type_counts.items(), key=lambda x: -x[1]):
            lines.append(f"  {t}: {c}")
        lines.append("")

    for f in findings:
        lines.append(f"[{f['type']}] {f['file']}:{f['line']}")
        lines.append(f"  {f['snippet']}")
        lines.append("")

    return "\n".join(lines)


def format_json(findings, scanned):
    type_counts = {}
    for f in findings:
        type_counts[f["type"]] = type_counts.get(f["type"], 0) + 1

    return json.dumps({
        "scanned_files": scanned,
        "total_findings": len(findings),
        "by_type": type_counts,
        "findings": findings,
    }, indent=2)


def main():
    parser = argparse.ArgumentParser(description="Scan for hardcoded secrets")
    parser.add_argument("path", help="Project directory to scan")
    parser.add_argument("--format", choices=["text", "json"], default="text", help="Output format")
    parser.add_argument("--include-tests", action="store_true", help="Include test files in scan")
    args = parser.parse_args()

    findings, scanned = scan_project(args.path, args.include_tests)

    if args.format == "json":
        print(format_json(findings, scanned))
    else:
        print(format_text(findings, scanned))

    sys.exit(1 if findings else 0)


if __name__ == "__main__":
    main()
