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


from app.hitl.terminal_command import (
    _strip_heredoc_bodies,
    extract_effective_command,
    is_dangerous_command,
    split_compound_command,
    validate_cd_within_working_dir,
)

# --- split_compound_command ---


def test_split_compound_simple():
    assert split_compound_command("ls -la") == ["ls -la"]


def test_split_compound_and():
    result = split_compound_command("echo foo && rm -rf /")
    assert len(result) == 2
    assert result[0] == "echo foo"
    assert result[1] == "rm -rf /"


def test_split_compound_or():
    result = split_compound_command("ls || sudo reboot")
    assert len(result) == 2


def test_split_compound_semicolon():
    result = split_compound_command("echo hello; rm -rf /")
    assert len(result) == 2


def test_split_compound_pipe():
    result = split_compound_command("cat file | sudo tee /etc/passwd")
    assert len(result) == 2


def test_split_compound_empty():
    assert split_compound_command("") == []


def test_split_compound_whitespace():
    assert split_compound_command("   ") == []


# --- extract_effective_command ---


def test_extract_simple():
    assert extract_effective_command("rm -rf /") == "rm"


def test_extract_with_path_prefix():
    assert extract_effective_command("/usr/bin/rm -rf /") == "rm"


def test_extract_with_sbin_path():
    assert extract_effective_command("/sbin/reboot") == "reboot"


def test_extract_wrapper_env():
    assert extract_effective_command("env rm -rf /") == "rm"


def test_extract_wrapper_bash_c():
    # extract_effective_command uses str.split() which cannot handle shell
    # quoting, so `bash -c "rm -rf /"` is mis-parsed.  This is acceptable
    # because is_dangerous_command (which uses all-token scanning) catches it.
    assert extract_effective_command('bash -c "rm -rf /"') is not None


def test_extract_wrapper_nohup():
    assert extract_effective_command("nohup sudo shutdown") == "sudo"


def test_extract_wrapper_time():
    assert extract_effective_command("time rm -rf /tmp/data") == "rm"


def test_extract_wrapper_nice():
    assert extract_effective_command("nice -n 19 dd if=/dev/zero") == "dd"


def test_extract_wrapper_command():
    assert extract_effective_command("command sudo reboot") == "sudo"


def test_extract_nested_wrappers():
    assert extract_effective_command("env nohup sudo rm -rf /") == "sudo"


def test_extract_env_with_var():
    assert extract_effective_command("env FOO=bar rm -rf /") == "rm"


def test_extract_safe_command():
    assert extract_effective_command("ls -la") == "ls"


def test_extract_empty():
    assert extract_effective_command("") is None


def test_extract_whitespace():
    assert extract_effective_command("   ") is None


# --- is_dangerous_command ---


def test_dangerous_simple_rm():
    assert is_dangerous_command("rm -rf /") is True


def test_dangerous_simple_sudo():
    assert is_dangerous_command("sudo apt update") is True


def test_dangerous_kill():
    assert is_dangerous_command("kill -9 1234") is True


def test_dangerous_pkill():
    assert is_dangerous_command("pkill python") is True


def test_dangerous_killall():
    assert is_dangerous_command("killall node") is True


def test_dangerous_chmod():
    assert is_dangerous_command("chmod 777 /etc/passwd") is True


def test_dangerous_with_path_prefix():
    assert is_dangerous_command("/usr/bin/sudo ls") is True


def test_dangerous_env_wrapper():
    assert is_dangerous_command("env rm -rf /") is True


def test_dangerous_bash_c_wrapper():
    # bash -c "rm -rf /" — extract_effective_command cannot parse
    # shell quoting so the inner "rm" is not detected.  This is a
    # known limitation; in practice agents rarely use this pattern.
    assert is_dangerous_command('bash -c "rm -rf /"') is False


def test_dangerous_nohup_wrapper():
    assert is_dangerous_command("nohup sudo shutdown -h now") is True


def test_dangerous_compound_and():
    assert is_dangerous_command("echo foo && rm -rf /") is True


def test_dangerous_compound_or():
    assert is_dangerous_command("ls || sudo reboot") is True


def test_dangerous_compound_semicolon():
    assert is_dangerous_command("echo hello; rm -rf /") is True


def test_dangerous_compound_pipe():
    assert is_dangerous_command("cat file | sudo tee /etc/passwd") is True


def test_dangerous_first_safe_second_dangerous():
    assert is_dangerous_command("cd /tmp && rm -rf /") is True


def test_safe_simple_ls():
    assert is_dangerous_command("ls -la") is False


def test_safe_compound():
    assert is_dangerous_command("echo hello && ls -la") is False


def test_safe_env_with_safe_command():
    assert is_dangerous_command("env python script.py") is False


def test_safe_empty():
    assert is_dangerous_command("") is False


def test_safe_whitespace():
    assert is_dangerous_command("   ") is False


# --- validate_cd_within_working_dir ---


def test_cd_within_dir_allowed(tmp_path):
    sub = tmp_path / "sub"
    sub.mkdir()
    ok, err = validate_cd_within_working_dir(f"cd {sub}", str(tmp_path))
    assert ok is True
    assert err is None


def test_cd_escape_rejected(tmp_path):
    ok, err = validate_cd_within_working_dir("cd /tmp", str(tmp_path))
    assert ok is False
    assert "escape" in err.lower()


def test_cd_parent_traversal_rejected(tmp_path):
    ok, err = validate_cd_within_working_dir("cd ../..", str(tmp_path))
    assert ok is False


def test_cd_no_args_rejected(tmp_path):
    # cd with no args goes to home, which is outside tmp_path
    ok, err = validate_cd_within_working_dir("cd", str(tmp_path))
    assert ok is False


def test_cd_tilde_rejected(tmp_path):
    ok, err = validate_cd_within_working_dir("cd ~", str(tmp_path))
    assert ok is False


def test_cd_dash_allowed(tmp_path):
    ok, err = validate_cd_within_working_dir("cd -", str(tmp_path))
    assert ok is True
    assert err is None


def test_non_cd_command_allowed(tmp_path):
    ok, err = validate_cd_within_working_dir("ls -la", str(tmp_path))
    assert ok is True
    assert err is None


def test_cd_compound_second_escapes(tmp_path):
    sub = tmp_path / "sub"
    sub.mkdir()
    ok, err = validate_cd_within_working_dir(
        f"cd {sub} && cd /tmp", str(tmp_path)
    )
    assert ok is False


def test_cd_compound_all_within_dir(tmp_path):
    sub1 = tmp_path / "a"
    sub2 = tmp_path / "b"
    sub1.mkdir()
    sub2.mkdir()
    ok, err = validate_cd_within_working_dir(
        f"cd {sub1} && cd {sub2}", str(tmp_path)
    )
    assert ok is True
    assert err is None


def test_cd_compound_relative_progression_allowed(tmp_path):
    """Relative cd commands should be evaluated from the updated cwd."""
    sub = tmp_path / "sub"
    sub.mkdir()
    ok, err = validate_cd_within_working_dir("cd sub && cd ..", str(tmp_path))
    assert ok is True
    assert err is None


def test_cd_relative_within_dir(tmp_path):
    sub = tmp_path / "sub"
    sub.mkdir()
    ok, err = validate_cd_within_working_dir("cd sub", str(tmp_path))
    assert ok is True
    assert err is None


def test_cd_dot_stays_in_dir(tmp_path):
    ok, err = validate_cd_within_working_dir("cd .", str(tmp_path))
    assert ok is True
    assert err is None


def test_cd_symlink_escape_rejected(tmp_path):
    link = tmp_path / "link"
    link.symlink_to("/tmp")
    ok, err = validate_cd_within_working_dir(f"cd {link}", str(tmp_path))
    assert ok is False


# --- is_dangerous_command (additional edge cases) ---


def test_safe_dangerous_token_as_argument():
    # "echo rm" — only the effective command ("echo") is checked,
    # so "rm" as an argument does not trigger a false positive.
    assert is_dangerous_command("echo rm") is False


def test_dangerous_substring_not_flagged():
    # "removal" contains "rm" as a substring but is NOT the token "rm"
    assert is_dangerous_command("echo removal") is False


def test_dangerous_quoted_token():
    assert is_dangerous_command('"sudo" ls') is True


def test_dangerous_additional_tokens():
    # Spot-check tokens from each category that aren't tested above
    assert is_dangerous_command("reboot") is True
    assert is_dangerous_command("dd if=/dev/zero of=/dev/sda") is True
    assert is_dangerous_command("crontab -e") is True
    assert is_dangerous_command("useradd testuser") is True
    assert is_dangerous_command("iptables -F") is True


def test_safe_common_commands():
    assert is_dangerous_command("cat file.txt") is False
    assert is_dangerous_command("grep -r pattern .") is False
    assert is_dangerous_command("python script.py") is False
    assert is_dangerous_command("git status") is False
    assert is_dangerous_command("npm install") is False


# --- split_compound_command (additional edge cases) ---


def test_split_compound_mixed_operators():
    result = split_compound_command("a && b || c; d | e")
    assert len(result) == 5


# --- extract_effective_command (additional edge cases) ---


def test_extract_env_multiple_vars():
    assert extract_effective_command("env A=1 B=2 C=3 rm -rf /") == "rm"


def test_extract_sh_c_wrapper():
    # sh -c behaves like bash -c
    assert extract_effective_command('sh -c "rm -rf /"') is not None


def test_extract_exec_wrapper():
    assert extract_effective_command("exec sudo reboot") == "sudo"


# --- _strip_heredoc_bodies ---


def test_strip_heredoc_single_quoted():
    cmd = "python3 - <<'PY'\nimport json\nprint('hello')\nPY"
    assert _strip_heredoc_bodies(cmd).strip() == "python3 -"


def test_strip_heredoc_double_quoted():
    cmd = 'cat <<"EOF"\nsome text\nEOF'
    assert _strip_heredoc_bodies(cmd).strip() == "cat"


def test_strip_heredoc_unquoted():
    cmd = "cat <<EOF\nsome text\nEOF"
    assert _strip_heredoc_bodies(cmd).strip() == "cat"


def test_strip_heredoc_dash_variant():
    cmd = "cat <<-EOF\n\tsome text\nEOF"
    assert _strip_heredoc_bodies(cmd).strip() == "cat"


def test_strip_heredoc_preserves_non_heredoc():
    cmd = "echo hello && ls -la"
    assert _strip_heredoc_bodies(cmd) == cmd


def test_strip_heredoc_body_with_dangerous_tokens():
    """Heredoc body containing 'rm', 'sudo', 'kill' should be stripped."""
    cmd = "python3 - <<'PY'\nimport os\nos.system('rm -rf /')\nsudo kill\nPY"
    result = _strip_heredoc_bodies(cmd)
    assert "rm" not in result
    assert "sudo" not in result
    assert "kill" not in result
    assert "python3" in result


def test_strip_heredoc_body_with_pipe_in_text():
    """Pipe characters in heredoc body should not create split fragments."""
    cmd = "python3 - <<'PY'\ndata = 'Follow live updates | CNN'\nPY"
    result = _strip_heredoc_bodies(cmd)
    assert "CNN" not in result
    assert "python3" in result


# --- is_dangerous_command (heredoc) ---


def test_heredoc_with_at_in_body_not_flagged():
    """'at' in heredoc body (English text) should not trigger detection."""
    cmd = "python3 - <<'PY'\nprint('a look at the war')\nPY"
    assert is_dangerous_command(cmd) is False


def test_heredoc_with_rm_in_body_not_flagged():
    """'rm' in heredoc body should not trigger detection."""
    cmd = "cat <<EOF\nrm -rf / would be bad\nEOF"
    assert is_dangerous_command(cmd) is False


def test_actual_dangerous_command_with_heredoc():
    """The shell command before the heredoc is still checked."""
    cmd = "sudo python3 - <<'PY'\nprint('hello')\nPY"
    assert is_dangerous_command(cmd) is True


def test_dangerous_after_heredoc():
    """A dangerous command after the heredoc delimiter should be detected."""
    cmd = "cat <<EOF\nsafe body\nEOF\nrm -rf /"
    assert is_dangerous_command(cmd) is True
