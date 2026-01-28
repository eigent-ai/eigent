#!/bin/bash
# Direct AppImage installer for Eigent
# Usage: ./install-appimage.sh [version]
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION="${1:-$(grep '^pkgver=' "$SCRIPT_DIR/PKGBUILD" | cut -d'=' -f2)}"
INSTALL_DIR="${HOME}/.local/bin"
# Note: URL also in update-version.sh and PKGBUILD
URL="https://github.com/eigent-ai/eigent/releases/download/v${VERSION}/Eigent-${VERSION}.AppImage"

echo "Installing Eigent v${VERSION}..."
mkdir -p "$INSTALL_DIR"

echo "Downloading from $URL..."
curl -fSL -o "$INSTALL_DIR/Eigent-${VERSION}.AppImage" "$URL"
chmod +x "$INSTALL_DIR/Eigent-${VERSION}.AppImage"

ln -sf "$INSTALL_DIR/Eigent-${VERSION}.AppImage" "$INSTALL_DIR/eigent"

echo ""
echo "Installed: $INSTALL_DIR/Eigent-${VERSION}.AppImage"
echo "Symlink: $INSTALL_DIR/eigent"
echo ""
echo "Make sure $INSTALL_DIR is in your PATH, then run: eigent"
