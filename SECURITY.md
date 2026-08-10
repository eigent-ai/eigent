# Security Policy

## Supported Versions

The following versions of Eigent are currently being supported with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 0.0.x   | :white_check_mark: |
| < 0.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in Eigent, please report it responsibly:

### How to Report

- **Email**: Send details to info@eigent.ai
- **GitHub**: Use GitHub's private security advisory feature
- **Include**: Detailed description, steps to reproduce, and potential impact

### What to Expect

- **Response Time**: We aim to acknowledge reports within 48 hours
- **Updates**: We will provide updates on the investigation progress weekly
- **Resolution**: Critical vulnerabilities will be addressed within 7 days
- **Credit**: We will credit security researchers in our security advisories (if desired)

### Security Disclosure Policy

- We follow responsible disclosure practices
- We request 90 days to address the vulnerability before public disclosure
- We will coordinate disclosure timing with the reporter

## Local Agent Threat Boundary

Eigent's local permission policy, HumanInteraction approval records, Git
previews, and audit trail reduce accidental or model-initiated risk. They are
not an operating-system sandbox. If an Agent can run an arbitrary shell as the
same OS user as Eigent, that capability must be treated as full access to that
user's files and processes.

Advanced Git tells the model not to use options that execute external
programs, rejects known executable-option forms, returns structured rejection
reasons for self-correction, and requires user review for dangerous or
destructive operations. This is defense in depth and depends on model
discipline plus informed user approval; it is not a complete parser for Git's
option-abbreviation language. Local policy/profile state also remains inside
the same-UID boundary until an OS sandbox provides independent integrity.
