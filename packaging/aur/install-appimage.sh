#!/bin/bash
# Direct AppImage installer for Eigent
# Usage: ./install-appimage.sh [version]
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION="${1:-$(grep '^pkgver=' "$SCRIPT_DIR/PKGBUILD" 2>/dev/null | cut -d'=' -f2)}"
INSTALL_DIR="${HOME}/.local/bin"
DESKTOP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons"
# Note: URL also in update-version.sh and PKGBUILD
URL="https://github.com/eigent-ai/eigent/releases/download/v${VERSION}/Eigent-${VERSION}.AppImage"

if [[ -z "$VERSION" ]]; then
    echo "Usage: $0 <version>"
    echo "Example: $0 0.0.80"
    exit 1
fi

echo "Installing Eigent v${VERSION}..."
mkdir -p "$INSTALL_DIR" "$DESKTOP_DIR" "$ICON_DIR"

echo "Downloading from $URL..."
curl -fSL -o "$INSTALL_DIR/Eigent-${VERSION}.AppImage" "$URL"
chmod +x "$INSTALL_DIR/Eigent-${VERSION}.AppImage"

ln -sf "$INSTALL_DIR/Eigent-${VERSION}.AppImage" "$INSTALL_DIR/eigent"

# Extract icon from AppImage
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT
cd "$TMPDIR"
"$INSTALL_DIR/Eigent-${VERSION}.AppImage" --appimage-extract "*.png" >/dev/null 2>&1 || true
if [[ -f "squashfs-root/eigent.png" ]]; then
    cp "squashfs-root/eigent.png" "$ICON_DIR/eigent.png"
fi
cd - >/dev/null

# Create desktop entry
cat > "$DESKTOP_DIR/eigent.desktop" << EOF
[Desktop Entry]
Name=Eigent
Comment=AI-powered desktop agent for browser automation
Exec=$INSTALL_DIR/eigent %U
Icon=$ICON_DIR/eigent.png
Terminal=false
Type=Application
Categories=Utility;Development;
StartupWMClass=Eigent
EOF

echo ""
echo "Installed: $INSTALL_DIR/Eigent-${VERSION}.AppImage"
echo "Symlink: $INSTALL_DIR/eigent"
echo "Desktop: $DESKTOP_DIR/eigent.desktop"
echo ""
echo "Make sure $INSTALL_DIR is in your PATH, then run: eigent"
