# Packaging Tests

Validation tests for all packaging formats.

## Run

```bash
# Run all tests
./test-packaging.sh

# Verbose output (show tool output on failure)
./test-packaging.sh --verbose
```

## What's Tested

### File Existence
- All packaging files present (PKGBUILD, spec, flake.nix, etc.)
- Scripts are executable

### Version Consistency
- Version matches across AUR, Flatpak, Nix, RPM

### Format-Specific Validation

| Format | Tests |
|--------|-------|
| AUR | Required fields, package() function, namcap |
| Flatpak | YAML syntax, required fields |
| Nix | Required sections, `nix flake check` |
| RPM | Required fields/sections, rpmlint |
| Desktop | Required keys, desktop-file-validate |
| Man page | Required sections, renders correctly |
| Scripts | Shebang, set -e, shellcheck |

## Optional Tools

Install for more thorough validation:

```bash
# Arch Linux
sudo pacman -S namcap shellcheck desktop-file-utils man-db

# Fedora
sudo dnf install rpmlint ShellCheck desktop-file-utils man-db

# Ubuntu/Debian
sudo apt install shellcheck desktop-file-utils man-db
```

## CI Integration

The tests exit with code 1 if any test fails, making them suitable for CI:

```yaml
- name: Run packaging tests
  run: ./packaging/tests/test-packaging.sh
```
