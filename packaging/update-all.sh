#!/bin/bash
# Update all packaging files to a new version
# Usage: ./update-all.sh <version> [--verify]
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION="$1"
FLAG="$2"
HASH=""

if [[ -z "$VERSION" ]]; then
    echo "Usage: $0 <version> [--verify]"
    echo ""
    echo "Options:"
    echo "  --verify    Download AppImage and calculate SHA256"
    echo ""
    echo "Example:"
    echo "  $0 0.0.81 --verify"
    exit 1
fi

echo "Updating all packaging to v${VERSION}..."

# Calculate hash if --verify
if [[ "$FLAG" == "--verify" ]]; then
    URL="https://github.com/eigent-ai/eigent/releases/download/v${VERSION}/Eigent-${VERSION}.AppImage"
    TMPFILE=$(mktemp)
    trap "rm -f $TMPFILE" EXIT

    echo "Downloading $URL..."
    curl -fSL -o "$TMPFILE" "$URL"
    HASH=$(sha256sum "$TMPFILE" | cut -d' ' -f1)
    echo "SHA256: $HASH"
fi

# ============================================
# AUR
# ============================================
echo ""
echo "Updating AUR..."
cd "$SCRIPT_DIR/aur"

sed -i "s/^pkgver=.*/pkgver=$VERSION/" PKGBUILD
sed -i "s/^pkgrel=.*/pkgrel=1/" PKGBUILD

if [[ -n "$HASH" ]]; then
    sed -i "s/^sha256sums=.*/sha256sums=('$HASH')/" PKGBUILD
fi

# Generate .SRCINFO if makepkg available
if command -v makepkg &> /dev/null; then
    makepkg --printsrcinfo > .SRCINFO
    echo "  ✓ PKGBUILD + .SRCINFO"
else
    echo "  ✓ PKGBUILD (makepkg not available, .SRCINFO not updated)"
fi

# ============================================
# Flatpak
# ============================================
echo ""
echo "Updating Flatpak..."
cd "$SCRIPT_DIR/flatpak"

# Update manifest
sed -i "s|/v[0-9.]*\/Eigent-[0-9.]*.AppImage|/v${VERSION}/Eigent-${VERSION}.AppImage|g" ai.eigent.Eigent.yml
if [[ -n "$HASH" ]]; then
    sed -i "s/sha256: .*/sha256: $HASH/" ai.eigent.Eigent.yml
fi

# Update metainfo release version and date
TODAY=$(date +%Y-%m-%d)
sed -i "s/version=\"[0-9.]*\" date=\"[0-9-]*\"/version=\"$VERSION\" date=\"$TODAY\"/" ai.eigent.Eigent.metainfo.xml

echo "  ✓ ai.eigent.Eigent.yml + metainfo.xml"

# ============================================
# Debian
# ============================================
echo ""
echo "Updating Debian..."
cd "$SCRIPT_DIR/deb"

sed -i "s/VERSION=\"\${1:-[0-9.]*}\"/VERSION=\"\${1:-$VERSION}\"/" build-deb.sh

echo "  ✓ build-deb.sh"

# ============================================
# Nix
# ============================================
echo ""
echo "Updating Nix..."
cd "$SCRIPT_DIR/nix"

sed -i "s/version = \"[0-9.]*\";/version = \"$VERSION\";/" flake.nix
if [[ -n "$HASH" ]]; then
    # Convert hex hash to base64 for Nix SRI format
    NIX_HASH=$(echo "$HASH" | xxd -r -p | base64 | tr -d '\n')
    sed -i "s|sha256 = \"sha256-.*\";|sha256 = \"sha256-$NIX_HASH\";|g" flake.nix
fi

echo "  ✓ flake.nix"

# ============================================
# RPM
# ============================================
echo ""
echo "Updating RPM..."
cd "$SCRIPT_DIR/rpm"

if [[ -f "eigent.spec" ]]; then
    sed -i "s/^Version:.*/Version:        $VERSION/" eigent.spec
    if [[ -n "$HASH" ]]; then
        # Store hash in a separate file for RPM builds
        echo "$HASH" > sha256sum.txt
    fi
    echo "  ✓ eigent.spec"
else
    echo "  - eigent.spec not found, skipping"
fi

# ============================================
# Done
# ============================================
echo ""
echo "================================================"
echo "Updated all packaging to v${VERSION}"
[[ -n "$HASH" ]] && echo "SHA256: $HASH"
echo "================================================"
