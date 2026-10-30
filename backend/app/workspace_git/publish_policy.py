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

"""Bounded secret and large-object preflight for explicit Git publish."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from app.workspace_config import canonical_digest
from app.workspace_git.backend import GitBackend, GitBackendError
from app.workspace_git.retention import DEFAULT_GIT_RETENTION_POLICY

_MAX_OUTGOING_OBJECTS = 20_000
_MAX_SCAN_OUTPUT_BYTES = 8 * 1024 * 1024
_REMOTE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
_SECRET_PATTERNS = (
    ("aws_access_key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("github_token", re.compile(r"gh[ps]_[A-Za-z0-9_]{36,}")),
    ("github_fine_grained_pat", re.compile(r"github_pat_[A-Za-z0-9_]{22,}")),
    ("gitlab_token", re.compile(r"glpat-[A-Za-z0-9-]{20,}")),
    ("slack_token", re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}")),
    ("stripe_secret", re.compile(r"sk_live_[A-Za-z0-9]{24,}")),
    (
        "private_key",
        re.compile(
            r"-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----"
        ),
    ),
    (
        "credential_url",
        re.compile(
            r"(?i)(?:mysql|postgres|postgresql|mongodb|redis|mssql)://"
            r"(?P<username>[^:\s]+):(?P<password>[^@\s]+)@"
        ),
    ),
    (
        "hardcoded_secret",
        re.compile(
            r"(?i)(?:password|passwd|secret_key|api_secret|auth_token|"
            r"access_token|api_key|apikey)\s*[=:]\s*['\"][^'\"]{8,}['\"]"
        ),
    ),
)
_FALSE_POSITIVE_INDICATORS = (
    "${",
    "changeme",
    "dummy",
    "example",
    "getenv",
    "os.environ",
    "placeholder",
    "process.env",
    "replace_",
    "sample",
    "your_",
)
_PLACEHOLDER_USERNAMES = {"user", "username", "example"}
_PLACEHOLDER_PASSWORDS = {
    "pass",
    "password",
    "changeme",
    "placeholder",
}
_SENSITIVE_FILE_NAMES = {
    ".env",
    "id_dsa",
    "id_ed25519",
    "id_ecdsa",
    "id_rsa",
}
_SENSITIVE_SUFFIXES = {".key", ".p12", ".pfx", ".pem"}


class GitPublishPolicyError(GitBackendError):
    """Publish cannot proceed without bypassing a frozen safety boundary."""


@dataclass(frozen=True)
class GitPublishPreflight:
    head_oid: str
    remote_name: str
    outgoing_object_count: int
    outgoing_blob_count: int
    largest_blob_bytes: int
    scan_digest: str

    def to_dict(self) -> dict[str, str | int]:
        return {
            "head_oid": self.head_oid,
            "remote_name": self.remote_name,
            "outgoing_object_count": self.outgoing_object_count,
            "outgoing_blob_count": self.outgoing_blob_count,
            "largest_blob_bytes": self.largest_blob_bytes,
            "scan_digest": self.scan_digest,
        }


class GitPublishPolicy:
    """Scan only outgoing Git facts and never retain matched secret text."""

    def __init__(self, backend: GitBackend) -> None:
        self.git = GitBackend(
            git_executable=backend.git_executable,
            timeout_seconds=backend.timeout_seconds,
            max_output_chars=_MAX_SCAN_OUTPUT_BYTES,
            hooks_path=backend.hooks_path,
        )

    @staticmethod
    def validate_remote_name(value: str) -> str:
        if not _REMOTE_NAME.fullmatch(value):
            raise GitPublishPolicyError(
                "Git push requires a configured remote name"
            )
        return value

    def scan_head(
        self,
        repository_root: Path,
        *,
        remote_name: str,
    ) -> GitPublishPreflight:
        remote = self.validate_remote_name(remote_name)
        head_oid = self.git.current_head(repository_root)
        if head_oid is None:
            raise GitPublishPolicyError("Git push requires a committed HEAD")
        revisions = (
            "rev-list",
            "--objects",
            "HEAD",
            "--not",
            f"--remotes={remote}",
        )
        object_result = self.git.run_advanced_argv(
            repository_root,
            revisions,
        )
        if object_result.returncode != 0 or object_result.stdout_truncated:
            raise GitPublishPolicyError(
                "Outgoing object inventory exceeded the publish scan budget"
            )
        objects: list[tuple[str, str | None]] = []
        for line in object_result.stdout.splitlines():
            oid, _, path = line.partition(" ")
            if not oid:
                continue
            objects.append((oid, path or None))
            if len(objects) > _MAX_OUTGOING_OBJECTS:
                raise GitPublishPolicyError(
                    "Outgoing history exceeds the publish scan object limit"
                )
            if path and self._sensitive_path(path):
                raise GitPublishPolicyError(
                    "Outgoing history contains a credential-bearing file path"
                )

        metadata = self.git.object_metadata(
            repository_root,
            tuple(oid for oid, _ in objects),
        )
        blobs = [item for item in metadata if item.object_type == "blob"]
        largest_blob = max((item.size_bytes for item in blobs), default=0)
        if (
            largest_blob
            > DEFAULT_GIT_RETENTION_POLICY.lfs_recommendation_blob_bytes
        ):
            raise GitPublishPolicyError(
                "Outgoing history contains a blob above the Git LFS threshold"
            )

        patch = self.git.run_advanced_argv(
            repository_root,
            (
                "log",
                "--format=",
                "--no-ext-diff",
                "--no-textconv",
                "-p",
                "HEAD",
                "--not",
                f"--remotes={remote}",
            ),
        )
        if patch.returncode != 0 or patch.stdout_truncated:
            raise GitPublishPolicyError(
                "Outgoing patch exceeded the publish secret-scan budget"
            )
        secret_type = self._secret_type(patch.stdout)
        if secret_type is not None:
            raise GitPublishPolicyError(
                f"Outgoing history failed secret scan ({secret_type})"
            )

        return GitPublishPreflight(
            head_oid=head_oid,
            remote_name=remote,
            outgoing_object_count=len(objects),
            outgoing_blob_count=len(blobs),
            largest_blob_bytes=largest_blob,
            scan_digest=canonical_digest(
                {
                    "head_oid": head_oid,
                    "remote_name": remote,
                    "objects": [item.oid for item in metadata],
                }
            ),
        )

    @staticmethod
    def _sensitive_path(value: str) -> bool:
        name = Path(value).name.lower()
        return (
            name in _SENSITIVE_FILE_NAMES
            or name.startswith(".env.")
            or Path(name).suffix in _SENSITIVE_SUFFIXES
        )

    @staticmethod
    def _secret_type(value: str) -> str | None:
        for line in value.splitlines():
            for label, pattern in _SECRET_PATTERNS:
                for match in pattern.finditer(line):
                    # A comment or an earlier placeholder elsewhere on the
                    # same line must not bless an actual credential.
                    # Suppression applies only to this captured candidate.
                    candidate = match.group(0).lower()
                    if label == "credential_url" and (
                        match.group("username").casefold()
                        in _PLACEHOLDER_USERNAMES
                        and match.group("password").casefold()
                        in _PLACEHOLDER_PASSWORDS
                    ):
                        continue
                    if any(
                        indicator in candidate
                        for indicator in _FALSE_POSITIVE_INDICATORS
                    ):
                        continue
                    return label
        return None
