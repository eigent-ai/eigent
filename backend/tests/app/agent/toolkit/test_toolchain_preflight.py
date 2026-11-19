"""Read-only preflight regressions; only stdlib and synthetic files are used."""

import importlib.util
import json
import os
import runpy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


@unittest.skipUnless(
    os.name == "posix", "requires scoped directory descriptors"
)
class ToolchainPreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="eigent-preflight-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve() / "Space with spaces"
        self.root.mkdir()
        self.worker_bin = self.root / "worker bin"
        self.worker_bin.mkdir()
        self.environment = {"PATH": str(self.worker_bin)}

        # Load the dependency-free probe without bootstrapping the app, dotenv,
        # a model client, or the default journal in a developer's home directory.
        source = (
            Path(__file__).resolve().parents[4]
            / "app/utils/toolchain_preflight.py"
        )
        spec = importlib.util.spec_from_file_location(
            "preflight_under_test", source
        )
        assert spec is not None and spec.loader is not None
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def inspect(self, **kwargs):
        # None of the code under test may spawn even a version/login-shell probe.
        with (
            patch("subprocess.Popen", side_effect=AssertionError("spawn")),
            patch("os.system", side_effect=AssertionError("shell")),
        ):
            return self.module.inspect_toolchain(
                working_directory=self.root,
                worker_environment=kwargs.pop(
                    "worker_environment", self.environment
                ),
                commands=kwargs.pop("commands", []),
                **kwargs,
            )

    def executable(self, path):
        path.write_text("synthetic executable; must never be run")
        path.chmod(0o755)
        return path

    def frames(self, count=720):
        directory = self.root / "output" / "resume frames"
        directory.mkdir(parents=True)
        for number in range(1, count + 1):
            (directory / f"frame_{number:04d}.png").write_bytes(b"fixture")
        return directory

    def sequence(self, directory, **kwargs):
        return self.inspect(
            directory=str(directory),
            filename_pattern="frame_%04d.png",
            start_number=1,
            end_number=720,
            **kwargs,
        )["sequence"]

    def test_missing_command_is_actionable_without_installation(self):
        result = self.inspect(commands=["blender", "ffmpeg"])
        self.assertEqual(
            [item["status"] for item in result["commands"]],
            ["not_found", "not_found"],
        )
        self.assertIn("explicit user confirmation", json.dumps(result))
        self.assertFalse(result["execution_authorized"])
        self.assertEqual(list(self.worker_bin.iterdir()), [])

    def test_login_path_does_not_prove_worker_availability(self):
        login_bin = self.root / "login bin"
        login_bin.mkdir()
        binary = self.executable(login_bin / "blender")
        with patch.dict(os.environ, {"PATH": str(login_bin)}):
            self.assertEqual(
                self.inspect(commands=["blender"])["commands"][0]["status"],
                "not_found",
            )
        self.environment["PATH"] = str(login_bin)
        command = self.inspect(commands=["blender"])["commands"][0]
        self.assertEqual(command["path"], str(binary))
        self.assertEqual(command["status"], "found_on_worker_path")
        self.assertFalse(command["version_checked"])

    def test_missing_path_never_falls_back_to_process_path(self):
        self.executable(self.worker_bin / "blender")
        self.environment = {}
        with patch.dict(os.environ, {"PATH": str(self.worker_bin)}):
            result = self.inspect(commands=["blender"])
        self.assertEqual(result["commands"][0]["status"], "path_unavailable")

    def test_malformed_worker_path_returns_a_diagnostic(self):
        self.environment["PATH"] = "invalid\x00path"
        self.assertEqual(
            self.inspect(commands=["blender"])["commands"][0]["status"],
            "invalid_worker_path",
        )

    def test_relative_path_entries_use_worker_cwd(self):
        binary = self.executable(self.worker_bin / "blender")
        self.environment["PATH"] = "worker bin"
        self.assertEqual(
            self.inspect(commands=["blender"])["commands"][0]["path"],
            str(binary),
        )

    def test_explicit_in_scope_binary_with_spaces_is_one_path(self):
        binary = self.executable(self.worker_bin / "a tool")
        command = self.inspect(commands=[str(binary)])["commands"][0]
        self.assertEqual(command["status"], "found_in_workspace")
        self.assertEqual(command["path"], str(binary))

    def test_external_operand_is_not_statted_or_listed(self):
        outside = self.root.parent / "outside"
        outside.mkdir()
        original_stat = os.stat
        original_lstat = os.lstat

        def guard(function):
            def checked(path, *args, **kwargs):
                if not isinstance(path, int):
                    self.assertFalse(Path(path).is_relative_to(outside))
                return function(path, *args, **kwargs)

            return checked

        with (
            patch("os.stat", side_effect=guard(original_stat)),
            patch("os.lstat", side_effect=guard(original_lstat)),
            patch("os.scandir", side_effect=AssertionError("enumeration")),
        ):
            result = self.inspect(
                commands=[str(outside / "blender")],
                directory=str(outside),
                filename_pattern="%04d.png",
                end_number=720,
            )
        self.assertEqual(result["directory"]["status"], "outside_workspace")
        self.assertEqual(result["commands"][0]["status"], "outside_workspace")
        self.assertEqual(result["sequence"]["status"], "not_inspected")
        self.assertNotIn("present_count", result["sequence"])

    def test_symlink_directory_does_not_follow_external_target(self):
        target = self.root.parent / "outside frames"
        target.mkdir()
        link = self.root / "resume"
        link.symlink_to(target, target_is_directory=True)
        with patch("os.readlink", side_effect=AssertionError("follow link")):
            result = self.inspect(directory=str(link))
        self.assertEqual(result["directory"]["status"], "symlink_rejected")

    def test_missing_directory_is_guidance_only(self):
        path = self.root / "output" / "resume_frames"
        result = self.inspect(directory=str(path))
        self.assertEqual(result["directory"]["status"], "missing")
        self.assertFalse(path.exists())
        self.assertIn("output/resume_frames", json.dumps(result))

    def test_directory_replacement_does_not_redirect_sequence_scan(self):
        directory = self.frames()
        outside = self.root.parent / "unapproved"
        outside.mkdir()
        original_stat = os.stat
        switched = False

        def replace_directory(path, *args, **kwargs):
            nonlocal switched
            if path == "frame_0001.png" and kwargs.get("dir_fd") is not None:
                directory.rename(self.root / "original frames")
                directory.symlink_to(outside, target_is_directory=True)
                switched = True
            return original_stat(path, *args, **kwargs)

        with patch("os.stat", side_effect=replace_directory):
            result = self.sequence(directory)
        self.assertTrue(switched)
        self.assertEqual(result["present_count"], 720)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(list(outside.iterdir()), [])

    def test_worker_path_discovery_does_not_grant_external_access(self):
        external_bin = self.root.parent / "system bin"
        external_bin.mkdir()
        binary = self.executable(external_bin / "blender")
        (self.worker_bin / "blender").symlink_to(binary)
        result = self.inspect(commands=["blender"])
        self.assertEqual(
            result["commands"][0]["status"], "found_on_worker_path"
        )
        self.assertEqual(
            result["commands"][0]["probe_scope"], "worker_path_metadata_only"
        )
        self.assertFalse(result["execution_authorized"])
        self.assertEqual(
            self.inspect(directory=str(external_bin))["directory"]["status"],
            "outside_workspace",
        )

    def test_unsupported_host_and_protected_path_fail_closed(self):
        with patch.object(self.module, "_HAS_SCOPED_DIRECTORY_FDS", False):
            self.assertEqual(
                self.inspect(directory=str(self.root))["directory"]["status"],
                "unsupported_platform",
            )
        self.assertEqual(
            self.inspect(commands=["blender"], worker_environment=None)[
                "commands"
            ][0]["status"],
            "path_unavailable",
        )

    def test_shell_syntax_is_not_executable_input(self):
        result = self.inspect(
            commands=[
                "blender --version",
                "$(curl example.com)",
                "pip;install",
            ]
        )
        self.assertEqual(
            [item["status"] for item in result["commands"]],
            ["invalid_command"] * 3,
        )

    def test_720_contiguous_nonempty_frames_are_reused(self):
        directory = self.frames()
        before = {p.name: p.stat().st_mtime_ns for p in directory.iterdir()}
        result = self.sequence(directory)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["present_count"], 720)
        self.assertEqual(result["next_action"], "reuse_existing_sequence")
        self.assertEqual(result["validation"], "regular_nonempty_files_only")
        self.assertEqual(
            before, {p.name: p.stat().st_mtime_ns for p in directory.iterdir()}
        )

    def test_gap_empty_frame_and_symlink_prevent_complete(self):
        directory = self.frames()
        (directory / "frame_0360.png").unlink()
        (directory / "frame_0361.png").write_bytes(b"")
        (directory / "frame_0362.png").unlink()
        (directory / "frame_0362.png").symlink_to(
            self.root.parent / "never inspect this target"
        )
        result = self.sequence(directory)
        self.assertEqual(result["status"], "incomplete")
        self.assertEqual(result["missing_count"], 1)
        self.assertEqual(result["invalid_count"], 2)
        self.assertEqual(result["present_count"], 717)
        self.assertEqual(
            result["next_action"], "review_missing_or_invalid_files"
        )

    def test_unreadable_frame_metadata_never_counts_as_complete(self):
        directory = self.frames()
        original_stat = os.stat

        def deny_frame(path, *args, **kwargs):
            if path == "frame_0002.png":
                raise PermissionError("fixture")
            return original_stat(path, *args, **kwargs)

        with patch("os.stat", side_effect=deny_frame):
            result = self.sequence(directory)
        self.assertEqual(result["status"], "incomplete")
        self.assertEqual(result["invalid_count"], 1)
        self.assertEqual(result["invalid_sample"], [2])

    def test_numbered_sequence_is_generic_and_respects_inclusive_start(self):
        for number in range(3):
            (self.root / f"chunk_{number}.dat").write_bytes(b"fixture")
        result = self.inspect(
            filename_pattern="chunk_%d.dat", start_number=0, end_number=2
        )
        self.assertEqual(result["sequence"]["status"], "complete")
        self.assertEqual(result["sequence"]["present_count"], 3)
        self.assertFalse(result["directory"]["write_test_performed"])

    def test_traversal_and_pattern_injection_are_not_scanned(self):
        for operand in ("../outside", "output/../../outside"):
            with self.subTest(operand=operand):
                result = self.inspect(directory=operand)
                self.assertEqual(
                    result["directory"]["status"], "outside_workspace"
                )
        for pattern in (
            "../%04d.png",
            "%s.png",
            "%04d/%04d.png",
            "%d\x00.png",
        ):
            with self.subTest(pattern=pattern):
                result = self.inspect(
                    directory=str(self.root),
                    filename_pattern=pattern,
                    end_number=720,
                )
                self.assertEqual(
                    result["sequence"]["status"], "invalid_request"
                )

    def test_sequence_bounds_and_diagnostic_output_are_bounded(self):
        result = self.sequence(self.root)
        self.assertEqual(result["missing_count"], 720)
        self.assertLessEqual(len(result["missing_sample"]), 20)
        self.assertEqual(
            self.inspect(
                directory=str(self.root),
                filename_pattern="%04d.png",
                end_number=100000000,
            )["sequence"]["status"],
            "invalid_request",
        )

    def test_storage_contract_is_reported_without_creating_or_granting_roots(
        self,
    ):
        self.environment.update(
            {
                "EIGENT_RUNTIME_DIR": str(self.root.parent / "toolchains"),
                "EIGENT_CACHE_DIR": str(self.root.parent / "cache"),
                "EIGENT_INTERMEDIATE_DIR": str(
                    self.root.parent / "intermediates"
                ),
                "PRIVATE_SECRET": "do not expose",
            }
        )
        result = self.inspect()
        for key in (
            "EIGENT_RUNTIME_DIR",
            "EIGENT_CACHE_DIR",
            "EIGENT_INTERMEDIATE_DIR",
        ):
            self.assertEqual(
                result["storage"][key]["status"], "configured_uninspected"
            )
            self.assertFalse(Path(self.environment[key]).exists())
        self.assertNotIn("PRIVATE_SECRET", json.dumps(result))
        self.assertNotIn("do not expose", json.dumps(result))


class PreflightPromptTests(unittest.TestCase):
    def test_terminal_agents_are_guided_to_preflight_and_confirm_changes(self):
        prompts = runpy.run_path(
            str(Path(__file__).resolve().parents[4] / "app/agent/prompt.py")
        )
        for name in (
            "SINGLE_AGENT_SYS_PROMPT",
            "DEVELOPER_SYS_PROMPT",
            "MULTI_MODAL_SYS_PROMPT",
            "DOCUMENT_SYS_PROMPT",
            "SOCIAL_MEDIA_SYS_PROMPT",
        ):
            with self.subTest(name=name):
                prompt = " ".join(prompts[name].split())
                self.assertIn("terminal_preflight", prompt)
                self.assertIn("explicit user confirmation", prompt)
                self.assertIn("EIGENT_INTERMEDIATE_DIR", prompt)
                self.assertIn("output/resume_frames", prompt)
                self.assertNotIn("access files from any place", prompt)
                prompts[name].format(
                    working_directory="/isolated/Space with spaces",
                    platform_system="Darwin",
                    platform_machine="arm64",
                    now_str="2026-09-12",
                )

    def test_developer_does_not_claim_root_or_mandate_installs(self):
        prompts = runpy.run_path(
            str(Path(__file__).resolve().parents[4] / "app/agent/prompt.py")
        )
        prompt = prompts["DEVELOPER_SYS_PROMPT"]
        for unsafe in (
            "root-level access",
            "MUST install",
            "If a tool is missing, install it",
            "Automate Confirmation",
            "access files from any place",
        ):
            self.assertNotIn(unsafe, prompt)


if __name__ == "__main__":
    unittest.main()
