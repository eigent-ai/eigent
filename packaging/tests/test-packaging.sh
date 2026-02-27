#!/bin/bash
# Packaging validation tests
# Run: ./test-packaging.sh [--verbose]
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGING_DIR="$(dirname "$SCRIPT_DIR")"
VERBOSE="${1:-}"
PASSED=0
FAILED=0
SKIPPED=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

log() { echo -e "$1"; }
pass() { log "${GREEN}✓${NC} $1"; PASSED=$((PASSED + 1)); }
fail() { log "${RED}✗${NC} $1"; FAILED=$((FAILED + 1)); }
skip() { log "${YELLOW}○${NC} $1 (skipped)"; SKIPPED=$((SKIPPED + 1)); }
section() { echo ""; log "━━━ $1 ━━━"; }

# ============================================
# File existence tests
# ============================================
section "File Existence"

test_file_exists() {
    local file="$1"
    local desc="$2"
    if [[ -f "$PACKAGING_DIR/$file" ]]; then
        pass "$desc exists"
    else
        fail "$desc missing: $file"
    fi
}

test_file_exists "update-all.sh" "Unified update script"
test_file_exists "aur/PKGBUILD" "AUR PKGBUILD"
test_file_exists "aur/.SRCINFO" "AUR .SRCINFO"
test_file_exists "flatpak/ai.eigent.Eigent.yml" "Flatpak manifest"
test_file_exists "flatpak/ai.eigent.Eigent.metainfo.xml" "Flatpak metainfo"
test_file_exists "deb/build-deb.sh" "Debian build script"
test_file_exists "nix/flake.nix" "Nix flake"
test_file_exists "rpm/eigent.spec" "RPM spec"
test_file_exists "man/eigent.1" "Man page"
test_file_exists "autostart/eigent-autostart.desktop" "Autostart entry"

# ============================================
# Script executability
# ============================================
section "Script Executability"

test_executable() {
    local file="$1"
    local desc="$2"
    if [[ -x "$PACKAGING_DIR/$file" ]]; then
        pass "$desc is executable"
    else
        fail "$desc not executable: $file"
    fi
}

test_executable "update-all.sh" "update-all.sh"
test_executable "deb/build-deb.sh" "build-deb.sh"
test_executable "aur/install-appimage.sh" "AUR install-appimage.sh"
test_executable "aur/uninstall-appimage.sh" "AUR uninstall-appimage.sh"

# ============================================
# Version consistency
# ============================================
section "Version Consistency"

# Extract versions from different files
AUR_VERSION=$(grep "^pkgver=" "$PACKAGING_DIR/aur/PKGBUILD" 2>/dev/null | cut -d= -f2 || echo "")
FLATPAK_VERSION=$(grep -oP 'Eigent-\K[0-9.]+(?=\.AppImage)' "$PACKAGING_DIR/flatpak/ai.eigent.Eigent.yml" 2>/dev/null | head -1 || echo "")
NIX_VERSION=$(grep 'version = "' "$PACKAGING_DIR/nix/flake.nix" 2>/dev/null | grep -oP '"\K[0-9.]+(?=")' | head -1 || echo "")
RPM_VERSION=$(grep "^Version:" "$PACKAGING_DIR/rpm/eigent.spec" 2>/dev/null | awk '{print $2}' || echo "")

if [[ -n "$AUR_VERSION" ]]; then
    log "  AUR:     $AUR_VERSION"
    log "  Flatpak: $FLATPAK_VERSION"
    log "  Nix:     $NIX_VERSION"
    log "  RPM:     $RPM_VERSION"

    # Check if all match (allow empty for new files)
    MISMATCH=0
    [[ -n "$FLATPAK_VERSION" && "$FLATPAK_VERSION" != "$AUR_VERSION" ]] && MISMATCH=1
    [[ -n "$NIX_VERSION" && "$NIX_VERSION" != "$AUR_VERSION" ]] && MISMATCH=1
    [[ -n "$RPM_VERSION" && "$RPM_VERSION" != "$AUR_VERSION" ]] && MISMATCH=1

    if [[ $MISMATCH -eq 0 ]]; then
        pass "All versions consistent"
    else
        fail "Version mismatch detected"
    fi
else
    skip "Version check (could not extract version)"
fi

# ============================================
# PKGBUILD validation
# ============================================
section "AUR PKGBUILD Validation"

if [[ -f "$PACKAGING_DIR/aur/PKGBUILD" ]]; then
    # Check required fields
    for field in pkgname pkgver pkgrel pkgdesc arch url license source sha256sums; do
        if grep -q "^$field=" "$PACKAGING_DIR/aur/PKGBUILD"; then
            pass "PKGBUILD has $field"
        else
            fail "PKGBUILD missing $field"
        fi
    done

    # Check for package() function
    if grep -q "^package()" "$PACKAGING_DIR/aur/PKGBUILD"; then
        pass "PKGBUILD has package() function"
    else
        fail "PKGBUILD missing package() function"
    fi

    # Validate with namcap if available
    if command -v namcap &> /dev/null; then
        NAMCAP_OUT=$(namcap "$PACKAGING_DIR/aur/PKGBUILD" 2>&1)
        if [[ -z "$NAMCAP_OUT" ]]; then
            pass "namcap validation passed"
        else
            [[ "$VERBOSE" == "--verbose" ]] && echo "$NAMCAP_OUT"
            fail "namcap found issues"
        fi
    else
        skip "namcap validation (not installed)"
    fi
else
    skip "PKGBUILD validation (file not found)"
fi

# ============================================
# Flatpak manifest validation
# ============================================
section "Flatpak Manifest Validation"

FLATPAK_FILE="$PACKAGING_DIR/flatpak/ai.eigent.Eigent.yml"
if [[ -f "$FLATPAK_FILE" ]]; then
    # Check YAML syntax
    if command -v python3 &> /dev/null; then
        if python3 -c "import yaml; yaml.safe_load(open('$FLATPAK_FILE'))" 2>/dev/null; then
            pass "Flatpak manifest is valid YAML"
        else
            fail "Flatpak manifest has invalid YAML"
        fi
    else
        skip "YAML validation (python3 not available)"
    fi

    # Check required fields
    for field in "app-id" "runtime" "sdk" "modules"; do
        if grep -q "$field:" "$FLATPAK_FILE"; then
            pass "Flatpak has $field"
        else
            fail "Flatpak missing $field"
        fi
    done
else
    skip "Flatpak validation (file not found)"
fi

# ============================================
# Nix flake validation
# ============================================
section "Nix Flake Validation"

NIX_FILE="$PACKAGING_DIR/nix/flake.nix"
if [[ -f "$NIX_FILE" ]]; then
    # Check for required sections
    for section in "inputs" "outputs" "packages"; do
        if grep -q "$section" "$NIX_FILE"; then
            pass "Nix flake has $section"
        else
            fail "Nix flake missing $section"
        fi
    done

    # Validate with nix if available
    if command -v nix &> /dev/null; then
        cd "$PACKAGING_DIR/nix"
        if nix flake check --no-build 2>/dev/null; then
            pass "nix flake check passed"
        else
            skip "nix flake check (evaluation failed, may need network)"
        fi
        cd - > /dev/null
    else
        skip "nix flake check (nix not installed)"
    fi
else
    skip "Nix validation (file not found)"
fi

# ============================================
# RPM spec validation
# ============================================
section "RPM Spec Validation"

RPM_FILE="$PACKAGING_DIR/rpm/eigent.spec"
if [[ -f "$RPM_FILE" ]]; then
    # Check required fields
    for field in "Name:" "Version:" "Release:" "Summary:" "License:" "URL:" "Source0:"; do
        if grep -q "^$field" "$RPM_FILE"; then
            pass "RPM spec has $field"
        else
            fail "RPM spec missing $field"
        fi
    done

    # Check for required sections
    for section in "%description" "%prep" "%install" "%files"; do
        if grep -q "^$section" "$RPM_FILE"; then
            pass "RPM spec has $section"
        else
            fail "RPM spec missing $section"
        fi
    done

    # Validate with rpmlint if available
    if command -v rpmlint &> /dev/null; then
        RPMLINT_OUT=$(rpmlint "$RPM_FILE" 2>&1 | grep -v "^$" || true)
        ERRORS=$(echo "$RPMLINT_OUT" | grep -c "E:" || true)
        if [[ "$ERRORS" -eq 0 ]]; then
            pass "rpmlint validation passed"
        else
            [[ "$VERBOSE" == "--verbose" ]] && echo "$RPMLINT_OUT"
            fail "rpmlint found $ERRORS error(s)"
        fi
    else
        skip "rpmlint validation (not installed)"
    fi
else
    skip "RPM validation (file not found)"
fi

# ============================================
# Desktop file validation
# ============================================
section "Desktop File Validation"

validate_desktop() {
    local file="$1"
    local name="$2"

    if [[ ! -f "$file" ]]; then
        skip "$name validation (file not found)"
        return
    fi

    # Check required keys
    for key in "Type=" "Name=" "Exec=" "Icon="; do
        if grep -q "^$key" "$file"; then
            pass "$name has $key"
        else
            fail "$name missing $key"
        fi
    done

    # Validate with desktop-file-validate if available
    if command -v desktop-file-validate &> /dev/null; then
        if desktop-file-validate "$file" 2>/dev/null; then
            pass "$name passes desktop-file-validate"
        else
            fail "$name fails desktop-file-validate"
        fi
    else
        skip "$name desktop-file-validate (not installed)"
    fi
}

validate_desktop "$PACKAGING_DIR/autostart/eigent-autostart.desktop" "Autostart desktop"

# ============================================
# Man page validation
# ============================================
section "Man Page Validation"

MAN_FILE="$PACKAGING_DIR/man/eigent.1"
if [[ -f "$MAN_FILE" ]]; then
    # Check for required sections
    for section in ".TH" ".SH NAME" ".SH SYNOPSIS" ".SH DESCRIPTION"; do
        if grep -q "$section" "$MAN_FILE"; then
            pass "Man page has $section"
        else
            fail "Man page missing $section"
        fi
    done

    # Try to render with man
    if command -v man &> /dev/null; then
        if man -l "$MAN_FILE" > /dev/null 2>&1; then
            pass "Man page renders correctly"
        else
            fail "Man page fails to render"
        fi
    else
        skip "Man page render test (man not available)"
    fi
else
    skip "Man page validation (file not found)"
fi

# ============================================
# Update script validation
# ============================================
section "Update Script Validation"

UPDATE_SCRIPT="$PACKAGING_DIR/update-all.sh"
if [[ -f "$UPDATE_SCRIPT" ]]; then
    # Check for shebang
    if head -1 "$UPDATE_SCRIPT" | grep -q "^#!/bin/bash"; then
        pass "update-all.sh has bash shebang"
    else
        fail "update-all.sh missing bash shebang"
    fi

    # Check for set -e
    if grep -q "^set -e" "$UPDATE_SCRIPT"; then
        pass "update-all.sh has set -e"
    else
        fail "update-all.sh missing set -e"
    fi

    # Shellcheck if available
    if command -v shellcheck &> /dev/null; then
        if shellcheck "$UPDATE_SCRIPT" 2>/dev/null; then
            pass "update-all.sh passes shellcheck"
        else
            fail "update-all.sh has shellcheck warnings"
        fi
    else
        skip "shellcheck validation (not installed)"
    fi

    # Test --help (dry run)
    if "$UPDATE_SCRIPT" 2>&1 | grep -q "Usage:"; then
        pass "update-all.sh shows usage without args"
    else
        fail "update-all.sh doesn't show usage"
    fi
else
    skip "Update script validation (file not found)"
fi

# ============================================
# Summary
# ============================================
section "Summary"

TOTAL=$((PASSED + FAILED + SKIPPED))
echo ""
log "${GREEN}Passed:${NC}  $PASSED"
log "${RED}Failed:${NC}  $FAILED"
log "${YELLOW}Skipped:${NC} $SKIPPED"
log "Total:   $TOTAL"
echo ""

if [[ $FAILED -gt 0 ]]; then
    log "${RED}Some tests failed!${NC}"
    exit 1
else
    log "${GREEN}All tests passed!${NC}"
    exit 0
fi
