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

"""Scan a project directory for common security issues.

Usage:
    python scan_project.py /path/to/project [--format json|text]

Checks for:
- Hardcoded secrets and credentials
- Dangerous function calls (eval, exec, os.system, etc.)
- Insecure configuration patterns
- Missing security files (.gitignore, etc.)
"""

import argparse
import json
import re
import sys
from pathlib import Path

DANGEROUS_FUNCTIONS = {
    ".py": [
        (r"\beval\s*\(", "eval() can execute arbitrary code"),
        (r"\bexec\s*\(", "exec() can execute arbitrary code"),
        (r"\bos\.system\s*\(", "os.system() is vulnerable to command injection"),
        (r"\bos\.popen\s*\(", "os.popen() is vulnerable to command injection"),
        (
            r"subprocess\.\w+\(.*shell\s*=\s*True",
            "subprocess with shell=True is vulnerable to command injection",
        ),
        (r"\bpickle\.loads?\s*\(", "pickle.load() can execute arbitrary code during deserialization"),
        (r"\byaml\.load\s*\([^)]*\)", "yaml.load() without SafeLoader can execute arbitrary code"),
        (r'\.execute\s*\(\s*f["\']', "f-string in SQL execute() is vulnerable to SQL injection"),
        (r"\.execute\s*\([^)]*%", "string formatting in SQL execute() is vulnerable to SQL injection"),
        (r"\bmarkupsafe\.Markup\s*\(\s*f", "Markup() with f-string is vulnerable to XSS"),
    ],
    ".js": [
        (r"\beval\s*\(", "eval() can execute arbitrary code"),
        (r"\bnew\s+Function\s*\(", "Function constructor can execute arbitrary code"),
        (r"\.innerHTML\s*=", "innerHTML assignment is vulnerable to XSS"),
        (r"\bdocument\.write\s*\(", "document.write() is vulnerable to XSS"),
        (r"child_process\.exec\s*\(", "child_process.exec() is vulnerable to command injection"),
    ],
    ".ts": [
        (r"\beval\s*\(", "eval() can execute arbitrary code"),
        (r"\bnew\s+Function\s*\(", "Function constructor can execute arbitrary code"),
        (r"\.innerHTML\s*=", "innerHTML assignment is vulnerable to XSS"),
        (r"dangerouslySetInnerHTML", "dangerouslySetInnerHTML is vulnerable to XSS"),
    ],
    ".go": [
        (r'exec\.Command\s*\(\s*"sh"', "Shell execution is vulnerable to command injection"),
        (r'db\.Query\s*\([^)]*\+', "String concatenation in SQL query is vulnerable to injection"),
        (r'fmt\.Sprintf\s*\("SELECT', "String formatting in SQL query is vulnerable to injection"),
    ],
    ".java": [
        (r"Runtime\.getRuntime\(\)\.exec\s*\(", "Runtime.exec() is vulnerable to command injection"),
        (r"ObjectInputStream.*readObject", "Deserialization can execute arbitrary code"),
        (r'Statement.*execute\s*\([^)]*\+', "String concatenation in SQL is vulnerable to injection"),
        (r"parseExpression\s*\(.*\)\.getValue", "SpEL expression evaluation can execute arbitrary code"),
    ],
}

SECRET_PATTERNS = [
    (r"AKIA[0-9A-Z]{16}", "AWS Access Key ID"),
    (r"gh[ps]_[A-Za-z0-9_]{36,}", "GitHub Token"),
    (r"glpat-[A-Za-z0-9\-]{20,}", "GitLab Token"),
    (r"xox[baprs]-[A-Za-z0-9\-]{10,}", "Slack Token"),
    (r"sk_live_[A-Za-z0-9]{24,}", "Stripe Secret Key"),
    (r"SG\.[A-Za-z0-9\-_]{22}\.[A-Za-z0-9\-_]{43}", "SendGrid API Key"),
    (r"AIza[0-9A-Za-z\-_]{35}", "Google API Key"),
    (r"npm_[A-Za-z0-9]{36}", "npm Token"),
    (r"pypi-[A-Za-z0-9\-_]{50,}", "PyPI Token"),
    (r"-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----", "Private Key"),
]

CONFIG_ISSUES = [
    (r"DEBUG\s*[=:]\s*[Tt]rue", "Debug mode enabled"),
    (r"ALLOWED_HOSTS\s*=\s*\[\s*['\"]?\*['\"]?\s*\]", "Unrestricted ALLOWED_HOSTS"),
    (r"CORS_ALLOW_ALL_ORIGINS\s*=\s*True", "CORS allows all origins"),
    (r"SSL_VERIFY\s*[=:]\s*[Ff]alse", "TLS verification disabled"),
    (r"verify\s*=\s*False", "TLS verification disabled"),
    (r"NODE_TLS_REJECT_UNAUTHORIZED\s*[=:]\s*['\"]?0", "TLS verification disabled"),
]

SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv",
    ".env", "dist", "build", ".tox", ".mypy_cache",
    ".pytest_cache", "vendor", ".bundle",
}

SKIP_EXTENSIONS = {
    ".pyc", ".pyo", ".so", ".dylib", ".dll", ".exe",
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg",
    ".woff", ".woff2", ".ttf", ".eot", ".mp3", ".mp4",
    ".zip", ".tar", ".gz", ".jar", ".war",
}

MAX_FILE_SIZE = 1_000_000  # 1 MB


def should_skip(path: Path, root: Path) -> bool:
    """Return True if path should be skipped (e.g. .git, node_modules)."""
    return any(part in SKIP_DIRS for part in path.relative_to(root).parts)


def scan_file(filepath: Path) -> list:
    """Scan a single file for secrets, dangerous calls, and config issues.

    Args:
        filepath: Path to the file to scan.

    Returns:
        List of finding dicts with type, severity, file, line, rule, snippet.
    """
    findings = []
    extension = filepath.suffix.lower()

    if extension in SKIP_EXTENSIONS:
        return findings

    try:
        if filepath.stat().st_size > MAX_FILE_SIZE:
            return findings
        content = filepath.read_text(encoding="utf-8", errors="ignore")
    except (OSError, UnicodeDecodeError):
        return findings

    lines = content.splitlines()

    # Check for secrets
    for line_num, line in enumerate(lines, 1):
        for pattern, label in SECRET_PATTERNS:
            if re.search(pattern, line):
                findings.append({
                    "type": "secret",
                    "severity": "critical",
                    "file": str(filepath),
                    "line": line_num,
                    "rule": label,
                    "snippet": line.strip()[:120],
                })

    # Check for dangerous functions
    patterns = DANGEROUS_FUNCTIONS.get(extension, [])
    for line_num, line in enumerate(lines, 1):
        stripped = line.lstrip()
        if stripped.startswith("#") or stripped.startswith("//"):
            continue
        for pattern, desc in patterns:
            if re.search(pattern, line):
                findings.append({
                    "type": "vulnerability",
                    "severity": "high",
                    "file": str(filepath),
                    "line": line_num,
                    "rule": desc,
                    "snippet": line.strip()[:120],
                })

    # Check for config issues
    for line_num, line in enumerate(lines, 1):
        for pattern, desc in CONFIG_ISSUES:
            if re.search(pattern, line):
                findings.append({
                    "type": "config",
                    "severity": "medium",
                    "file": str(filepath),
                    "line": line_num,
                    "rule": desc,
                    "snippet": line.strip()[:120],
                })

    return findings


def check_project_structure(project_dir: Path) -> list:
    """Check project root for .gitignore and sensitive files.

    Args:
        project_dir: Path to the project root.

    Returns:
        List of finding dicts for missing .gitignore or sensitive files.
    """
    findings = []
    gitignore = project_dir / ".gitignore"

    if not gitignore.exists():
        findings.append({
            "type": "config",
            "severity": "medium",
            "file": str(project_dir),
            "line": 0,
            "rule": "Missing .gitignore file",
            "snippet": "",
        })
    else:
        content = gitignore.read_text(encoding="utf-8", errors="ignore")
        for sensitive in [".env", "*.pem", "*.key"]:
            if sensitive not in content:
                findings.append({
                    "type": "config",
                    "severity": "medium",
                    "file": str(gitignore),
                    "line": 0,
                    "rule": f".gitignore missing pattern: {sensitive}",
                    "snippet": "",
                })

    # Check for sensitive files that should not be committed
    sensitive_files = [".env", ".env.local", ".env.production"]
    for name in sensitive_files:
        target = project_dir / name
        if target.exists():
            findings.append({
                "type": "secret",
                "severity": "high",
                "file": str(target),
                "line": 0,
                "rule": f"Sensitive file present: {name}",
                "snippet": "",
            })

    return findings


def scan_project(project_dir) -> tuple:
    """Scan a project directory for security issues.

    Args:
        project_dir: Path or path string to the project root.

    Returns:
        Tuple of (list of findings, number of files scanned).
    """
    root = Path(project_dir).resolve()
    if not root.is_dir():
        print(f"Error: {project_dir} is not a directory", file=sys.stderr)
        sys.exit(1)

    all_findings = check_project_structure(root)
    scanned = 0

    for filepath in root.rglob("*"):
        if not filepath.is_file():
            continue
        if should_skip(filepath, root):
            continue
        all_findings.extend(scan_file(filepath))
        scanned += 1

    return all_findings, scanned


def format_text(findings, scanned):
    severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    findings.sort(key=lambda f: severity_order.get(f["severity"], 99))

    counts = {}
    for f in findings:
        counts[f["severity"]] = counts.get(f["severity"], 0) + 1

    lines = [
        f"Scanned {scanned} files, found {len(findings)} issue(s)",
        f"  Critical: {counts.get('critical', 0)}",
        f"  High: {counts.get('high', 0)}",
        f"  Medium: {counts.get('medium', 0)}",
        f"  Low: {counts.get('low', 0)}",
        "",
    ]

    for f in findings:
        loc = f"{f['file']}:{f['line']}" if f["line"] else f["file"]
        lines.append(f"[{f['severity'].upper()}] {f['rule']}")
        lines.append(f"  Location: {loc}")
        if f["snippet"]:
            lines.append(f"  Code: {f['snippet']}")
        lines.append("")

    return "\n".join(lines)


def format_json(findings, scanned):
    counts = {}
    for f in findings:
        counts[f["severity"]] = counts.get(f["severity"], 0) + 1

    return json.dumps({
        "scanned_files": scanned,
        "total_findings": len(findings),
        "summary": counts,
        "findings": findings,
    }, indent=2)


def main():
    parser = argparse.ArgumentParser(description="Scan a project for security issues")
    parser.add_argument("path", help="Project directory to scan")
    parser.add_argument("--format", choices=["text", "json"], default="text", help="Output format")
    args = parser.parse_args()

    findings, scanned = scan_project(args.path)

    if args.format == "json":
        print(format_json(findings, scanned))
    else:
        print(format_text(findings, scanned))

    sys.exit(1 if findings else 0)


if __name__ == "__main__":
    main()
